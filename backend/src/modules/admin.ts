/* Workspace bootstrap, expenses, notifications, the activity log, settings
   and the theme. */

import type { Filter } from 'mongodb';
import { VERSION } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { ActivityLog, Expense, Notification } from '../db/types.js';
import { lookupField } from '../db/pipeline.js';
import { bad, forbid, missing } from '../core/errors.js';
import { getSettings, logActivity, setSetting } from '../core/trails.js';
import { addDays, contains, escapeRegex, nowIso, today, toInt, toStr, uid } from '../core/util.js';
import { PERMISSIONS, THEMES, THEME_KEYS, PHARMACY_ADMIN_ROLE } from '../domain/permissions.js';
import { PASSWORD_MIN_LENGTH } from '../security/password.js';
import { accountRoute, route } from '../http/router.js';
import { DISCOUNT_REASONS, onHandMap, pageResult, paging, refreshStockAlerts } from './shared.js';
import { effectiveTheme } from './auth.js';
import { unreadPlatformNotices } from '../core/platform-notices.js';

const permissionCatalogue = PERMISSIONS.map(([key, label, group]) => ({ key, label, group }));
const discountReasons = Object.entries(DISCOUNT_REASONS).map(([value, label]) => ({ value, label }));

/* =============================== BOOTSTRAP ===============================
   One call after sign-in that gives the web app everything it needs to draw
   itself: the pharmacy, its branches, the settings, the theme and the badge
   counts. The platform Super Admin and their team, outside a pharmacy, get
   the platform workspace instead, with the badges their role may see. */
accountRoute('GET', '/api/v1/bootstrap', async (ctx) => {
  const common = {
    permissionCatalogue, passwordMinLength: PASSWORD_MIN_LENGTH, discountReasons, version: VERSION,
    themes: THEMES.map((theme) => ({ ...theme }))
  };

  if (!ctx.pharmacyId) {
    const may = (key: string) => ctx.isPlatformAdmin || ctx.platformPermissions.has(key);
    const [openTickets, pharmacies, notifications] = await Promise.all([
      may('platform.support') ? col.supportTickets().countDocuments({ status: { $in: ['open', 'in_progress'] } }) : 0,
      may('platform.pharmacies.view') ? col.pharmacies().countDocuments({}) : 0,
      ctx.isPlatformAdmin || ctx.isPlatformStaff
        ? col.notifications().countDocuments(unreadPlatformNotices({ userId: ctx.user.id, isPlatformAdmin: ctx.isPlatformAdmin, platformPermissions: ctx.platformPermissions }))
        : 0
    ]);
    return {
      ...common, platform: true, pharmacy: null, branches: [], settings: {},
      badges: { notifications, prescriptionsPending: 0, lowStock: 0, expiring: 0, purchasesOpen: 0, messagesUnread: 0, supportOpen: openTickets, pharmacies },
      theme: await effectiveTheme(ctx.user, ctx.permissions, null), pharmacyTheme: null
    };
  }

  const pharmacyId = ctx.pharmacyId;
  const pharmacy = await col.pharmacies().findOne({ _id: pharmacyId });
  if (!pharmacy) missing('That pharmacy could not be found.');
  const branches = await col.branches().find({ pharmacy_id: pharmacyId, status: 'active' }, {
    projection: { id: 1, name: 1, code: 1, city: 1, is_main: 1, status: 1 }, sort: { is_main: -1, name: 1 }
  }).toArray();
  const settings = await getSettings(pharmacyId);

  const medicines = await col.medicines().find({ pharmacy_id: pharmacyId, status: 'active' }, { projection: { min_stock: 1 } }).toArray();
  const stock = await onHandMap(pharmacyId);
  const unreadMessages = await col.conversations().aggregate<{ n: number }>([
    { $match: { pharmacy_id: pharmacyId, 'members.user_id': ctx.user.id } },
    { $project: { member: { $first: { $filter: { input: '$members', cond: { $eq: ['$$this.user_id', ctx.user.id] } } } } } },
    {
      $lookup: {
        from: 'messages', let: { conversation: '$_id', since: { $ifNull: ['$member.last_read_at', ''] } },
        pipeline: [{
          $match: {
            $expr: {
              $and: [{ $eq: ['$conversation_id', '$$conversation'] }, { $eq: ['$deleted_at', null] },
                { $ne: ['$sender_id', ctx.user.id] }, { $gt: ['$created_at', '$$since'] }]
            }
          }
        }, { $count: 'n' }],
        as: 'unread'
      }
    },
    { $group: { _id: null, n: { $sum: { $ifNull: [{ $first: '$unread.n' }, 0] } } } }
  ]).toArray();

  const [notifications, prescriptionsPending, expiring, purchasesOpen, supportOpen] = await Promise.all([
    col.notifications().countDocuments({ pharmacy_id: pharmacyId, is_read: 0, $or: [{ user_id: null }, { user_id: ctx.user.id }] }),
    col.prescriptions().countDocuments({ pharmacy_id: pharmacyId, status: 'pending' }),
    col.batches().countDocuments({ pharmacy_id: pharmacyId, quantity: { $gt: 0 }, status: { $in: ['active', 'quarantined'] }, expiry_date: { $lte: addDays(90) } }),
    col.purchases().countDocuments({ pharmacy_id: pharmacyId, status: { $in: ['draft', 'ordered'] } }),
    col.supportTickets().countDocuments({ pharmacy_id: pharmacyId, status: { $nin: ['resolved', 'closed'] }, unread_by_pharmacy: 1 })
  ]);

  return {
    ...common, platform: false, supportMode: ctx.supportMode,
    pharmacy: {
      id: pharmacy!.id, name: pharmacy!.name, legalName: pharmacy!.legal_name, phone: pharmacy!.phone, email: pharmacy!.email,
      address: pharmacy!.address, city: pharmacy!.city, province: pharmacy!.province, ntn: pharmacy!.ntn, strn: pharmacy!.strn,
      drapLicence: pharmacy!.drap_licence, currency: pharmacy!.currency, timezone: pharmacy!.timezone,
      gstPercent: pharmacy!.gst_percent, status: pharmacy!.status
    },
    branches, settings,
    badges: {
      notifications, prescriptionsPending, expiring, purchasesOpen, supportOpen,
      lowStock: medicines.filter((m) => (stock.get(m._id) ?? 0) <= m.min_stock).length,
      messagesUnread: unreadMessages[0]?.n ?? 0
    },
    theme: await effectiveTheme(ctx.user, ctx.permissions, settings['appearance.theme'] ?? null),
    pharmacyTheme: settings['appearance.theme'] ?? null
  };
});

