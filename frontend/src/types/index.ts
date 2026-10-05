/* Shared types. Field names mirror the database columns so a row can be
   passed straight from the API to a screen without a translation layer. */

export type StockState = 'in-stock' | 'reorder-soon' | 'low-stock' | 'out-of-stock';
export type ExpiryState = 'safe' | 'expiring' | 'critical' | 'expired';
export type Tone = 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'purple' | 'gold' | 'neutral';

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  cnic: string | null;
  pharmacistRegNo: string | null;
  roleKey: string;
  roleName: string;
  roleLevel: number;
  branchId: string | null;
  branchName: string | null;
  status: string;
  /** The person who registered the pharmacy. They hold the Admin role. */
  isOwner: boolean;
  /** The one account that runs the whole platform. */
  isPlatformAdmin: boolean;
  /** The Super Admin working inside a pharmacy, with every permission. */
  supportMode: boolean;
  pharmacyId: string | null;
  pharmacyName: string | null;
  /** The person's own brand theme, when their role may choose one. */
  theme: string | null;
  mustChangePassword: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  permissions: string[];
}

/* Accounts, devices, subscriptions, referrals and data migration. */
export * from './account';

export interface Pharmacy {
  id: string; name: string; legalName: string | null;
  phone: string | null; email: string | null; address: string | null;
  city: string; province: string;
  ntn: string | null; strn: string | null; drapLicence: string | null;
  currency: string; timezone: string; gstPercent: number;
}

export interface Branch {
  id: string; name: string; code: string | null; city: string | null;
  is_main: number; status: string;
  staff_count?: number; sales_count?: number; revenue_paisa?: number;
  address?: string | null; province?: string | null; phone?: string | null; drap_licence?: string | null;
}

export interface Badges {
  notifications: number;
  prescriptionsPending: number;
  lowStock: number;
  expiring: number;
  purchasesOpen: number;
  messagesUnread: number;
  /** Requests to KSF support with an answer waiting (pharmacy) or open (platform). */
  supportOpen?: number;
  /** Pharmacies on the platform (platform console only). */
  pharmacies?: number;
}

export interface ThemeOption { key: string; name: string; description?: string; swatch?: string }

export interface Bootstrap {
  /** True for the platform console: no pharmacy, platform badges. */
  platform: boolean;
  supportMode?: boolean;
  pharmacy: Pharmacy;
  branches: Branch[];
  settings: Record<string, string>;
  badges: Badges;
  permissionCatalogue: { key: string; label: string; group: string }[];
  /** The minimum the server enforces — PASSWORD_MIN_LENGTH, 12 by default. */
  passwordMinLength?: number;
  /** Why a discount may be given at the till. */
  discountReasons?: { value: string; label: string }[];
  version: string;
  /** The brand theme this person sees, the pharmacy's default, and all five. */
  theme: string;
  pharmacyTheme: string | null;
  themes: ThemeOption[];
}

/** The pharmacy Admin — or the Super Admin supporting the pharmacy. */
export const isPharmacyAdmin = (user: Pick<SessionUser, 'roleKey' | 'supportMode'> | null | undefined): boolean =>
  !!user && (user.roleKey === 'admin' || user.supportMode);

/** A person whose figures the owner or Super Admin can open (GET /reports/people). */
export interface StaffOption { id: string; name: string; role_id: string | null; role: string | null; role_level: number | null; status: string }

/** A role the owner or Super Admin can open combined: "All Cashiers". */
export interface RoleOption { id: string; name: string; plural: string; level: number; people: number }

/** Whose figures a screen is showing: null person means the whole pharmacy;
    `group` means everybody in one role. */
export interface FigureScope { everyone: boolean; person: { id: string; name: string; role: string | null; group?: boolean } | null; pharmacyWide?: boolean }

/** Somebody who is stuck and what fixes it (GET /staff/help). */
export interface StaffHelpItem {
  id: string; userId: string; name: string; role: string;
  kind: 'locked' | 'wrong-password' | 'device-limit' | 'two-step' | 'suspended';
  fix: 'unlock' | 'reset-password' | 'devices' | 'reset-2fa' | 'restore';
  title: string; detail: string; at: string;
}

export interface Category {
  id: string; name: string; description: string | null; colour: Tone;
  requires_prescription: number; status: string; medicine_count?: number;
}

export interface Medicine {
  id: string; name: string; generic_name: string | null; manufacturer: string | null;
  form: string; strength: string | null; pack_size: string | null;
  sku: string | null; barcode: string | null; drap_reg_no: string | null;
  shelf_location: string | null; storage_note: string | null;
  category_id: string | null; category_name?: string | null; category_colour?: Tone;
  cost_paisa: number; price_paisa: number; gst_percent: number;
  min_stock: number; max_stock: number;
  requires_prescription: number; is_controlled: number;
  status: string; on_hand: number; stock_state: StockState;
  next_expiry?: string | null;
}

