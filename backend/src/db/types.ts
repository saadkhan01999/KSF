/* ==========================================================================
   Document shapes
   --------------------------------------------------------------------------
   Field names are the API's field names (snake_case, money in paisa as
   integers, dates as ISO-8601 strings), so a document can be returned as it
   is stored. Yes/no flags are 0 or 1 because that is what the web app has
   always been sent.

   Lines that belong to one record and are never queried on their own are
   embedded: a sale's items, a purchase's items, a prescription's items, a
   role's permissions and a conversation's members.
   ========================================================================== */

type Id = string;
type When = string;
type Flag = 0 | 1;

export interface Base { _id: Id; id: Id }

/* ------------------------------------------------------------- tenancy */
export interface Pharmacy extends Base {
  name: string; legal_name: string | null; slug: string;
  ntn: string | null; strn: string | null; drap_licence: string | null;
  phone: string | null; email: string | null; address: string | null;
  city: string | null; province: string | null; country: string; currency: string; timezone: string;
  postcode?: string | null; website?: string | null; registration_no?: string | null;
  gst_percent: number; logo_initials: string; status: 'active' | 'suspended' | 'closed';
  pharmacy_type: string | null; subscription_id: Id | null; plan_key: string | null;
  owner_user_id: Id | null; device_limit_desktop: number | null; device_limit_mobile: number | null;
  referred_by_code: string | null; platform_note?: string | null;
  created_at: When; updated_at: When;
}

export interface Branch extends Base {
  pharmacy_id: Id; name: string; code: string | null; address: string | null; city: string | null;
  province: string | null; phone: string | null; drap_licence: string | null; is_main: Flag;
  status: string; created_at: When; updated_at: When;
}

export interface Role extends Base {
  pharmacy_id: Id; key: string; name: string; description: string | null; icon: string;
  level: number; is_system: Flag; permissions: string[]; created_by: Id | null;
  created_at: When; updated_at: When;
}

export interface User extends Base {
  pharmacy_id: Id | null; branch_id: Id | null; role_id: Id | null;
  /** The one platform account that runs the whole service. */
  is_platform_admin?: Flag;
  full_name: string; email: string; phone: string | null; cnic: string | null; pharmacist_reg_no: string | null;
  password_hash: string; password_changed_at: When | null; must_change_password: Flag;
  status: 'active' | 'suspended' | 'archived'; failed_attempts: number; locked_until: When | null;
  last_login_at: When | null; email_verified_at: When | null;
  totp_secret: string | null; totp_enabled: Flag; totp_confirmed_at: When | null; recovery_generated_at: When | null;
  is_owner: Flag; theme: string | null; avatar_tone?: string;
  created_at: When; updated_at: When;
}

export interface Session extends Base {
  user_id: Id; device_id: Id | null; refresh_hash: string; ip: string | null; user_agent: string;
  created_at: When; last_seen_at: When; expires_at: When; absolute_expires_at: When;
  revoked_at: When | null; revoked_reason: string | null; elevated_until: When | null; rotations: number;
}

export interface Device extends Base {
  pharmacy_id: Id | null; user_id: Id; secret_hash: string; category: 'desktop' | 'mobile' | 'tablet';
  label: string | null; platform: string | null; browser: string | null; browser_version: string | null;
  first_ip: string | null; last_ip: string | null; trusted: Flag; status: 'active' | 'revoked';
  registered_at: When; last_active_at: When; revoked_at: When | null; revoked_by: Id | null;
  revoke_reason: string | null; created_at: When; updated_at: When;
}

export interface Setting { _id: string; pharmacy_id: Id; key: string; value: string; updated_at: When }
export interface Counter { _id: string; pharmacy_id: Id; name: string; value: number }

/* ------------------------------------------------------------- catalogue */
export interface Category extends Base {
  pharmacy_id: Id; name: string; description: string | null; colour: string;
  requires_prescription: Flag; status: string; created_at: When; updated_at: When;
}

export interface Medicine extends Base {
  pharmacy_id: Id; category_id: Id | null; name: string; generic_name: string | null; manufacturer: string | null;
  form: string; strength: string | null; pack_size: string | null; sku: string | null; barcode: string | null;
  drap_reg_no: string | null; shelf_location: string | null; cost_paisa: number; price_paisa: number;
  gst_percent: number; min_stock: number; max_stock: number; requires_prescription: Flag; is_controlled: Flag;
  storage_note: string | null; status: 'active' | 'inactive' | 'retired'; created_at: When; updated_at: When;
}

export interface Batch extends Base {
  pharmacy_id: Id; medicine_id: Id; branch_id: Id | null; supplier_id: Id | null; purchase_id: Id | null;
  batch_no: string; expiry_date: string; quantity: number; quantity_in: number;
  cost_paisa: number; price_paisa: number; status: 'active' | 'finished' | 'quarantined' | 'expired' | 'written-off';
  quarantine_note: string | null; received_at: When; created_at: When; updated_at: When;
}

