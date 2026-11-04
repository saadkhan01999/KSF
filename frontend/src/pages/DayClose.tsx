/* Closing the day.

   The screen is deliberately in two halves, in the order the job is actually
   done: what the system says should be in the drawer, then the box where the
   person types what they counted. The difference appears between them, and it
   is never silently accepted — anything more than small change has to be
   written down before the day can be closed.

   Card, Easypaisa, JazzCash and bank totals sit to one side under their own
   heading, because this system cannot confirm that money reached an account.
   They are there to be checked against the provider's statement, and the
   screen says so rather than implying they are settled. */

import { useEffect, useState } from 'react';
import {
  Banknote, Calculator, CalendarCheck, CircleAlert, Coins, HandCoins,
  Landmark, Lock, Printer, ReceiptText, Scale, TrendingDown
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Alert, Allow, Button, Card, EmptyState, Modal, Pager, StatCard,
  TableSkeleton, TextInput
} from '../components/ui';
import { amount, date, dateTime, rupees, rupeesShort, toPaisa, todayIso, number } from '../utils/format';
import { BRAND } from '../brand';
import type { DayClosing, DayFigures, Paged } from '../types';

interface PreviewResponse {
  data: DayFigures;
  closings: DayClosing[];
  closed: boolean;
  hint: string;
}

interface HistoryResponse extends Paged<DayClosing> {
  variance: { net: number; shortfalls: number; closings: number };
}

/** Rs 50. Below this a difference is float rounding, above it somebody has to
    say what happened — the same line the server draws. */
const EXPLAIN_OVER = 5000;