export interface Batch {
  id: string; medicine_id: string; batch_no: string; expiry_date: string;
  quantity: number; quantity_in: number; cost_paisa: number; price_paisa: number;
  status: string; quarantine_note: string | null; received_at: string;
  medicine_name?: string; supplier_name?: string | null;
  form?: string; strength?: string; category_name?: string | null;
  value_paisa?: number; state?: ExpiryState; days?: number;
}

export interface Supplier {
  id: string; name: string; contact_person: string | null; phone: string | null;
  email: string | null; address: string | null; city: string | null; ntn: string | null;
  payment_terms: string; rating: number; status: string; notes: string | null;
  order_count?: number; total_spend_paisa?: number; last_order?: string | null;
  /* What was owed on the day of the migration, and what is owed now: the
     opening figure plus received orders that have not been paid for. The
     total is computed by the server, not stored. */
  opening_balance_paisa?: number; unpaid_orders_paisa?: number; payable_paisa?: number;
}

export interface PurchaseItem {
  id: string; medicine_id: string; medicine_name: string; batch_no: string;
  expiry_date: string; quantity: number; cost_paisa: number; price_paisa: number;
  line_total_paisa: number;
}

export interface Purchase {
  id: string; reference: string; invoice_no: string | null; supplier_id: string;
  supplier_name?: string; purchase_date: string; expected_date: string | null;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  subtotal_paisa: number; discount_paisa: number; gst_paisa: number;
  total_paisa: number; paid_paisa: number; payment_status: string;
  notes: string | null; line_count?: number; unit_count?: number;
  items?: PurchaseItem[]; received_by_name?: string | null; created_by_name?: string | null;
  supplier_phone?: string | null; supplier_address?: string | null; payment_terms?: string;
}

export interface Customer {
  id: string; name: string; phone: string | null; cnic: string | null; email: string | null;
  address: string | null; city: string | null; date_of_birth: string | null; gender: string | null;
  allergies: string | null; chronic_notes: string | null;
  loyalty_points: number; credit_limit_paisa: number; balance_paisa: number; status: string;
  visits?: number; total_spend_paisa?: number; last_visit?: string | null;
  sales?: Sale[]; prescriptions?: Prescription[]; payments?: CustomerPayment[];
  stats?: { visits: number; spend: number; average: number };
}

/* Udhaar coming back: one receipt for money received against an account. */
export interface CustomerPayment {
  id: string; receipt_no: string; customer_id?: string; customer_name?: string;
  customer_phone?: string | null; sale_id?: string | null; invoice_no?: string | null;
  amount_paisa: number; payment_method: string; reference?: string | null; note?: string | null;
  balance_before_paisa?: number; balance_after_paisa: number;
  received_by_name: string | null; received_at: string;
  reversed_at: string | null; reversal_reason?: string | null;
}

export interface SaleItem {
  id: string; medicine_id: string | null; batch_id: string | null;
  medicine_name: string; batch_no: string | null; expiry_date: string | null;
  quantity: number; unit_price_paisa: number; unit_cost_paisa: number;
  discount_paisa: number; gst_paisa: number; line_total_paisa: number;
}

export interface Sale {
  id: string; invoice_no: string; sold_at: string;
  customer_id: string | null; customer_name: string | null; customer_phone?: string | null;
  prescription_id: string | null; prescription_reference?: string | null;
  subtotal_paisa: number; discount_paisa: number; gst_paisa: number;
  total_paisa: number; paid_paisa: number; change_paisa: number; cost_paisa: number;
  payment_method: string; status: 'completed' | 'refunded';
  served_by: string | null; served_by_name: string | null; notes: string | null;
  /** Why a discount was given — a key from Bootstrap.discountReasons. */
  discount_reason?: string | null; discount_note?: string | null;
  branch_name?: string | null; line_count?: number; unit_count?: number;
  items?: SaleItem[];
  pharmacy?: { name: string; address: string; city: string; phone: string; ntn: string; strn: string; drap_licence: string };
  footer?: string;
  loyalty_points?: number | null; refunded_at?: string | null;
}

/* One cash-up. A corrected count is a new row with a higher attempt_no; the
   one still standing is the one with no superseded_at. */
export interface DayClosing {
  id: string; business_date: string; branch_id: string | null; branch_name?: string | null;
  opening_float_paisa: number; expected_cash_paisa: number; counted_cash_paisa: number;
  variance_paisa: number;
  cash_sales_paisa: number; card_sales_paisa: number; wallet_sales_paisa: number;
  bank_sales_paisa: number; credit_sales_paisa: number;
  repayments_paisa: number; cash_repayments_paisa: number;
  refunds_paisa: number; cash_refunds_paisa: number; cash_expenses_paisa: number;
  invoice_count: number; note: string | null;
  closed_by_name: string | null; closed_at: string;
  attempt_no: number; superseded_at: string | null;
  breakdown?: DayFigures | null;
}

/* What the server worked out the drawer should hold. Every figure is a sum
   over rows, never anything the browser sent. */
