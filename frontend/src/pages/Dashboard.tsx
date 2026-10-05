/* The dashboard.

   Ordered by what a pharmacy owner actually asks first thing in the morning:
   what did we take yesterday, what is about to run out, what is about to
   expire, and is anything waiting for me. */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  TrendingUp, Receipt, PackageX, CalendarClock, Wallet, ShoppingCart,
  Stethoscope, ArrowRight, Boxes, CircleAlert, Coins, ClipboardList
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SetupReminder } from '../components/SetupReminder';
import { StaffPicker } from '../components/StaffPicker';
import { StaffHelp } from '../components/StaffSupport';
import { useApiData } from '../hooks/useApi';
import {
  Card, StatCard, BarChart, DonutChart, StatusBadge, Button, Allow,
  EmptyState, CardSkeleton, Meter, Badge
} from '../components/ui';
import { rupees, rupeesShort, number, monthLabel, time, ago, payment, shortName, possessive } from '../utils/format';
import { query } from '../services/api';

interface DashboardData {
  today: { invoices: number; revenuePaisa: number; profitPaisa: number; discountPaisa: number; revenueChange: number | null; invoiceChange: number | null };
  month: { invoices: number; revenuePaisa: number; profitPaisa: number; discountPaisa: number; expensesPaisa: number; netPaisa: number; revenueChange: number | null };
  stock: { tracked: number; outOfStock: number; lowStock: number; stockValuePaisa: number };
  expiry: { expired: number; critical: number; soon: number; atRiskValuePaisa: number };
  prescriptionsPending: number;
  trend: { period: string; revenue: number; profit: number; invoices: number }[];
  daily: { day: string; revenue: number; invoices: number }[];
  topSellers: { medicine_id: string; medicine_name: string; units: number; revenue: number }[];
  attention: { id: string; name: string; min_stock: number; on_hand: number; form: string; strength: string; next_expiry: string | null }[];
  recentSales: { id: string; invoice_no: string; customer_name: string; sold_at: string; total_paisa: number; payment_method: string; served_by_name: string; status: string }[];
  paymentMix: { payment_method: string; invoices: number; revenue: number }[];
  scopedToMe: boolean;
  /** Whose figures these are; null for the whole pharmacy, `group`
      for everybody in one role. */
  viewing: { id: string; name: string; role: string | null; group?: boolean } | null;
  pharmacyWide: boolean;
}

