/* ==========================================================================
   Housekeeping
   --------------------------------------------------------------------------
   Subscription dates (a trial or a plan ending, grace periods, reminders),
   the mail retry queue, and old sessions and codes. A long-running server
   (Docker, a VPS, Railway) runs it at start-up and then hourly; a serverless
   host (Vercel) has no "hourly", so its scheduler calls
   /api/v1/cron/maintenance instead. Safe to run as often as you like, and a
   failure in one part never stops the others.
   ========================================================================== */

import { runSubscriptionMaintenance } from './subscriptions.js';
import { drainMailQueue } from './mailer.js';
import { pruneSessions } from '../security/sessions.js';
import { pruneCodes } from '../security/otp.js';

export interface MaintenanceSummary {
  subscriptions: Awaited<ReturnType<typeof runSubscriptionMaintenance>> | null;
  mail: Awaited<ReturnType<typeof drainMailQueue>> | null;
  problems: string[];
}

export async function runMaintenance(): Promise<MaintenanceSummary> {
  const summary: MaintenanceSummary = { subscriptions: null, mail: null, problems: [] };
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      summary.problems.push(`${name}: ${(error as Error).message}`);
      console.error(`[KSF] maintenance (${name}) failed:`, (error as Error).message);
    }
  };
  await step('subscriptions', async () => {
    summary.subscriptions = await runSubscriptionMaintenance();
    const { trialsEnded, graceStarted, expired } = summary.subscriptions;
    if (trialsEnded || graceStarted || expired) {
      console.log(`[KSF] subscriptions: ${trialsEnded} trial(s) ended, ${graceStarted} in grace, ${expired} ended`);
    }
  });
  await step('mail', async () => {
    summary.mail = await drainMailQueue();
    if (summary.mail.tried) console.log(`[KSF] mail queue: ${summary.mail.sent} sent, ${summary.mail.failed} still failing of ${summary.mail.tried} retried`);
  });
  await step('sessions', async () => { await pruneSessions(); });
  await step('codes', async () => { await pruneCodes(); });
  return summary;
}
