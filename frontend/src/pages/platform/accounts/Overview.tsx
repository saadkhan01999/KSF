/* KSF's own books at a glance: four figures, the profit and loss, where
   things stand today, and how the last twelve months went. */

import { Link } from 'react-router-dom';
import { Landmark, Scale, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Card, CardSkeleton, StatCard } from '../../../components/ui';
import type { PlatformAccountsSummary } from '../../../types/accounting';
import { number, percent, rupees, rupeesShort } from '../../../utils/format';
import { TrendChart } from '../../accounts/Overview';
import { PlatformProfitAndLossStatement } from '../../accounts/statements';

export function PlatformAccountsOverview({ summary, label }: { summary: PlatformAccountsSummary | null; label: string }) {
  if (!summary) return <CardSkeleton count={4} />;
  const { profitAndLoss: pnl, position, trend } = summary;

  return (
    <>
      <div className="grid grid-4 mb-5">
        <StatCard label="Income" value={rupeesShort(pnl.income.totalPaisa)} icon={<TrendingUp size={20} />} hint={`${number(pnl.income.payments)} subscription payment(s) and other income`} />
        <StatCard label="Costs" value={rupeesShort(pnl.costs.totalPaisa)} icon={<TrendingDown size={20} />} tone="warn" hint="Salaries, servers and every other expense" />
        <StatCard
          label={pnl.netProfitPaisa < 0 ? 'Net loss' : 'Net profit'} value={rupeesShort(pnl.netProfitPaisa)} icon={<Scale size={20} />}
          tone={pnl.netProfitPaisa < 0 ? 'danger' : 'brand'} hint={`${percent(pnl.netMargin)} of income`}
        />
        <StatCard label="Paying pharmacies" value={number(position.payingPharmacies)} icon={<Users size={20} />} tone="info" hint="On a paid plan today" />
      </div>

      <div className="accounts-grid mb-5">
        <Card title="Profit and loss" subtitle={label}>
          <PlatformProfitAndLossStatement pnl={pnl} />
        </Card>
        <Card title="Where things stand today" icon={<Landmark size={18} />}>
          <dl className="kv">
            <dt>Waiting to be paid</dt>
            <dd className="num">
              {rupees(position.awaitingPaisa)} <span className="t-dim t-sm">· {number(position.awaitingPayments)} open payment(s)</span>
            </dd>
            <dt>Refunds still to finish</dt>
            <dd className="num">
              {rupees(position.refundsOwedPaisa)} <span className="t-dim t-sm">· {number(position.refundsOwed)} refund(s)</span>
            </dd>
          </dl>
          <p className="card-note">
            Bank transfers are confirmed, and refunds finished, on <Link to="/platform/income">Income</Link>.
          </p>
        </Card>
      </div>

      <Card title="The last twelve months" subtitle="Income against costs, with the profit or loss under each month">
        <TrendChart rows={trend} />
      </Card>
    </>
  );
}
