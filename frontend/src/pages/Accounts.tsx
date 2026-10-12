/* The accounts: income, costs, salaries and net profit for any period, with
   every movement listed, downloads for the accountant and a printed
   statement for the file. */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Banknote, Download, FileSpreadsheet, HandCoins, Lock, PieChart, Printer } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAction, useApiData } from '../hooks/useApi';
import { api } from '../services/api';
import { Button, Menu, MenuItem, Tabs } from '../components/ui';
import { PeriodPicker, usePeriod } from '../components/period';
import { PrintSheet, printSheet } from '../components/print';
import type { AccountsSummary } from '../types/accounting';
import { downloadCsv } from '../utils/format';
import { AccountsOverview } from './accounts/Overview';
import { AccountsLedger } from './accounts/Ledger';
import { AccountsIncome } from './accounts/Income';
import { AccountsSalaries } from './accounts/Salaries';
import { CashStatement, ProfitAndLossStatement } from './accounts/statements';

type Tab = 'overview' | 'ledger' | 'income' | 'salaries';
const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: 'overview', label: 'Overview', icon: <PieChart size={16} /> },
  { value: 'ledger', label: 'Money in & out', icon: <ArrowLeftRight size={16} /> },
  { value: 'income', label: 'Other income', icon: <HandCoins size={16} /> },
  { value: 'salaries', label: 'Salaries', icon: <Banknote size={16} /> }
];

const DOWNLOADS = [
  { kind: 'profit-and-loss', label: 'Profit and loss' },
  { kind: 'transactions', label: 'Money in and out' },
  { kind: 'income', label: 'Other income' },
  { kind: 'salaries', label: 'Salaries' }
];

export default function Accounts() {
  const { ok, hasFeature, workspace } = useApp();
  const { run } = useAction();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((entry) => entry.value === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const setTab = (next: Tab) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true });

  const { period, setPeriod, label } = usePeriod();
  const range = `from=${period.from}&to=${period.to}`;
  const { data: summary, reload } = useApiData<AccountsSummary>(`/accounting/summary?${range}`, [range]);
  const refresh = useCallback(() => { void reload(true); }, [reload]);
  const canDownload = hasFeature('reports.export');

  const download = (kind: string, name: string) => run(
    () => api.get<{ data: Record<string, unknown>[] }>(`/accounting/export?kind=${kind}&${range}`),
    (result) => {
      if (!result.data.length) { ok('Nothing to download', 'There is nothing recorded in this period.'); return; }
      downloadCsv(`ksf-${kind}-${period.from}-to-${period.to}`, result.data);
      ok('Downloaded', `${name} saved as a CSV file that opens in Excel.`);
    }
  );

  const pharmacy = workspace?.pharmacy;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p className="sub">Income, costs, salaries and net profit — worked out from your sales, purchases and expenses, never typed twice.</p>
        </div>
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
            {(close) => (canDownload
              ? DOWNLOADS.map((entry) => (
                <MenuItem key={entry.kind} icon={<FileSpreadsheet size={16} />} onClick={() => { close(); void download(entry.kind, entry.label); }}>
                  {entry.label} (CSV)
                </MenuItem>
              ))
              : (
                <MenuItem icon={<Lock size={16} />} disabled>
                  Downloads come with the Weekly, Monthly and Annual plans
                </MenuItem>
              ))}
          </Menu>
        </div>
      </div>

      <div className="accounts-bar">
        <PeriodPicker value={period} onChange={setPeriod} />
        <span className="t-sm t-dim">{label}</span>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={TABS} />

      <div className="mt-5">
        {tab === 'overview' && <AccountsOverview summary={summary} label={label} />}
        {tab === 'ledger' && <AccountsLedger range={range} />}
        {tab === 'income' && <AccountsIncome range={range} onChanged={refresh} />}
        {tab === 'salaries' && <AccountsSalaries range={range} onChanged={refresh} />}
      </div>

      {summary && (
        <PrintSheet
          title="Statement of accounts"
          subtitle={label}
          issuer={pharmacy && (
            <>
              <strong>{pharmacy.name}</strong>
              {pharmacy.legalName && pharmacy.legalName !== pharmacy.name && <span>{pharmacy.legalName}</span>}
              {pharmacy.address && <span>{pharmacy.address}{pharmacy.city ? `, ${pharmacy.city}` : ''}</span>}
              {pharmacy.ntn && <span>NTN {pharmacy.ntn}</span>}
            </>
          )}
        >
          <h2>Profit and loss</h2>
          <ProfitAndLossStatement pnl={summary.profitAndLoss} />
          <h2>Cash in and out</h2>
          <CashStatement cash={summary.cashFlow} />
        </PrintSheet>
      )}
    </>
  );
}
