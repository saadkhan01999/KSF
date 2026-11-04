/* ==========================================================================
   The Express application
   --------------------------------------------------------------------------
   Security headers on every response, JSON bodies (with the raw bytes kept
   for payment webhooks, whose signatures are computed over them), the
   registered routes behind one authorisation pipeline, the built web app
   with a single-page fallback, and one error handler that never sends a
   stack trace to a browser.
   ========================================================================== */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, IS_PROD, isAllowedOrigin, originAllowed, STATIC_FOLDER, VERSION } from '../config/env.js';
import { describeDatabase, supportsTransactions } from '../db/mongo.js';
import { HttpError } from '../core/errors.js';
import { nowIso, rateLimit } from '../core/util.js';
import { isElevated } from '../security/sessions.js';
import { platformAllows } from '../domain/platform.js';
import { sendAvatar } from '../services/avatars.js';
import { planRequired, requireFeature, workingState } from '../services/subscriptions.js';
import { authenticate } from './authenticate.js';
import type { Ctx, HandlerResult } from './context.js';
import { routes, type RouteDef } from './router.js';
import { bodyLimitFor, isSafeRedirect, unsafeKey } from './safety.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function clientIp(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:(?=\d)/, '');
}

/** Strip Mongo's `_id` from every reply and refuse an un-awaited Promise. */
function replacer(key: string, value: unknown): unknown {
  if (key === '_id') return undefined;
  if (value && typeof (value as Promise<unknown>).then === 'function') {
    throw new Error('A handler returned a Promise inside its response — an `await` is missing.');
  }
  return value;
}

function sendJson(res: Response, status: number, payload: unknown): void {
  res.status(status).set('Cache-Control', 'no-store').type('application/json; charset=utf-8')
    .send(JSON.stringify(payload ?? { ok: true }, replacer));
}

function baseContext(req: Request): Ctx {
  const ip = clientIp(req);
  const queryString = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '';
  const ctx: Ctx = {
    user: null, session: null, pharmacyId: null, permissions: new Set(), isPlatformAdmin: false, isPlatformStaff: false,
    platformPermissions: new Set(), supportMode: false,
    can: (permission) => ctx.permissions.has(permission),
    require: (permission) => { if (!ctx.permissions.has(permission)) throw new HttpError(403, 'You do not have permission to do this.'); },
    requireRecentVerification: () => {
      if (!isElevated(ctx.session)) throw new HttpError(403, 'Please confirm your password before making this change.', undefined, 'step_up_required');
    },
    isElevated: () => isElevated(ctx.session),
    ip,
    userAgent: String(req.headers['user-agent'] ?? ''),
    query: new URLSearchParams(queryString),
    body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>,
    rawBody: (req as Request & { rawBody?: string }).rawBody ?? '',
    params: Object.fromEntries(Object.entries(req.params ?? {}).map(([k, v]) => [k, String(v)])),
    headers: req.headers,
    cookies: (req.cookies ?? {}) as Record<string, string>,
    setCookie: []
  };
  return ctx;
}

/* A sign-in page on an address the server does not know fails with nothing
   but a 403 in the browser. Say once per address, in the server log, which
   one it was and where to allow it. */
const refusedOrigins = new Set<string>();
function noteRefusedOrigin(origin: string | undefined): void {
  if (!origin || refusedOrigins.has(origin) || refusedOrigins.size >= 20) return;
  refusedOrigins.add(origin);
  console.warn(`[KSF] Refused a sign-in or sign-up from ${origin.slice(0, 200)}: add it to PUBLIC_ALLOWED_ORIGINS (or PUBLIC_APP_URL) if it is yours.`);
}

/* What a pharmacy with no plan can still change: its plan, its notices, and
   a support request if it needs help choosing. */
const OPEN_WITHOUT_PLAN = ['/api/v1/billing', '/api/v1/notifications', '/api/v1/support', '/api/v1/setup/plan'];