/* ================================ EXPENSES ================================ */
const EXPENSE_CATEGORIES = [
  'Rent', 'Electricity (K-Electric)', 'Salaries', 'Sui Gas', 'Internet & Phone',
  'Cleaning & Maintenance', 'Delivery & Transport', 'Licences & Renewals',
  'Marketing', 'Bank Charges', 'Equipment', 'Stationery', 'Miscellaneous'
];

const expenseOut = async (id: string) => (await col.expenses().aggregate([
  { $match: { _id: id } },
  ...lookupField('users', 'created_by', 'full_name', 'created_by_name'),
  ...lookupField('users', 'approved_by', 'full_name', 'approved_by_name'),
  ...lookupField('branches', 'branch_id', 'name', 'branch_name')
]).toArray())[0];

route('GET', '/api/v1/expenses', 'expenses.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const category = toStr(ctx.query.get('category'), 60);
  const status = toStr(ctx.query.get('status'), 20);
  const from = toStr(ctx.query.get('from'), 10);
  const to = toStr(ctx.query.get('to'), 10);
  const search = toStr(ctx.query.get('q'), 80);

  const filter: Filter<Expense> = { pharmacy_id: ctx.pharmacyId };
  if (category && category !== 'all') filter.category = category;
  if (status && status !== 'all') filter.status = status;
  if (from || to) filter.expense_date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (search) filter.$or = [{ description: contains(search) }, { vendor: contains(search) }, { reference: contains(search) }];

  const [rows, total, summary, byCategory] = await Promise.all([
    col.expenses().aggregate([
      { $match: filter }, { $sort: { expense_date: -1, created_at: -1 } }, { $skip: skip }, { $limit: size },
      ...lookupField('users', 'created_by', 'full_name', 'created_by_name'),
      ...lookupField('users', 'approved_by', 'full_name', 'approved_by_name'),
      ...lookupField('branches', 'branch_id', 'name', 'branch_name')
    ]).toArray(),
    col.expenses().countDocuments(filter),
    col.expenses().aggregate([{ $match: filter }, {
      $group: {
        _id: null, total: { $sum: '$amount_paisa' }, entries: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount_paisa', 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'recorded'] }, '$amount_paisa', 0] } }
      }
    }, { $project: { _id: 0 } }]).toArray(),
    col.expenses().aggregate([{ $match: filter },
      { $group: { _id: '$category', amount: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } },
      { $project: { _id: 0, category: '$_id', amount: 1, entries: 1 } }, { $sort: { amount: -1 } }]).toArray()
  ]);

  return {
    ...pageResult(rows, total, { page, size }),
    summary: summary[0] ?? { total: 0, approved: 0, pending: 0, entries: 0 },
    byCategory, categories: EXPENSE_CATEGORIES
  };
});

