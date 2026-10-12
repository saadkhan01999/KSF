/* Every movement the accounts are built from, newest first: the till's
   takings day by day, other income, expenses, salaries and supplier payments.
   Each row links back to the screen it was recorded on. The platform's own
   books use the same list, with their own endpoint and links. */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { useApiData, useDebounced } from '../../hooks/useApi';
import { query } from '../../services/api';
import { EmptyState, Pager, SearchField, Segmented, TableSkeleton } from '../../components/ui';
import type { LedgerRow } from '../../types/accounting';
import type { Paged } from '../../types';
import { date, payment, rupees } from '../../utils/format';

interface LedgerReply extends Paged<LedgerRow> { totals: { inPaisa: number; outPaisa: number; netPaisa: number } }

const PHARMACY_LINK: Partial<Record<LedgerRow['source'], (row: LedgerRow) => string>> = {
  sales: (row) => `/sales?from=${row.date}&to=${row.date}`,
  expense: () => '/expenses',
  supplier: () => '/purchases',
  income: () => '/accounts?tab=income',
  salary: () => '/accounts?tab=salaries'
};
const pharmacyLink = (row: LedgerRow): string | null => PHARMACY_LINK[row.source]?.(row) ?? null;

export function AccountsLedger({
  range, path = '/accounting/transactions', linkFor = pharmacyLink,
  emptyMessage = 'Sales, expenses, salaries, supplier payments and other income will appear here as they are recorded.'
}: { range: string; path?: string; linkFor?: (row: LedgerRow) => string | null; emptyMessage?: string }) {
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, direction, range]);

  const { data, loading } = useApiData<LedgerReply>(
    `${path}?${range}&${query({ q: search, direction, page, size: 25 }).slice(1)}`,
    [path, range, search, direction, page]
  );

  return (
    <>
      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search descriptions, categories, references…" />
        <Segmented
          value={direction} onChange={setDirection} label="Direction"
          options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'Money in' }, { value: 'out', label: 'Money out' }]}
        />
      </div>

      {data && (
        <div className="ledger-totals">
          <span>In <b className="num">{rupees(data.totals.inPaisa)}</b></span>
          <span>Out <b className="num">{rupees(data.totals.outPaisa)}</b></span>
          <span>Net <b className={`num ${data.totals.netPaisa < 0 ? 't-danger' : ''}`}>{rupees(data.totals.netPaisa)}</b></span>
        </div>
      )}

      <div className="table-wrap">
        {loading && !data
          ? <TableSkeleton columns={4} />
          : !data?.data.length
            ? <EmptyState icon={<ArrowLeftRight size={30} />} title="Nothing moved in this period" message={emptyMessage} />
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>What</th>
                        <th>Date</th>
                        <th>Paid by</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((row) => {
                        const link = linkFor(row);
                        return (
                          <tr key={`${row.source}-${row.id}`}>
                            <td className="cell-title">
                              <span className="cell-main">{link ? <Link to={link}>{row.description}</Link> : row.description}</span>
                              <div className="cell-sub">{row.category}{row.reference ? ` · ${row.reference}` : ''}</div>
                            </td>
                            <td data-label="Date" className="t-sm">{date(row.date)}</td>
                            <td data-label="Paid by" className="t-sm">{row.payment_method ? payment(row.payment_method) : 'Several'}</td>
                            <td data-label="Amount" className="t-right">
                              <span className={`t-bold num ${row.direction === 'in' ? 't-ok' : 't-danger'}`}>
                                {row.direction === 'in' ? '+' : '−'}{rupees(row.amount_paisa)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} />
              </>
            )}
      </div>
    </>
  );
}
