/* The two statements — profit and loss, and cash in and out — drawn the same
   way on the screen and on paper, so the printed copy is the screen. */

import type { CashFlow, ProfitAndLoss } from '../../types/accounting';
import { payment, percent, rupees } from '../../utils/format';

type Tone = 'sub' | 'total' | 'result' | 'note';

function Row({ label, value, tone, negative }: { label: string; value: number; tone?: Tone; negative?: boolean }) {
  /* A cost is shown in brackets, the way an accountant writes it, so a
     column of figures reads correctly without a minus sign on every line. */
  const shown = negative ? `(${rupees(Math.abs(value))})` : rupees(value);
  return (
    <div className={`statement-row ${tone ? `is-${tone}` : ''}`}>
      <span className="statement-label">{label}</span>
      <span className={`statement-amt num ${value < 0 && !negative ? 'is-neg' : ''}`}>{shown}</span>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return <div className="statement-head">{children}</div>;
}

export function ProfitAndLossStatement({ pnl }: { pnl: ProfitAndLoss }) {
  const { income, costs } = pnl;
  return (
    <div className="statement">
      <Heading>Income</Heading>
      <Row label={`Sales${income.gstPaisa ? ' (excluding GST)' : ''} · ${income.invoices} invoice${income.invoices === 1 ? '' : 's'}`} value={income.salesPaisa} tone="sub" />
      {income.otherIncome.map((row) => <Row key={row.category} label={row.category} value={row.amount} tone="sub" />)}
      <Row label="Total income" value={income.totalPaisa} tone="total" />

      <Row label="Cost of the medicines sold" value={pnl.costOfSalesPaisa} tone="sub" negative />
      <Row label={`Gross profit · ${percent(pnl.grossMargin)} of income`} value={pnl.grossProfitPaisa} tone="total" />

      <Heading>Running costs</Heading>
      <Row label="Salaries and wages" value={costs.salariesPaisa} tone="sub" negative />
      {costs.operating.map((row) => <Row key={row.category} label={row.category} value={row.amount} tone="sub" negative />)}
      {costs.writeOffsPaisa > 0 && <Row label="Stock written off" value={costs.writeOffsPaisa} tone="sub" negative />}
      <Row label="Total running costs" value={costs.totalPaisa} tone="total" negative />

      <Row label={`Net ${pnl.netProfitPaisa < 0 ? 'loss' : 'profit'} · ${percent(pnl.netMargin)} of income`} value={pnl.netProfitPaisa} tone="result" />

      <div className="statement-notes">
        {income.gstPaisa > 0 && <Row label="GST collected (owed to FBR, not income)" value={income.gstPaisa} tone="note" />}
        {income.discountsPaisa > 0 && <Row label="Discounts given at the till" value={income.discountsPaisa} tone="note" />}
        {pnl.refunds.amountPaisa > 0 && <Row label={`Refunded invoices, not counted (${pnl.refunds.invoices})`} value={pnl.refunds.amountPaisa} tone="note" />}
      </div>
    </div>
  );
}

export function CashStatement({ cash }: { cash: CashFlow }) {
  return (
    <div className="statement">
      <Heading>Money in</Heading>
      {cash.in.byMethod.map((row) => <Row key={row.method} label={`Sales — ${payment(row.method)}`} value={row.amount} tone="sub" />)}
      {!cash.in.byMethod.length && <Row label="Sales" value={0} tone="sub" />}
      {cash.in.repaymentsPaisa > 0 && <Row label="Udhaar repaid by customers" value={cash.in.repaymentsPaisa} tone="sub" />}
      {cash.in.otherIncomePaisa > 0 && <Row label="Other income" value={cash.in.otherIncomePaisa} tone="sub" />}
      <Row label="Total money in" value={cash.in.totalPaisa} tone="total" />

      <Heading>Money out</Heading>
      <Row label="Paid to suppliers" value={cash.out.suppliersPaisa} tone="sub" negative />
      <Row label="Salaries and wages" value={cash.out.salariesPaisa} tone="sub" negative />
      <Row label="Expenses" value={cash.out.expensesPaisa} tone="sub" negative />
      {cash.out.refundsPaisa > 0 && <Row label="Refunds to customers" value={cash.out.refundsPaisa} tone="sub" negative />}
      <Row label="Total money out" value={cash.out.totalPaisa} tone="total" negative />

      <Row label={cash.netPaisa < 0 ? 'More went out than came in' : 'More came in than went out'} value={cash.netPaisa} tone="result" />
    </div>
  );
}