export default function DayClose() {
  const { ok } = useApp();
  const { busy, run } = useAction();

  const [day, setDay] = useState(todayIso());
  const [float, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [page, setPage] = useState(1);
  const [slip, setSlip] = useState<DayClosing | null>(null);

  const floatPaisa = toPaisa(float);
  const previewPath = `/day-close/preview${query({ date: day, float: floatPaisa })}`;
  const { data: preview, loading, reload } = useApiData<PreviewResponse>(previewPath, [day, floatPaisa]);
  const history = useApiData<HistoryResponse>(`/day-close${query({ page, size: 20 })}`, [page]);

  const figures = preview?.data;
  const expected = figures?.expectedCashPaisa ?? 0;
  const countedPaisa = counted.trim() === '' ? null : toPaisa(counted);
  const variance = countedPaisa === null ? null : countedPaisa - expected;
  const needsNote = variance !== null && Math.abs(variance) > EXPLAIN_OVER;
  const alreadyClosed = !!preview?.closed;

  /* A new day starts with an empty count rather than the last one. */
  useEffect(() => { setCounted(''); setNote(''); setAmendReason(''); }, [day]);

  const close = () => run(
    () => api.post<{ data: DayClosing; variancePaisa: number; message: string }>('/day-close', {
      businessDate: day,
      openingFloatPaisa: floatPaisa,
      countedCashPaisa: countedPaisa ?? 0,
      note,
      amendReason
    }),
    (result) => {
      ok(result?.variancePaisa === 0 ? 'The drawer balances' : 'Closed with a difference on the record', result?.message);
      setSlip(result?.data ?? null);
      setCounted('');
      setNote('');
      setAmendReason('');
      void reload(true);
      void history.reload(true);
    }
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Close the day</h1>
          <p className="sub">
            Count the drawer and record what is in it. The expected figure is worked out from the money that
            moved — it cannot be typed in, and a difference is kept rather than corrected.
          </p>
        </div>
        <div className="actions">
          <input
            className="input" style={{ width: 'auto' }} type="date" value={day} max={todayIso()}
            onChange={(e) => setDay(e.target.value)} aria-label="Business date"
          />
        </div>
      </div>

      {alreadyClosed && (
        <Alert tone="ok" title={`${date(day)} has been closed`} icon={<Lock />}>
          Counted {rupees(preview!.closings.find((row) => !row.superseded_at)?.counted_cash_paisa ?? 0)} by{' '}
          {preview!.closings.find((row) => !row.superseded_at)?.closed_by_name ?? 'someone'}. A corrected count is
          possible, and is recorded as a second count with a reason — the first one stays on the record.
        </Alert>
      )}

      <div className="grid grid-4 mb-5">
        <StatCard
          label="Expected in the drawer" value={rupeesShort(expected)} icon={<Calculator size={20} />}
          hint={`Float ${rupees(figures?.openingFloatPaisa ?? 0)} + cash in − cash out`}
        />
        <StatCard
          label="Cash taken at the till" value={rupeesShort(figures?.cash.salesPaisa ?? 0)} icon={<Banknote size={20} />}
          hint={`${number(figures?.sales.invoices ?? 0)} invoice(s) today`}
        />
        <StatCard
          label="Udhaar paid back in cash" value={rupeesShort(figures?.cash.repaymentsPaisa ?? 0)}
          icon={<HandCoins size={20} />} tone="info"
          hint={`${number(figures?.repaymentReceipts ?? 0)} receipt(s)`}
        />
        <StatCard
          label="Cash paid out" value={rupeesShort((figures?.cash.refundsPaisa ?? 0) + (figures?.cash.expensesPaisa ?? 0))}
          icon={<TrendingDown size={20} />} tone="warn"
          hint="Refunds and expenses taken from the drawer"
        />
      </div>

      <div className="grid grid-2 mb-5">
        <Card title="How the expected figure is made up" icon={<Coins size={18} />} subtitle={date(day)}>
          {loading && !figures
            ? <TableSkeleton rows={6} columns={2} />
            : (
              <dl className="kv">
                <dt>Opening float</dt><dd className="num">{amount(figures?.openingFloatPaisa ?? 0)}</dd>
                <dt>Cash sales</dt><dd className="num">+ {amount(figures?.cash.salesPaisa ?? 0)}</dd>
                <dt>Udhaar repaid in cash</dt><dd className="num">+ {amount(figures?.cash.repaymentsPaisa ?? 0)}</dd>
                <dt>Cash refunded</dt><dd className="num">− {amount(figures?.cash.refundsPaisa ?? 0)}</dd>
                <dt>Receipts reversed</dt><dd className="num">− {amount(figures?.cash.reversalsPaisa ?? 0)}</dd>
                <dt>Expenses paid in cash</dt><dd className="num">− {amount(figures?.cash.expensesPaisa ?? 0)}</dd>
                <dt><b>Should be in the drawer</b></dt><dd className="num"><b>{amount(expected)}</b></dd>
              </dl>
            )}
          <p className="hint mt-4">
            The opening float is whatever was left in the till to start the day. Change it above and every figure
            here is recalculated.
          </p>
        </Card>

        <Card title="Not cash — check these against the statement" icon={<Landmark size={18} />}>
          <dl className="kv">
            <dt>Card</dt><dd className="num">{amount(figures?.nonCash.cardPaisa ?? 0)}</dd>
            <dt>Easypaisa / JazzCash</dt><dd className="num">{amount(figures?.nonCash.walletPaisa ?? 0)}</dd>
            <dt>Bank transfer</dt><dd className="num">{amount(figures?.nonCash.bankPaisa ?? 0)}</dd>
            <dt>Sold on loan (udhaar)</dt><dd className="num">{amount(figures?.nonCash.creditPaisa ?? 0)}</dd>
          </dl>
          <Alert tone="warn" title="These are what the till recorded, not what arrived">
            KSF has no way to see your merchant account. Match each figure against the provider's or the bank's own
            statement before you treat it as received.
          </Alert>
        </Card>
      </div>

      <Allow permission="day-close.manage">
        <Card title="Count the drawer" icon={<Scale size={18} />} className="mb-5">
          <div className="grid grid-2">
            <TextInput
              label="Opening float" prefix="Rs" inputMode="decimal" value={float}
              onChange={(e) => setFloat(e.target.value)}
              hint="What was in the till before the first sale. Leave empty if the drawer starts at zero."
            />
            <TextInput
              label="Counted in the drawer now" prefix="Rs" inputMode="decimal" value={counted}
              onChange={(e) => setCounted(e.target.value)} required
              hint="Count the notes and coins and type the total. Do not adjust it to match."
            />
          </div>

          {variance !== null && (
            <div className={`close-variance ${variance === 0 ? 'is-balanced' : variance < 0 ? 'is-short' : 'is-over'}`}>
              <span className="lbl">{variance === 0 ? 'The drawer balances' : variance < 0 ? 'Short by' : 'Over by'}</span>
              <span className="val">{variance === 0 ? rupees(expected) : rupees(Math.abs(variance))}</span>
            </div>
          )}

          {needsNote && (
            <Alert tone={variance! < 0 ? 'danger' : 'warn'} title="Write down what happened" icon={<CircleAlert />}>
              A difference of more than {rupees(EXPLAIN_OVER)} has to be explained before the day can be closed. Money
              taken from the drawer for a delivery, a note given as change in error, a sale rung up twice — say which.
            </Alert>
          )}

          <TextInput
            label={needsNote ? 'Explanation (required)' : 'Note (optional)'}
            value={note} onChange={(e) => setNote(e.target.value)}
            required={needsNote}
            placeholder="Rs 200 paid to the delivery rider from the drawer, slip to follow"
          />

          {alreadyClosed && (
            <TextInput
              label="Why is this being counted again?" required
              value={amendReason} onChange={(e) => setAmendReason(e.target.value)}
              hint="The first count stays on the record. This one supersedes it."
              placeholder="Recounted after the shift changed"
            />
          )}

          <div className="card-actions">
            <Button
              variant="primary" icon={<CalendarCheck size={18} />} loading={busy}
              onClick={close}
              disabled={countedPaisa === null || (needsNote && !note.trim()) || (alreadyClosed && !amendReason.trim())}
            >
              {alreadyClosed ? 'Record the corrected count' : `Close ${date(day)}`}
            </Button>
          </div>
        </Card>
      </Allow>

      <Card
        title="Closings on record" icon={<ReceiptText size={18} />}
        subtitle={history.data ? `${number(history.data.total)} count(s), net difference ${rupees(history.data.variance?.net ?? 0, { sign: true })}` : undefined}
        pad={false}
      >
        {history.loading
          ? <TableSkeleton columns={6} />
          : !history.data?.data.length
            ? (
              <EmptyState
                icon={<CalendarCheck size={30} />}
                title="Nothing has been closed yet"
                message="Once you close a day it appears here with the figures it was closed against, so a difference can be looked at weeks later."
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="num">Expected</th>
                        <th className="num">Counted</th>
                        <th className="num">Difference</th>
                        <th>Closed by</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.data.map((row) => (
                        <tr key={row.id} className={row.superseded_at ? 'is-muted' : undefined}>
                          <td data-label="Date">
                            <b>{date(row.business_date)}</b>
                            <div className="cell-sub">
                              {row.branch_name ?? 'Whole pharmacy'}
                              {row.attempt_no > 1 && ` · count ${row.attempt_no}`}
                              {row.superseded_at && ' · superseded'}
                            </div>
                          </td>
                          <td className="num" data-label="Expected">{amount(row.expected_cash_paisa)}</td>
                          <td className="num" data-label="Counted">{amount(row.counted_cash_paisa)}</td>
                          <td className="num" data-label="Difference">
                            <span className={row.variance_paisa === 0 ? '' : row.variance_paisa < 0 ? 't-danger' : 't-warn'}>
                              {row.variance_paisa === 0 ? '—' : rupees(row.variance_paisa, { sign: true })}
                            </span>
                          </td>
                          <td data-label="Closed by">
                            {row.closed_by_name ?? '—'}
                            <div className="cell-sub">{dateTime(row.closed_at)}</div>
                          </td>
                          <td className="row-actions">
                            <Button variant="ghost" size="sm" onClick={() => setSlip(row)}>Slip</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={history.data.page} pages={history.data.pages}
                  total={history.data.total} size={history.data.size} onPage={setPage}
                />
              </>
            )}
      </Card>

      {/* The slip that gets signed and kept with the cash bag. */}
      <Modal
        open={!!slip} onClose={() => setSlip(null)}
        title="Cash-up slip"
        subtitle={slip ? date(slip.business_date) : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setSlip(null)} className="no-print">Close</Button>
            <Button variant="primary" icon={<Printer size={17} />} onClick={() => window.print()} className="no-print">
              Print
            </Button>
          </>
        }
      >
        {slip && <CashUpSlip closing={slip} />}
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------
   Printed on the same 76mm roll as a receipt, because that is the printer
   every counter already has.
   ------------------------------------------------------------------------- */
function CashUpSlip({ closing }: { closing: DayClosing }) {
  return (
    <div className="receipt">
      <h3>CASH UP</h3>
      <div className="rc-sub">
        {closing.branch_name ?? 'Whole pharmacy'}<br />
        {date(closing.business_date)}
      </div>
      <hr />
      <div className="rc-line"><span>Opening float</span><span>{amount(closing.opening_float_paisa)}</span></div>
      <div className="rc-line"><span>Cash sales</span><span>{amount(closing.cash_sales_paisa)}</span></div>
      <div className="rc-line"><span>Udhaar received</span><span>{amount(closing.cash_repayments_paisa)}</span></div>
      <div className="rc-line"><span>Cash refunded</span><span>-{amount(closing.cash_refunds_paisa)}</span></div>
      <div className="rc-line"><span>Cash expenses</span><span>-{amount(closing.cash_expenses_paisa)}</span></div>
      <hr />
      <div className="rc-line"><span>Expected</span><span>{amount(closing.expected_cash_paisa)}</span></div>
      <div className="rc-line"><span>Counted</span><span>{amount(closing.counted_cash_paisa)}</span></div>
      <div className="rc-line rc-total">
        <span>{closing.variance_paisa === 0 ? 'BALANCED' : closing.variance_paisa < 0 ? 'SHORT' : 'OVER'}</span>
        <span>{closing.variance_paisa === 0 ? '0.00' : amount(Math.abs(closing.variance_paisa))}</span>
      </div>
      <hr />
      <div className="rc-line"><span>Card</span><span>{amount(closing.card_sales_paisa)}</span></div>
      <div className="rc-line"><span>Easypaisa / JazzCash</span><span>{amount(closing.wallet_sales_paisa)}</span></div>
      <div className="rc-line"><span>Bank transfer</span><span>{amount(closing.bank_sales_paisa)}</span></div>
      <div className="rc-line"><span>Loans (udhaar)</span><span>{amount(closing.credit_sales_paisa)}</span></div>
      <div className="rc-trace">Not cash — check against the statement.</div>
      {closing.note && (
        <>
          <hr />
          <div className="rc-trace">{closing.note}</div>
        </>
      )}
      <hr />
      <div className="rc-line"><span>Counted by</span><span>{closing.closed_by_name ?? '—'}</span></div>
      <div className="rc-line"><span>At</span><span>{dateTime(closing.closed_at)}</span></div>
      <div className="rc-foot">
        Signature ____________________<br /><br />
        {BRAND.name} {BRAND.version}
      </div>
    </div>
  );
}
