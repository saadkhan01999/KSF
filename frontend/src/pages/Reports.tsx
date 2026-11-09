/* Reports and analytics.

   Four views over the same period: the money, what sold, who sold it, and
   what the stock is worth. Every figure can be exported as a CSV so it can go
   straight to an accountant. */

import { useMemo, useState } from 'react';
import {
  Download, Coins, TrendingUp, TrendingDown, 
  Users, Package, ShoppingBag, Boxes, Wallet, Percent, Receipt
} from 'lucide-react';
import { StaffPicker, isRoleValue } from '../components/StaffPicker';
import { FeatureLocked } from '../components/plan';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  Button, StatCard, Card, Tabs, BarChart, DonutChart, EmptyState,
  TableSkeleton, CardSkeleton, Segmented, Alert
} from '../components/ui';
import {
  rupees, rupeesShort, number, percent, date, monthLabel,
  isoDaysAgo, todayIso, downloadCsv
} from '../utils/format';

interface Overview {
  range: { from: string; to: string };
  revenuePaisa: number; costPaisa: number; grossProfitPaisa: number; grossMargin: number;
  expensesPaisa: number; writeOffPaisa: number; netProfitPaisa: number;
  invoices: number; unitsSold: number; distinctMedicines: number;
  averageBasketPaisa: number; discountPaisa: number; refundsPaisa: number;
  purchasesPaisa: number; purchaseOrders: number; customersServed: number; expenseEntries: number;
  discountedInvoices: number;
  /** Whose figures: pharmacyWide is false for one person's report. */
  scope: { everyone: boolean; person: { id: string; name: string; role: string | null } | null; pharmacyWide: boolean };
}

interface DiscountRow {
  id: string; invoice_no: string; sold_at: string; user_id: string; staff_name: string;
  customer_name: string | null; subtotal_paisa: number; discount_paisa: number; total_paisa: number;
  percent: number; reason_label: string; discount_note: string | null; status: string;
}

type Tab = 'money' | 'products' | 'people' | 'stock';

