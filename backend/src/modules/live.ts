/* The live-updates feed (services/live.ts): one stream for visitors, which
   only ever hears that the plans changed, and one for signed-in people,
   which also hears about their own pharmacy's subscription — or, for the
   platform team, about every pharmacy's. */

import { tooMany } from '../core/errors.js';
import { rateLimit, toStr } from '../core/util.js';
import { accountRoute, publicRoute, type SignedInCtx } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { openStream, VISITOR, type Audience } from '../services/live.js';

/* A tab reconnects about once a minute; a few tabs, a few times that. */
const OPENS_PER_MINUTE = 30;

const lastEventId = (ctx: Ctx): string => toStr(ctx.headers['last-event-id'] ?? ctx.query.get('lastEventId'), 40);

function audienceOf(ctx: SignedInCtx): Audience {
  if (ctx.pharmacyId) return { pharmacyId: ctx.pharmacyId, platform: false };
  const watchesPharmacies = ctx.isPlatformAdmin
    || ctx.platformPermissions.has('platform.pharmacies.view') || ctx.platformPermissions.has('platform.finance.view');
  return { pharmacyId: null, platform: watchesPharmacies };
}

publicRoute('GET', '/api/v1/public/events', (ctx) => {
  const limit = rateLimit(`live:${ctx.ip}`, OPENS_PER_MINUTE * 2, 60_000);
  if (!limit.ok) tooMany('Too many connections from this address.', limit.retryAfter);
  return { __stream: (res) => openStream(res, VISITOR, lastEventId(ctx)) };
});

accountRoute('GET', '/api/v1/events', (ctx) => {
  const limit = rateLimit(`live:${ctx.user.id}`, OPENS_PER_MINUTE, 60_000);
  if (!limit.ok) tooMany('Too many live connections. Close a few tabs and try again.', limit.retryAfter);
  return { __stream: (res) => openStream(res, audienceOf(ctx), lastEventId(ctx)) };
});
