/* ==========================================================================
   Configuration
   --------------------------------------------------------------------------
   `.env` is read once, here, before anything else, and every setting the
   server uses is validated and typed in one place. A missing MongoDB URI or a
   weak JWT secret stops the server at start-up with a message that says
   which line to fix — not with a stack trace from deep inside a request.

   Paths are anchored to the project root, so starting the server from the
   root or from inside backend/ reads the same `.env` and serves the same
   build.
   ========================================================================== */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** The folder that holds the root package.json, `.env` and `frontend/`. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const fromRoot = (path: string): string => resolve(PROJECT_ROOT, path);

/* A variable already set by the shell, Docker or a test always wins. */
const envFile = process.env.KSF_ENV_FILE ? resolve(process.env.KSF_ENV_FILE) : fromRoot('.env');
if (existsSync(envFile)) dotenv.config({ path: envFile, override: false, quiet: true });

const bool = (fallback: boolean) => z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => (value === undefined || value === '' ? fallback : value === true || value === 'true'));

const int = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);

/**
 * Express "trust proxy" from its text form. Express reads a string as a list
 * of addresses, so `2` or `true` straight from the environment trusts no
 * proxy at all and every visitor gets the proxy's IP — a hop count has to
 * arrive as a number.
 */
export function trustProxySetting(value: string): boolean | number | string {
  const text = value.trim();
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(8790, 1),
  PUBLIC_APP_URL: z.string().default('http://localhost:5180'),
  PUBLIC_ALLOWED_ORIGINS: z.string().default('http://localhost:5180,http://localhost:4180'),
  TRUST_PROXY: z.string().default('loopback').transform(trustProxySetting),
  STATIC_DIR: z.string().default('frontend/dist'),

  /* ------------------------------------------------------------ database */
  MONGODB_URI: z.string()
    .min(1, 'MONGODB_URI is empty. Put your MongoDB connection string in .env (see DATABASE_SETUP.md).')
    .refine((value) => /^mongodb(\+srv)?:\/\//.test(value), 'MONGODB_URI must start with mongodb:// or mongodb+srv:// — paste the connection string from MongoDB Atlas (see DATABASE_SETUP.md).'),
  MONGODB_DB: z.string().min(1).default('ksf_pharmacy'),

  /* ----------------------------------------------------------------- JWT */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters. Generate one with: npm run secrets'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters. Generate one with: npm run secrets'),
  JWT_ISSUER: z.string().default('ksf-pharmacy'),
  JWT_AUDIENCE: z.string().default('ksf-web'),
  JWT_ACCESS_MINUTES: int(15, 1),
  JWT_REFRESH_DAYS: int(7, 1),
  REFRESH_COOKIE_NAME: z.string().default('ksf_refresh'),
  DEVICE_COOKIE_NAME: z.string().default('ksf_device'),
  COOKIE_SECURE: bool(false),

  /* -------------------------------------------------------------- sessions */
  SESSION_IDLE_MINUTES: int(45, 1),
  SESSION_ABSOLUTE_HOURS: int(72, 1),
  STEP_UP_MINUTES: int(10, 1),
  DEVICE_LIMIT_DESKTOP: int(1, 0),
  DEVICE_LIMIT_MOBILE: int(1, 0),
  LOGIN_MAX_ATTEMPTS: int(5, 1),
  LOGIN_LOCK_MINUTES: int(15, 1),
  LOGIN_MAX_PER_IP: int(60, 1),

  /* ------------------------------------------------------------- passwords */
  PASSWORD_MIN_LENGTH: int(12, 8),
  PASSWORD_SCRYPT_N: int(32768, 1024),
  PASSWORD_SCRYPT_R: int(8, 1),
  PASSWORD_SCRYPT_P: int(3, 1),

  /* -------------------------------------------------------- platform owner */
  SUPER_ADMIN_NAME: z.string().default('Super Admin'),
  SUPER_ADMIN_EMAIL: z.string().default(''),
  SUPER_ADMIN_PASSWORD: z.string().default(''),

  /* -------------------------------------------------------------- mail */
  MAIL_TRANSPORT: z.enum(['console', 'file', 'smtp', 'none']).optional(),
  MAIL_FROM: z.string().default('no-reply@ksfpharmacy.pk'),
  MAIL_FROM_NAME: z.string().default('KSF'),
  MAIL_OUTBOX: z.string().default('.data/outbox'),
  MAIL_HOST: z.string().default(''),
  MAIL_PORT: int(587, 1),
  MAIL_SECURE: bool(false),
  MAIL_USER: z.string().default(''),
  MAIL_PASSWORD: z.string().default(''),

  /* ----------------------------------------------------- codes and signup */
  OTP_EXPIRY_MINUTES: int(10, 1),
  OTP_MAX_ATTEMPTS: int(5, 1),
  OTP_MAX_SENDS: int(5, 1),
  /* Testing only: the sign-up code is also sent back to the browser and shown
     on screen, so anyone can sign up with an address they do not own. */
  SHOW_SIGNUP_CODE: bool(false),
  REFERRAL_TRIAL_DAYS: int(15, 0),
  REFERRAL_MAX_USES: int(100, 1),
  REFERRAL_MAX_PER_DAY: int(10, 1),
  REFERRAL_MAX_PER_IP_PER_DAY: int(3, 1),
  REGISTER_MAX_PER_IP: int(20, 1),

  /* -------------------------------------------------------------- edition */
  /* "university" is the isolated copy made by scripts/university-copy.mjs:
     online payments are off, and the app says which edition it is. */
  KSF_EDITION: z.enum(['commercial', 'university']).default('commercial'),

  /* ------------------------------------------------------------- payments */
  PAYMENT_PROVIDER: z.string().default('manual'),
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),

  /* ---------------------------------------------------------- data import */
  MIGRATION_MAX_ROWS: int(20000, 1),
  MIGRATION_BACKUP_DIR: z.string().default('.data/backups'),

  /* ------------------------------------------------------------ business */
  BUSINESS_LEGAL_NAME: z.string().default(''),
  BUSINESS_ADDRESS: z.string().default(''),
  BUSINESS_CITY: z.string().default(''),
  BUSINESS_COUNTRY: z.string().default(''),
  BUSINESS_PHONE: z.string().default(''),
  BUSINESS_WHATSAPP: z.string().default(''),
  SUPPORT_EMAIL: z.string().default(''),
  SALES_EMAIL: z.string().default(''),
  BUSINESS_WEBSITE: z.string().default(''),
  BUSINESS_NTN: z.string().default(''),
  BUSINESS_STRN: z.string().default(''),
  SUPPORT_HOURS: z.string().default('')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || 'value'}: ${issue.message}`);
  console.error(`\n[KSF] The server cannot start: .env needs attention.\n${lines.join('\n')}\n`);
  console.error(`      Settings file: ${envFile}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const IS_PROD = env.NODE_ENV === 'production';
