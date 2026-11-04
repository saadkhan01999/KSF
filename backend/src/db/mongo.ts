/* ==========================================================================
   MongoDB connection, collections and transactions
   --------------------------------------------------------------------------
   One MongoClient for the whole process. Collections are reached through
   `col.<name>()`, typed with the document interfaces in ./types.

   Identifiers
     Every document's `_id` is a readable string (MED-3F9A21C4) and the same
     value is stored in `id`. The API speaks `id`; `_id` is stripped from every
     response in one place (http/respond.ts), so documents never need mapping
     on their way out.

   Transactions
     `tx(fn)` runs fn inside a multi-document transaction when the deployment
     supports one (any replica set — MongoDB Atlas always is). The session is
     carried in AsyncLocalStorage, and every write helper picks it up through
     `s()`, so code inside `tx()` does not thread a session by hand.

     On a standalone server, where MongoDB has no transactions, fn simply
     runs. Every write that protects stock or money is a single-document
     conditional update (`quantity: { $gte: n }`), which MongoDB applies
     atomically on any deployment, so overselling is impossible either way;
     the transaction adds all-or-nothing on top of that.
   ========================================================================== */

import { AsyncLocalStorage } from 'node:async_hooks';
import { MongoClient, type ClientSession, type Collection, type Db, type Document } from 'mongodb';
import { env } from '../config/env.js';
import type * as T from './types.js';

let client: MongoClient | null = null;
let database: Db | null = null;
let transactionsSupported = false;
const store = new AsyncLocalStorage<ClientSession>();