route('POST', '/api/v1/expenses', 'expenses.write', async (ctx) => {
  const description = toStr(ctx.body.description, 300);
  const category = toStr(ctx.body.category, 60);
  const amount = toInt(ctx.body.amountPaisa, 0);
  const expenseDate = toStr(ctx.body.expenseDate, 10) || today();
  if (!description) bad('Describe what the money was spent on.', 'description');
  if (!category) bad('Choose an expense category.', 'category');
  if (amount <= 0) bad('Enter an amount above zero.', 'amountPaisa');
  if (expenseDate > today()) bad('An expense cannot be dated in the future.', 'expenseDate');

  const id = uid('EXP');
  const at = nowIso();
  await col.expenses().insertOne({
    _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.user.branch_id, category, description, amount_paisa: amount,
    expense_date: expenseDate, payment_method: toStr(ctx.body.paymentMethod, 20) || 'cash',
    reference: toStr(ctx.body.reference, 60) || null, vendor: toStr(ctx.body.vendor, 120) || null, status: 'recorded',
    approved_by: null, approved_at: null, created_by: ctx.user.id, created_at: at, updated_at: at
  });
  await logActivity(ctx, {
    action: 'expense.created', entity: 'expense', entityId: id,
    summary: `Expense recorded: ${category} — Rs ${(amount / 100).toLocaleString('en-PK')} (${description})`
  });
  return { data: await expenseOut(id), __status: 201 };
});

route('PATCH', '/api/v1/expenses/:id', 'expenses.write', async (ctx) => {
  const expense = await col.expenses().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!expense) return missing('That expense could not be found.');
  if (expense.status === 'approved' && !ctx.can('expenses.approve')) {
    bad('This expense has been approved and can only be changed by someone who can approve expenses.');
  }
  const amount = toInt(ctx.body.amountPaisa, expense.amount_paisa);
  if (amount <= 0) bad('Enter an amount above zero.', 'amountPaisa');
  const expenseDate = toStr(ctx.body.expenseDate, 10) || expense.expense_date;
  if (expenseDate > today()) bad('An expense cannot be dated in the future.', 'expenseDate');

  await col.expenses().updateOne({ _id: expense.id }, {
    $set: {
      category: toStr(ctx.body.category, 60) || expense.category,
      description: toStr(ctx.body.description, 300) || expense.description,
      amount_paisa: amount, expense_date: expenseDate,
      payment_method: toStr(ctx.body.paymentMethod, 20) || expense.payment_method,
      reference: ctx.body.reference !== undefined ? toStr(ctx.body.reference, 60) || null : expense.reference,
      vendor: ctx.body.vendor !== undefined ? toStr(ctx.body.vendor, 120) || null : expense.vendor,
      updated_at: nowIso()
    }
  });
  await logActivity(ctx, { action: 'expense.updated', entity: 'expense', entityId: expense.id, summary: `Expense "${expense.description}" updated` });
  return { data: await expenseOut(expense.id) };
});