async function handle(def: RouteDef, req: Request, res: Response): Promise<void> {
  const ctx = baseContext(req);

  if (def.access === 'public') {
    if (WRITE_METHODS.has(req.method) && !def.options.allowCrossOrigin && !originAllowed(req.headers.origin, req.headers.host, req.get('sec-fetch-site'))) {
      noteRefusedOrigin(req.headers.origin);
      sendJson(res, 403, { message: 'That request did not come from this application.' });
      return;
    }
  } else {
    const auth = await authenticate(req, ctx.ip);
    if (!auth) { sendJson(res, 401, { code: 'session_expired', message: 'Please sign in.' }); return; }
    if (!auth.ok) { sendJson(res, auth.status, { code: auth.code, message: auth.message }); return; }

    Object.assign(ctx, {
      user: auth.user, session: auth.session, permissions: auth.permissions, pharmacyId: auth.pharmacyId,
      supportMode: auth.supportMode, isPlatformAdmin: auth.isPlatformAdmin, isPlatformStaff: auth.isPlatformStaff,
      platformPermissions: auth.platformPermissions
    });

    if (def.access === 'platform') {
      if (!ctx.isPlatformAdmin && !ctx.isPlatformStaff) throw new HttpError(403, 'Only the KSF platform team can do this.');
      if (!platformAllows(ctx, def.platform ?? 'owner')) {
        throw new HttpError(403, def.platform === 'owner' ? 'Only the Super Admin can do this.' : 'Your team role does not include this. Ask the Super Admin.');
      }
    }
    if (def.access === 'pharmacy') {
      if (!ctx.pharmacyId) {
        throw new HttpError(400, 'Open a pharmacy first: this screen belongs to one pharmacy.', undefined, 'pharmacy_required');
      }
      if (def.permission) ctx.require(def.permission);
      /* The platform team in support mode sees what the pharmacy has, locked
         or not: they are there to help, and the plan is not theirs. */
      if (def.options.feature && !ctx.supportMode) await requireFeature(ctx.pharmacyId, def.options.feature);
      /* The trial or the plan has ended: every record can still be read and
         exported, and the way to a plan stays open, but nothing is changed
         until one is paid for. */
      if (WRITE_METHODS.has(req.method) && !ctx.supportMode && !OPEN_WITHOUT_PLAN.some((prefix) => def.path.startsWith(prefix))) {
        const working = await workingState(ctx.pharmacyId);
        if (!working.ok) throw planRequired(working.afterTrial);
      }
    }

    /* A person at a counter cannot make 240 changes a minute; a stuck tab or
       a script can. Reads are not limited — a busy till polls a lot. */
    if (WRITE_METHODS.has(req.method)) {
      const limit = rateLimit(`w:${auth.user.id}`, 240, 60_000);
      if (!limit.ok) {
        res.set('Retry-After', String(limit.retryAfter));
        sendJson(res, 429, { message: `Too many changes in a short time. Please wait ${limit.retryAfter} second(s).` });
        return;
      }
    }
  }

  const result: HandlerResult = await def.handler(ctx);
  if (ctx.setCookie.length) res.append('Set-Cookie', ctx.setCookie);
  if (result?.__stream) { result.__stream(res); return; }

  if (result && result.__redirect) {
    /* Only to this application: an open redirect on a payment return URL is
       how a paying customer gets sent somewhere else entirely. */
    const target = String(result.__redirect);
    if (!isSafeRedirect(target, env.PUBLIC_APP_URL)) { sendJson(res, 400, { message: 'Refused to redirect away from this application.' }); return; }
    res.location(target);
    sendJson(res, 303, { ok: true, redirect: target });
    return;
  }

  const status = result?.__status ?? 200;
  if (result) delete result.__status;
  sendJson(res, status, result ?? { ok: true });
}

