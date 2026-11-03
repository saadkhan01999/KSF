/* The three plans the way the price sheet draws them — Starter in green,
   Monthly in blue, Yearly in purple — on the website's pricing page, in
   Billing, and on the screen a pharmacy sees when its free trial has ended.

   Every figure comes from the plan documents (/public/plans, or /billing
   with this pharmacy's own price), so a price the Super Admin changes is the
   price drawn here; only the words around the figures are written below. */

import type { ReactNode } from 'react';
import {
  BarChart3, Check, Crown, Infinity as InfinityIcon, LayoutDashboard, Package, ReceiptText, Settings, ShoppingCart, Store, Tag, Users
} from 'lucide-react';
import { rupees } from '../utils/format';
import type { Plan, PlanOffer } from '../types';

export type SheetTone = 'trial' | 'monthly' | 'yearly';

export const toneOf = (plan: Plan): SheetTone => (plan.isTrial ? 'trial' : plan.period === 'year' ? 'yearly' : 'monthly');

const isOffer = (plan: Plan | PlanOffer): plan is PlanOffer => 'yourPricePaisa' in plan;

/** What twelve months of Monthly would cost against one year of Yearly. */
export function yearlySaving(plans: Plan[]): { savedPaisa: number; percent: number; perMonthPaisa: number } | null {
  const monthly = plans.find((plan) => plan.period === 'month' && !plan.isTrial);
  const yearly = plans.find((plan) => plan.period === 'year');
  if (!monthly || !yearly) return null;
  const twelve = monthly.pricePaisa * 12;
  const saved = twelve - yearly.pricePaisa;
  return saved > 0 ? { savedPaisa: saved, percent: Math.round((saved / twelve) * 100), perMonthPaisa: Math.round(yearly.pricePaisa / 12) } : null;
}

const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

/** The ticks on each card, from what the plan is. */
export function pointsFor(plan: Plan): string[] {
  const common = ['Complete account access', 'All features & functionalities', 'Unlimited data (add without limit)'];
  if (plan.isTrial) return [...common, 'Full system access (no restrictions)'];
  if (plan.period === 'year') return [...common, '24/7 access, all year round'];
  if (plan.maxCycles > 0) return [...common, 'Ideal for new and beginner pharmacies'];
  return common;
}

/** One plan, as a card on the price sheet. */
export function SheetPlanCard({ plan, plans, action, current, note }: {
  plan: Plan | PlanOffer;
  /** Every plan on sale, for the Yearly saving against Monthly. */
  plans: Plan[];
  action?: ReactNode;
  current?: boolean;
  /** "Month 2 of 3", or why it cannot be chosen any more. */
  note?: ReactNode;
}) {
  const tone = toneOf(plan);
  const saving = tone === 'yearly' ? yearlySaving(plans) : null;
  const special = plan.referralPricePaisa !== null && plan.referralPricePaisa < plan.pricePaisa ? plan.referralPricePaisa : null;
  /* In Billing the card knows which of the two Monthly prices this pharmacy pays. */
  const yours = isOffer(plan) ? (plan.referralApplied ? 'referral' : 'direct') : null;
  const period = plan.period === 'year' ? 'year' : plan.period === 'week' ? 'week' : 'month';

  return (
    <article className={`sheet-card tone-${tone}${current ? ' is-current' : ''}`} aria-current={current ? 'true' : undefined}>
      <header className="sheet-card-head">
        {current && <span className="sheet-current"><Check size={12} aria-hidden="true" /> Your plan</span>}
        <h3>{plan.name} Plan</h3>
        {tone === 'monthly' && plan.maxCycles > 0 && <p className="sheet-card-sub">({plan.maxCycles}-month starter plan)</p>}
        <span className="sheet-pill">
          {tone === 'trial' && 'Free trial'}
          {tone === 'monthly' && (plan.maxCycles > 0 ? 'For beginners' : 'Pay monthly')}
          {tone === 'yearly' && <><Crown size={14} aria-hidden="true" /> Best value</>}
        </span>
      </header>

      <div className="sheet-card-body">
        {tone === 'trial' && (
          <div className="sheet-price is-free">
            <strong className="sheet-free">Free</strong>
            <span className="sheet-chip">{plan.trialDays || plan.periodDays} days access</span>
          </div>
        )}

        {tone !== 'trial' && special !== null && (
          <div className="sheet-price is-split">
            <div className={yours === 'referral' ? 'is-yours' : undefined}>
              <span className="sheet-figure"><span className="sheet-amount">{rupees(special)}</span><span className="sheet-per">/ {period}</span></span>
              <small>{yours === 'referral' ? 'Your price — with referral' : 'With referral'}</small>
            </div>
            <div className={yours === 'direct' ? 'is-yours' : undefined}>
              <span className="sheet-figure"><span className="sheet-amount">{rupees(plan.pricePaisa)}</span><span className="sheet-per">/ {period}</span></span>
              <small>{yours === 'direct' ? 'Your price — direct' : 'Direct, without referral'}</small>
            </div>
          </div>
        )}

        {tone !== 'trial' && special === null && (
          <div className="sheet-price">
            <span className="sheet-figure"><span className="sheet-amount is-big">{rupees(plan.pricePaisa)}</span><span className="sheet-per">/ {period}</span></span>
            {saving && <small>(≈ {rupees(saving.perMonthPaisa)} / month)</small>}
          </div>
        )}

        {tone === 'monthly' && plan.maxCycles > 0 && (
          <p className="sheet-box">
            <strong>Plan duration: {months(plan.maxCycles)}</strong>
            <span>Starter plan, paid month by month</span>
          </p>
        )}
        {saving && (
          <p className="sheet-box is-saving">
            <Tag size={18} aria-hidden="true" />
            <span className="sheet-saving"><strong>Save {rupees(saving.savedPaisa)} vs. Monthly</strong><span>(≈ {saving.percent}% discount)</span></span>
          </p>
        )}

        <ul className="sheet-points">
          {pointsFor(plan).map((point) => <li key={point}><Check size={17} aria-hidden="true" /> {point}</li>)}
        </ul>

        {note && <div className="sheet-note">{note}</div>}
        {action && <div className="sheet-action">{action}</div>}
      </div>
    </article>
  );
}

