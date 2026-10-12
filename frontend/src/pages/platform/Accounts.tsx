/* KSF's own accounts, for the Super Admin and the Finance team: what the
   platform earned from subscriptions and elsewhere, what it spent, and its
   net profit — with every movement listed, downloads for the accountant, a
   printed statement, and which ways to pay are switched on. */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, CreditCard, Download, FileSpreadsheet, PieChart, Printer, ReceiptText } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Button, Menu, MenuItem, Tabs } from '../../components/ui';
import { PeriodPicker, usePeriod } from '../../components/period';
import { PrintSheet, printSheet } from '../../components/print';
import { useBusiness } from '../../services/business';
import type { LedgerRow, PlatformAccountsSummary } from '../../types/accounting';
import { downloadCsv } from '../../utils/format';
import { AccountsLedger } from '../accounts/Ledger';
import { PlatformProfitAndLossStatement } from '../accounts/statements';
import { PlatformAccountsOverview } from './accounts/Overview';
import { PlatformEntries } from './accounts/Entries';
import { PaymentMethods } from './accounts/PaymentMethods';

type Tab = 'overview' | 'ledger' | 'entries' | 'methods';
const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: 'overview', label: 'Overview', icon: <PieChart size={16} /> },
  { value: 'ledger', label: 'Money in & out', icon: <ArrowLeftRight size={16} /> },
  { value: 'entries', label: 'Income & expenses', icon: <ReceiptText size={16} /> },
  { value: 'methods', label: 'Payment methods', icon: <CreditCard size={16} /> }
];

const DOWNLOADS = [
  { kind: 'profit-and-loss', label: 'Profit and loss' },
  { kind: 'transactions', label: 'Money in and out' },
  { kind: 'entries', label: 'Income and expenses' }
];

/* A subscription or a refund opens Income; an entry opens its own tab. */
const ledgerLink = (row: LedgerRow): string | null => (
  row.source === 'subscription' || row.source === 'refund' ? '/platform/income' : '/platform/accounts?tab=entries'
);

export default function PlatformAccounts() {
  const { ok } = useApp();
  const business = useBusiness();
  const { run } = useAction();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((entry) => entry.value === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const setTab = (next: Tab) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true });

  const { period, setPeriod, label } = usePeriod();
  const range = `from=${period.from}&to=${period.to}`;
  const { data: summary, reload } = useApiData<PlatformAccountsSummary>(`/platform/accounts/summary?${range}`, [range]);
  const refresh = useCallback(() => { void reload(true); }, [reload]);
  /* A payment clearing anywhere moves these figures. */
  useLiveRefresh(reload, ['subscription']);

  const download = (kind: string, name: string) => run(
    () => api.get<{ data: Record<string, unknown>[] }>(`/platform/accounts/export?kind=${kind}&${range}`),
    (result) => {
      if (!result.data.length) { ok('Nothing to download', 'There is nothing recorded in this period.'); return; }
      downloadCsv(`ksf-platform-${kind}-${period.from}-to-${period.to}`, result.data);
      ok('Downloaded', `${name} saved as a CSV file that opens in Excel.`);
    }
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p className="sub">KSF&apos;s own books: subscriptions and other income, salaries and every other cost, and the net profit.</p>
        </div>
        {tab !== 'methods' && (
          <div className="actions">
            <Button variant="outline" icon={<Printer size={17} />} onClick={printSheet} disabled={!summary}>Print statement</Button>
            <Menu
              label="Download"
              trigger={({ toggle, props }) => (
                <button className="btn btn-outline" onClick={toggle} {...props}>
                  <Download size={17} /> Download
                </button>
              )}
            >
              {(close) => DOWNLOADS.map((entry) => (
                <MenuItem key={entry.kind} icon={<FileSpreadsheet size={16} />} onClick={() => { close(); void download(entry.kind, entry.label); }}>
                  {entry.label} (CSV)
                </MenuItem>
              ))}
            </Menu>
          </div>
        )}
      </div>

      {tab !== 'methods' && (
        <div className="accounts-bar">
          <PeriodPicker value={period} onChange={setPeriod} />
          <span className="t-sm t-dim">{label}</span>
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={TABS} />

      <div className="mt-5">
        {tab === 'overview' && <PlatformAccountsOverview summary={summary} label={label} />}
        {tab === 'ledger' && (
          <AccountsLedger
            range={range} path="/platform/accounts/transactions" linkFor={ledgerLink}
            emptyMessage="Subscription payments, refunds, and the income and expenses you record will appear here."
          />
        )}
        {tab === 'entries' && <PlatformEntries range={range} onChanged={refresh} />}
        {tab === 'methods' && <PaymentMethods />}
      </div>

      {summary && (
        <PrintSheet
          title="Statement of accounts"
          subtitle={label}
          issuer={(
            <>
              <strong>{business.legalName || 'KSF Pharmacy Management System'}</strong>
              {business.address && <span>{business.address}{business.city ? `, ${business.city}` : ''}</span>}
              {business.ntn && <span>NTN {business.ntn}</span>}
            </>
          )}
        >
          <h2>Profit and loss</h2>
          <PlatformProfitAndLossStatement pnl={summary.profitAndLoss} />
        </PrintSheet>
      )}
    </>
  );
}
