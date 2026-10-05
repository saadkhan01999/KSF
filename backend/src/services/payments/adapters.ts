/* ==========================================================================
   The four ways to take a subscription payment
   --------------------------------------------------------------------------
   gateway        an aggregator (Safepay, PayFast, Paymob, a bank gateway)
                  covering card and wallets under one contract — the route
                  most installations should launch with.
   jazzcash       JazzCash hosted checkout (pp_ fields, pp_SecureHash).
   easypaisa      Easypaisa hosted checkout; the hash field order comes from
                  the merchant pack, so it is configuration, not a constant.
   bank-transfer  Bank transfer or Raast. No API: the platform Super Admin
                  confirms the credit against the statement.

   The JazzCash and Easypaisa adapters follow the published integration
   shapes and stay marked unverified until somebody with merchant credentials
   runs the sandbox cases in docs/PAYMENTS.md and sets *_VERIFIED=true.
   ========================================================================== */

import {
  hmacHex, paisaToUnits, PAYMENT_STATUS, requireEnv, sameSignature, setting, unitsToPaisa,
  type Adapter, type PaymentStatus, type ProviderOutcome
} from './provider.js';

/** yyyyMMddHHmmss in Pakistan Standard Time. */
function pkStamp(date: Date, separator = ''): string {
  const local = new Date(date.getTime() + 300 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}${separator}`
    + `${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`;
}

const minutesFromNow = (name: string, fallback: number): Date => new Date(Date.now() + Number(setting(name) || fallback) * 60_000);

/* =============================== GATEWAY =============================== */

const GATEWAY_ENV = ['GATEWAY_CHECKOUT_URL', 'GATEWAY_MERCHANT_ID', 'GATEWAY_API_KEY', 'GATEWAY_WEBHOOK_SECRET'];
const GATEWAY_STATUS: Record<string, PaymentStatus> = {
  paid: PAYMENT_STATUS.SUCCEEDED, success: PAYMENT_STATUS.SUCCEEDED, succeeded: PAYMENT_STATUS.SUCCEEDED, completed: PAYMENT_STATUS.SUCCEEDED,
  pending: PAYMENT_STATUS.PENDING, in_progress: PAYMENT_STATUS.PENDING, failed: PAYMENT_STATUS.FAILED, declined: PAYMENT_STATUS.FAILED,
  cancelled: PAYMENT_STATUS.CANCELLED, canceled: PAYMENT_STATUS.CANCELLED, expired: PAYMENT_STATUS.EXPIRED, refunded: PAYMENT_STATUS.REFUNDED
};
const timeout = () => AbortSignal.timeout(Number(setting('GATEWAY_TIMEOUT_MS') || 12_000));

export const gateway: Adapter = {
  key: 'gateway',
  get label() { return setting('GATEWAY_NAME') || 'Card and wallet gateway'; },
  methods: ['card', 'wallet', 'transfer'],
  get capabilities() { return { redirect: true, lookup: !!setting('GATEWAY_STATUS_URL'), refund: !!setting('GATEWAY_REFUND_URL'), webhook: true }; },
  configured: () => requireEnv(GATEWAY_ENV),
  describe() {
    const state = requireEnv(GATEWAY_ENV);
    return {
      key: 'gateway', label: this.label, configured: state.ok, missing: state.missing, mode: setting('GATEWAY_MODE') || 'sandbox',
      verified: setting('GATEWAY_VERIFIED') === 'true', note: 'One contract covering card, Easypaisa and JazzCash. Hosted checkout — no card details reach KSF.'
    };
  },
  createRequest({ reference, amountPaisa, currency, description, returnUrl }) {
    const state = requireEnv(GATEWAY_ENV);
    if (!state.ok) return { ok: false, reason: `The gateway is not configured: ${state.missing.join(', ')}` };
    const expiry = minutesFromNow('GATEWAY_EXPIRY_MINUTES', 60);
    const fields: Record<string, string> = {
      merchant_id: setting('GATEWAY_MERCHANT_ID'), order_id: reference, amount: paisaToUnits(amountPaisa), currency,
      description: description.slice(0, 120), return_url: returnUrl, expires_at: expiry.toISOString()
    };
    /* Signed the way the webhook will be, so the aggregator can tell the
       request came from this server and not from somebody's browser. */
    const canonical = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('&');
    fields.signature = hmacHex(setting('GATEWAY_API_KEY'), canonical);
    return { ok: true, redirect: { url: setting('GATEWAY_CHECKOUT_URL'), method: 'POST', fields }, expiresAt: expiry.toISOString() };
  },
  /* The signature covers the raw bytes of the body, never a re-serialised
     copy: JSON.stringify does not promise to reproduce what was sent. */
  verifyCallback({ raw, body = {}, headers = {} }) {
    const key = setting('GATEWAY_WEBHOOK_SECRET');
    if (!key) return { ok: false, reason: 'The gateway is not configured.' };
    const header = (setting('GATEWAY_SIGNATURE_HEADER') || 'x-signature').toLowerCase();
    const supplied = String(headers[header] ?? '').replace(/^sha256=/i, '');
    if (!supplied) return { ok: false, reason: `The callback carried no ${header} header.` };
    if (!raw) return { ok: false, reason: 'The raw body was not available to verify.' };
    if (!sameSignature(hmacHex(key, raw), supplied)) return { ok: false, reason: 'The signature did not verify.' };
    const data = body.data ?? body;
    return {
      ok: true, reference: String(data.order_id ?? data.reference ?? ''),
      providerReference: String(data.transaction_id ?? data.id ?? data.order_id ?? ''),
      amountPaisa: typeof data.amount_paisa === 'number' ? data.amount_paisa : unitsToPaisa(data.amount),
      currency: String(data.currency || 'PKR'), status: GATEWAY_STATUS[String(data.status ?? '').toLowerCase()] ?? PAYMENT_STATUS.FAILED,
      providerStatus: String(data.status ?? ''), method: String(data.method ?? data.payment_method ?? '').toLowerCase() || null,
      feePaisa: typeof data.fee_paisa === 'number' ? data.fee_paisa : unitsToPaisa(data.fee)
    };
  },
  /* Turns a lost callback from a lost payment into a delay. Only offered when
     GATEWAY_STATUS_URL is set — there is no universal endpoint to guess at. */
  async lookup({ reference }) {
    const base = setting('GATEWAY_STATUS_URL');
    if (!base) return { ok: false, reason: 'No status endpoint is configured.' };
    const response = await fetch(`${base}${base.includes('?') ? '&' : '?'}order_id=${encodeURIComponent(reference)}`, {
      headers: { accept: 'application/json', 'x-merchant-id': setting('GATEWAY_MERCHANT_ID'), 'x-signature': hmacHex(setting('GATEWAY_API_KEY'), `order_id=${reference}`) },
      signal: timeout()
    });
    if (!response.ok) return { ok: false, reason: `The provider answered ${response.status}.` };
    const json = await response.json().catch(() => ({})) as Record<string, any>;
    const data = json.data ?? json;
    return {
      ok: true, reference: String(data.order_id ?? reference), providerReference: String(data.transaction_id ?? data.id ?? ''),
      amountPaisa: typeof data.amount_paisa === 'number' ? data.amount_paisa : unitsToPaisa(data.amount), currency: String(data.currency || 'PKR'),
      status: GATEWAY_STATUS[String(data.status ?? '').toLowerCase()] ?? PAYMENT_STATUS.PENDING, providerStatus: String(data.status ?? '')
    };
  },
  async refund({ providerReference, currency, amountPaisa, reason }) {
    const url = setting('GATEWAY_REFUND_URL');
    if (!url) return { ok: false, reason: 'No refund endpoint is configured.' };
    const body = JSON.stringify({
      merchant_id: setting('GATEWAY_MERCHANT_ID'), transaction_id: providerReference, amount: paisaToUnits(amountPaisa), currency, reason: reason.slice(0, 200)
    });
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': hmacHex(setting('GATEWAY_API_KEY'), body) }, body, signal: timeout()
    });
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) return { ok: false, reason: String(data.message || `The provider answered ${response.status}.`) };
    return {
      ok: true, providerReference: String(data.refund_id ?? data.id ?? ''),
      status: GATEWAY_STATUS[String(data.status ?? '').toLowerCase()] ?? PAYMENT_STATUS.PENDING, providerStatus: String(data.status ?? '')
    };
  }
};

/* =============================== JAZZCASH =============================== */

const JAZZCASH_ENV = ['JAZZCASH_MERCHANT_ID', 'JAZZCASH_PASSWORD', 'JAZZCASH_INTEGRITY_SALT', 'JAZZCASH_POST_URL'];

/** pp_SecureHash: the salt, then every non-empty pp_ field sorted by name, joined with '&'. */
export function jazzcashSignature(fields: Record<string, unknown>, salt: string): string {
  const values = Object.keys(fields)
    .filter((key) => /^pp_/i.test(key) && key.toLowerCase() !== 'pp_securehash' && String(fields[key] ?? '').length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => String(fields[key]));
  return hmacHex(salt, [salt, ...values].join('&')).toUpperCase();
}

export const jazzcash: Adapter = {
  key: 'jazzcash',
  label: 'JazzCash',
  methods: ['wallet', 'card', 'voucher'],
  capabilities: { redirect: true, lookup: false, refund: false, webhook: true },
  configured: () => requireEnv(JAZZCASH_ENV),
  describe() {
    const state = requireEnv(JAZZCASH_ENV);
    return {
      key: 'jazzcash', label: 'JazzCash', configured: state.ok, missing: state.missing, mode: setting('JAZZCASH_MODE') || 'sandbox',
      verified: setting('JAZZCASH_VERIFIED') === 'true', note: 'Hosted checkout. Card details, if any, are entered on JazzCash, never here.'
    };
  },
  createRequest({ reference, amountPaisa, currency, description, returnUrl }) {
    const state = requireEnv(JAZZCASH_ENV);
    if (!state.ok) return { ok: false, reason: `JazzCash is not configured: ${state.missing.join(', ')}` };
    if (currency !== 'PKR') return { ok: false, reason: 'JazzCash settles in PKR only.' };
    const now = new Date();
    const expiry = minutesFromNow('JAZZCASH_EXPIRY_MINUTES', 60);
    const fields: Record<string, string> = {
      pp_Version: setting('JAZZCASH_VERSION') || '1.1', pp_TxnType: setting('JAZZCASH_TXN_TYPE') || 'MWALLET', pp_Language: 'EN',
      pp_MerchantID: setting('JAZZCASH_MERCHANT_ID'), pp_Password: setting('JAZZCASH_PASSWORD'), pp_TxnRefNo: reference,
      pp_Amount: String(Math.round(amountPaisa)), pp_TxnCurrency: currency, pp_TxnDateTime: pkStamp(now), pp_TxnExpiryDateTime: pkStamp(expiry),
      pp_BillReference: reference, pp_Description: description.slice(0, 100), pp_ReturnURL: returnUrl, ppmpf_1: 'ksf'
    };
    fields.pp_SecureHash = jazzcashSignature(fields, setting('JAZZCASH_INTEGRITY_SALT'));
    return { ok: true, redirect: { url: setting('JAZZCASH_POST_URL'), method: 'POST', fields }, expiresAt: expiry.toISOString() };
  },
  verifyCallback({ body = {}, query = {} }) {
    const fields: Record<string, any> = { ...query, ...body };
    const salt = setting('JAZZCASH_INTEGRITY_SALT');
    if (!salt) return { ok: false, reason: 'JazzCash is not configured.' };
    const supplied = String(fields.pp_SecureHash ?? '');
    if (!supplied) return { ok: false, reason: 'The callback carried no secure hash.' };
    if (!sameSignature(jazzcashSignature(fields, salt), supplied.toUpperCase())) return { ok: false, reason: 'The secure hash did not verify.' };
    const code = String(fields.pp_ResponseCode ?? '');
    const status = code === '000' || code === '121' ? PAYMENT_STATUS.SUCCEEDED
      : code === '124' ? PAYMENT_STATUS.CANCELLED : code === '157' ? PAYMENT_STATUS.EXPIRED : PAYMENT_STATUS.FAILED;
    const raw = String(fields.pp_Amount ?? '');
    return {
      ok: true, reference: String(fields.pp_TxnRefNo || fields.pp_BillReference || ''),
      providerReference: String(fields.pp_RetreivalReferenceNo || fields.pp_AuthCode || fields.pp_TxnRefNo || ''),
      amountPaisa: /^\d+$/.test(raw) ? Number(raw) : unitsToPaisa(raw), currency: String(fields.pp_TxnCurrency || 'PKR'), status,
      providerStatus: `${code} ${String(fields.pp_ResponseMessage ?? '')}`.trim(), method: String(fields.pp_TxnType ?? '').toLowerCase() || 'wallet'
    };
  }
};

/* =============================== EASYPAISA =============================== */

const EASYPAISA_ENV = ['EASYPAISA_STORE_ID', 'EASYPAISA_HASH_KEY', 'EASYPAISA_POST_URL'];
const EASYPAISA_DEFAULT_ORDER = ['amount', 'storeId', 'postBackURL', 'orderRefNum', 'expiryDate', 'merchantHashedReq', 'autoRedirect'];

export function easypaisaSignature(fields: Record<string, unknown>): string {
  const order = (setting('EASYPAISA_HASH_FIELDS') || EASYPAISA_DEFAULT_ORDER.join(',')).split(',').map((name) => name.trim()).filter(Boolean);
  return hmacHex(setting('EASYPAISA_HASH_KEY'), order.map((name) => `${name}=${fields[name] ?? ''}`).join('&')).toUpperCase();
}

export const easypaisa: Adapter = {
  key: 'easypaisa',
  label: 'Easypaisa',
  methods: ['wallet', 'card'],
  capabilities: { redirect: true, lookup: false, refund: false, webhook: true },
  configured: () => requireEnv(EASYPAISA_ENV),
  describe() {
    const state = requireEnv(EASYPAISA_ENV);
    return {
      key: 'easypaisa', label: 'Easypaisa', configured: state.ok, missing: state.missing, mode: setting('EASYPAISA_MODE') || 'sandbox',
      verified: setting('EASYPAISA_VERIFIED') === 'true', note: 'Hosted checkout. The hash field order must be taken from your own merchant pack.'
    };
  },
  createRequest({ reference, amountPaisa, currency, returnUrl }) {
    const state = requireEnv(EASYPAISA_ENV);
    if (!state.ok) return { ok: false, reason: `Easypaisa is not configured: ${state.missing.join(', ')}` };
    if (currency !== 'PKR') return { ok: false, reason: 'Easypaisa settles in PKR only.' };
    const expiry = minutesFromNow('EASYPAISA_EXPIRY_MINUTES', 60);
    const fields: Record<string, string> = {
      storeId: setting('EASYPAISA_STORE_ID'), orderRefNum: reference, amount: paisaToUnits(amountPaisa), postBackURL: returnUrl,
      expiryDate: pkStamp(expiry, ' '), autoRedirect: '1', paymentMethod: setting('EASYPAISA_METHOD') || 'MA_PAYMENT_METHOD'
    };
    fields.merchantHashedReq = easypaisaSignature(fields);
    return { ok: true, redirect: { url: setting('EASYPAISA_POST_URL'), method: 'POST', fields }, expiresAt: expiry.toISOString() };
  },
  verifyCallback({ body = {}, query = {} }) {
    const fields: Record<string, any> = { ...query, ...body };
    if (!setting('EASYPAISA_HASH_KEY')) return { ok: false, reason: 'Easypaisa is not configured.' };
    const supplied = String(fields.merchantHashedReq || fields.hashedRes || fields.signature || '');
    if (!supplied) return { ok: false, reason: 'The callback carried no hash.' };
    if (!sameSignature(easypaisaSignature(fields), supplied.toUpperCase())) return { ok: false, reason: 'The hash did not verify.' };
    const code = String(fields.status ?? fields.responseCode ?? '');
    const status = code === '0000' || /^success$/i.test(code) ? PAYMENT_STATUS.SUCCEEDED
      : /cancel/i.test(code) ? PAYMENT_STATUS.CANCELLED : /expire/i.test(code) ? PAYMENT_STATUS.EXPIRED : PAYMENT_STATUS.FAILED;
    return {
      ok: true, reference: String(fields.orderRefNum ?? ''), providerReference: String(fields.transactionId || fields.orderRefNum || ''),
      amountPaisa: unitsToPaisa(fields.transactionAmount ?? fields.amount), currency: 'PKR', status,
      providerStatus: `${code} ${String(fields.desc || fields.responseDesc || '')}`.trim(), method: 'wallet'
    };
  }
};

/* ============================= BANK TRANSFER ============================= */

const BANK_ENV = ['BANK_ACCOUNT_TITLE', 'BANK_ACCOUNT_NUMBER', 'BANK_NAME'];

export const bankTransfer: Adapter = {
  key: 'bank-transfer',
  label: 'Bank transfer or Raast',
  methods: ['transfer'],
  capabilities: { redirect: false, lookup: false, refund: false, webhook: false },
  configured: () => requireEnv(BANK_ENV),
  describe() {
    const state = requireEnv(BANK_ENV);
    return {
      key: 'bank-transfer', label: 'Bank transfer or Raast', configured: state.ok, missing: state.missing, mode: 'manual', verified: state.ok,
      note: 'The payment stays pending until the platform checks the bank statement and confirms it.'
    };
  },
  /* Nothing to redirect to: the screen prints where to send it and the
     reference to quote. */
  createRequest({ reference, amountPaisa, currency }) {
    const state = requireEnv(BANK_ENV);
    if (!state.ok) return { ok: false, reason: `Bank transfer is not configured: ${state.missing.join(', ')}` };
    return {
      ok: true,
      instructions: {
        accountTitle: setting('BANK_ACCOUNT_TITLE'), accountNumber: setting('BANK_ACCOUNT_NUMBER'), bank: setting('BANK_NAME'),
        iban: setting('BANK_IBAN'), branch: setting('BANK_BRANCH'), raastId: setting('BANK_RAAST_ID'), reference, amountPaisa, currency,
        note: 'Put the reference on the transfer. Without it the payment cannot be matched to your account.'
      },
      expiresAt: new Date(Date.now() + Number(setting('BANK_TRANSFER_EXPIRY_DAYS') || 7) * 86_400_000).toISOString()
    };
  },
  /* A transfer has no callback: a person confirms it, through a permissioned
     platform route with an audit entry. */
  verifyCallback(): ProviderOutcome {
    return { ok: false, reason: 'A bank transfer is confirmed by a person, not by a callback.' };
  }
};