export interface StockMovement extends Base {
  pharmacy_id: Id; medicine_id: Id; batch_id: Id | null; type: string; quantity_delta: number; balance_after: number;
  reference_type: string | null; reference_id: string | null; reason: string | null; created_by: Id | null; created_at: When;
}

/* ------------------------------------------------------------ purchasing */
export interface Supplier extends Base {
  pharmacy_id: Id; name: string; contact_person: string | null; phone: string | null; email: string | null;
  address: string | null; city: string | null; ntn: string | null; payment_terms: string | null;
  balance_paisa: number; opening_balance_paisa: number; rating: number; status: string; notes: string | null;
  created_at: When; updated_at: When;
}

export interface PurchaseItem {
  id: Id; medicine_id: Id; medicine_name: string; batch_no: string; expiry_date: string;
  quantity: number; cost_paisa: number; price_paisa: number; line_total_paisa: number;
}

export interface Purchase extends Base {
  pharmacy_id: Id; branch_id: Id | null; supplier_id: Id; reference: string; invoice_no: string | null;
  purchase_date: string; expected_date: string | null; status: string; items: PurchaseItem[];
  subtotal_paisa: number; discount_paisa: number; gst_paisa: number; total_paisa: number; paid_paisa: number;
  payment_status: string; notes: string | null; created_by: Id | null; received_by: Id | null; received_at: When | null;
  approved_by: Id | null; approved_at: When | null; created_at: When; updated_at: When;
}

/* --------------------------------------------------------------- selling */
export interface Customer extends Base {
  pharmacy_id: Id; name: string; phone: string | null; cnic: string | null; email: string | null;
  address: string | null; city: string | null; date_of_birth: string | null; gender: string | null;
  allergies: string | null; chronic_notes: string | null; loyalty_points: number;
  credit_limit_paisa: number; balance_paisa: number; opening_balance_paisa: number; status: string;
  created_at: When; updated_at: When;
}

export interface CustomerPayment extends Base {
  pharmacy_id: Id; branch_id: Id | null; customer_id: Id; sale_id: Id | null; receipt_no: string;
  amount_paisa: number; payment_method: string; reference: string | null; note: string | null;
  balance_before_paisa: number; balance_after_paisa: number; received_by: Id | null; received_by_name: string | null;
  received_at: When; reversed_at: When | null; reversed_by: Id | null; reversal_reason: string | null; created_at: When;
}

export interface PrescriptionItem {
  id: Id; medicine_id: Id | null; medicine_text: string; dosage: string | null; duration: string | null; quantity: number;
}

export interface Prescription extends Base {
  pharmacy_id: Id; customer_id: Id | null; reference: string; patient_name: string | null; doctor_name: string | null;
  hospital: string | null; pmdc_number: string | null; prescription_date: string | null; status: string;
  notes: string | null; items: PrescriptionItem[]; verified_by: Id | null; verified_at: When | null;
  dispensed_by: Id | null; dispensed_at: When | null; sale_id: Id | null; created_by: Id | null;
  created_at: When; updated_at: When;
}

export interface SaleItem {
  id: Id; medicine_id: Id | null; batch_id: Id | null; medicine_name: string; batch_no: string | null;
  expiry_date: string | null; quantity: number; unit_price_paisa: number; unit_cost_paisa: number;
  discount_paisa: number; gst_paisa: number; line_total_paisa: number;
}

export interface Sale extends Base {
  pharmacy_id: Id; branch_id: Id | null; customer_id: Id | null; prescription_id: Id | null; invoice_no: string;
  sold_at: When; items: SaleItem[]; subtotal_paisa: number; discount_paisa: number; gst_paisa: number;
  total_paisa: number; paid_paisa: number; change_paisa: number; cost_paisa: number; payment_method: string;
  status: 'completed' | 'refunded' | 'held' | 'void'; customer_name: string | null; served_by: Id | null;
  served_by_name: string | null; notes: string | null; discount_reason: string | null; discount_note: string | null;
  refunded_at: When | null; refunded_by: Id | null; refund_reason?: string | null; created_at: When; updated_at: When;
}

export interface Expense extends Base {
  pharmacy_id: Id; branch_id: Id | null; category: string; description: string; amount_paisa: number;
  expense_date: string; payment_method: string; reference: string | null; vendor: string | null; status: string;
  approved_by: Id | null; approved_at: When | null; created_by: Id | null; created_at: When; updated_at: When;
}

