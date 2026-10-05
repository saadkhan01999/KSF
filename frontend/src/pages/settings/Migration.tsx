/* ==========================================================================
   Settings › Bring your data across
   --------------------------------------------------------------------------
   The import wizard: choose what, upload, check the columns, validate,
   look at the problems, import, read the report.

   The screen's job is to make the problems easy to deal with rather than
   easy to ignore. A row that cannot be imported is never quietly dropped —
   it is listed with the reason, and there is a control beside it to correct
   it, skip it, or merge it into the record that already exists. The counts
   are shown adding up to the number of rows in the file, so nobody has to
   take on trust that nothing went missing.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database, Upload, ArrowRight, ArrowLeft, Check, X, AlertTriangle,
  FileText, Undo2, Info, Download, Scale
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction } from '../../hooks/useApi';
import { api, ApiError } from '../../services/api';
import {
  Button, Card, Modal, ConfirmDialog, Alert, CardSkeleton, EmptyState,
  Badge, SelectInput, TextInput, Tabs, TableSkeleton
} from '../../components/ui';
import { FileDrop, StatusNote, UpgradeNotice, DetailRow, StepUpDialog } from '../../components/account-ui';
import { dateTime, ago, number, rupees, downloadCsv } from '../../utils/format';
import type {
  MigrationCategory, MigrationJobSummary, MigrationJobDetail, ValidationSummary, MigrationItem
} from '../../types';

interface CategoriesReply {
  data: MigrationCategory[];
  maxRows: number;
  maxFileMb: number;
  formats: string[];
  available: boolean;
  order: string[];
  guidance: string;
}

interface UploadReply {
  job: { id: string; category: string; categoryLabel: string; fileName: string; totalRows: number; status: string };
  columns: string[];
  mapping: Record<string, string | null>;
  fields: { key: string; label: string; required: boolean; type: string; hint: string }[];
  sampleRows: Record<string, string>[];
  sanitised: number;
  truncated: boolean;
  note: string | null;
  warning: string | null;
}

interface TemplateReply {
  category: string;
  label: string;
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
  required: string[];
  notes: string[];
}

/* What landed against what was in the file. The screen shows it next to the
   report because the two answer different questions: the report says what the
   import did, this says whether it is complete. */
interface ReconciliationReply {
  counts: { inFile: number; imported: number; skipped: number; notImported: number; label: string };
  totals: { label: string; unit: 'paisa' | 'count'; inFile: number; imported: number; difference: number } | null;
  notImported: { row: number; status: string; reasons: string[] }[];
  notImportedTruncated: number;
  statement: string;
  howToCheck: string;
}

type Stage = 'choose' | 'map' | 'review' | 'done';