route('POST', '/api/v1/expenses/:id/approve', 'expenses.approve', async (ctx) => {
  const expense = await col.expenses().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!expense) return missing('That expense could not be found.');
  if (expense.status === 'approved') bad('That expense is already approved.');
  if (expense.created_by === ctx.user.id && ctx.user.role_key !== PHARMACY_ADMIN_ROLE && !ctx.supportMode) {
    bad('You cannot approve an expense you recorded yourself. Ask the Admin or a manager.');
  }
  await col.expenses().updateOne({ _id: expense.id }, { $set: { status: 'approved', approved_by: ctx.user.id, approved_at: nowIso(), updated_at: nowIso() } });
  await logActivity(ctx, {
    action: 'expense.approved', entity: 'expense', entityId: expense.id, severity: 'warn',
    summary: `Expense approved: ${expense.category} — Rs ${(expense.amount_paisa / 100).toLocaleString('en-PK')}`
  });
  return { data: await expenseOut(expense.id) };
});

route('DELETE', '/api/v1/expenses/:id', 'expenses.write', async (ctx) => {
  const expense = await col.expenses().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!expense) return missing('That expense could not be found.');
  if (expense.status === 'approved' && !ctx.can('expenses.approve')) {
    bad('An approved expense can only be removed by someone who can approve expenses.');
  }
  await col.expenses().deleteOne({ _id: expense.id });
  await logActivity(ctx, {
    action: 'expense.deleted', entity: 'expense', entityId: expense.id, severity: 'warn',
    summary: `Expense deleted: ${expense.description} (Rs ${(expense.amount_paisa / 100).toLocaleString('en-PK')})`
  });
  return { ok: true };
});

/* ============================= NOTIFICATIONS ============================= */
const mine = (pharmacyId: string, userId: string): Filter<Notification> =>
  ({ pharmacy_id: pharmacyId, $or: [{ user_id: null }, { user_id: userId }] });

async function notificationCounts(pharmacyId: string, userId: string) {
  const [row] = await col.notifications().aggregate<{ total: number; unread: number; critical: number; warnings: number }>([
    { $match: mine(pharmacyId, userId) },
    {
      $group: {
        _id: null, total: { $sum: 1 },
        unread: { $sum: { $cond: [{ $eq: ['$is_read', 0] }, 1, 0] } },
        critical: { $sum: { $cond: [{ $eq: ['$severity', 'danger'] }, 1, 0] } },
        warnings: { $sum: { $cond: [{ $eq: ['$severity', 'warn'] }, 1, 0] } }
      }
    }
  ]).toArray();
  return { total: row?.total ?? 0, unread: row?.unread ?? 0, critical: row?.critical ?? 0, warnings: row?.warnings ?? 0 };
}

route('GET', '/api/v1/notifications', null, async (ctx) => {
  const filterKey = toStr(ctx.query.get('filter'), 20);
  const filter: Filter<Notification> = mine(ctx.pharmacyId, ctx.user.id);
  if (filterKey === 'unread') filter.is_read = 0;
  else if (filterKey && filterKey !== 'all') filter.type = filterKey;
  const rows = await col.notifications().find(filter).sort({ is_read: 1, created_at: -1 }).limit(200).toArray();
  return { data: rows, counts: await notificationCounts(ctx.pharmacyId, ctx.user.id) };
});

route('GET', '/api/v1/notifications/recent', null, async (ctx) => {
  const rows = await col.notifications().find(mine(ctx.pharmacyId, ctx.user.id), {
    projection: { id: 1, type: 1, severity: 1, title: 1, body: 1, link: 1, is_read: 1, created_at: 1 }
  }).sort({ is_read: 1, created_at: -1 }).limit(6).toArray();
  const counts = await notificationCounts(ctx.pharmacyId, ctx.user.id);
  return { data: rows, counts: { total: counts.total, unread: counts.unread } };
});

route('POST', '/api/v1/notifications/:id/read', null, async (ctx) => {
  /* Only a notice this person can see: the pharmacy's, or one addressed to them. */
  const result = await col.notifications().updateOne({ _id: toStr(ctx.params.id, 60), ...mine(ctx.pharmacyId, ctx.user.id) }, { $set: { is_read: 1 } });
  if (!result.matchedCount) return missing('That notification could not be found.');
  return { ok: true };
});