export interface DayClosing extends Base {
  pharmacy_id: Id; branch_id: Id | null; business_date: string; opening_float_paisa: number;
  expected_cash_paisa: number; counted_cash_paisa: number; variance_paisa: number;
  cash_sales_paisa: number; card_sales_paisa: number; wallet_sales_paisa: number; bank_sales_paisa: number;
  credit_sales_paisa: number; repayments_paisa: number; cash_repayments_paisa: number; refunds_paisa: number;
  cash_refunds_paisa: number; cash_expenses_paisa: number; invoice_count: number; breakdown: unknown;
  note: string | null; closed_by: Id | null; closed_by_name: string | null; closed_at: When;
  attempt_no: number; superseded_at: When | null; created_at: When;
}

/* --------------------------------------------------------------- trails */
export interface Notification extends Base {
  pharmacy_id: Id | null; user_id: Id | null; type: string; severity: string; title: string;
  body: string | null; link: string | null; is_read: Flag; created_at: When;
}

export interface ActivityLog extends Base {
  pharmacy_id: Id | null; user_id: Id | null; actor_name: string; actor_role: string; action: string;
  entity: string | null; entity_id: string | null; summary: string | null; severity: string;
  ip: string | null; user_agent: string; meta: unknown; created_at: When;
}

export interface AuditLog extends Base {
  pharmacy_id: Id; sequence: number; user_id: Id | null; actor_name: string; actor_role: string; action: string;
  entity: string | null; entity_id: string | null; summary: string | null; before_json: string | null;
  after_json: string | null; ip: string | null; user_agent: string; prev_hash: string | null; entry_hash: string; created_at: When;
}

/** The tip of each pharmacy's audit chain, advanced by compare-and-set. */
export interface AuditHead { _id: Id; sequence: number; hash: string | null }

export interface SecurityEvent extends Base {
  pharmacy_id: Id | null; user_id: Id | null; email_hint: string | null; type: string; severity: string;
  outcome: string; ip: string | null; user_agent: string; device_id: Id | null; session_id: string | null;
  detail: string | null; created_at: When;
}

export interface LoginAttempt extends Base { email: string; ip: string | null; ok: Flag; created_at: When }

/* ------------------------------------------------------------ messaging */
export interface ConversationMember {
  user_id: Id; role_id: Id | null; joined_at: When; last_read_at: When | null; is_muted: Flag;
}

export interface Conversation extends Base {
  pharmacy_id: Id; subject: string; kind: 'direct' | 'role' | 'broadcast'; priority: string;
  audience_role_id: Id | null; linked_entity: string | null; linked_entity_id: string | null; origin_system: string;
  status: string; members: ConversationMember[]; created_by: Id | null; created_at: When; updated_at: When;
  last_message_at: When; resolved_at?: When | null; resolved_by?: Id | null;
}

export interface Message extends Base {
  conversation_id: Id; pharmacy_id: Id; sender_id: Id | null; sender_name: string; sender_role: string | null;
  body: string; created_at: When; edited_at: When | null; deleted_at: When | null;
}

/* ------------------------------------------------------- accounts & codes */
export interface Registration extends Base {
  token_hash: string; email: string | null; step: number; payload: Record<string, unknown>; email_verified: Flag;
  verified_at: When | null; referral_code: string | null; ip: string | null; user_agent: string;
  status: string; pharmacy_id: Id | null; expires_at: When; created_at: When; updated_at: When;
}

export interface VerificationCode extends Base {
  purpose: string; email: string; user_id: Id | null; pharmacy_id: Id | null; reference_id: string | null;
  code_hash: string; attempts: number; max_attempts: number; sent_count: number; ip: string | null;
  expires_at: When; consumed_at: When | null; created_at: When;
}

export interface RecoveryCode extends Base { user_id: Id; code_hash: string; used_at: When | null; created_at: When }

/* --------------------------------------------------------------- billing */
export interface Plan extends Base {
  key: string; name: string; tagline: string | null; description: string | null; period: string; period_days: number;
  price_paisa: number; currency: string; annual_discount_pct: number; trial_days: number; grace_days: number;
  max_desktop_devices: number; max_mobile_devices: number; max_users: number; max_branches: number;
  max_medicines: number; features: string[]; auto_renew: Flag; is_default: Flag; is_public: Flag; is_free: Flag;
  sort_order: number; status: string; created_at: When; updated_at: When;
}

export interface Subscription extends Base {
  pharmacy_id: Id; plan_id: Id; plan_key: string; status: string; price_paisa: number; currency: string;
  auto_renew: Flag; started_at: When; current_period_start: When; current_period_end: When;
  renewal_at: When | null; grace_until: When | null; cancelled_at: When | null; cancel_reason: string | null;
  ended_at: When | null; source: string; provider: string | null; provider_reference: string | null;
  failed_payments: number; reminder_sent_for?: string | null; dunning_sent_for?: string | null;
  created_at: When; updated_at: When;
}

