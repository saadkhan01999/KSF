/* What the platform console (the Super Admin) is sent. Field names follow the
   API: snake_case for stored records, camelCase for computed summaries. */

export interface PlatformOverview {
  pharmacies: { total: number; active: number; suspended: number; closed: number; new30: number; staff: number };
  income: {
    monthPaisa: number; lastMonthPaisa: number; allTimePaisa: number; refundedPaisa: number; payments: number; mrrPaisa: number;
    trend: { period: string; gross: number; refunded: number; net: number; payments: number }[];
  };
  subscriptions: { byPlan: { plan: string; pharmacies: number; paying: number }[]; byStatus: Record<string, number>; trialsActive: number };
  sales: {
    todayPaisa: number; todayInvoices: number; monthPaisa: number; monthInvoices: number; monthProfitPaisa: number; lastMonthPaisa: number;
    topPharmacies: { pharmacy_id: string; name: string; revenue: number; invoices: number }[];
  };
  support: { open: number; urgent: number; unread: number; resolved: number };
  recentSignups: { id: string; name: string; city: string | null; plan_key: string | null; status: string; created_at: string }[];
  recentPayments: { id: string; pharmacy_id: string; pharmacy_name: string; amount_paisa: number; provider: string | null; method: string | null; kind: string; paid_at: string; status: string }[];
}

export interface PharmacyRow {
  id: string; name: string; city: string | null; province: string | null; phone: string | null; email: string | null;
  status: 'active' | 'suspended' | 'closed'; plan_key: string | null; pharmacy_type: string | null; platform_note: string | null; created_at: string;
  owner: { id?: string; name?: string; email?: string; phone?: string | null };
  staff_count: number; last_active_at: string | null; subscription_status: string | null; period_end: string | null; price_paisa: number | null;
  revenue_30d: number; invoices_30d: number; open_tickets: number;
}

export interface PlatformStaff {
  id: string; full_name: string; email: string; phone: string | null; status: string; is_owner: number; role_name: string | null;
  branch_name: string | null; last_login_at: string | null; locked_until: string | null; failed_attempts: number; totp_enabled: number;
}

export interface PlatformPayment {
  id: string; pharmacy_id: string; pharmacy_name?: string; subscription_id: string; amount_paisa: number; currency: string; status: string;
  kind: string; provider: string | null; provider_reference: string | null; method: string | null; paid_at: string | null;
  refunded_paisa: number | null; statement_reference: string | null; created_at: string; plan_key?: string | null;
}

export interface PaymentAttemptRow {
  id: string; reference: string; pharmacy_id: string; pharmacy_name?: string; created_by_name?: string; provider: string; method: string | null;
  amount_paisa: number; currency: string; status: string; provider_status: string | null; plan_key: string | null;
  created_at: string; expires_at: string | null; failure_reason: string | null;
}

export interface HelpItem {
  id: string; userId: string; name: string; role: string; pharmacyId: string; pharmacyName?: string;
  kind: string; fix: string; title: string; detail: string; at: string;
}

export interface PlatformSubscription {
  subscriptionId: string | null; plan: string; planName: string; status: string; entitled: boolean; isFree: boolean; autoRenew: boolean;
  periodStart?: string; periodEnd?: string; graceUntil?: string | null; daysLeft: number | null; failedPayments?: number;
  limits: { users?: number; branches?: number; medicines?: number; desktopDevices?: number; mobileDevices?: number };
  trial: { expiresAt: string; daysLeft: number; source: string } | null;
}

export interface PharmacyDetail {
  data: {
    id: string; name: string; legal_name: string | null; email: string | null; phone: string | null; address: string | null; city: string | null;
    province: string | null; ntn: string | null; drap_licence: string | null; status: 'active' | 'suspended' | 'closed'; plan_key: string | null;
    platform_note: string | null; device_limit_desktop: number | null; device_limit_mobile: number | null; created_at: string; pharmacy_type: string | null;
  };
  owner: PlatformStaff | null;
  subscription: PlatformSubscription | null;
  staff: PlatformStaff[];
  branches: { id: string; name: string; code: string | null; city: string | null; is_main: number; status: string }[];
  payments: PlatformPayment[];
  attempts: PaymentAttemptRow[];
  tickets: TicketSummary[];
  activity: { id: string; actor_name: string; actor_role: string; action: string; summary: string | null; severity: string; created_at: string }[];
  help: HelpItem[];
  figures: {
    todayPaisa: number; todayInvoices: number; monthPaisa: number; monthInvoices: number; monthProfitPaisa: number;
    allTimePaisa: number; allTimeInvoices: number; medicines: number; lowStock: number; stockValuePaisa: number; customers: number;
  };
}

/* ------------------------------------------------------------- support */
export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TicketMessage {
  id: string; author_id: string | null; author_name: string; author_side: 'pharmacy' | 'platform'; body: string; created_at: string;
}

export interface TicketSummary {
  id: string; reference: string; pharmacy_id: string; pharmacy_name: string; raised_by: string | null; raised_by_name: string;
  raised_by_role: string | null; subject: string; category: string; priority: TicketPriority; status: TicketStatus;
  created_at: string; updated_at: string; last_activity_at: string; resolved_at: string | null;
  unread_by_pharmacy: number; unread_by_platform: number; message_count?: number;
  last_message?: { author_side: 'pharmacy' | 'platform'; author_name: string; preview: string; created_at: string } | null;
}

export interface Ticket extends TicketSummary { messages: TicketMessage[] }

export interface PlanRow {
  id: string; key: string; name: string; tagline: string | null; description: string | null; period: string; periodDays: number;
  pricePaisa: number; currency: string; graceDays: number; trialDays: number; isFree: boolean; isDefault: boolean; isPublic?: boolean;
  autoRenew: boolean; status?: string; sortOrder: number; features: string[]; pharmacies?: number;
  limits: { desktopDevices: number; mobileDevices: number; users: number; branches: number; medicines: number };
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open', in_progress: 'In progress', waiting: 'Waiting for the pharmacy', resolved: 'Resolved', closed: 'Closed'
};

export const TICKET_CATEGORY_LABEL: Record<string, string> = {
  account: 'Account and sign-in', billing: 'Billing and plan', sales: 'Till and sales', stock: 'Stock and medicines',
  'data-import': 'Data import', technical: 'Something not working', other: 'Something else'
};