route('POST', '/api/v1/notifications/read-all', null, async (ctx) => {
  const result = await col.notifications().updateMany({ ...mine(ctx.pharmacyId, ctx.user.id), is_read: 0 }, { $set: { is_read: 1 } });
  return { ok: true, marked: result.modifiedCount };
});

route('POST', '/api/v1/notifications/refresh', 'inventory.read', async (ctx) => {
  await refreshStockAlerts(ctx.pharmacyId);
  return { ok: true };
});

/* ============================== ACTIVITY LOG ============================== */
route('GET', '/api/v1/activity', 'audit.read', async (ctx) => {
  const { page, size, skip } = paging(ctx, 60);
  const action = toStr(ctx.query.get('action'), 40);
  const entity = toStr(ctx.query.get('entity'), 30);
  const severity = toStr(ctx.query.get('severity'), 20);
  const userId = toStr(ctx.query.get('user'), 40);
  const search = toStr(ctx.query.get('q'), 80);
  const from = toStr(ctx.query.get('from'), 10);
  const to = toStr(ctx.query.get('to'), 10);

  const filter: Filter<ActivityLog> = { pharmacy_id: ctx.pharmacyId };
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  if (entity && entity !== 'all') filter.entity = entity;
  if (severity && severity !== 'all') filter.severity = severity;
  if (userId) filter.user_id = userId;
  if (search) filter.$or = [{ summary: contains(search) }, { actor_name: contains(search) }];
  if (from || to) filter.created_at = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: `${to}~` } : {}) };

  const [rows, total, actors, entities] = await Promise.all([
    col.activityLogs().find(filter).sort({ created_at: -1 }).skip(skip).limit(size).toArray(),
    col.activityLogs().countDocuments(filter),
    col.activityLogs().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, user_id: { $ne: null } } },
      { $group: { _id: '$user_id', name: { $last: '$actor_name' } } },
      { $project: { _id: 0, id: '$_id', name: 1 } }, { $sort: { name: 1 } }
    ]).toArray(),
    col.activityLogs().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, entity: { $ne: null } } },
      { $group: { _id: '$entity', n: { $sum: 1 } } }, { $project: { _id: 0, entity: '$_id', n: 1 } }, { $sort: { n: -1 } }
    ]).toArray()
  ]);
  return { ...pageResult(rows, total, { page, size }), actors, entities };
});

/* ================================ SETTINGS ================================ */
route('GET', '/api/v1/settings', 'settings.read', async (ctx) => {
  const pharmacyId = ctx.pharmacyId;
  const [pharmacy, settings, medicines, batches, sales, customers, staff, logs] = await Promise.all([
    col.pharmacies().findOne({ _id: pharmacyId }),
    getSettings(pharmacyId),
    col.medicines().countDocuments({ pharmacy_id: pharmacyId, status: 'active' }),
    col.batches().countDocuments({ pharmacy_id: pharmacyId }),
    col.sales().countDocuments({ pharmacy_id: pharmacyId }),
    col.customers().countDocuments({ pharmacy_id: pharmacyId }),
    col.users().countDocuments({ pharmacy_id: pharmacyId, status: 'active' }),
    col.activityLogs().countDocuments({ pharmacy_id: pharmacyId })
  ]);
  return { pharmacy, settings, stats: { medicines, batches, sales, customers, staff, logs } };
});

route('PATCH', '/api/v1/settings', 'settings.write', async (ctx) => {
  const changed: string[] = [];
  if (ctx.body.pharmacy) {
    const p = ctx.body.pharmacy;
    const current = await col.pharmacies().findOne({ _id: ctx.pharmacyId });
    if (!current) return missing('That pharmacy could not be found.');
    await col.pharmacies().updateOne({ _id: ctx.pharmacyId }, {
      $set: {
        name: toStr(p.name, 140) || current.name, legal_name: toStr(p.legalName, 160) || null,
        ntn: toStr(p.ntn, 40) || null, strn: toStr(p.strn, 40) || null, drap_licence: toStr(p.drapLicence, 60) || null,
        phone: toStr(p.phone, 40) || null, email: toStr(p.email, 160) || null, address: toStr(p.address, 300) || null,
        city: toStr(p.city, 80) || current.city, province: toStr(p.province, 60) || current.province,
        gst_percent: Number(p.gstPercent ?? current.gst_percent) || 0, updated_at: nowIso()
      }
    });
    changed.push('pharmacy details');
  }
  if (ctx.body.settings && typeof ctx.body.settings === 'object') {
    for (const [key, value] of Object.entries(ctx.body.settings as Record<string, unknown>)) {
      if (key.length > 60) continue;
      if (key === 'appearance.theme' && !THEME_KEYS.includes(String(value))) bad('That theme does not exist.', 'appearance.theme');
      await setSetting(ctx.pharmacyId, key, String(value).slice(0, 500));
      changed.push(key);
    }
  }
  await logActivity(ctx, {
    action: 'settings.updated', entity: 'settings', severity: 'warn',
    summary: `Settings changed: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` and ${changed.length - 6} more` : ''}`,
    meta: { changed }
  });
  return { ok: true, changed };
});