export default function Reports() {
  const { ok, can, hasFeature } = useApp();
  /* What the plan includes: the server refuses the rest with 402 either way. */
  const advanced = hasFeature('reports.advanced');
  const exportable = hasFeature('reports.export') && can('reports.export');
  const { run } = useAction();

  const [tab, setTab] = useState<Tab>('money');
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(todayIso());
  const [grain, setGrain] = useState<'day' | 'month'>('day');
  /* The Admin can open one person's report, or one role's combined ("All Cashiers"). */
  const [staffFilter, setStaffFilter] = useState('');

  const range = `from=${from}&to=${to}${staffFilter ? `&staff=${encodeURIComponent(staffFilter)}` : ''}`;
  const { data: overview, loading } = useApiData<Overview>(`/reports/overview?${range}`, [from, to, staffFilter]);
  const { data: trend } = useApiData<{ data: { period: string; revenue: number; profit: number; invoices: number; discount: number }[] }>(
    `/reports/sales-trend?${range}&grain=${grain}`, [from, to, grain, staffFilter]
  );
  const { data: topMedicines } = useApiData<{ data: { medicine_id: string; medicine_name: string; units: number; revenue: number; cost: number; profit: number; invoices: number }[] }>(
    tab === 'products' && advanced ? `/reports/top-medicines?${range}` : null, [tab, from, to, staffFilter]
  );
  const { data: categoryMix } = useApiData<{ data: { category: string; units: number; revenue: number; profit: number }[] }>(
    tab === 'products' && advanced ? `/reports/category-mix?${range}` : null, [tab, from, to, staffFilter]
  );
  const { data: staff } = useApiData<{ data: { user_id: string; name: string; role: string | null; invoices: number; revenue: number; profit: number; discount: number; average_basket: number }[] }>(
    tab === 'people' && advanced ? `/reports/staff-performance?${range}` : null, [tab, from, to, staffFilter]
  );
  const { data: valuation } = useApiData<{ data: { category: string; medicines: number; units: number; cost_value: number; retail_value: number }[]; totals: { units: number; costValue: number; retailValue: number } }>(
    tab === 'stock' && advanced ? '/reports/stock-valuation' : null, [tab]
  );
  const { data: expenseReport } = useApiData<{ byCategory: { category: string; amount: number; entries: number }[]; byMonth: { period: string; amount: number }[] }>(
    tab === 'money' ? `/reports/expenses?${range}` : null, [tab, from, to, staffFilter]
  );
  const { data: discounts } = useApiData<{ data: DiscountRow[] }>(
    (tab === 'money' || tab === 'people') && advanced ? `/reports/discounts?${range}` : null, [tab, from, to, staffFilter]
  );
  const everyone = can('reports.everyone');
  /* Several people on screen: the whole pharmacy, or everybody in one role. */
  const manyPeople = everyone && (!staffFilter || isRoleValue(staffFilter));

  const chart = useMemo(
    () => (trend?.data ?? []).map((point) => ({ label: monthLabel(point.period), value: point.revenue })),
    [trend]
  );

  const preset = (days: number, useMonths = false) => {
    setFrom(isoDaysAgo(days));
    setTo(todayIso());
    setGrain(useMonths ? 'month' : 'day');
  };

  const exportKind = (kind: string, filename: string) => run(
    () => api.get<{ data: Record<string, unknown>[] }>(`/reports/export?kind=${kind}&${range}`),
    (result) => {
      if (!result.data.length) { ok('Nothing to export', 'There is no data in this period.'); return; }
      downloadCsv(`${filename}-${from}-to-${to}`, result.data);
      ok('Exported', `${result.data.length} rows saved as a CSV file.`);
    }
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="sub">
            {!everyone
              ? 'Your own sales. Every figure below comes from the invoices you rang up.'
              : overview?.scope?.person
                ? `Showing ${overview.scope.person.name}${overview.scope.person.role ? ` (${overview.scope.person.role})` : ''} only. Pick "Whole pharmacy" to see everything.`
                : 'Everything below is calculated from your real invoices, purchases and expenses — nothing is estimated.'}
          </p>
        </div>
        {exportable && (
          <div className="actions">
            <Button variant="outline" icon={<Download size={17} />} onClick={() => exportKind('sales', 'ksf-sales')}>
              Export sales
            </Button>
            <Button variant="secondary" icon={<Download size={17} />} onClick={() => exportKind('items', 'ksf-sold-items')}>
              Export item lines
            </Button>
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="row-tight wrap">
          <input className="input" style={{ width: 'auto' }} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <span className="t-dim">to</span>
          <input className="input" style={{ width: 'auto' }} type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
        <button className="chip" onClick={() => preset(6)}>7 days</button>
        <button className="chip" onClick={() => preset(29)}>30 days</button>
        <button className="chip" onClick={() => preset(89)}>3 months</button>
        <button className="chip" onClick={() => preset(364, true)}>12 months</button>
        <StaffPicker value={staffFilter} onChange={setStaffFilter} />
        <div className="spacer" />
        <Segmented
          value={grain}
          onChange={setGrain}
          options={[{ value: 'day', label: 'Daily' }, { value: 'month', label: 'Monthly' }]}
        />
      </div>

      {loading || !overview
        ? <CardSkeleton />
        : (
          <>
            <div className="grid grid-4 mb-5">
              <StatCard label="Sales" value={rupeesShort(overview.revenuePaisa)} icon={<Coins size={20} />} tone="gold" hint={`${number(overview.invoices)} invoices`} />
              <StatCard label="Gross profit" value={rupeesShort(overview.grossProfitPaisa)} icon={<TrendingUp size={20} />} hint={`${percent(overview.grossMargin)} margin`} />
              {overview.scope.pharmacyWide
                ? (
                  <>
                    <StatCard label="Expenses & losses" value={rupeesShort(overview.expensesPaisa + overview.writeOffPaisa)} icon={<TrendingDown size={20} />} tone="danger" hint={`${rupeesShort(overview.writeOffPaisa)} written off`} />
                    <StatCard
                      label="Net profit"
                      value={rupeesShort(overview.netProfitPaisa)}
                      icon={<Wallet size={20} />}
                      tone={overview.netProfitPaisa >= 0 ? 'brand' : 'danger'}
                      hint={overview.netProfitPaisa >= 0 ? 'after everything' : 'a loss in this period'}
                    />
                  </>
                )
                : (
                  <>
                    <StatCard label="Discounts given" value={rupeesShort(overview.discountPaisa)} icon={<Percent size={20} />} tone="info" hint={`on ${number(overview.discountedInvoices)} invoice${overview.discountedInvoices === 1 ? '' : 's'}`} />
                    <StatCard label="Average sale" value={rupeesShort(overview.averageBasketPaisa)} icon={<Receipt size={20} />} hint={`${number(overview.unitsSold)} units sold`} />
                  </>
                )}
            </div>

            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'money', label: 'The money', icon: <Coins size={16} /> },
                { value: 'products', label: 'What sold', icon: <ShoppingBag size={16} /> },
                { value: 'people', label: 'Who sold it', icon: <Users size={16} /> },
                { value: 'stock', label: 'Stock value', icon: <Boxes size={16} /> }
              ]}
            />

            {/* ============================ MONEY ============================ */}
            {tab === 'money' && (
              <>
                <div className="mb-5">
                  <Card
                    title={grain === 'month' ? 'Sales by month' : 'Sales by day'}
                    subtitle={`${date(from)} to ${date(to)}`}
                  >
                    {chart.length > 1
                      ? <BarChart data={chart} format={(value) => rupees(value)} />
                      : <EmptyState title="Not enough data" message="Widen the date range to see a trend." />}
                  </Card>
                </div>

                <div className="grid grid-2 mb-5">
                  <Card title="How the money adds up" subtitle={overview.scope.pharmacyWide ? 'For the selected period' : "This person's sales in the selected period"}>
                    <dl className="kv">
                      <dt>Sales taken</dt><dd className="num">{rupees(overview.revenuePaisa)}</dd>
                      <dt>Cost of the stock sold</dt><dd className="num">−{rupees(overview.costPaisa)}</dd>
                      <dt><b>Gross profit</b></dt><dd className="num t-bold">{rupees(overview.grossProfitPaisa)}</dd>
                      {overview.scope.pharmacyWide && (
                        <>
                          <dt>Running expenses</dt><dd className="num">−{rupees(overview.expensesPaisa)}</dd>
                          <dt>Stock written off</dt><dd className="num">−{rupees(overview.writeOffPaisa)}</dd>
                          <dt><b>Net profit</b></dt>
                          <dd className="num t-bold" style={{ color: overview.netProfitPaisa >= 0 ? 'var(--ok-600)' : 'var(--danger-600)' }}>
                            {rupees(overview.netProfitPaisa)}
                          </dd>
                        </>
                      )}
                    </dl>
                    {!overview.scope.pharmacyWide && (
                      <p className="t-xs t-dim mt-3">
                        Rent, bills and stock write-offs belong to the whole pharmacy, so they are on the whole-pharmacy report only.
                      </p>
                    )}
                    <hr />
                    <dl className="kv">
                      <dt>Discounts given</dt><dd className="num">{rupees(overview.discountPaisa)} <span className="t-dim t-xs">({number(overview.discountedInvoices)} invoices)</span></dd>
                      <dt>Refunded to customers</dt><dd className="num">{rupees(overview.refundsPaisa)}</dd>
                      <dt>Average basket</dt><dd className="num">{rupees(overview.averageBasketPaisa)}</dd>
                      {overview.scope.pharmacyWide && (
                        <>
                          <dt>Stock bought in</dt><dd className="num">{rupees(overview.purchasesPaisa)} <span className="t-dim t-xs">({overview.purchaseOrders} orders)</span></dd>
                        </>
                      )}
                    </dl>
                  </Card>

                  {overview.scope.pharmacyWide
                    ? (
                      <Card
                        title="Expenses by category"
                        subtitle={`${overview.expenseEntries} entries`}
                        actions={
                          exportable && (
                            <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={() => exportKind('expenses', 'ksf-expenses')}>
                              Export
                            </Button>
                          )
                        }
                      >
                        {(expenseReport?.byCategory ?? []).length === 0
                          ? <EmptyState title="No expenses recorded" message="Record rent, bills and salaries so net profit is accurate." />
                          : (
                            <DonutChart
                              data={(expenseReport?.byCategory ?? []).slice(0, 8).map((row) => ({ label: row.category, value: row.amount }))}
                              centreLabel="spent"
                              centreValue={rupeesShort(overview.expensesPaisa)}
                              format={(value) => rupeesShort(value)}
                            />
                          )}
                      </Card>
                    )
                    : (
                      <Card title="Discounts given" subtitle="Each one, how much and why" pad={false}>
                        {advanced
                          ? <DiscountsTable rows={discounts?.data} showStaff={false} />
                          : <FeatureLocked name="The discount register" />}
                      </Card>
                    )}
                </div>
              </>
            )}

            {/* =========================== PRODUCTS =========================== */}
            {tab === 'products' && !advanced && <FeatureLocked name="Best sellers and category mix" description="Best sellers, category mix, each person's sales and profit, and the value of the stock come with a paid plan — see Subscription plans. Nothing has been deleted." />}
            {tab === 'products' && advanced && (
              <>
                <div className="grid grid-2 mb-5">
                  <Card title="Sales by category" subtitle="Where the revenue comes from">
                    {(categoryMix?.data ?? []).length === 0
                      ? <EmptyState title="No sales in this period" />
                      : (
                        <DonutChart
                          data={(categoryMix?.data ?? []).map((row) => ({ label: row.category, value: row.revenue }))}
                          centreLabel="in sales"
                          centreValue={rupeesShort(overview.revenuePaisa)}
                          format={(value) => rupeesShort(value)}
                        />
                      )}
                  </Card>
                  <Card title="At a glance">
                    <div className="grid grid-2">
                      <div className="mini-card"><div className="lbl">Units sold</div><div className="val">{number(overview.unitsSold)}</div></div>
                      <div className="mini-card"><div className="lbl">Different medicines</div><div className="val">{number(overview.distinctMedicines)}</div></div>
                      <div className="mini-card"><div className="lbl">Invoices</div><div className="val">{number(overview.invoices)}</div></div>
                      <div className="mini-card"><div className="lbl">Customers served</div><div className="val">{number(overview.customersServed)}</div></div>
                    </div>
                  </Card>
                </div>

                <Card
                  title="Best sellers"
                  subtitle="Ranked by revenue"
                  pad={false}
                  actions={
                    exportable && (
                      <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={() => exportKind('items', 'ksf-sold-items')}>
                        Export
                      </Button>
                    )
                  }
                >
                  {!topMedicines
                    ? <TableSkeleton columns={5} />
                    : topMedicines.data.length === 0
                      ? <EmptyState icon={<Package size={30} />} title="Nothing sold in this period" />
                      : (
                        <div className="table-scroll">
                          <table className="tbl responsive">
                            <thead>
                              <tr>
                                <th>#</th><th>Medicine</th>
                                <th className="t-right">Units</th>
                                <th className="t-right">Revenue</th>
                                <th className="t-right">Profit</th>
                                <th className="t-right">Margin</th>
                              </tr>
                            </thead>
                            <tbody>
                              {topMedicines.data.map((row, index) => (
                                <tr key={row.medicine_id}>
                                  <td data-label="Rank" className="t-dim">{index + 1}</td>
                                  <td className="cell-title cell-main">{row.medicine_name}</td>
                                  <td data-label="Units" className="t-right num">{number(row.units)}</td>
                                  <td data-label="Revenue" className="t-right num t-bold">{rupees(row.revenue)}</td>
                                  <td data-label="Profit" className="t-right num">{rupees(row.profit)}</td>
                                  <td data-label="Margin" className="t-right num">
                                    {row.revenue > 0 ? percent((row.profit / row.revenue) * 100) : '—'}
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

            {/* ============================ PEOPLE ============================ */}
            {tab === 'people' && !advanced && <FeatureLocked name="Staff performance" description="Best sellers, category mix, each person's sales and profit, and the value of the stock come with a paid plan — see Subscription plans. Nothing has been deleted." />}
            {tab === 'people' && advanced && (
              <>
              <Card
                title="Sales by staff member"
                subtitle={everyone ? "Who rang up what, in this period. Click a name to open that person's report." : 'Your sales in this period'}
                pad={false}
              >
                {!staff
                  ? <TableSkeleton columns={5} />
                  : staff.data.length === 0
                    ? <EmptyState icon={<Users size={30} />} title="No sales in this period" />
                    : (
                      <div className="table-scroll">
                        <table className="tbl responsive">
                          <thead>
                            <tr>
                              <th>Staff member</th>
                              <th className="t-right">Invoices</th>
                              <th className="t-right">Takings</th>
                              <th className="t-right">Profit</th>
                              <th className="t-right">Average basket</th>
                              <th className="t-right">Discounts given</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staff.data.map((row) => (
                              <tr key={row.user_id}>
                                <td className="cell-title cell-main">
                                  {manyPeople
                                    ? (
                                      <button type="button" className="staff-link" onClick={() => setStaffFilter(row.user_id)}>
                                        {row.name || 'Unknown'}
                                      </button>
                                    )
                                    : row.name || 'Unknown'}
                                  {row.role && <div className="cell-sub">{row.role}</div>}
                                </td>
                                <td data-label="Invoices" className="t-right num">{number(row.invoices)}</td>
                                <td data-label="Takings" className="t-right num t-bold">{rupees(row.revenue)}</td>
                                <td data-label="Profit" className="t-right num">{rupees(row.profit)}</td>
                                <td data-label="Average basket" className="t-right num">{rupees(Math.round(row.average_basket))}</td>
                                <td data-label="Discounts" className="t-right num">
                                  {rupees(row.discount)}
                                  {row.revenue > 0 && row.discount / row.revenue > 0.08 && (
                                    <div className="cell-sub t-warn">unusually high</div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
              </Card>

              <div className="mt-5">
                <Card
                  title="Discounts given"
                  subtitle={everyone ? 'Every discount at the till: who gave it, how much and why' : 'The discounts you gave, and why'}
                  pad={false}
                >
                  <DiscountsTable rows={discounts?.data} showStaff={manyPeople} />
                </Card>
              </div>
              </>
            )}

            {/* ============================= STOCK ============================= */}
            {tab === 'stock' && !advanced && <FeatureLocked name="Stock valuation" description="Best sellers, category mix, each person's sales and profit, and the value of the stock come with a paid plan — see Subscription plans. Nothing has been deleted." />}
            {tab === 'stock' && advanced && (
              <>
                {valuation && (
                  <div className="grid grid-3 mb-5">
                    <StatCard label="Units on the shelf" value={number(valuation.totals.units)} icon={<Boxes size={20} />} />
                    <StatCard label="Value at cost" value={rupeesShort(valuation.totals.costValue)} icon={<Coins size={20} />} tone="gold" hint="what you paid for it" />
                    <StatCard label="Value at retail" value={rupeesShort(valuation.totals.retailValue)} icon={<TrendingUp size={20} />} tone="info" hint="if it all sold at list price" />
                  </div>
                )}

                <Card
                  title="Stock value by category"
                  subtitle="Live, based on in-date sellable batches only"
                  pad={false}
                  actions={
                    exportable && (
                      <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={() => exportKind('inventory', 'ksf-inventory')}>
                        Export
                      </Button>
                    )
                  }
                >
                  {!valuation
                    ? <TableSkeleton columns={5} />
                    : (
                      <div className="table-scroll">
                        <table className="tbl responsive">
                          <thead>
                            <tr>
                              <th>Category</th>
                              <th className="t-right">Medicines</th>
                              <th className="t-right">Units</th>
                              <th className="t-right">At cost</th>
                              <th className="t-right">At retail</th>
                              <th className="t-right">Potential profit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {valuation.data.map((row) => (
                              <tr key={row.category}>
                                <td className="cell-title cell-main">{row.category}</td>
                                <td data-label="Medicines" className="t-right num">{number(row.medicines)}</td>
                                <td data-label="Units" className="t-right num">{number(row.units)}</td>
                                <td data-label="At cost" className="t-right num">{rupees(row.cost_value)}</td>
                                <td data-label="At retail" className="t-right num">{rupees(row.retail_value)}</td>
                                <td data-label="Potential profit" className="t-right num t-bold">
                                  {rupees(row.retail_value - row.cost_value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </Card>

                <div className="mt-4">
                  <Alert tone="info" title="What this does not include">
                    Quarantined and expired batches are excluded, because they cannot be sold.
                    You will find them, and their value, on the Expiry Control screen.
                  </Alert>
                </div>
              </>
            )}
          </>
        )}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/** Every discount in the period: which invoice, who gave it, how much, why. */
function DiscountsTable({ rows, showStaff = true }: { rows: DiscountRow[] | undefined; showStaff?: boolean }) {
  if (!rows) return <TableSkeleton columns={5} />;
  if (rows.length === 0) {
    return <EmptyState icon={<Percent size={30} />} title="No discounts in this period" message="Every discount given at the till appears here with its reason." />;
  }
  return (
    <div className="table-scroll">
      <table className="tbl responsive">
        <thead>
          <tr>
            <th>Invoice</th>
            {showStaff && <th>Given by</th>}
            <th>Customer</th>
            <th>Why</th>
            <th className="t-right">Discount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="cell-main">
                <span className="mono t-sm">{row.invoice_no}</span>
                <div className="cell-sub">{date(row.sold_at)}{row.status === 'refunded' ? ' · refunded' : ''}</div>
              </td>
              {showStaff && <td data-label="Given by">{row.staff_name}</td>}
              <td data-label="Customer">{row.customer_name || 'Walk-in customer'}</td>
              <td data-label="Why">
                {row.reason_label}
                {row.discount_note && <div className="cell-sub">“{row.discount_note}”</div>}
              </td>
              <td data-label="Discount" className="t-right num t-bold">
                {rupees(row.discount_paisa)}
                <div className="cell-sub">{percent(row.percent)} of {rupees(row.subtotal_paisa)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