export function Migration() {
  const { ok, fail, hasFeature, subscription, user } = useApp();
  const { busy, run } = useAction();

  const { data: catalogue, loading } = useApiData<CategoriesReply>('/migration/categories');
  const { data: jobs, reload: reloadJobs } = useApiData<{ data: MigrationJobSummary[] }>('/migration/jobs');

  const [stage, setStage] = useState<Stage>('choose');
  const [category, setCategory] = useState('medicines');
  const [upload, setUpload] = useState<UploadReply | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [detail, setDetail] = useState<MigrationJobDetail | null>(null);
  const [itemFilter, setItemFilter] = useState<'error' | 'valid' | 'skipped' | 'imported'>('error');
  const [fixing, setFixing] = useState<MigrationItem | null>(null);
  const [fixValues, setFixValues] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MigrationJobDetail | null>(null);
  /* Undoing an import removes records, so the server asks for the password
     again. Ask here first rather than letting the call fail. */
  const [stepUpFor, setStepUpFor] = useState<string | null>(null);
  /* A file the server has seen before, held until the person says whether
     they meant it. */
  const [duplicate, setDuplicate] = useState<{ file: File; message: string } | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReply | null>(null);

  const available = hasFeature('migration.import');

  /* --------------------------------------------------------------- load -- */
  const loadDetail = useCallback(async (jobId: string, status = itemFilter) => {
    const reply = await api.get<MigrationJobDetail>(`/migration/jobs/${jobId}?status=${status}&size=100`);
    setDetail(reply);
    return reply;
  }, [itemFilter]);

  useEffect(() => {
    if (stage === 'review' && upload) void loadDetail(upload.job.id, itemFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFilter]);

  /* ----------------------------------------------------------- template -- */
  /* The file is written in the browser, from the headers and example rows the
     server describes — the same way every report on this system is exported. */
  const downloadTemplate = async () => {
    const reply = await run(() => api.get<TemplateReply>(`/migration/template/${category}`));
    if (!reply) return;
    downloadCsv(reply.filename, reply.rows);
    ok(`${reply.label} template saved`, 'Fill it in, delete the two example rows, and bring it back here.');
  };

  /* ------------------------------------------------------------- upload -- */
  const takeFile = async (file: File, allowDuplicate = false) => {
    const content = await new Promise<string>((resolvePromise, rejectPromise) => {
      const reader = new FileReader();
      reader.onload = () => resolvePromise(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => rejectPromise(new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });

    /* Not wrapped in run(): a file the server has already imported is not a
       failure to report, it is a question to ask. */
    let reply: UploadReply;
    try {
      reply = await api.post<UploadReply>('/migration/jobs', {
        category, fileName: file.name, content, allowDuplicate
      });
    } catch (problem) {
      if (problem instanceof ApiError && problem.code === 'duplicate_file') {
        setDuplicate({ file, message: problem.message });
        return;
      }
      fail(problem);
      return;
    }

    setDuplicate(null);
    setUpload(reply);
    setMapping(reply.mapping);
    setValidation(null);
    setReconciliation(null);
    setStage('map');
    if (reply.warning) ok('File read', reply.warning);
  };

  /* ----------------------------------------------------------- validate -- */
  const validate = async () => {
    if (!upload) return;
    const reply = await run(() => api.post<ValidationSummary>(`/migration/jobs/${upload.job.id}/validate`, { mapping }));
    if (!reply) return;
    setValidation(reply);
    setItemFilter(reply.errors ? 'error' : 'valid');
    await loadDetail(upload.job.id, reply.errors ? 'error' : 'valid');
    setStage('review');
  };

  /* -------------------------------------------------------------- fixes -- */
  const resolveItem = async (item: MigrationItem, resolution: string, values?: Record<string, string>) => {
    if (!upload) return;
    const reply = await run(() => api.post(`/migration/jobs/${upload.job.id}/items/${item.id}`, { resolution, values }));
    if (!reply) return;
    setFixing(null);
    const refreshed = await run(() => api.post<ValidationSummary>(`/migration/jobs/${upload.job.id}/validate`, { mapping }));
    if (refreshed) setValidation(refreshed);
    await loadDetail(upload.job.id, itemFilter);
  };

  /* ------------------------------------------------------------- import -- */
  const startImport = async () => {
    if (!upload) return;
    setImporting(true);
    const reply = await run(() => api.post<{ report: MigrationJobDetail['job']['report']; message: string }>(
      `/migration/jobs/${upload.job.id}/import`, {}
    ));
    setImporting(false);
    if (!reply) return;
    ok('Import finished', reply.message);
    await loadDetail(upload.job.id, 'error');
    /* Fetched rather than derived: the figures have to come from the rows the
       server wrote, not from anything this screen was holding. */
    setReconciliation(await api.get<ReconciliationReply>(`/migration/jobs/${upload.job.id}/reconciliation`));
    setStage('done');
    void reloadJobs();
  };

  const rollback = async () => {
    if (!rollingBack) return;
    setStepUpFor(rollingBack);
    setRollingBack(null);
  };

  const doRollback = async (jobId: string) => {
    const reply = await run(() => api.post<{ message: string }>(`/migration/jobs/${jobId}/rollback`, {}));
    setRollingBack(null);
    if (!reply) return;
    ok('Import rolled back', reply.message);
    void reloadJobs();
    setStage('choose');
    setUpload(null);
  };

  const restart = () => {
    setStage('choose');
    setUpload(null);
    setValidation(null);
    setDetail(null);
    setReconciliation(null);
  };

  /* ------------------------------------------------------------- render -- */

  const fields = upload?.fields ?? [];
  const missingRequired = useMemo(
    () => fields.filter((field) => field.required && !mapping[field.key]),
    [fields, mapping]
  );

  if (loading) return <CardSkeleton count={2} />;

  if (!available) {
    return (
      <Card title="Bring your data across" subtitle="Import your catalogue, stock and customers" icon={<Database size={18} />}>
        <UpgradeNotice
          feature="Importing data from another system"
          plan={subscription?.planName}
          onUpgrade={() => { window.location.href = '/settings?tab=billing'; }}
        />
        <p className="card-note">
          Everything already in your pharmacy stays exactly as it is. This screen is about
          bringing more in, not about what you already have.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid">
      {/* ------------------------------ 1. choose -------------------------- */}
      {stage === 'choose' && (
        <>
          <Card
            title="Bring your data across"
            subtitle="From your old system, in an afternoon"
            icon={<Database size={18} />}
          >
            <StatusNote tone="info" title="Do it in this order">
              {catalogue?.guidance}
            </StatusNote>

            <SelectInput
              label="What kind of records are in the file?"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={(catalogue?.order ?? []).map((key) => {
                const found = catalogue?.data.find((item) => item.key === key);
                return { value: key, label: found?.label ?? key };
              })}
              hint={catalogue?.data.find((item) => item.key === category)?.description}
            />

            <div className="card-actions">
              <Button variant="outline" icon={<Download size={15} />} onClick={() => { void downloadTemplate(); }} loading={busy}>
                Download a blank template
              </Button>
              <span className="card-note">
                Two example rows show the shape of every column. A template you fill in maps
                itself with nothing to correct.
              </span>
            </div>

            <FileDrop
              onFile={(file) => { void takeFile(file); }}
              busy={busy}
              maxMb={catalogue?.maxFileMb ?? 9}
              hint={`${catalogue?.formats.join(', ')} — up to ${number(catalogue?.maxRows ?? 20000)} rows`}
            />

            <details className="optional-details">
              <summary>What KSF expects to find in the file</summary>
              <ul className="field-hint-list">
                {catalogue?.data.find((item) => item.key === category)?.fields.map((field) => (
                  <li key={field.key}>
                    <strong>{field.label}</strong>
                    {field.required ? <Badge tone="warn">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                    {field.hint && <span>{field.hint}</span>}
                  </li>
                ))}
              </ul>
              <p className="card-note">
                Your column names do not have to match. KSF recognises what old systems
                usually call these, and you can correct any of it on the next screen.
              </p>
            </details>
          </Card>

          {/* ------------------------- previous imports ------------------- */}
          <Card title="Previous imports" subtitle="Every job, and what became of it" icon={<FileText size={18} />}>
            {!jobs ? <TableSkeleton rows={3} columns={5} /> : jobs.data.length === 0 ? (
              <EmptyState title="Nothing imported yet" message="Once you bring a file across it will be listed here, with its report." />
            ) : (
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col">What</th>
                      <th scope="col">When</th>
                      <th scope="col">Result</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.data.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <strong>{job.file_name}</strong>
                          <div className="muted">by {job.created_by_name ?? 'unknown'}</div>
                        </td>
                        <td>{job.category}</td>
                        <td>{ago(job.created_at)}</td>
                        <td>
                          {job.rolled_back_at ? (
                            <Badge tone="neutral">Rolled back</Badge>
                          ) : job.status === 'completed' ? (
                            <>
                              <Badge tone="ok">{job.imported_rows} imported</Badge>
                              {job.error_rows > 0 && <Badge tone="warn">{job.error_rows} to fix</Badge>}
                            </>
                          ) : (
                            <Badge tone="neutral">{job.status}</Badge>
                          )}
                        </td>
                        <td className="row-tight">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              void api.get<MigrationJobDetail>(`/migration/jobs/${job.id}?status=error&size=100`)
                                .then(setViewing)
                                .catch(fail);
                            }}
                          >
                            Report
                          </Button>
                          {job.status === 'completed' && !job.rolled_back_at && (
                            <Button variant="ghost" icon={<Undo2 size={14} />} onClick={() => setRollingBack(job.id)}>
                              Undo
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* -------------------------------- 2. map --------------------------- */}
      {stage === 'map' && upload && (
        <Card
          title={`Match the columns in ${upload.job.fileName}`}
          subtitle={`${number(upload.job.totalRows)} rows found`}
          icon={<ArrowRight size={18} />}
          actions={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={restart}>Start again</Button>}
        >
          {upload.warning && <Alert tone="warn" title="Some cells were made safe">{upload.warning}</Alert>}
          {upload.note && <Alert tone="info">{upload.note}</Alert>}

          <StatusNote tone="info" title="Nothing has been written yet">
            KSF has read the file and guessed which column is which. Check the matches below —
            especially cost against retail price, which old systems name inconsistently.
          </StatusNote>

          <div className="table-scroll">
            <table className="tbl map-table">
              <thead>
                <tr>
                  <th scope="col">KSF field</th>
                  <th scope="col">Your column</th>
                  <th scope="col">First row in your file</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const chosen = mapping[field.key];
                  const sample = chosen ? upload.sampleRows[0]?.[chosen] : '';
                  return (
                    <tr key={field.key} className={field.required && !chosen ? 'is-missing' : ''}>
                      <th scope="row">
                        {field.label}
                        {field.required && <Badge tone="warn">Required</Badge>}
                        {field.hint && <div className="muted">{field.hint}</div>}
                      </th>
                      <td>
                        <SelectInput
                          aria-label={`Column for ${field.label}`}
                          value={chosen ?? ''}
                          onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || null })}
                          placeholder="— not in my file —"
                          options={upload.columns.map((column) => ({ value: column, label: column }))}
                        />
                      </td>
                      <td className="muted">{sample || <span className="tone-dim">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {missingRequired.length > 0 && (
            <Alert tone="warn" title="Some required fields have no column">
              Choose a column for: {missingRequired.map((field) => field.label).join(', ')}.
            </Alert>
          )}

          <div className="card-actions">
            <Button
              variant="primary" loading={busy} disabled={missingRequired.length > 0}
              icon={<ArrowRight size={15} />}
              onClick={() => { void validate(); }}
            >
              Check the file
            </Button>
            <Button variant="ghost" onClick={restart}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* ------------------------------ 3. review -------------------------- */}
      {stage === 'review' && validation && upload && (
        <Card
          title="What KSF found"
          subtitle={`${upload.job.fileName} — nothing has been written yet`}
          icon={<AlertTriangle size={18} />}
          actions={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStage('map')}>Back to the columns</Button>}
        >
          <div className="validation-summary">
            <div className="tone-ok"><strong>{validation.valid}</strong><span>ready to import</span></div>
            <div className="tone-warn"><strong>{validation.errors}</strong><span>need attention</span></div>
            <div className="tone-neutral"><strong>{validation.skipped}</strong><span>you chose to skip</span></div>
            <div className="tone-info"><strong>{validation.total}</strong><span>rows in the file</span></div>
          </div>

          <StatusNote tone="info" title="Nothing is thrown away">
            Rows that cannot be imported are kept exactly as they arrived, with the reason.
            Correct one, skip it, or merge it into the record you already have — and import
            the rest whenever you are ready.
          </StatusNote>

          <Tabs
            value={itemFilter}
            onChange={(value) => setItemFilter(value)}
            tabs={[
              { value: 'error' as const, label: `Need attention (${validation.errors})` },
              { value: 'valid' as const, label: `Ready (${validation.valid})` },
              { value: 'skipped' as const, label: `Skipped (${validation.skipped})` },
              { value: 'imported' as const, label: 'Imported' }
            ]}
          />

          {!detail ? <TableSkeleton rows={5} columns={4} /> : detail.items.length === 0 ? (
            <EmptyState
              title={itemFilter === 'error' ? 'Nothing needs attention' : 'Nothing here'}
              message={itemFilter === 'error' ? 'Every row in the file can be imported as it is.' : undefined}
            />
          ) : (
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">What is in it</th>
                    <th scope="col">What is wrong</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="num">{item.rowNumber}</td>
                      <td>
                        <div className="row-preview">
                          {Object.entries(item.raw).slice(0, 4).map(([key, value]) => (
                            <span key={key}><em>{key}:</em> {value || '—'}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <ul className="problem-list">
                          {item.problems.map((problem, index) => (
                            <li key={index} className={problem.fixable ? 'is-error' : 'is-warning'}>
                              {problem.fixable ? <X size={13} /> : <Info size={13} />}
                              {problem.message}
                            </li>
                          ))}
                          {item.problems.length === 0 && <li className="is-ok"><Check size={13} /> Ready</li>}
                        </ul>
                      </td>
                      <td className="row-tight">
                        {item.status === 'error' && (
                          <>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setFixing(item);
                                setFixValues(Object.fromEntries(
                                  fields.map((field) => [
                                    field.key,
                                    String((item.mapped as Record<string, unknown>)[field.key] ?? '')
                                  ])
                                ));
                              }}
                            >
                              Correct it
                            </Button>
                            {item.problems.some((p) => p.code === 'duplicate_existing') && (
                              <Button variant="ghost" onClick={() => { void resolveItem(item, 'merge'); }}>
                                Merge
                              </Button>
                            )}
                            <Button variant="ghost" onClick={() => { void resolveItem(item, 'skip'); }}>
                              Skip
                            </Button>
                          </>
                        )}
                        {item.status === 'skipped' && (
                          <Button variant="ghost" onClick={() => { void resolveItem(item, 'retry'); }}>
                            Put it back
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card-actions">
            <Button
              variant="primary" size="lg" loading={importing}
              disabled={!validation.canImport}
              icon={<Upload size={16} />}
              onClick={() => { void startImport(); }}
            >
              Import {validation.valid} record(s)
            </Button>
            <Button variant="ghost" onClick={restart}>Cancel this import</Button>
          </div>

          <p className="card-note">
            A backup of the affected table is taken before anything is written, and the whole
            import can be undone afterwards.
          </p>
        </Card>
      )}

      {/* ------------------------------- 4. done --------------------------- */}
      {stage === 'done' && detail?.job.report && (
        <Card title="Import finished" subtitle={detail.job.fileName} icon={<Check size={18} />}>
          <div className="validation-summary">
            <div className="tone-ok"><strong>{detail.job.report.imported}</strong><span>imported</span></div>
            <div className="tone-neutral"><strong>{detail.job.report.skipped}</strong><span>skipped</span></div>
            <div className="tone-warn"><strong>{detail.job.report.stillToFix}</strong><span>still to fix</span></div>
            <div className="tone-info"><strong>{detail.job.report.total}</strong><span>rows in the file</span></div>
          </div>

          <StatusNote tone="ok" title="The numbers add up">
            {detail.job.report.reconciliation}
          </StatusNote>

          <dl className="detail-list">
            {detail.job.report.merged > 0 && (
              <DetailRow label="Merged into existing records">{detail.job.report.merged}</DetailRow>
            )}
            {detail.job.report.categoriesCreated > 0 && (
              <DetailRow label="Categories created">{detail.job.report.categoriesCreated}</DetailRow>
            )}
            <DetailRow label="Backup taken before the import">
              <code className="muted">{detail.job.report.backupPath}</code>
            </DetailRow>
            <DetailRow label="Finished">{dateTime(detail.job.report.finishedAt)}</DetailRow>
          </dl>

          {detail.job.report.stillToFix > 0 && (
            <Alert tone="warn" title={`${detail.job.report.stillToFix} row(s) were not imported`}>
              They are saved with their reasons and nothing was thrown away. Correct them here
              and import them whenever you like.
            </Alert>
          )}

          <div className="card-actions">
            <Button variant="primary" onClick={restart} icon={<Upload size={15} />}>Import something else</Button>
            <Button variant="ghost" icon={<Undo2 size={15} />} onClick={() => setRollingBack(detail.job.id)}>
              Undo this import
            </Button>
          </div>
        </Card>
      )}

      {/* --------------------------- reconciliation ----------------------- */}
      {stage === 'done' && reconciliation && (
        <Card
          title="Check it against your old system"
          subtitle="Two numbers, and where any difference went"
          icon={<Scale size={18} />}
        >
          <StatusNote tone="info" title="How to check">{reconciliation.howToCheck}</StatusNote>

          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">In the file</th>
                  <th scope="col">In KSF</th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>{reconciliation.counts.label}</strong></td>
                  <td>{number(reconciliation.counts.inFile)}</td>
                  <td>{number(reconciliation.counts.imported)}</td>
                  <td className={reconciliation.counts.inFile === reconciliation.counts.imported ? '' : 't-warn'}>
                    {number(reconciliation.counts.inFile - reconciliation.counts.imported)}
                  </td>
                </tr>
                {reconciliation.totals && (
                  <tr>
                    <td><strong>{reconciliation.totals.label}</strong></td>
                    <td>
                      {reconciliation.totals.unit === 'paisa'
                        ? rupees(reconciliation.totals.inFile)
                        : number(reconciliation.totals.inFile)}
                    </td>
                    <td>
                      {reconciliation.totals.unit === 'paisa'
                        ? rupees(reconciliation.totals.imported)
                        : number(reconciliation.totals.imported)}
                    </td>
                    <td className={reconciliation.totals.difference === 0 ? '' : 't-warn'}>
                      {reconciliation.totals.unit === 'paisa'
                        ? rupees(reconciliation.totals.difference)
                        : number(reconciliation.totals.difference)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="card-note">{reconciliation.statement}</p>

          {reconciliation.notImported.length > 0 && (
            <details className="optional-details" open>
              <summary>The {reconciliation.notImported.length} row(s) that account for the difference</summary>
              <ul className="field-hint-list">
                {reconciliation.notImported.map((row) => (
                  <li key={row.row}>
                    <strong>Row {row.row}</strong>
                    <span>{row.reasons[0] ?? row.status}</span>
                  </li>
                ))}
              </ul>
              {reconciliation.notImportedTruncated > 0 && (
                <p className="card-note">
                  and {number(reconciliation.notImportedTruncated)} more, listed on the import itself.
                </p>
              )}
            </details>
          )}
        </Card>
      )}

      {/* ================================ modals =========================== */}

      {/* A file the server has imported before. The choice is the person's. */}
      <ConfirmDialog
        open={!!duplicate}
        onCancel={() => setDuplicate(null)}
        onConfirm={() => {
          const again = duplicate;
          setDuplicate(null);
          if (again) void takeFile(again.file, true);
        }}
        loading={busy}
        tone="warn"
        title="This file has been imported already"
        confirmLabel="Import it anyway"
        message={
          <>
            {duplicate?.message}
            <br /><br />
            Importing it again will update the records it matches rather than duplicating them,
            but anything it creates fresh will be a second copy. If the first import was wrong,
            undo that one first.
          </>
        }
      />

      <Modal
        open={!!fixing}
        onClose={() => setFixing(null)}
        title={`Correct row ${fixing?.rowNumber ?? ''}`}
        subtitle="Change what is wrong and KSF will check it again"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFixing(null)}>Cancel</Button>
            <Button
              variant="primary" loading={busy}
              onClick={() => { if (fixing) void resolveItem(fixing, 'fix', fixValues); }}
            >
              Check it again
            </Button>
          </>
        }
      >
        {fixing && (
          <>
            <ul className="problem-list">
              {fixing.problems.map((problem, index) => (
                <li key={index} className={problem.fixable ? 'is-error' : 'is-warning'}>
                  {problem.message}
                </li>
              ))}
            </ul>

            <div className="form-grid">
              {fields.map((field) => (
                <TextInput
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  hint={field.hint}
                  error={fixing.problems.find((p) => p.field === field.key)?.message}
                  value={fixValues[field.key] ?? ''}
                  onChange={(e) => setFixValues({ ...fixValues, [field.key]: e.target.value })}
                />
              ))}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Import report"
        subtitle={viewing?.job.fileName}
        size="lg"
        footer={<Button variant="primary" onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing?.job.report ? (
          <>
            <div className="validation-summary">
              <div className="tone-ok"><strong>{viewing.job.report.imported}</strong><span>imported</span></div>
              <div className="tone-neutral"><strong>{viewing.job.report.skipped}</strong><span>skipped</span></div>
              <div className="tone-warn"><strong>{viewing.job.report.stillToFix}</strong><span>still to fix</span></div>
              <div className="tone-info"><strong>{viewing.job.report.total}</strong><span>in the file</span></div>
            </div>
            <StatusNote tone="info">{viewing.job.report.reconciliation}</StatusNote>

            {viewing.items.length > 0 && (
              <>
                <h4>Rows that were not imported</h4>
                <ul className="problem-rows">
                  {viewing.items.map((item) => (
                    <li key={item.id}>
                      <strong>Row {item.rowNumber}</strong>
                      <ul className="problem-list">
                        {item.problems.map((problem, index) => <li key={index}>{problem.message}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <EmptyState title="No report" message="That import did not finish, so there is no report to show." />
        )}
      </Modal>

      <StepUpDialog
        open={!!stepUpFor}
        onClose={() => setStepUpFor(null)}
        needsCode={!!user?.twoFactorEnabled}
        reason="Undoing an import removes records, so your password is needed again."
        onVerified={() => { if (stepUpFor) void doRollback(stepUpFor); setStepUpFor(null); }}
      />

      <ConfirmDialog
        open={!!rollingBack}
        onCancel={() => setRollingBack(null)}
        onConfirm={rollback}
        tone="danger"
        title="Undo this import?"
        message="Exactly the records this import created will be removed — nothing else. Records that were merged into rows you already had are left alone, because deleting those would take your own data with them. You will be asked for your password."
        confirmLabel="Undo the import"
        loading={busy}
      />
    </div>
  );
}

export default Migration;
