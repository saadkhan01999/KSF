/* ==========================================================================
   Data migration — Settings, Bring your data across
   --------------------------------------------------------------------------
   The endpoints behind the import wizard. Every one checks the job belongs
   to the pharmacy asking, so a job id from somebody else's shop answers "not
   found" rather than their data.

   Files arrive base64-encoded in the JSON body: a third more bytes, no
   multipart parser, and the 12 MB body limit still leaves about 9 MB of
   file — far more than any pharmacy catalogue.
   ========================================================================== */

import { bad, HttpError, missing, tooMany } from '../core/errors.js';
import { auditLog, logActivity, notify } from '../core/trails.js';
import { rateLimit, toInt, toStr } from '../core/util.js';
import { col } from '../db/mongo.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { hasFeature } from '../services/subscriptions.js';
import { CATEGORIES, categoryList, createJob, jobDetail, listJobs, resolveItem, rollbackJob, runImport, suggestMapping, validateJob } from '../services/migration.js';
import { reconciliation, template } from '../services/migration-report.js';
import { MAX_ROWS } from '../services/tabular.js';
import { refreshStockAlerts } from './shared.js';

/* Importing rewrites the catalogue, so it sits behind the same permission as
   editing it — and behind the plan feature, checked here on the server. */
async function requireImportRights(ctx: PharmacyCtx): Promise<void> {
  ctx.require('medicines.write');
  if (!ctx.supportMode && !await hasFeature(ctx.pharmacyId, 'migration.import')) {
    const error = new HttpError(402, 'Importing data is part of the paid plans. Your records are all still here — upgrade whenever you are ready.');
    error.code = 'upgrade_required';
    throw error;
  }
}

route('GET', '/api/v1/migration/categories', 'medicines.read', async (ctx) => ({
  data: categoryList(),
  maxRows: MAX_ROWS,
  maxFileMb: 9,
  formats: ['CSV', 'Excel (.xlsx)', 'JSON'],
  available: ctx.supportMode || await hasFeature(ctx.pharmacyId, 'migration.import'),
  order: ['suppliers', 'medicines', 'batches', 'customers', 'sales', 'sale_items', 'purchases', 'prescriptions'],
  guidance: 'Import in this order: suppliers, then medicines, then stock, then customers, then history. '
    + 'Each step can only match what is already here — a batch needs its medicine, an invoice line needs its invoice.'
}));

/* A file to start from, as headers and rows: the browser already writes CSV
   for every report, and JSON avoids encoding surprises in Excel. */
route('GET', '/api/v1/migration/template/:category', 'medicines.read', async (ctx) => {
  const made = template(toStr(ctx.params.category, 30));
  if (!made) return missing('There is no template for that.');
  return made;
});

route('GET', '/api/v1/migration/jobs', 'medicines.read', async (ctx) => ({ data: await listJobs(ctx.pharmacyId) }));

route('GET', '/api/v1/migration/jobs/:id', 'medicines.read', async (ctx) => {
  const detail = await jobDetail({
    jobId: ctx.params.id, pharmacyId: ctx.pharmacyId, status: toStr(ctx.query.get('status'), 20) || null,
    page: Math.max(1, toInt(ctx.query.get('page'), 1)), size: Math.min(200, Math.max(1, toInt(ctx.query.get('size'), 50)))
  });
  if (!detail) return missing('That import could not be found.');
  return detail;
});

route('POST', '/api/v1/migration/jobs', 'medicines.write', async (ctx) => {
  await requireImportRights(ctx);
  const limit = rateLimit(`mig:${ctx.user.id}`, 20, 60 * 60_000);
  if (!limit.ok) tooMany('Too many imports started in the last hour. Please wait before starting another.', limit.retryAfter);

  const category = toStr(ctx.body.category, 30);
  if (!CATEGORIES[category]) bad('Choose what kind of records this file holds.', 'category');
  const fileName = toStr(ctx.body.fileName, 200);
  if (!fileName) bad('The file needs a name so we can tell what it is.', 'fileName');
  const encoded = String(ctx.body.content || '');
  if (!encoded) bad('No file was received. Try choosing it again.', 'content');
  const payload = encoded.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]*$/.test(payload.slice(0, 2000))) bad('That upload was not encoded correctly.', 'content');
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) bad('That file appears to be empty.', 'content');
  if (buffer.length > 9_000_000) bad('That file is larger than 9 MB. Split it and import the parts one at a time.', 'content');

  const result = await createJob({
    pharmacyId: ctx.pharmacyId, userId: ctx.user.id, userName: ctx.user.full_name, category, fileName, buffer,
    /* Asked for deliberately, after being told which earlier import the file matches. */
    allowDuplicate: ctx.body.allowDuplicate === true
  });
  if (!result.ok) {
    if ('duplicateOf' in result && result.duplicateOf) {
      /* 409: nothing is wrong with the file — it has been imported already. */
      const error = new HttpError(409, result.reason, 'content');
      error.code = 'duplicate_file';
      error.details = { duplicateOf: result.duplicateOf };
      throw error;
    }
    return bad(result.reason, 'content');
  }

  await logActivity(ctx, { action: 'migration.uploaded', entity: 'migration', entityId: result.job.id, summary: `${fileName} uploaded for ${CATEGORIES[category].label} (${result.job.total_rows} rows)` });
  return {
    job: { id: result.job.id, category, categoryLabel: CATEGORIES[category].label, fileName, source: result.job.source, totalRows: result.job.total_rows, status: result.job.status },
    columns: result.columns, mapping: result.mapping,
    fields: CATEGORIES[category].fields.map((field) => ({ key: field.key, label: field.label, required: field.required, type: field.type, hint: field.hint })),
    sampleRows: result.sampleRows, sanitised: result.sanitised, truncated: result.truncated, note: result.note,
    warning: result.sanitised ? `${result.sanitised} cell(s) began with a spreadsheet formula character. They have been quoted so they cannot run if you export this data again.` : null,
    __status: 201
  };
});