const ACCESS: Array<[ReactNode, string]> = [
  [<LayoutDashboard key="a" />, 'Dashboard'],
  [<ShoppingCart key="b" />, 'Purchase'],
  [<Package key="c" />, 'Inventory / Stock'],
  [<ReceiptText key="d" />, 'Sales & Billing'],
  [<Users key="e" />, 'Customers & Suppliers'],
  [<BarChart3 key="f" />, 'Reports & Analytics'],
  [<Settings key="g" />, 'Settings & Administration'],
  [<InfinityIcon key="h" />, 'Unlimited records']
];

/** "All plans include FULL ACCESS to:" and the eight parts of the system. */
export function FullAccessStrip() {
  return (
    <section className="sheet-access" aria-label="What every plan includes">
      <p className="sheet-access-title"><Store size={22} aria-hidden="true" /><span>All plans include <strong>full access</strong> to:</span></p>
      <ul>
        {ACCESS.map(([icon, label]) => <li key={label}><span aria-hidden="true">{icon}</span>{label}</li>)}
      </ul>
    </section>
  );
}

/** The plan summary: what each costs, and for how long. */
export function PlanSummaryTable({ plans }: { plans: Plan[] }) {
  const saving = yearlySaving(plans);
  return (
    <div className="table-scroll">
      <table className="tbl sheet-summary">
        <caption className="sr-only">Plan summary</caption>
        <thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Term</th></tr></thead>
        <tbody>
          {plans.map((plan) => {
            const special = plan.referralPricePaisa !== null && plan.referralPricePaisa < plan.pricePaisa ? plan.referralPricePaisa : null;
            const per = plan.period === 'year' ? 'per year' : plan.period === 'week' ? 'per week' : 'per month';
            return (
              <tr key={plan.key} className={`tone-${toneOf(plan)}`}>
                <th scope="row">{plan.name}{plan.isTrial ? ' (free)' : plan.maxCycles > 0 ? ' (beginner)' : ''}</th>
                <td>{plan.isTrial ? 'Rs 0' : special !== null ? `${rupees(special)} / ${rupees(plan.pricePaisa)} ${per}` : `${rupees(plan.pricePaisa)} ${per}`}</td>
                <td>
                  {plan.isTrial && `${plan.trialDays || plan.periodDays} days, full access`}
                  {!plan.isTrial && plan.maxCycles > 0 && `${months(plan.maxCycles)} (beginner)`}
                  {!plan.isTrial && !plan.maxCycles && plan.period === 'year' && `≈ ${rupees(saving?.perMonthPaisa ?? Math.round(plan.pricePaisa / 12))} / month, 24/7 access`}
                  {!plan.isTrial && !plan.maxCycles && plan.period !== 'year' && 'Cancel any time'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