export const IS_TEST = env.NODE_ENV === 'test';

if (IS_PROD && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error('[KSF] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production.');
  process.exit(1);
}

/** The release number, typed once — in the root package.json. */
export const VERSION: string = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')).version;

export const STATIC_FOLDER = (): string => fromRoot(env.STATIC_DIR);
export const OUTBOX_FOLDER = (): string => fromRoot(env.MAIL_OUTBOX);

/** "https://ksf.example.pk" from a full address, or '' when it is not one. */
function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

/**
 * A test for allowed origins. An entry may hold `*`, which stands for one run
 * of letters and digits — enough for Vercel's per-deployment addresses
 * (https://ksf-x86j-*-team.vercel.app), never a dot or a hyphen, so it cannot
 * stretch over somebody else's team or domain.
 */
export function originMatcher(entries: string[]): (origin: string) => boolean {
  const exact = new Set(entries.filter((entry) => !entry.includes('*')));
  const patterns = entries.filter((entry) => entry.includes('*')).map((entry) => new RegExp(
    `^${entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9]+')}$`
  ));
  return (origin) => exact.has(origin) || patterns.some((pattern) => pattern.test(origin));
}

/* The address people open KSF at is always allowed, so a deployment whose
   web app lives on another host (Vercel in front of Railway, say) cannot
   lock its own sign-in page out by leaving it off the list. */
export const ALLOWED_ORIGINS = new Set(
  [...env.PUBLIC_ALLOWED_ORIGINS.split(','), originOf(env.PUBLIC_APP_URL)]
    /* Quotes and a trailing slash are how the list usually gets typed into a dashboard; neither is part of an origin. */
    .map((value) => value.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, ''))
    .filter(Boolean)
);
export const isAllowedOrigin = originMatcher([...ALLOWED_ORIGINS]);

/**
 * Is this Origin allowed to post to a public endpoint? In production the
 * answer is the configured list; in development any localhost port is
 * accepted too, because the dev launcher moves to the next free port.
 *
 * First, though, the browser's own word: every current browser marks a
 * request with Sec-Fetch-Site, which no page script can set or change.
 * "same-origin" means the page and the address it called share an origin —
 * whichever address that is: the Vercel site, one of its per-deployment
 * links, a custom domain or the API's own. Cookies only ever travel to that
 * same origin, so there is nothing to forge across sites. The list remains
 * for older browsers and for pages that call the API from another origin.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, fetchSite?: string): boolean {
  if (!origin) return true;
  if (fetchSite === 'same-origin') return true;
  if (isAllowedOrigin(origin)) return true;
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
  if (IS_PROD) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

export const IS_UNIVERSITY = env.KSF_EDITION === 'university';

/** Facts about whoever sells this installation. Every field is optional. */
export const BUSINESS = {
  legalName: env.BUSINESS_LEGAL_NAME,
  address: env.BUSINESS_ADDRESS,
  city: env.BUSINESS_CITY,
  country: env.BUSINESS_COUNTRY,
  phone: env.BUSINESS_PHONE,
  whatsapp: env.BUSINESS_WHATSAPP,
  supportEmail: env.SUPPORT_EMAIL,
  salesEmail: env.SALES_EMAIL,
  website: env.BUSINESS_WEBSITE,
  ntn: env.BUSINESS_NTN,
  strn: env.BUSINESS_STRN,
  supportHours: env.SUPPORT_HOURS
};