export interface DayFigures {
  businessDate: string; branchId: string | null;
  openingFloatPaisa: number; expectedCashPaisa: number;
  cash: { salesPaisa: number; repaymentsPaisa: number; refundsPaisa: number; reversalsPaisa: number; expensesPaisa: number };
  nonCash: { cardPaisa: number; walletPaisa: number; bankPaisa: number; creditPaisa: number; note: string };
  sales: { invoices: number; totalPaisa: number; discountPaisa: number; gstPaisa: number };
  refundsPaisa: number; repaymentsPaisa: number; repaymentReceipts: number;
  expensesPaisa: number; expenseEntries: number;
}

export interface PrescriptionItem {
  id: string; medicine_id: string | null; medicine_text: string;
  dosage: string | null; duration: string | null; quantity: number;
  catalogue_name?: string | null; price_paisa?: number; on_hand?: number;
  requires_prescription?: number;
}

export interface Prescription {
  id: string; reference: string; customer_id: string | null; customer_name?: string | null;
  customer_phone?: string | null; allergies?: string | null; chronic_notes?: string | null;
  patient_name: string | null; doctor_name: string | null; hospital: string | null;
  pmdc_number: string | null; prescription_date: string | null;
  status: 'pending' | 'verified' | 'dispensed' | 'rejected';
  notes: string | null; verified_by_name?: string | null; verified_at: string | null;
  dispensed_by_name?: string | null; dispensed_at: string | null;
  invoice_no?: string | null; item_count?: number; items?: PrescriptionItem[];
}

export interface Expense {
  id: string; category: string; description: string; amount_paisa: number;
  expense_date: string; payment_method: string; reference: string | null;
  vendor: string | null; status: 'recorded' | 'approved';
  created_by_name?: string | null; approved_by_name?: string | null; branch_name?: string | null;
}

export interface Role {
  id: string; key: string; name: string; description: string | null;
  icon: string; level: number; is_system: number;
  permissions: string[]; member_count?: number;
}

export interface StaffMember {
  id: string; full_name: string; email: string; phone: string | null; cnic: string | null;
  pharmacist_reg_no: string | null; status: string;
  last_login_at: string | null; created_at: string;
  must_change_password: number; locked_until: string | null;
  role_id: string; role_key: string; role_name: string; role_level: number; role_is_system: number;
  branch_id: string | null; branch_name: string | null;
  active_sessions: number; sales_count: number;
  /** Registered devices, and whether two-step sign-in is on. */
  devices: number; totp_enabled: number;
}

export interface AppNotification {
  id: string; type: string; severity: 'info' | 'warn' | 'danger' | 'success';
  title: string; body: string | null; link: string | null;
  is_read: number; created_at: string;
}

export interface ActivityEntry {
  id: string; user_id: string | null; actor_name: string | null; actor_role: string | null;
  action: string; entity: string | null; entity_id: string | null;
  summary: string | null; severity: string; ip: string | null;
  user_agent: string | null; meta: string | null; created_at: string;
}

export interface StockMovement {
  id: string; medicine_id: string; medicine_name?: string; batch_id: string | null;
  batch_no?: string | null; type: string; quantity_delta: number; balance_after: number;
  reference_type: string | null; reference_id: string | null; reason: string | null;
  actor_name?: string | null; created_at: string;
}

export interface Paged<T> {
  data: T[]; page: number; size: number; total: number; pages: number;
}

/* The line the till is working on, before it becomes a sale. */
export interface CartLine {
  medicine: Medicine;
  quantity: number;
  unitPricePaisa: number;
}

/* ---------------------------------------------------------------------------
   Internal messaging
   --------------------------------------------------------------------------- */

export type ConversationKind = 'direct' | 'role' | 'broadcast';
export type ConversationPriority = 'normal' | 'high' | 'urgent';

export interface ChatMessage {
  id: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export interface ConversationMember {
  user_id: string;
  full_name: string;
  status: string;
  role_name: string | null;
  role_key: string | null;
  last_read_at: string | null;
  is_muted: number;
}

export interface Conversation {
  id: string;
  subject: string;
  kind: ConversationKind;
  priority: ConversationPriority;
  status: 'open' | 'resolved';
  audience_role_id: string | null;
  audience_role_name: string | null;
  linked_entity: string | null;
  linked_entity_id: string | null;
  origin_system: string;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;

  /* Present on the list endpoint only. */
  unread?: number;
  member_count?: number;
  message_count?: number;
  last_body?: string | null;
  last_sender?: string | null;
  last_read_at?: string | null;
  is_muted?: number;

  /* Present on the detail endpoint only. */
  messages?: ChatMessage[];
  members?: ConversationMember[];
  my_last_read_at?: string | null;
}

export interface MessageDirectory {
  people: {
    id: string;
    full_name: string;
    email: string;
    role_id: string;
    role_name: string;
    role_key: string;
    branch_name: string | null;
    online: number;
  }[];
  roles: { id: string; name: string; key: string; level: number; member_count: number }[];
  canBroadcast: boolean;
}
