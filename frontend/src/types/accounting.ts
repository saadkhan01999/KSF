/* The accounts, as the API returns them. Money is paisa throughout. */

export interface CategoryAmount { category: string; amount: number; entries: number }

export interface ProfitAndLoss {
  income: {
    grossSalesPaisa: number; gstPaisa: number; salesPaisa: number; discountsPaisa: number; invoices: number;
    otherIncomePaisa: number; otherIncome: CategoryAmount[]; totalPaisa: number;
  };
  costOfSalesPaisa: number;
  grossProfitPaisa: number;
  grossMargin: number;
  costs: {
    salariesPaisa: number;
    salaries: { salaryPaisa: number; advancePaisa: number; bonusPaisa: number; recordedAsExpensesPaisa: number; payments: number };
    operatingPaisa: number; operating: CategoryAmount[]; writeOffsPaisa: number; totalPaisa: number;
  };
  netProfitPaisa: number;
  netMargin: number;
  refunds: { amountPaisa: number; invoices: number };
}

export interface CashFlow {
  in: { salesPaisa: number; byMethod: { method: string; amount: number }[]; repaymentsPaisa: number; otherIncomePaisa: number; totalPaisa: number };
  out: { suppliersPaisa: number; salariesPaisa: number; expensesPaisa: number; refundsPaisa: number; totalPaisa: number };
  netPaisa: number;
}

export interface AccountsSummary {
  range: { from: string; to: string };
  profitAndLoss: ProfitAndLoss;
  cashFlow: CashFlow;
  position: { receivablePaisa: number; customersOwing: number; payablePaisa: number; unpaidOrders: number; stockAtCostPaisa: number };
  trend: { period: string; income: number; costs: number; profit: number }[];
}

export interface LedgerRow {
  id: string; date: string; at: string; direction: 'in' | 'out';
  source: 'sales' | 'income' | 'expense' | 'salary' | 'supplier';
  category: string; description: string; amount_paisa: number; payment_method: string | null; reference: string | null;
}

export interface IncomeEntry {
  id: string; category: string; description: string; amount_paisa: number; received_on: string;
  payment_method: string; reference: string | null; payer: string | null; created_by_name: string | null; created_at: string;
}

export type SalaryKind = 'salary' | 'advance' | 'bonus';

export interface SalaryPayment {
  id: string; staff_id: string | null; staff_name: string; kind: SalaryKind; period: string;
  basic_paisa: number; allowances_paisa: number; deductions_paisa: number; net_paisa: number;
  paid_on: string; payment_method: string; reference: string | null; note: string | null;
  created_by_name: string | null; created_at: string;
}

export interface Payee { id: string; name: string; role: string | null; status: string }