route('POST', '/api/v1/migration/jobs/:id/suggest-mapping', 'medicines.write', async (ctx) => {
  const job = await col.migrationJobs().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId }, { projection: { category: 1, columns: 1 } });
  if (!job) return missing('That import could not be found.');
  return { mapping: suggestMapping(job.category, job.columns) };
});

route('POST', '/api/v1/migration/jobs/:id/validate', 'medicines.write', async (ctx) => {
  await requireImportRights(ctx);
  const mapping = ctx.body.mapping && typeof ctx.body.mapping === 'object' ? ctx.body.mapping as Record<string, string | null> : null;
  const result = await validateJob({ jobId: ctx.params.id, pharmacyId: ctx.pharmacyId, mapping });
  if (!result.ok) return bad(result.reason);
  return {
    ...result,
    message: result.errors
      ? `${result.valid} row(s) are ready. ${result.errors} need attention — none of them will be thrown away.`
      : `All ${result.valid} row(s) are ready to import.`
  };
});

route('POST', '/api/v1/migration/jobs/:id/items/:itemId', 'medicines.write', async (ctx) => {
  await requireImportRights(ctx);
  const resolution = toStr(ctx.body.resolution, 20);
  if (!['fix', 'skip', 'default', 'merge', 'retry'].includes(resolution)) {
    bad('Choose whether to correct this row, skip it, use a default, or merge it into the existing record.', 'resolution');
  }
  const result = await resolveItem({ jobId: ctx.params.id, pharmacyId: ctx.pharmacyId, itemId: ctx.params.itemId, resolution, values: ctx.body.values });
  if ('reason' in result && result.reason) {
    if (/already been imported/.test(result.reason)) bad(result.reason);
    missing(result.reason);
  }
  return result;
});

route('POST', '/api/v1/migration/jobs/:id/import', 'medicines.write', async (ctx) => {
  await requireImportRights(ctx);
  const result = await runImport({ jobId: ctx.params.id, pharmacyId: ctx.pharmacyId, userId: ctx.user.id });
  if (!result.ok) return bad(result.reason);
  const { report } = result;
  await logActivity(ctx, {
    action: 'migration.imported', entity: 'migration', entityId: ctx.params.id, severity: 'warn',
    summary: `${report.imported} record(s) imported from ${report.file}`, meta: { skipped: report.skipped, stillToFix: report.stillToFix }
  });
  await auditLog(ctx, {
    action: 'migration.imported', entity: 'migration', entityId: ctx.params.id, summary: report.reconciliation,
    after: { imported: report.imported, merged: report.merged, skipped: report.skipped, errors: report.stillToFix }
  });
  await notify(ctx.pharmacyId, {
    type: 'system', severity: report.stillToFix ? 'warn' : 'info', title: `${report.imported} record(s) imported`,
    body: report.stillToFix ? `${report.stillToFix} row(s) still need attention — they are saved and waiting, nothing was thrown away.` : 'Every row in the file was imported.',
    link: '/settings?tab=migration'
  });
  /* New stock changes what is low and what is expiring. */
  if (report.category === 'batches' || report.category === 'medicines') await refreshStockAlerts(ctx.pharmacyId);
  return { report, message: report.reconciliation };
});

route('POST', '/api/v1/migration/jobs/:id/rollback', 'medicines.write', async (ctx) => {
  await requireImportRights(ctx);
  /* Undoing an import removes records, so the password is confirmed first. */
  ctx.requireRecentVerification();
  const result = await rollbackJob({ jobId: ctx.params.id, pharmacyId: ctx.pharmacyId });
  if (!result.ok) return bad(result.reason);
  await logActivity(ctx, { action: 'migration.rolled-back', entity: 'migration', entityId: ctx.params.id, severity: 'warn', summary: `Import rolled back: ${result.removed} record(s) removed` });
  await auditLog(ctx, { action: 'migration.rolled-back', entity: 'migration', entityId: ctx.params.id, summary: result.message });
  await refreshStockAlerts(ctx.pharmacyId);
  return result;
});

route('GET', '/api/v1/migration/jobs/:id/report', 'medicines.read', async (ctx) => {
  const detail = await jobDetail({ jobId: ctx.params.id, pharmacyId: ctx.pharmacyId, status: 'error', size: 200 });
  if (!detail) return missing('That import could not be found.');
  return {
    report: detail.job.report, counts: detail.counts, outstanding: detail.items, backupPath: detail.job.backupPath,
    message: 'Rows listed here were not imported. They are kept exactly as they arrived and can be corrected and imported at any time.'
  };
});

/* The two numbers somebody holds against the printout from their old system. */
route('GET', '/api/v1/migration/jobs/:id/reconciliation', 'medicines.read', async (ctx) => {
  const report = await reconciliation({ jobId: toStr(ctx.params.id, 40), pharmacyId: ctx.pharmacyId });
  if (!report) return missing('That import could not be found.');
  return report;
});