/** The origins of the hosted checkout pages a payment form may post to. */
function checkoutOrigins(): string[] {
  const origins = ['GATEWAY_CHECKOUT_URL', 'JAZZCASH_POST_URL', 'EASYPAISA_POST_URL'].map((name) => {
    try { return new URL(String(process.env[name] ?? '')).origin; } catch { return ''; }
  });
  return [...new Set(origins.filter((origin) => origin.startsWith('https://')))];
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  /* `script-src 'self'` is the line that matters: the web app has no inline
     scripts. Inline styles are allowed because React writes style
     attributes; style injection cannot execute code. */
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        /* Hosted checkouts that are reached by posting a signed form (JazzCash,
           Easypaisa, a gateway) must be allowed as form targets; Stripe is a
           plain link and needs nothing here. */
        formAction: ["'self'", ...checkoutOrigins()],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        ...(env.COOKIE_SECURE ? { upgradeInsecureRequests: [] } : {})
      }
    },
    strictTransportSecurity: env.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false
  }));
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });

  /* Cross-origin calls are allowed only from the configured web origins. */
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' });
    }
    if (req.method === 'OPTIONS') {
      res.set({
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Client,X-Pharmacy-Id',
        'Access-Control-Max-Age': '600'
      }).status(204).end();
      return;
    }
    next();
  });

  const keepRaw = (req: Request, _res: Response, buffer: Buffer) => {
    (req as Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
  };
  app.use(cookieParser());
  const parsers = {
    '12mb': express.json({ limit: '12mb', verify: keepRaw }),
    '2mb': express.json({ limit: '2mb', verify: keepRaw })
  };
  app.use((req, res, next) => parsers[bodyLimitFor(req.path)](req, res, next));
  app.use(express.urlencoded({ extended: false, limit: '1mb', verify: keepRaw }));
  /* No operator keys ($gt, $where) and no prototype keys (__proto__) in a body. */
  app.use((req, res, next) => {
    const key = req.body && typeof req.body === 'object' ? unsafeKey(req.body) : null;
    if (key) { sendJson(res, 400, { code: 'invalid_field', message: `The request carried a field name that is not allowed: ${key.slice(0, 40)}` }); return; }
    next();
  });

  app.get('/api/v1/health', (_req, res) => {
    sendJson(res, 200, {
      ok: true, service: 'KSF', version: VERSION, time: nowIso(), dialect: 'mongodb', transactions: supportsTransactions(),
      /* Where the data lives is useful on a developer's machine and nobody else's business. */
      ...(IS_PROD ? {} : { database: describeDatabase() })
    });
  });

  /* Profile photos are plain images an <img> asks for, so they are served
     here rather than as JSON. The address is a random id that changes with
     every new photo, which is what lets it be cached for a year. */
  app.get('/api/v1/avatars/:id', (req, res, next) => { sendAvatar(String(req.params.id), res).catch(next); });

  const api = express.Router();
  for (const def of routes) {
    const verb = def.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
    api[verb](def.path, (req: Request, res: Response, next: NextFunction) => {
      handle(def, req, res).catch(next);
    });
  }
  app.use(api);
  app.use('/api', (_req, res) => sendJson(res, 404, { message: 'That endpoint does not exist.' }));

  /* The built web app. Hashed assets are cached for a year; index.html never. */
  const dist = STATIC_FOLDER();
  if (existsSync(dist)) {
    app.use(express.static(dist, {
      index: false,
      setHeaders: (res, path) => {
        res.set('Cache-Control', /-[A-Za-z0-9_]{8,}\.(js|css|woff2)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      }
    }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate').sendFile(join(dist, 'index.html'));
    });
  } else {
    app.get(/^\/(?!api\/).*/, (_req, res) => sendJson(res, 404, { message: 'The web application has not been built yet. Run: npm run build' }));
  }

  /* ------------------------------------------------------------- errors */
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
      sendJson(res, error.status, { message: error.message, field: error.field, code: error.code, ...(error.details ?? {}) });
      return;
    }
    const parse = error as { type?: string; status?: number };
    if (parse?.type === 'entity.parse.failed') { sendJson(res, 400, { message: 'The request body was not valid JSON.' }); return; }
    if (parse?.type === 'entity.too.large') { sendJson(res, 413, { message: 'That request is too large.' }); return; }
    /* Anything else the body reader turned down (an unknown charset or encoding, an aborted upload) is the request's fault, not a server failure. */
    const reader = error as { status?: number; expose?: boolean };
    if (reader?.expose && typeof reader.status === 'number' && reader.status >= 400 && reader.status < 500) {
      sendJson(res, reader.status, { message: 'The request could not be read.' }); return;
    }
    const correlationId = randomUUID().slice(0, 8);
    console.error(`[KSF ${correlationId}] ${req.method} ${req.originalUrl}`, IS_PROD ? (error as Error)?.message : error);
    sendJson(res, 500, { message: 'Something went wrong on the server. Please try again.', correlationId });
  });

  return app;
}