export default function Dashboard() {
  const { user, workspace, can } = useApp();
  const navigate = useNavigate();
  /* The Admin (and the Super Admin in support) can open any one person's
     dashboard, or one role's combined ("All Cashiers"). */
  const [staff, setStaff] = useState('');
  const { data, loading } = useApiData<DashboardData>(`/dashboard${query({ staff })}`, [staff]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Early in a month, comparing a few days against a full previous month reads
  // as a collapse in trade. The card says how far into the month we are so the
  // percentage is understood rather than believed.
  const dayOfMonth = new Date().getDate();
  const partialMonth = dayOfMonth <= 10;

  const monthly = useMemo(
    () => (data?.trend ?? []).map((point) => ({ label: monthLabel(point.period), value: point.revenue })),
    [data]
  );
  const twoWeeks = useMemo(
    () => (data?.daily ?? []).map((point) => ({ label: monthLabel(point.day), value: point.revenue })),
    [data]
  );

  if (loading || !data) {
    return (
      <>
        <div className="page-head"><div><h1>Dashboard</h1><p className="sub">Loading today&apos;s figures…</p></div></div>
        <CardSkeleton />
      </>
    );
  }

  const netPositive = data.month.netPaisa >= 0;
  /* Whose figures: "Your", "Nadia Parveen's", "All Cashiers'", or nobody's in particular. */
  const whose = data.scopedToMe ? 'Your' : data.viewing ? possessive(data.viewing.name) : null;

  return (
    <>
      <SetupReminder />

      <div className="page-head">
        <div>
          <h1>{greeting}, {shortName(user?.fullName)}</h1>
          <p className="sub">
            {data.scopedToMe
              ? 'Your own sales figures. Stock alerts are for the whole pharmacy.'
              : data.viewing
                ? `Showing ${possessive(data.viewing.name)} figures${data.viewing.role ? ` (${data.viewing.role})` : ''}. Stock alerts are for the whole pharmacy.`
                : `How ${workspace?.pharmacy?.name ?? 'the pharmacy'} is doing today.`}
            {' '}{new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="actions">
          <StaffPicker value={staff} onChange={setStaff} />
          <Allow permission="pos.operate">
            <Button variant="primary" icon={<ShoppingCart size={18} />} onClick={() => navigate('/pos')}>
              Start a sale
            </Button>
          </Allow>
          <Allow permission="purchases.write">
            <Button variant="secondary" icon={<ClipboardList size={18} />} onClick={() => navigate('/purchases')}>
              Order stock
            </Button>
          </Allow>
        </div>
      </div>

      {/* ---------------------------- headline ---------------------------- */}
      <div className="grid grid-4 mb-5">
        <StatCard
          label="Sales today"
          value={rupees(data.today.revenuePaisa)}
          icon={<TrendingUp size={20} />}
          change={data.today.revenueChange}
          hint="vs yesterday"
        />
        <StatCard
          label="Invoices today"
          value={number(data.today.invoices)}
          icon={<Receipt size={20} />}
          change={data.today.invoiceChange}
          hint={data.today.discountPaisa > 0 ? `${rupees(data.today.discountPaisa)} discounted` : 'No discounts given'}
          tone="info"
        />
        <StatCard
          label="Needs reordering"
          value={number(data.stock.lowStock + data.stock.outOfStock)}
          icon={<PackageX size={20} />}
          tone={data.stock.outOfStock > 0 ? 'danger' : 'warn'}
          hint={`${data.stock.outOfStock} out of stock`}
          onClick={can('inventory.read') ? () => navigate('/inventory?state=low-stock') : undefined}
        />
        <StatCard
          label="Expiring or expired"
          value={number(data.expiry.expired + data.expiry.critical)}
          icon={<CalendarClock size={20} />}
          tone={data.expiry.expired > 0 ? 'danger' : 'warn'}
          hint={`${rupeesShort(data.expiry.atRiskValuePaisa)} at risk`}
          onClick={can('inventory.read') ? () => navigate('/expiry') : undefined}
        />
      </div>

      {/* -------------- staff who cannot sign in ------------------- */}
      <StaffHelp />

      {/* ------------------------- month at a glance ------------------------ */}
      <Allow permission="reports.view">
        <div className="grid grid-4 mb-5">
          <StatCard
            label="Sales this month"
            value={rupeesShort(data.month.revenuePaisa)}
            icon={<Coins size={20} />}
            change={partialMonth ? null : data.month.revenueChange}
            hint={partialMonth ? `only ${dayOfMonth} day${dayOfMonth === 1 ? '' : 's'} in so far` : 'vs last month'}
            tone="gold"
          />
          <StatCard label="Gross profit" value={rupeesShort(data.month.profitPaisa)} icon={<TrendingUp size={20} />} hint="before expenses" />
          {data.pharmacyWide
            ? (
              <>
                <StatCard label="Expenses" value={rupeesShort(data.month.expensesPaisa)} icon={<Wallet size={20} />} tone="info" hint={`${data.month.invoices} invoices raised`} />
                <StatCard
                  label="Net this month"
                  value={rupeesShort(data.month.netPaisa)}
                  icon={<TrendingUp size={20} />}
                  tone={netPositive ? 'brand' : 'danger'}
                  hint={partialMonth
                    ? `month to date · ${rupeesShort(data.month.expensesPaisa)} of bills already paid`
                    : netPositive ? 'profit after expenses' : 'loss after expenses'}
                />
              </>
            )
            : (
              /* One person's month: bills and rent belong to the whole
                 pharmacy, so they are not set against one till. */
              <>
                <StatCard label="Invoices this month" value={number(data.month.invoices)} icon={<Receipt size={20} />} tone="info" />
                <StatCard label="Discounts given" value={rupeesShort(data.month.discountPaisa)} icon={<Wallet size={20} />} hint="this month" />
              </>
            )}
        </div>
      </Allow>

      {/* ----------------------------- charts ----------------------------- */}
      <div className="grid mb-5" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <Card
          title={whose ? `${whose} sales over the last twelve months` : 'Sales over the last twelve months'}
          subtitle={whose ? 'Takings per month for this person, in rupees' : 'Total takings per month, in rupees'}
          actions={
            <Allow permission="reports.view">
              <Button size="sm" variant="ghost" iconRight={<ArrowRight size={15} />} onClick={() => navigate('/reports')}>
                Full reports
              </Button>
            </Allow>
          }
        >
          {monthly.length > 1
            ? <BarChart data={monthly} format={(value) => rupees(value)} />
            : <EmptyState title="Not enough history yet" message="Once you have been trading for a few weeks this chart fills in." />}
        </Card>

        <Card title="Needs your attention" subtitle="Lowest stock first">
          {data.attention.length === 0
            ? <EmptyState title="Everything is well stocked" message="No medicine is at or below its minimum level." />
            : (
              <div className="col" style={{ gap: 14 }}>
                {data.attention.map((item) => (
                  <div key={item.id}>
                    <div className="row-between" style={{ gap: 10, marginBottom: 5 }}>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="t-semi truncate">{item.name}</div>
                        <div className="t-xs t-dim">{item.form}{item.strength ? ` · ${item.strength}` : ''}</div>
                      </div>
                      <StatusBadge status={item.on_hand === 0 ? 'out-of-stock' : 'low-stock'} />
                    </div>
                    <div className="stock-meter">
                      <Meter value={item.on_hand} max={Math.max(item.min_stock * 2, 1)} />
                      <span className="n">{item.on_hand}</span>
                      <span className="t-xs t-dim" style={{ whiteSpace: 'nowrap' }}>/ min {item.min_stock}</span>
                    </div>
                  </div>
                ))}
                <Allow permission="inventory.read">
                  <Link to="/inventory?state=low-stock" className="t-sm t-semi mt-2">See the full list →</Link>
                </Allow>
              </div>
            )}
        </Card>
      </div>

      {/* ------------------------ recent + breakdowns ----------------------- */}
      <div className="grid grid-2 mb-5">
        <Card
          title="Latest sales"
          subtitle={data.scopedToMe ? 'Invoices you have rung up' : data.viewing ? `Invoices ${data.viewing.name} rang up` : 'Across the counter'}
          actions={
            <Allow permission="sales.read">
              <Button size="sm" variant="ghost" iconRight={<ArrowRight size={15} />} onClick={() => navigate('/sales')}>
                All sales
              </Button>
            </Allow>
          }
          pad={false}
        >
          {data.recentSales.length === 0
            ? <EmptyState icon={<Receipt size={30} />} title="No sales yet today" message="Invoices appear here as soon as they are completed." />
            : (
              <div className="table-scroll">
                <table className="tbl">
                  <tbody>
                    {data.recentSales.map((sale) => (
                      <tr key={sale.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/sales?invoice=${sale.invoice_no}`)}>
                        <td>
                          <div className="cell-main">{sale.invoice_no}</div>
                          <div className="cell-sub">{sale.customer_name || 'Walk-in customer'}</div>
                        </td>
                        <td className="hide-sm">
                          <div className="t-sm">{time(sale.sold_at)}</div>
                          <div className="cell-sub">{payment(sale.payment_method)}</div>
                        </td>
                        <td className="t-right">
                          <div className="t-bold num">{rupees(sale.total_paisa)}</div>
                          {sale.status !== 'completed' && <div className="cell-sub"><StatusBadge status={sale.status} /></div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>

        <div className="col" style={{ gap: 16 }}>
          <Allow permission="reports.view">
            <Card title="How customers pay" subtitle={whose ? `${whose} sales, last 30 days` : 'Last 30 days'}>
              <DonutChart
                data={data.paymentMix.map((row) => ({ label: payment(row.payment_method), value: row.revenue }))}
                centreLabel="taken"
                centreValue={rupeesShort(data.paymentMix.reduce((sum, r) => sum + r.revenue, 0))}
                format={(value) => rupeesShort(value)}
              />
            </Card>
          </Allow>

          <Card title="Best sellers" subtitle={whose ? `${whose} sales by value, last 30 days` : 'By value, last 30 days'} pad={false}>
            {data.topSellers.length === 0
              ? <EmptyState title="No sales in the last month" />
              : (
                <div className="card-body col" style={{ gap: 11 }}>
                  {data.topSellers.slice(0, 6).map((item, index) => (
                    <div className="row" key={item.medicine_id} style={{ gap: 12 }}>
                      <span
                        className="avatar sm"
                        style={index === 0 ? { background: 'linear-gradient(140deg,var(--gold-300),var(--gold-600))', color: 'var(--brand-950)' } : undefined}
                      >
                        {index + 1}
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="t-sm t-semi truncate">{item.medicine_name}</div>
                        <div className="t-xs t-dim">{number(item.units)} units sold</div>
                      </div>
                      <span className="t-sm t-bold num">{rupees(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </div>
      </div>

      {/* ------------------------------ prompts ----------------------------- */}
      <div className="grid grid-3">
        <Allow permission="prescriptions.read">
          <Card title="Prescriptions waiting" subtitle="Needing a pharmacist">
            <div className="row-between">
              <div>
                <div className="stat-value" style={{ marginTop: 0 }}>{data.prescriptionsPending}</div>
                <div className="t-sm t-soft mt-2">
                  {data.prescriptionsPending === 0
                    ? 'Nothing in the queue.'
                    : 'Each one must be checked before the medicine can be handed over.'}
                </div>
              </div>
              <span className="stat-icon" style={{ width: 48, height: 48 }}><Stethoscope /></span>
            </div>
            {data.prescriptionsPending > 0 && (
              <Button variant="secondary" block className="mt-4" onClick={() => navigate('/prescriptions?status=pending')}>
                Open the queue
              </Button>
            )}
          </Card>
        </Allow>

        <Allow permission="inventory.read">
          <Card title="Stock on the shelf" subtitle="Valued at purchase cost">
            <div className="row-between">
              <div>
                <div className="stat-value" style={{ marginTop: 0 }}>{rupeesShort(data.stock.stockValuePaisa)}</div>
                <div className="t-sm t-soft mt-2">{number(data.stock.tracked)} medicines tracked</div>
              </div>
              <span className="stat-icon" style={{ width: 48, height: 48 }}><Boxes /></span>
            </div>
            <Button variant="secondary" block className="mt-4" onClick={() => navigate('/inventory')}>
              Open inventory
            </Button>
          </Card>
        </Allow>

        <Card title="Two-week trend" subtitle={whose ? `${whose} daily takings` : 'Daily takings'}>
          {twoWeeks.length > 1
            ? <BarChart data={twoWeeks} height={140} format={(value) => rupees(value)} />
            : <EmptyState title="No recent sales" />}
        </Card>
      </div>

      {data.expiry.expired > 0 && (
        <Allow permission="expiry.manage">
          <div className="mt-5">
            <Card>
              <div className="row-between wrap" style={{ gap: 16 }}>
                <div className="row" style={{ gap: 14 }}>
                  <span className="stat-icon" style={{ background: 'var(--danger-100)', color: 'var(--danger-600)', width: 48, height: 48 }}>
                    <CircleAlert />
                  </span>
                  <div>
                    <div className="row-tight">
                      <strong>{data.expiry.expired} batch{data.expiry.expired === 1 ? '' : 'es'} on the shelf have expired</strong>
                      <Badge tone="danger">Action needed</Badge>
                    </div>
                    <div className="t-sm t-soft mt-2">
                      Expired stock is already blocked from sale. Quarantine and write it off so your stock value stays accurate.
                    </div>
                  </div>
                </div>
                <Button variant="danger" onClick={() => navigate('/expiry?state=expired')}>Deal with it now</Button>
              </div>
            </Card>
          </div>
        </Allow>
      )}

      <p className="t-xs t-dim t-center mt-6">
        Figures update as staff work. Last refreshed {ago(new Date().toISOString())}.
      </p>
    </>
  );
}