/* ================================= THEME =================================
   The pharmacy's own theme is a setting (above). Which roles may choose their
   own is a permission, `appearance.theme`, ticked on the Roles screen. This
   endpoint lets the Admin do both from Settings › Appearance in one place. */
route('PATCH', '/api/v1/settings/appearance', 'settings.write', async (ctx) => {
  const theme = toStr(ctx.body.theme, 40);
  if (theme) {
    if (!THEME_KEYS.includes(theme)) bad('That theme does not exist.', 'theme');
    await setSetting(ctx.pharmacyId, 'appearance.theme', theme);
  }
  if (Array.isArray(ctx.body.roleIds)) {
    const allowed = new Set((ctx.body.roleIds as unknown[]).map((id) => String(id)));
    const roles = await col.roles().find({ pharmacy_id: ctx.pharmacyId }).toArray();
    for (const role of roles) {
      if (role.key === PHARMACY_ADMIN_ROLE) continue;
      if (role.level >= ctx.user.role_level && !ctx.supportMode && ctx.user.role_key !== PHARMACY_ADMIN_ROLE) forbid('You cannot change a role at your own level or above.');
      const has = role.permissions.includes('appearance.theme');
      if (allowed.has(role.id) && !has) await col.roles().updateOne({ _id: role.id }, { $addToSet: { permissions: 'appearance.theme' }, $set: { updated_at: nowIso() } });
      if (!allowed.has(role.id) && has) await col.roles().updateOne({ _id: role.id }, { $pull: { permissions: 'appearance.theme' }, $set: { updated_at: nowIso() } });
    }
  }
  await logActivity(ctx, { action: 'settings.appearance', entity: 'settings', summary: `Appearance updated${theme ? ` — pharmacy theme ${theme}` : ''}` });
  const roles = await col.roles().find({ pharmacy_id: ctx.pharmacyId }, { projection: { id: 1, name: 1, key: 1, permissions: 1 } }).sort({ level: -1 }).toArray();
  return {
    ok: true,
    theme: theme || (await getSettings(ctx.pharmacyId))['appearance.theme'],
    roles: roles.map((role) => ({ id: role.id, name: role.name, key: role.key, canChoose: role.key === PHARMACY_ADMIN_ROLE || role.permissions.includes('appearance.theme') }))
  };
});

route('GET', '/api/v1/settings/appearance', 'settings.read', async (ctx) => {
  const settings = await getSettings(ctx.pharmacyId);
  const roles = await col.roles().find({ pharmacy_id: ctx.pharmacyId }, { projection: { id: 1, name: 1, key: 1, permissions: 1 } }).sort({ level: -1 }).toArray();
  return {
    theme: settings['appearance.theme'], themes: THEMES,
    roles: roles.map((role) => ({ id: role.id, name: role.name, key: role.key, canChoose: role.key === PHARMACY_ADMIN_ROLE || role.permissions.includes('appearance.theme') }))
  };
});

/* My own sessions — every signed-in person, no permission needed. */
accountRoute('GET', '/api/v1/me/sessions', async (ctx) => {
  const rows = await col.sessions().find({ user_id: ctx.user.id }).sort({ last_seen_at: -1 }).limit(50).toArray();
  return {
    data: rows.map((row) => ({
      id: row.id, ip: row.ip, userAgent: row.user_agent, createdAt: row.created_at,
      lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, revokedAt: row.revoked_at
    }))
  };
});
