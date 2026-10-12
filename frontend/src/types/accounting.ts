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
  source: 'sales' | 'income' | 'expense' | 'salary' | 'supplier' | 'subscription' | 'refund';
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

/* ------------------------------------------------ the platform's own books */

export interface PlatformProfitAndLoss {
  income: {
    subscriptionsPaisa: number; payments: number; byPlan: { plan: string; amount: number; payments: number }[];
    refundsPaisa: number; refunds: number; netSubscriptionsPaisa: number;
    otherIncome: CategoryAmount[]; otherIncomePaisa: number; totalPaisa: number;
  };
  costs: { feesPaisa: number; expenses: CategoryAmount[]; expensesPaisa: number; totalPaisa: number };
  netProfitPaisa: number;
  netMargin: number;
}

export interface PlatformAccountsSummary {
  range: { from: string; to: string };
  profitAndLoss: PlatformProfitAndLoss;
  position: { payingPharmacies: number; awaitingPaisa: number; awaitingPayments: number; refundsOwedPaisa: number; refundsOwed: number };
  trend: AccountsSummary['trend'];
}

export type PlatformEntryKind = 'income' | 'expense';

export interface PlatformEntry {
  id: string; kind: PlatformEntryKind; category: string; description: string; amount_paisa: number; entry_date: string;
  payment_method: string; reference: string | null; party: string | null; created_by_name: string | null; created_at: string;
}

export interface PaymentProviderSetup {
  key: string; label: string; configured: boolean; missing: string[]; mode: string; verified: boolean; note: string;
  methods: string[]; capabilities: { redirect: boolean; lookup: boolean; refund: boolean; webhook: boolean };
  webhookUrl: string | null; returnUrl: string | null;
}
