/* The accounts at a glance: four figures, the two statements, what is owed
   either way, and how the last twelve months went. */

import { ArrowDownRight, ArrowUpRight, Landmark, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardSkeleton, StatCard } from '../../components/ui';
import type { AccountsSummary } from '../../types/accounting';
import { monthLabel, number, percent, rupees, rupeesShort } from '../../utils/format';
import { CashStatement, ProfitAndLossStatement } from './statements';

export function TrendChart({ rows }: { rows: AccountsSummary['trend'] }) {
  const peak = Math.max(1, ...rows.flatMap((row) => [row.income, row.costs]));
  return (
    <div className="trend-chart" role="img" aria-label="Income and costs for each of the last twelve months">
      <div className="trend-legend">
        <span><i className="swatch is-income" /> Income</span>
        <span><i className="swatch is-costs" /> Costs</span>
      </div>
      <div className="trend-cols">
        {rows.map((row) => (
          <div className="trend-col" key={row.period} title={`${monthLabel(row.period)}: income ${rupees(row.income)}, costs ${rupees(row.costs)}, ${row.profit < 0 ? 'loss' : 'profit'} ${rupees(Math.abs(row.profit))}`}>
            <div className="trend-bars">
              <i className="is-income" style={{ height: `${(row.income / peak) * 100}%` }} />
              <i className="is-costs" style={{ height: `${(row.costs / peak) * 100}%` }} />
            </div>
            <span className={`trend-profit ${row.profit < 0 ? 'is-neg' : ''}`}>{row.income || row.costs ? rupeesShort(row.profit) : '—'}</span>
            <span className="trend-label">{monthLabel(row.period)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountsOverview({ summary, label }: { summary: AccountsSummary | null; label: string }) {
  if (!summary) return <CardSkeleton count={4} />;
  const { profitAndLoss: pnl, cashFlow: cash, position, trend } = summary;
  const costs = pnl.costOfSalesPaisa + pnl.costs.totalPaisa;

  return (
    <>
      <div className="grid grid-4 mb-5">
        <StatCard label="Income" value={rupeesShort(pnl.income.totalPaisa)} icon={<TrendingUp size={20} />} hint={`${number(pnl.income.invoices)} invoices and other income`} />
        <StatCard label="Costs" value={rupeesShort(costs)} icon={<TrendingDown size={20} />} tone="warn" hint="Medicines sold, salaries and expenses" />
        <StatCard
          label={pnl.netProfitPaisa < 0 ? 'Net loss' : 'Net profit'} value={rupeesShort(pnl.netProfitPaisa)} icon={<Scale size={20} />}
          tone={pnl.netProfitPaisa < 0 ? 'danger' : 'brand'} hint={`${percent(pnl.netMargin)} of income`}
        />
        <StatCard
          label="Cash movement" value={rupeesShort(cash.netPaisa)} icon={cash.netPaisa < 0 ? <ArrowDownRight size={20} /> : <ArrowUpRight size={20} />}
          tone={cash.netPaisa < 0 ? 'danger' : 'info'} hint={`${rupeesShort(cash.in.totalPaisa)} in · ${rupeesShort(cash.out.totalPaisa)} out`}
        />
      </div>

      <div className="accounts-grid mb-5">
        <Card title="Profit and loss" subtitle={label}>
          <ProfitAndLossStatement pnl={pnl} />
        </Card>
        <div className="stack">
          <Card title="Cash in and out" subtitle="Money that actually moved in the period">
            <CashStatement cash={cash} />
          </Card>
          <Card title="Where things stand today" icon={<Landmark size={18} />}>
            <dl className="kv">
              <dt>Customers owe you</dt>
              <dd className="num">{rupees(position.receivablePaisa)} <span className="t-dim t-sm">· {number(position.customersOwing)} customer(s)</span></dd>
              <dt>You owe suppliers</dt>
              <dd className="num">{rupees(position.payablePaisa)} <span className="t-dim t-sm">· {number(position.unpaidOrders)} unpaid order(s)</span></dd>
              <dt>Stock on the shelf</dt>
              <dd className="num">{rupees(position.stockAtCostPaisa)} <span className="t-dim t-sm">at cost</span></dd>
            </dl>
          </Card>
        </div>
      </div>

      <Card title="The last twelve months" subtitle="Income against costs, with the profit or loss under each month">
        <TrendChart rows={trend} />
      </Card>
    </>
  );
}