export async function connect(uri = env.MONGODB_URI, dbName = env.MONGODB_DB): Promise<Db> {
  if (database) return database;
  client = new MongoClient(uri, {
    appName: 'ksf-pharmacy',
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 15_000,
    retryWrites: true
  });
  try {
    await client.connect();
  } catch (error) {
    /* Not left half-open: the next attempt (the next request, on Vercel) starts clean. */
    await client.close().catch(() => undefined);
    client = null;
    throw error;
  }
  database = client.db(dbName);

  /* A replica set (or a sharded cluster) can run transactions. */
  const hello = await database.admin().command({ hello: 1 }).catch(() => ({} as Document));
  transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  return database;
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

export function db(): Db {
  if (!database) throw new Error('The database is not connected yet.');
  return database;
}

export const supportsTransactions = (): boolean => transactionsSupported;

/** "MongoDB 7.0 · cluster0.mongodb.net/ksf_pharmacy" — never the password. */
export function describeDatabase(): string {
  try {
    const url = new URL(env.MONGODB_URI.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    return `MongoDB (${url.hostname}${url.port ? `:${url.port}` : ''}/${env.MONGODB_DB})`;
  } catch {
    return `MongoDB (${env.MONGODB_DB})`;
  }
}

/** What to do about the ways a first deployment usually fails to reach the database. */
export function databaseHint(error: Error): string[] {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  /* Atlas answers a connection from an address that is not on the cluster's
     IP Access List with a TLS "internal error" alert (number 80) — not with
     anything that says "access denied". */
  if (/SSL routines|SSL alert number 80|tlsv1 alert internal error/i.test(text)) {
    return [
      'MongoDB Atlas refused the connection from this server\'s address.',
      'In Atlas open Security > Network Access > Add IP Address and allow this server.',
      'Vercel and similar hosts have no fixed address: add 0.0.0.0/0',
      '("Allow access from anywhere"); the database user and password still guard the data.'
    ];
  }
  if (/bad auth|authentication failed/i.test(text)) {
    return [
      'The database user or password in MONGODB_URI is wrong.',
      'Check them in Atlas > Database Access; a password containing @ : / ? # [ ] or % must be URL-encoded.'
    ];
  }
  if (/ECONNREFUSED|querySrv|ENOTFOUND|Server selection|MongoServerSelectionError/i.test(text)) {
    return ['Check MONGODB_URI (in .env, or the host\'s environment variables) and that the database is reachable from this computer.'];
  }
  return [];
}

/* ------------------------------------------------------------ transactions */

/** The current transaction's session as a driver option, or nothing. */
export const s = (): { session?: ClientSession } => {
  const session = store.getStore();
  return session ? { session } : {};
};

export async function tx<R>(fn: () => Promise<R>): Promise<R> {
  if (store.getStore() || !transactionsSupported || !client) return fn();
  const session = client.startSession();
  try {
    let result: R | undefined;
    await session.withTransaction(async () => {
      result = await store.run(session, fn);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result as R;
  } finally {
    await session.endSession();
  }
}

/* -------------------------------------------------------------- collections */

const c = <D extends Document>(name: string) => (): Collection<D> => db().collection<D>(name);

export const col = {
  pharmacies: c<T.Pharmacy>('pharmacies'),
  branches: c<T.Branch>('branches'),
  roles: c<T.Role>('roles'),
  users: c<T.User>('users'),
  sessions: c<T.Session>('sessions'),
  devices: c<T.Device>('devices'),
  settings: c<T.Setting>('settings'),
  counters: c<T.Counter>('counters'),

  categories: c<T.Category>('categories'),
  medicines: c<T.Medicine>('medicines'),
  batches: c<T.Batch>('batches'),
  stockMovements: c<T.StockMovement>('stock_movements'),
  suppliers: c<T.Supplier>('suppliers'),
  purchases: c<T.Purchase>('purchases'),
  customers: c<T.Customer>('customers'),
  customerPayments: c<T.CustomerPayment>('customer_payments'),
  prescriptions: c<T.Prescription>('prescriptions'),
  sales: c<T.Sale>('sales'),
  expenses: c<T.Expense>('expenses'),
  dayClosings: c<T.DayClosing>('day_closings'),
  incomeEntries: c<T.IncomeEntry>('income_entries'),
  salaryPayments: c<T.SalaryPayment>('salary_payments'),
  supplierPayments: c<T.SupplierPayment>('supplier_payments'),
  directory: c<T.DirectoryMedicine>('medicine_directory'),
  barcodeProducts: c<T.BarcodeProduct>('barcode_products'),
  platformEntries: c<T.PlatformEntry>('platform_entries'),

  notifications: c<T.Notification>('notifications'),
  activityLogs: c<T.ActivityLog>('activity_logs'),
  auditLogs: c<T.AuditLog>('audit_logs'),
  auditHeads: c<T.AuditHead>('audit_heads'),
  securityEvents: c<T.SecurityEvent>('security_events'),
  loginAttempts: c<T.LoginAttempt>('login_attempts'),

  conversations: c<T.Conversation>('conversations'),
  messages: c<T.Message>('messages'),

  registrations: c<T.Registration>('registrations'),
  verificationCodes: c<T.VerificationCode>('verification_codes'),
  recoveryCodes: c<T.RecoveryCode>('recovery_codes'),

  plans: c<T.Plan>('subscription_plans'),
  subscriptions: c<T.Subscription>('subscriptions'),
  subscriptionPayments: c<T.SubscriptionPayment>('subscription_payments'),
  paymentAttempts: c<T.PaymentAttempt>('payment_attempts'),
  paymentRefunds: c<T.PaymentRefund>('payment_refunds'),
  webhookEvents: c<T.WebhookEvent>('webhook_events'),
  referralCodes: c<T.ReferralCode>('referral_codes'),
  referrals: c<T.Referral>('referrals'),
  trials: c<T.Trial>('trials'),

  migrationJobs: c<T.MigrationJob>('migration_jobs'),
  migrationItems: c<T.MigrationItem>('migration_items'),
  mailDeliveries: c<T.MailDelivery>('mail_deliveries'),
  supportTickets: c<T.SupportTicket>('support_tickets'),
  platformRoles: c<T.PlatformRole>('platform_roles'),
  avatars: c<T.Avatar>('avatars'),

  /** A collection chosen at run time — only the importer and its rollback need this. */
  raw: (name: string): Collection<Document & { _id: string }> => db().collection<Document & { _id: string }>(name)
};

/** Give a new document its `_id` from its readable `id`. */
export const withId = <D extends { id: string }>(doc: D): D & { _id: string } => ({ _id: doc.id, ...doc });