export interface SubscriptionPayment extends Base {
  subscription_id: Id; pharmacy_id: Id; amount_paisa: number; currency: string; status: string; kind: string;
  provider: string | null; provider_reference: string | null; provider_event_id: string | null; method: string | null;
  failure_code: string | null; failure_message: string | null; period_start: When | null; period_end: When | null;
  paid_at: When | null; provider_status: string | null; fee_paisa: number | null; settled_at: When | null;
  refunded_paisa: number | null; cancelled_at: When | null; expires_at: When | null; verified_by: Id | null;
  verified_at: When | null; statement_reference: string | null; attempt_id: Id | null; created_at: When; updated_at: When | null;
}

export interface PaymentAttempt extends Base {
  reference: string; pharmacy_id: Id; subscription_id: Id | null; purpose: string; plan_key: string | null;
  provider: string; method: string | null; amount_paisa: number; currency: string; status: string;
  provider_reference: string | null; provider_status: string | null; redirect_url: string | null;
  request_payload: string | null; last_checked_at: When | null; check_count: number; failure_reason: string | null;
  created_by: Id | null; created_at: When; updated_at: When; expires_at: When | null;
}

export interface PaymentRefund extends Base {
  payment_id: Id; pharmacy_id: Id; amount_paisa: number; currency: string; reason: string | null; status: string;
  provider: string; provider_reference: string | null; provider_status: string | null; requested_by: Id | null;
  requested_at: When; completed_at: When | null; failure_message: string | null;
}

export interface WebhookEvent extends Base {
  provider: string; event_id: string; event_type: string | null; signature_valid: Flag; payload: string | null;
  status: string; result: string | null; received_at: When; processed_at: When | null;
}

export interface ReferralCode extends Base {
  code: string; pharmacy_id: Id; user_id: Id | null; uses: number; successful: number; max_uses: number;
  status: string; created_at: When; updated_at: When;
}

export interface Referral extends Base {
  code: string; referral_code_id: Id | null; referrer_pharmacy_id: Id | null; referrer_user_id: Id | null;
  referred_pharmacy_id: Id | null; referred_user_id: Id | null; referred_email: string; trial_id: Id | null;
  status: string; reject_reason: string | null; signup_ip: string | null; registered_at: When | null;
  verified_at: When | null; converted_at: When | null; created_at: When; updated_at: When;
}

export interface Trial extends Base {
  pharmacy_id: Id; subscription_id: Id | null; plan_key: string; source: string; referral_id: Id | null;
  days: number; started_at: When; expires_at: When; ended_at: When | null; status: string; created_at: When; updated_at: When;
}

/* ----------------------------------------------------------- data import */
export interface MigrationJob extends Base {
  pharmacy_id: Id; created_by: Id | null; created_by_name: string | null; source: string; adapter: string | null;
  category: string; file_name: string | null; file_size: number; file_hash: string | null;
  columns: string[]; mapping: Record<string, string>; options: Record<string, unknown>; status: string;
  total_rows: number; valid_rows: number; error_rows: number; skipped_rows: number; imported_rows: number;
  backup_path: string | null; report: unknown; error_message: string | null; duplicate_of: Id | null;
  started_at: When | null; finished_at: When | null; rolled_back_at: When | null; created_at: When; updated_at: When;
}

export interface ImportProblem { code: string; message: string; field: string | null; fixable: boolean }

export interface MigrationItem extends Base {
  job_id: Id; row_number: number; raw: Record<string, unknown>; mapped: Record<string, unknown>; status: string;
  resolution: string | null; errors: ImportProblem[]; target_collection: string | null; target_id: string | null;
  created_at: When; updated_at: When;
}

/* ------------------------------------------------------------------ mail */
export interface MailDelivery extends Base {
  notice_key: string | null; pharmacy_id: Id | null; to: string; subject: string; template: string | null;
  text: string; html: string | null; status: string; attempts: number; max_attempts: number;
  last_error: string | null; next_attempt_at: When | null; sent_at: When | null; created_at: When; updated_at: When;
}

/* --------------------------------------------------------------- support */
export interface TicketMessage {
  id: Id; author_id: Id | null; author_name: string; author_side: 'pharmacy' | 'platform'; body: string; created_at: When;
}

export interface SupportTicket extends Base {
  reference: string; pharmacy_id: Id; pharmacy_name: string; raised_by: Id | null; raised_by_name: string;
  raised_by_role: string | null; subject: string; category: string; priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed'; messages: TicketMessage[];
  assigned_to: Id | null; resolved_at: When | null; created_at: When; updated_at: When; last_activity_at: When;
  unread_by_pharmacy: Flag; unread_by_platform: Flag;
}
