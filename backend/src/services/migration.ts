/* ==========================================================================
   Bringing data across from the old system
   --------------------------------------------------------------------------
   A pharmacy that has traded for fifteen years does not retype its
   catalogue. It exports what it has — a CSV from an old Windows program, an
   Excel sheet somebody kept by hand — in whatever shape that program used.

     choose what -> upload -> detect columns -> map fields -> validate
       -> preview -> fix or skip the problems -> back up -> import -> report

   Nothing is discarded silently: every row of the file becomes a
   migration_items document with its original content, what it mapped to and
   exactly what is wrong with it, so imported + skipped + left to fix always
   adds up to the rows in the file.

   Nothing is half-done: rows are written in batches inside transactions, a
   backup of the affected collection is written first, and a rollback removes
   precisely the documents the job created — no more and no less.
   ========================================================================== */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnyBulkWriteOperation, Filter } from 'mongodb';
import { env, fromRoot } from '../config/env.js';
import { col, s, tx } from '../db/mongo.js';
import type { Customer, MigrationItem, MigrationJob, SaleItem } from '../db/types.js';
import { escapeRegex, isCnic, isEmail, isPkPhone, nowIso, randomUUID, sanitiseText, sha256, today, toStr, uid } from '../core/util.js';
import { excelSerialToDate, MAX_ROWS, readTable } from './tabular.js';

const BATCH_SIZE = 200;
const backupFolder = (): string => fromRoot(env.MIGRATION_BACKUP_DIR);

/* ============================== FIELD TYPES ============================== */

export const normalise = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const exactly = (value: unknown): RegExp => new RegExp(`^${escapeRegex(String(value ?? '').trim())}$`, 'i');

/**
 * Rupees as people type them: "1,250.50", "Rs 1250", "1250/-", "PKR 1,250".
 * The first number in the text is taken — stripping every non-digit would
 * turn "1250/-" into "1250-" and reject a whole column of prices.
 */
export function toPaisa(raw: unknown): number | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = /-?\d[\d,\s]*(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const value = Number(match[0].replace(/[,\s]/g, ''));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const lastDay = (year: number, month: number): string => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/**
 * 12/03/2026, 2026-03-12, 03-2026, an Excel serial, or "Mar 2026". An expiry
 * with no day means the end of that month — what "03/2026" on a pack means.
 * Day-first, as Pakistan writes dates; the alternative silently turns 03/12
 * into December.
 */
export function toDate(raw: unknown, { endOfMonth = false } = {}): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToDate(text);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const monthYear = /^(\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (monthYear) {
    const month = Number(monthYear[1]);
    return month >= 1 && month <= 12 ? lastDay(Number(monthYear[2]), month) : null;
  }
  const named = /^([A-Za-z]{3,9})[\s\-/]+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    return month ? lastDay(Number(named[2]), month) : null;
  }
  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (parts) {
    let [day, month, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(text)) {
    return endOfMonth ? lastDay(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1) : parsed.toISOString().slice(0, 10);
  }
  return null;
}

const TRUTHY = new Set(['1', 'y', 'yes', 'true', 't', 'rx', 'prescription', 'pom', 'han', 'haan']);
export const toBool = (raw: unknown): boolean => TRUTHY.has(String(raw ?? '').trim().toLowerCase());

/* ============================== THE CATEGORIES =========================== */

interface Field { key: string; label: string; required: boolean; type: 'text' | 'money' | 'integer' | 'date' | 'boolean'; aliases: string[]; hint: string }
const F = (key: string, label: string, options: Partial<Field> = {}): Field => ({ key, label, required: false, type: 'text', aliases: [], hint: '', ...options });

interface Category { label: string; description: string; target: string; fields: Field[]; requires?: string }

export const CATEGORIES: Record<string, Category> = {
  medicines: {
    label: 'Medicines', description: 'The catalogue: names, forms, strengths, prices and reorder levels.', target: 'medicines',
    fields: [
      F('name', 'Medicine name', { required: true, aliases: ['medicine', 'product', 'productname', 'itemname', 'item', 'drug', 'brand', 'description', 'title'] }),
      F('generic_name', 'Generic name', { aliases: ['generic', 'salt', 'molecule', 'formula', 'composition', 'ingredient'] }),
      F('manufacturer', 'Manufacturer', { aliases: ['company', 'maker', 'brandcompany', 'mfg', 'manufacturedby'] }),
      F('category', 'Category', { aliases: ['group', 'type', 'class', 'department', 'section'] }),
      F('form', 'Form', { aliases: ['dosageform', 'presentation', 'unit'], hint: 'Tablet, Syrup, Injection…' }),
      F('strength', 'Strength', { aliases: ['power', 'dose', 'mg'] }),
      F('pack_size', 'Pack size', { aliases: ['pack', 'packing', 'unitsperpack', 'packsize'] }),
      F('barcode', 'Barcode', { aliases: ['ean', 'upc', 'code', 'scancode'] }),
      F('sku', 'Item code', { aliases: ['itemcode', 'productcode', 'ref', 'reference'] }),
      F('cost_paisa', 'Cost price (Rs)', { type: 'money', aliases: ['cost', 'purchaseprice', 'buyingprice', 'tradeprice', 'tp', 'costprice'] }),
      F('price_paisa', 'Retail price (Rs)', { type: 'money', required: true, aliases: ['price', 'mrp', 'retail', 'saleprice', 'sellingprice', 'rate'] }),
      F('min_stock', 'Reorder level', { type: 'integer', aliases: ['minstock', 'reorder', 'minimum', 'reorderlevel', 'minqty'] }),
      F('requires_prescription', 'Prescription only', { type: 'boolean', aliases: ['rx', 'prescription', 'pom', 'controlled', 'schedule'] }),
      F('shelf_location', 'Shelf', { aliases: ['location', 'rack', 'shelf', 'bin', 'position'] })
    ]
  },
  suppliers: {
    label: 'Suppliers', description: 'Distributors and the terms you buy on.', target: 'suppliers',
    fields: [
      F('name', 'Supplier name', { required: true, aliases: ['supplier', 'distributor', 'vendor', 'company', 'party', 'partyname'] }),
      F('contact_person', 'Contact person', { aliases: ['contact', 'person', 'representative', 'salesman', 'agent'] }),
      F('phone', 'Phone', { aliases: ['mobile', 'cell', 'telephone', 'contactno', 'phoneno'] }),
      F('email', 'Email', { aliases: ['mail', 'emailaddress'] }),
      F('address', 'Address', { aliases: ['location', 'street'] }),
      F('city', 'City', { aliases: ['town', 'district'] }),
      F('ntn', 'NTN', { aliases: ['taxno', 'ntnnumber', 'nationaltaxnumber'] }),
      F('payment_terms', 'Payment terms', { aliases: ['terms', 'credit', 'creditdays', 'payment'] }),
      /* What the pharmacy owed this distributor on the day it moved across. */
      F('balance_paisa', 'Outstanding payable (Rs)', { type: 'money', aliases: ['balance', 'payable', 'due', 'outstanding', 'openingbalance', 'creditbalance'], hint: 'What you owe them today' })
    ]
  },
  customers: {
    label: 'Customers', description: 'Regular patients and account customers.', target: 'customers',
    fields: [
      F('name', 'Customer name', { required: true, aliases: ['customer', 'patient', 'client', 'partyname', 'fullname'] }),
      F('phone', 'Phone', { aliases: ['mobile', 'cell', 'contact', 'contactno', 'phoneno'] }),
      F('cnic', 'CNIC', { aliases: ['nic', 'idcard', 'identity', 'cnicno'] }),
      F('address', 'Address', { aliases: ['street', 'location'] }),
      F('city', 'City', { aliases: ['town'] }),
      F('gender', 'Gender', { aliases: ['sex'] }),
      F('allergies', 'Allergies', { aliases: ['allergy', 'allergicto'] }),
      F('chronic_notes', 'Notes', { aliases: ['notes', 'remarks', 'conditions', 'history'] }),
      F('balance_paisa', 'Outstanding balance (Rs)', { type: 'money', aliases: ['balance', 'due', 'outstanding', 'udhaar', 'credit'] })
    ]
  },
  batches: {
    label: 'Stock and batches', description: 'What is on the shelf now: batch numbers, expiry dates and quantities.', target: 'batches',
    fields: [
      F('medicine', 'Medicine name or code', { required: true, aliases: ['medicine', 'product', 'item', 'itemname', 'drug', 'barcode', 'itemcode'] }),
      F('batch_no', 'Batch number', { required: true, aliases: ['batch', 'batchno', 'lot', 'lotno', 'batchnumber'] }),
      F('expiry_date', 'Expiry date', { type: 'date', required: true, aliases: ['expiry', 'exp', 'expirydate', 'expdate', 'validtill', 'bestbefore'] }),
      F('quantity', 'Quantity', { type: 'integer', required: true, aliases: ['qty', 'stock', 'balance', 'onhand', 'units', 'available'] }),
      F('cost_paisa', 'Cost price (Rs)', { type: 'money', aliases: ['cost', 'purchaseprice', 'tp', 'tradeprice'] }),
      F('price_paisa', 'Retail price (Rs)', { type: 'money', aliases: ['price', 'mrp', 'retail', 'rate'] }),
      F('supplier', 'Supplier', { aliases: ['supplier', 'distributor', 'vendor', 'party'] })
    ]
  },
  sales: {
    label: 'Sales history', description: 'Past invoices, kept for reporting. Historical sales never move current stock.', target: 'sales',
    fields: [
      F('invoice_no', 'Invoice number', { required: true, aliases: ['invoice', 'billno', 'receipt', 'invoiceno', 'bill'] }),
      F('sold_at', 'Date', { type: 'date', required: true, aliases: ['date', 'billdate', 'invoicedate', 'saledate'] }),
      F('customer_name', 'Customer', { aliases: ['customer', 'party', 'patient', 'name'] }),
      F('total_paisa', 'Total (Rs)', { type: 'money', required: true, aliases: ['total', 'amount', 'nettotal', 'grandtotal', 'netamount'] }),
      F('discount_paisa', 'Discount (Rs)', { type: 'money', aliases: ['discount', 'disc'] }),
      F('cost_paisa', 'Cost of goods (Rs)', { type: 'money', aliases: ['cost', 'costofgoods', 'purchasevalue'] }),
      F('payment_method', 'Payment method', { aliases: ['payment', 'paymode', 'mode', 'paidby'] })
    ]
  },
  sale_items: {
    label: 'Invoice lines', description: 'The lines on invoices that have already been imported. Adds detail to history; never moves stock.', target: 'sale_items',
    requires: 'Import the invoices themselves first, under Sales history. A line whose invoice number is not already in KSF cannot be placed.',
    fields: [
      F('invoice_no', 'Invoice number', { required: true, aliases: ['invoice', 'billno', 'receipt', 'invoiceno', 'bill', 'billnumber'] }),
      F('medicine', 'Medicine', { required: true, aliases: ['medicine', 'product', 'item', 'itemname', 'drug', 'description', 'particulars'] }),
      F('quantity', 'Quantity', { type: 'integer', required: true, aliases: ['qty', 'quantity', 'units', 'pcs', 'nos'] }),
      F('unit_price_paisa', 'Unit price (Rs)', { type: 'money', aliases: ['price', 'rate', 'unitprice', 'mrp', 'saleprice'] }),
      F('line_total_paisa', 'Line total (Rs)', { type: 'money', aliases: ['total', 'amount', 'linetotal', 'netamount', 'value'] }),
      F('discount_paisa', 'Discount (Rs)', { type: 'money', aliases: ['discount', 'disc'] }),
      F('batch_no', 'Batch number', { aliases: ['batch', 'batchno', 'lot', 'lotno'] }),
      F('expiry_date', 'Expiry date', { type: 'date', aliases: ['expiry', 'exp', 'expirydate', 'expdate'] })
    ]
  },
  purchases: {
    label: 'Purchase history', description: 'Past purchase orders, kept for reporting. Historical purchases never move current stock.', target: 'purchases',
    fields: [
      F('reference', 'Order number', { required: true, aliases: ['po', 'ponumber', 'reference', 'orderno', 'purchaseno'] }),
      F('supplier', 'Supplier', { required: true, aliases: ['supplier', 'distributor', 'vendor', 'party'] }),
      F('purchase_date', 'Date', { type: 'date', required: true, aliases: ['date', 'podate', 'purchasedate', 'billdate'] }),
      F('invoice_no', 'Supplier invoice', { aliases: ['invoice', 'billno', 'invoiceno'] }),
      F('total_paisa', 'Total (Rs)', { type: 'money', required: true, aliases: ['total', 'amount', 'nettotal', 'grandtotal'] }),
      F('payment_status', 'Paid', { aliases: ['paid', 'status', 'paymentstatus'] })
    ]
  },
  prescriptions: {
    label: 'Prescriptions', description: 'Prescription records, for the legal history. Items are recorded as free text.', target: 'prescriptions',
    fields: [
      F('reference', 'Reference', { aliases: ['reference', 'rxno', 'prescriptionno', 'number'] }),
      F('patient_name', 'Patient', { required: true, aliases: ['patient', 'customer', 'name', 'patientname'] }),
      F('doctor_name', 'Doctor', { required: true, aliases: ['doctor', 'prescriber', 'physician', 'doctorname'] }),
      F('prescription_date', 'Date', { type: 'date', required: true, aliases: ['date', 'rxdate', 'prescriptiondate'] }),
      F('hospital', 'Hospital or clinic', { aliases: ['hospital', 'clinic', 'facility'] }),
      F('pmdc_number', 'PMDC number', { aliases: ['pmdc', 'registration', 'regno', 'licence'] }),
      F('medicines', 'Medicines', { aliases: ['medicines', 'items', 'drugs', 'prescribed', 'details'] }),
      F('notes', 'Notes', { aliases: ['notes', 'remarks', 'instructions'] })
    ]
  }
};

const publicFields = (category: Category) => category.fields.map((field) => ({ key: field.key, label: field.label, required: field.required, type: field.type, hint: field.hint }));

export const categoryList = () => Object.entries(CATEGORIES).map(([key, category]) => ({
  key, label: category.label, description: category.description, fields: publicFields(category)
}));

/* ============================== MAPPING ================================== */

/** Guess which column belongs to which field, so the mapping screen opens mostly filled in. */
export function suggestMapping(categoryKey: string, columns: string[]): Record<string, string | null> {
  const category = CATEGORIES[categoryKey];
  if (!category) return {};
  const available = columns.map((column) => ({ column, key: normalise(column) }));
  const taken = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const field of category.fields) {
    const candidates = [normalise(field.key), normalise(field.label), ...field.aliases.map(normalise)];
    /* Exact first, so "price" does not steal the column called "cost price". */
    let hit = available.find((item) => !taken.has(item.column) && candidates.includes(item.key));
    hit ??= available.find((item) => !taken.has(item.column) && candidates.some((candidate) => candidate.length >= 4 && item.key.includes(candidate)));
    mapping[field.key] = hit?.column ?? null;
    if (hit) taken.add(hit.column);
  }
  return mapping;
}

/* ============================== VALIDATION =============================== */

export interface Problem { code: string; message: string; field: string | null; fixable: boolean }
const problem = (code: string, message: string, field: string | null = null, fixable = true): Problem => ({ code, message, field, fixable });

interface Context {
  medicineIndex: Map<string, string>; existingMedicines: Set<string>; supplierIndex: Map<string, string>;
  invoiceIndex: Map<string, string>; seenNames: Map<string, number>; rowNumber: number;
}

type Row = Record<string, any>;

/**
 * Turn one row into the shape KSF stores and say everything wrong with it.
 * Never throws: one unreadable line must not stop the other 4,000.
 */
export function validateRow(categoryKey: string, raw: Record<string, unknown>, mapping: Record<string, string | null>, context: Context) {
  const category = CATEGORIES[categoryKey];
  const value: Row = {};
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  for (const field of category.fields) {
    const column = mapping[field.key];
    const text = String(column ? raw[column] ?? '' : '').trim();
    if (!text) {
      if (field.required) errors.push(problem('missing', `${field.label} is empty.`, field.key));
      value[field.key] = field.type === 'integer' || field.type === 'money' ? null : '';
      continue;
    }
    if (/^'[=+\-@]/.test(text)) {
      warnings.push(problem('sanitised', `${field.label} began with a spreadsheet formula character and has been quoted so it cannot run.`, field.key, false));
    }
    if (field.type === 'money') {
      const paisa = toPaisa(text);
      if (paisa === null) errors.push(problem('invalid_price', `${field.label} "${text.slice(0, 40)}" is not a valid amount.`, field.key));
      else if (paisa > 100_000_000) errors.push(problem('invalid_price', `${field.label} of Rs ${(paisa / 100).toLocaleString()} looks wrong. Check the decimal point.`, field.key));
      value[field.key] = paisa;
      continue;
    }
    if (field.type === 'integer') {
      const number = Number(text.replace(/[,\s]/g, ''));
      if (!Number.isFinite(number) || !Number.isInteger(number)) {
        errors.push(problem('invalid_quantity', `${field.label} "${text.slice(0, 40)}" is not a whole number.`, field.key));
        value[field.key] = null;
      } else if (number < 0) {
        errors.push(problem('invalid_quantity', `${field.label} cannot be negative.`, field.key));
        value[field.key] = null;
      } else value[field.key] = number;
      continue;
    }
    if (field.type === 'date') {
      const date = toDate(text, { endOfMonth: field.key === 'expiry_date' });
      if (!date) errors.push(problem('invalid_date', `${field.label} "${text.slice(0, 40)}" is not a date we recognise. Try 2026-03-31 or 31/03/2026.`, field.key));
      else if (field.key === 'expiry_date' && date < today()) warnings.push(problem('expired', `This batch expired on ${date}. It will be imported as quarantined and cannot be sold.`, field.key, false));
      else if (date > '2099-12-31' || date < '1990-01-01') errors.push(problem('invalid_date', `${field.label} of ${date} is outside any sensible range.`, field.key));
      value[field.key] = date;
      continue;
    }
    if (field.type === 'boolean') { value[field.key] = toBool(text) ? 1 : 0; continue; }
    value[field.key] = sanitiseText(text, field.key === 'notes' || field.key === 'medicines' ? 1000 : 300);
  }

  const seen = (key: string, field: string, message: string) => {
    if (context.seenNames.has(key)) errors.push(problem('duplicate_in_file', message.replace('{row}', String(context.seenNames.get(key))), field));
    else if (key) context.seenNames.set(key, context.rowNumber);
  };

  if (categoryKey === 'medicines') {
    if (value.cost_paisa && value.price_paisa && value.cost_paisa > value.price_paisa) {
      warnings.push(problem('price_below_cost', `The retail price (Rs ${value.price_paisa / 100}) is below the cost (Rs ${value.cost_paisa / 100}). Check it before you start selling.`, 'price_paisa', false));
    }
    const key = normalise(value.name);
    seen(key, 'name', `"${value.name}" appears earlier in this file, on row {row}.`);
    if (value.name && context.existingMedicines.has(key)) {
      errors.push(problem('duplicate_existing', `"${value.name}" is already in your catalogue. Merge to update the existing record, or skip to leave it alone.`, 'name'));
    }
  }

  if (categoryKey === 'suppliers') {
    if (!value.phone && !value.email && !value.address) errors.push(problem('missing_supplier_contact', `There is no way to contact "${value.name}" — a phone number, an email address or an address is needed.`, 'phone'));
    if (value.email && !isEmail(value.email)) errors.push(problem('invalid_email', `"${value.email}" is not a valid email address.`, 'email'));
    if (value.phone && !isPkPhone(value.phone)) warnings.push(problem('odd_phone', `"${value.phone}" does not look like a Pakistani number. It will be imported as it is.`, 'phone', false));
    seen(normalise(value.name), 'name', `"${value.name}" appears earlier in this file, on row {row}.`);
  }

  if (categoryKey === 'customers') {
    if (value.cnic && !isCnic(value.cnic)) errors.push(problem('invalid_cnic', `"${value.cnic}" is not a valid CNIC. It should look like 42101-1234567-1.`, 'cnic'));
    if (value.phone && !isPkPhone(value.phone)) warnings.push(problem('odd_phone', `"${value.phone}" does not look like a Pakistani number.`, 'phone', false));
    const key = `${normalise(value.name)}|${String(value.phone ?? '').replace(/\D/g, '')}`;
    if (context.seenNames.has(key)) errors.push(problem('duplicate_customer', `"${value.name}" with this number appears earlier in the file, on row ${context.seenNames.get(key)}.`, 'name'));
    else if (value.name) context.seenNames.set(key, context.rowNumber);
  }

  if (categoryKey === 'batches') {
    const key = normalise(value.medicine);
    const medicineId = context.medicineIndex.get(key);
    if (!medicineId) errors.push(problem('unknown_medicine', `"${value.medicine}" is not in your catalogue. Import the medicines first, or correct the name.`, 'medicine'));
    else value.__medicineId = medicineId;
    if (value.quantity === 0) warnings.push(problem('zero_quantity', 'This batch has no units in it. It will be imported with a quantity of zero.', 'quantity', false));
    seen(`${key}|${normalise(value.batch_no)}`, 'batch_no', `Batch "${value.batch_no}" of "${value.medicine}" appears earlier, on row {row}.`);
  }

  if (categoryKey === 'sales' || categoryKey === 'purchases') {
    const reference = value.invoice_no ?? value.reference;
    seen(normalise(reference), categoryKey === 'sales' ? 'invoice_no' : 'reference', `"${reference}" appears earlier in this file, on row {row}.`);
    const date = value.sold_at ?? value.purchase_date;
    if (date && date > today()) errors.push(problem('future_date', `That date (${date}) is in the future.`, categoryKey === 'sales' ? 'sold_at' : 'purchase_date'));
  }

  if (categoryKey === 'sale_items') {
    const saleId = context.invoiceIndex.get(normalise(value.invoice_no));
    if (!saleId) errors.push(problem('unknown_invoice', `Invoice "${value.invoice_no}" is not in KSF. Import the invoices under Sales history first, then these lines.`, 'invoice_no'));
    else value.__saleId = saleId;
    /* Matched if it can be, kept as text if not — a five-year-old invoice
       for something no longer stocked is still a record of what was sold. */
    value.__medicineId = context.medicineIndex.get(normalise(value.medicine)) ?? null;
    if (!value.__medicineId) warnings.push(problem('medicine_not_matched', `"${value.medicine}" is not in your catalogue, so the line will keep the name as written without linking to a product.`, 'medicine', false));
    const quantity = value.quantity ?? 0;
    if (value.line_total_paisa === null && value.unit_price_paisa !== null) value.line_total_paisa = value.unit_price_paisa * quantity;
    else if (value.unit_price_paisa === null && value.line_total_paisa !== null && quantity > 0) value.unit_price_paisa = Math.round(value.line_total_paisa / quantity);
    else if (value.unit_price_paisa !== null && value.line_total_paisa !== null && quantity > 0) {
      const expected = value.unit_price_paisa * quantity - (value.discount_paisa ?? 0);
      if (Math.abs(expected - value.line_total_paisa) > 100) {
        warnings.push(problem('line_does_not_add_up', `${quantity} × Rs ${value.unit_price_paisa / 100} comes to Rs ${expected / 100}, but the line total says Rs ${value.line_total_paisa / 100}. The file's own total is what will be imported.`, 'line_total_paisa', false));
      }
    }
    if (value.line_total_paisa === null && value.unit_price_paisa === null) errors.push(problem('no_amount', 'This line has neither a unit price nor a total.', 'line_total_paisa'));
  }

  if (categoryKey === 'purchases') {
    const supplierId = context.supplierIndex.get(normalise(value.supplier));
    if (!supplierId) errors.push(problem('unknown_supplier', `"${value.supplier}" is not in your supplier list. Import suppliers first, or correct the name.`, 'supplier'));
    else value.__supplierId = supplierId;
  }

  return { value, errors, warnings };
}

/* ============================== THE JOB ================================== */

/** Read the file, work out its columns and create the job. Nothing touches the pharmacy's records yet. */
export async function createJob(input: { pharmacyId: string; userId: string; userName: string; category: string; fileName: string; buffer: Buffer; allowDuplicate?: boolean }) {
  if (!CATEGORIES[input.category]) return { ok: false as const, reason: 'That is not something KSF can import.' };
  const table = readTable(input.buffer, input.fileName);
  if (!table.ok) return { ok: false as const, reason: table.reason };

  /* The same file twice is the commonest way an import goes wrong. Matching
     on the bytes catches it even when the second copy has been renamed. It
     is a refusal with a way past it, because re-importing on purpose — after
     a rollback — is legitimate. */
  const hash = sha256(input.buffer.toString('base64'));
  const earlier = await col.migrationJobs().findOne(
    { pharmacy_id: input.pharmacyId, file_hash: hash, status: 'completed', rolled_back_at: null }, { sort: { created_at: -1 } }
  );
  if (earlier && !input.allowDuplicate) {
    return {
      ok: false as const, duplicateOf: earlier.id,
      reason: `This is the same file as the import on ${earlier.created_at.slice(0, 10)} ("${earlier.file_name}"), which brought in ${earlier.imported_rows} row(s). `
        + 'Importing it again would duplicate them. Roll that import back first, or choose "import it anyway" if you know this is what you want.'
    };
  }

  const at = nowIso();
  const id = uid('MIG');
  const mapping = suggestMapping(input.category, table.columns);
  const job: MigrationJob = {
    _id: id, id, pharmacy_id: input.pharmacyId, created_by: input.userId, created_by_name: input.userName, source: table.kind, adapter: null,
    category: input.category, file_name: toStr(input.fileName, 200), file_size: input.buffer.length, file_hash: hash, columns: table.columns,
    mapping: mapping as Record<string, string>, options: {}, status: 'mapping', total_rows: table.rows.length, valid_rows: 0, error_rows: 0,
    skipped_rows: 0, imported_rows: 0, backup_path: null, report: null, error_message: null, duplicate_of: earlier?.id ?? null,
    started_at: null, finished_at: null, rolled_back_at: null, created_at: at, updated_at: at
  };
  await col.migrationJobs().insertOne(job);
  const items: MigrationItem[] = table.rows.map((row, index) => {
    const itemId = randomUUID();
    return {
      _id: itemId, id: itemId, job_id: id, row_number: index + 2, raw: row, mapped: {}, status: 'pending', resolution: null, errors: [],
      target_collection: null, target_id: null, created_at: at, updated_at: at
    };
  });
  for (let start = 0; start < items.length; start += 1000) await col.migrationItems().insertMany(items.slice(start, start + 1000), { ordered: false });

  return {
    ok: true as const, job, columns: table.columns, mapping, sampleRows: table.rows.slice(0, 5), truncated: table.truncated, sanitised: table.sanitised,
    note: table.truncated ? `Only the first ${MAX_ROWS} rows were read. Split the file and import the rest afterwards.` : null
  };
}

/** The look-ups validation needs, fetched once rather than per row. */
async function buildContext(pharmacyId: string): Promise<Context> {
  const [medicines, suppliers, sales] = await Promise.all([
    col.medicines().find({ pharmacy_id: pharmacyId }, { projection: { name: 1, barcode: 1, sku: 1 } }).toArray(),
    col.suppliers().find({ pharmacy_id: pharmacyId }, { projection: { name: 1 } }).toArray(),
    col.sales().find({ pharmacy_id: pharmacyId }, { projection: { invoice_no: 1 } }).toArray()
  ]);
  const medicineIndex = new Map<string, string>();
  const existingMedicines = new Set<string>();
  for (const medicine of medicines) {
    medicineIndex.set(normalise(medicine.name), medicine._id);
    existingMedicines.add(normalise(medicine.name));
    if (medicine.barcode) medicineIndex.set(normalise(medicine.barcode), medicine._id);
    if (medicine.sku) medicineIndex.set(normalise(medicine.sku), medicine._id);
  }
  return {
    medicineIndex, existingMedicines,
    supplierIndex: new Map(suppliers.map((supplier) => [normalise(supplier.name), supplier._id])),
    invoiceIndex: new Map(sales.map((sale) => [normalise(sale.invoice_no), sale._id])),
    seenNames: new Map(), rowNumber: 0
  };
}

/** Apply the mapping and check every row, writing the verdict onto each item. */
export async function validateJob(input: { jobId: string; pharmacyId: string; mapping: Record<string, string | null> | null }) {
  const job = await col.migrationJobs().findOne({ _id: input.jobId, pharmacy_id: input.pharmacyId });
  if (!job) return { ok: false as const, reason: 'That import could not be found.' };
  if (['importing', 'completed', 'rolled_back'].includes(job.status)) return { ok: false as const, reason: `That import is ${job.status.replace('_', ' ')} and can no longer be changed.` };
  const category = CATEGORIES[job.category];
  const map = input.mapping ?? job.mapping;
  const unknownColumn = Object.values(map).find((column) => column && !job.columns.includes(column));
  if (unknownColumn) return { ok: false as const, reason: `"${unknownColumn}" is not a column in this file.` };
  const missingRequired = category.fields.filter((field) => field.required && !map[field.key]);
  if (missingRequired.length) {
    return { ok: false as const, reason: `Choose a column for: ${missingRequired.map((field) => field.label).join(', ')}.`, missing: missingRequired.map((field) => field.key) };
  }

  const context = await buildContext(input.pharmacyId);
  const at = nowIso();
  let valid = 0;
  let invalid = 0;
  const errorCounts: Record<string, number> = {};
  const writes: AnyBulkWriteOperation<MigrationItem>[] = [];

  for await (const item of col.migrationItems().find({ job_id: job.id, status: { $nin: ['skipped', 'imported'] } }).sort({ row_number: 1 })) {
    context.rowNumber = item.row_number;
    const checked = validateRow(job.category, item.raw, map, context);
    for (const error of checked.errors) errorCounts[error.code] = (errorCounts[error.code] ?? 0) + 1;
    if (checked.errors.length) invalid += 1; else valid += 1;
    writes.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { mapped: checked.value, status: checked.errors.length ? 'error' : 'valid', errors: [...checked.errors, ...checked.warnings], updated_at: at } }
      }
    });
    if (writes.length >= 500) await col.migrationItems().bulkWrite(writes.splice(0), { ordered: false });
  }
  if (writes.length) await col.migrationItems().bulkWrite(writes, { ordered: false });

  const skipped = await col.migrationItems().countDocuments({ job_id: job.id, status: 'skipped' });
  await col.migrationJobs().updateOne({ _id: job.id }, {
    $set: { mapping: map as Record<string, string>, status: 'preview', valid_rows: valid, error_rows: invalid, skipped_rows: skipped, updated_at: at }
  });
  return { ok: true as const, valid, errors: invalid, skipped, total: job.total_rows, errorCounts, canImport: valid > 0 };
}

/** Correct one row, or decide what to do with it — a problem row always has somewhere to go. */
export async function resolveItem(input: { jobId: string; pharmacyId: string; itemId: string; resolution: string; values: unknown }) {
  const job = await col.migrationJobs().findOne({ _id: input.jobId, pharmacy_id: input.pharmacyId });
  if (!job) return { ok: false, reason: 'That import could not be found.' };
  const item = await col.migrationItems().findOne({ _id: input.itemId, job_id: job.id });
  if (!item) return { ok: false, reason: 'That row could not be found.' };
  if (item.status === 'imported') return { ok: false, reason: 'That row has already been imported.' };
  const at = nowIso();

  if (input.resolution === 'skip') {
    await col.migrationItems().updateOne({ _id: item._id }, { $set: { status: 'skipped', resolution: 'skip', updated_at: at } });
    return { ok: true, status: 'skipped' };
  }
  /* A fix edits the original row, so re-validation checks the corrected
     values by exactly the same rules as everything else. */
  const raw = { ...item.raw };
  if (input.resolution === 'fix' && input.values && typeof input.values === 'object') {
    for (const [fieldKey, newValue] of Object.entries(input.values as Record<string, unknown>)) {
      const column = job.mapping[fieldKey];
      if (column) raw[column] = String(newValue ?? '');
    }
  }
  const context = await buildContext(input.pharmacyId);
  context.rowNumber = item.row_number;
  /* Merging says "this duplicate is the same record, update it". */
  if (input.resolution === 'merge') context.existingMedicines = new Set();
  const checked = validateRow(job.category, raw, job.mapping, context);
  await col.migrationItems().updateOne({ _id: item._id }, {
    $set: {
      raw, mapped: checked.value, status: checked.errors.length ? 'error' : 'valid', resolution: input.resolution,
      errors: [...checked.errors, ...checked.warnings], updated_at: at
    }
  });
  return { ok: checked.errors.length === 0, status: checked.errors.length ? 'error' : 'valid', errors: checked.errors, warnings: checked.warnings };
}

/* ============================== WRITERS ================================== */

interface WriteContext { pharmacyId: string; userId: string; jobId: string; branchId: string | null; createdCategories: string[]; sequence: number }
interface Written { id: string; merged: boolean; collection: string }

/* Prefer the incoming text; keep the stored value when the file left it blank. */
const keep = <T>(incoming: T | null | undefined | '', current: T): T => (incoming === null || incoming === undefined || incoming === '' ? current : incoming);

/* One writer per category. Each returns the id it created, which is what
   makes the rollback exact. */
const WRITERS: Record<string, (value: Row, ctx: WriteContext) => Promise<Written>> = {
  async medicines(value, ctx) {
    const at = nowIso();
    let categoryId: string | null = null;
    if (value.category) {
      const found = await col.categories().findOne({ pharmacy_id: ctx.pharmacyId, name: exactly(value.category) }, s());
      if (found) categoryId = found.id;
      else {
        categoryId = uid('CAT');
        await col.categories().insertOne({
          _id: categoryId, id: categoryId, pharmacy_id: ctx.pharmacyId, name: sanitiseText(value.category, 80), description: 'Created during data migration',
          colour: 'brand', requires_prescription: 0, status: 'active', created_at: at, updated_at: at
        }, s());
        ctx.createdCategories.push(categoryId);
      }
    }
    const existing = await col.medicines().findOne({ pharmacy_id: ctx.pharmacyId, name: exactly(value.name) }, s());
    if (existing) {
      await col.medicines().updateOne({ _id: existing.id }, {
        $set: {
          generic_name: value.generic_name || null, manufacturer: value.manufacturer || null, category_id: categoryId ?? existing.category_id,
          form: keep(value.form, existing.form), strength: value.strength || null, pack_size: value.pack_size || null,
          barcode: keep(value.barcode, existing.barcode), sku: keep(value.sku, existing.sku), cost_paisa: keep(value.cost_paisa, existing.cost_paisa),
          price_paisa: keep(value.price_paisa, existing.price_paisa), min_stock: keep(value.min_stock, existing.min_stock),
          requires_prescription: value.requires_prescription ?? 0, shelf_location: value.shelf_location || null, updated_at: at
        }
      }, s());
      return { id: existing.id, merged: true, collection: 'medicines' };
    }
    const id = uid('KSF');
    const minStock = value.min_stock ?? 10;
    await col.medicines().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, category_id: categoryId, name: value.name, generic_name: value.generic_name || null,
      manufacturer: value.manufacturer || null, form: value.form || 'Tablet', strength: value.strength || null, pack_size: value.pack_size || null,
      sku: value.sku || null, barcode: value.barcode || null, drap_reg_no: null, shelf_location: value.shelf_location || null,
      cost_paisa: value.cost_paisa ?? 0, price_paisa: value.price_paisa ?? 0, gst_percent: 0, min_stock: minStock, max_stock: minStock * 12,
      requires_prescription: value.requires_prescription ?? 0, is_controlled: 0, storage_note: null, status: 'active', created_at: at, updated_at: at
    }, s());
    return { id, merged: false, collection: 'medicines' };
  },

  async suppliers(value, ctx) {
    const at = nowIso();
    const payable = value.balance_paisa ?? 0;
    /* A distributor list imported twice must not produce two of everybody;
       the name is how a pharmacy identifies them. */
    const existing = await col.suppliers().findOne({ pharmacy_id: ctx.pharmacyId, name: exactly(value.name) }, s());
    if (existing) {
      await col.suppliers().updateOne({ _id: existing.id }, {
        $set: {
          contact_person: keep(value.contact_person, existing.contact_person), phone: keep(value.phone, existing.phone), email: keep(value.email, existing.email),
          address: keep(value.address, existing.address), city: keep(value.city, existing.city), ntn: keep(value.ntn, existing.ntn),
          payment_terms: keep(value.payment_terms, existing.payment_terms),
          /* The opening figure is written once and never moved by a re-import. */
          opening_balance_paisa: payable > 0 && !existing.opening_balance_paisa ? payable : existing.opening_balance_paisa,
          updated_at: at
        }
      }, s());
      return { id: existing.id, merged: true, collection: 'suppliers' };
    }
    const id = uid('SUP');
    await col.suppliers().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, name: value.name, contact_person: value.contact_person || null, phone: value.phone || null,
      email: value.email || null, address: value.address || null, city: value.city || null, ntn: value.ntn || null,
      payment_terms: value.payment_terms || 'Cash on delivery', balance_paisa: 0, opening_balance_paisa: payable, rating: 4, status: 'active',
      notes: null, created_at: at, updated_at: at
    }, s());
    return { id, merged: false, collection: 'suppliers' };
  },

  async customers(value, ctx) {
    const at = nowIso();
    const owed = value.balance_paisa ?? 0;
    const digits = String(value.phone ?? '').replace(/\D/g, '');
    /* Matched on the number if there is one: two people called Muhammad Ali
       are two people, one number is one account. */
    const filter: Filter<Customer> = digits.length >= 10
      ? { pharmacy_id: ctx.pharmacyId, phone: { $regex: `${digits.slice(-10).split('').join('[\\s\\-]*')}$` } }
      : { pharmacy_id: ctx.pharmacyId, name: exactly(value.name) };
    const existing = await col.customers().findOne(filter, s());
    if (existing) {
      const firstBalance = owed > 0 && !existing.balance_paisa;
      await col.customers().updateOne({ _id: existing.id }, {
        $set: {
          name: keep(value.name, existing.name), phone: keep(value.phone, existing.phone), cnic: keep(value.cnic, existing.cnic),
          address: keep(value.address, existing.address), city: keep(value.city, existing.city), gender: keep(value.gender, existing.gender),
          allergies: keep(value.allergies, existing.allergies), chronic_notes: keep(value.chronic_notes, existing.chronic_notes),
          ...(firstBalance ? { balance_paisa: owed, opening_balance_paisa: owed } : {}), updated_at: at
        }
      }, s());
      return { id: existing.id, merged: true, collection: 'customers' };
    }
    const id = uid('CUS');
    await col.customers().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, name: value.name, phone: value.phone || null, cnic: value.cnic || null, email: null,
      address: value.address || null, city: value.city || null, date_of_birth: null, gender: value.gender || null, allergies: value.allergies || null,
      chronic_notes: value.chronic_notes || null, loyalty_points: 0, credit_limit_paisa: 0, balance_paisa: owed, opening_balance_paisa: owed,
      status: 'active', created_at: at, updated_at: at
    }, s());
    return { id, merged: false, collection: 'customers' };
  },

  /* A line on an invoice already in KSF. It never touches a batch: the stock
     it consumed was consumed in the old system, and today's shelf came in
     through the stock import. */
  async sale_items(value, ctx) {
    const quantity = value.quantity ?? 0;
    const unitPrice = value.unit_price_paisa ?? 0;
    const item: SaleItem = {
      id: randomUUID(), medicine_id: value.__medicineId, batch_id: null, medicine_name: sanitiseText(value.medicine, 140),
      batch_no: value.batch_no || null, expiry_date: value.expiry_date || null, quantity, unit_price_paisa: unitPrice, unit_cost_paisa: 0,
      discount_paisa: value.discount_paisa ?? 0, gst_paisa: 0, line_total_paisa: value.line_total_paisa ?? unitPrice * quantity
    };
    const pushed = await col.sales().updateOne({ _id: value.__saleId, pharmacy_id: ctx.pharmacyId }, { $push: { items: item } }, s());
    if (!pushed.matchedCount) throw new Error(`Invoice ${value.invoice_no} is no longer in KSF.`);
    return { id: item.id, merged: false, collection: 'sales' };
  },

  async batches(value, ctx) {
    const at = nowIso();
    const id = uid('BAT');
    const expired = value.expiry_date < today();
    const supplier = value.supplier ? await col.suppliers().findOne({ pharmacy_id: ctx.pharmacyId, name: exactly(value.supplier) }, s()) : null;
    await col.batches().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, medicine_id: value.__medicineId, branch_id: ctx.branchId, supplier_id: supplier?.id ?? null,
      purchase_id: null, batch_no: value.batch_no, expiry_date: value.expiry_date, quantity: value.quantity ?? 0, quantity_in: value.quantity ?? 0,
      cost_paisa: value.cost_paisa ?? 0, price_paisa: value.price_paisa ?? 0, status: expired ? 'quarantined' : 'active',
      quarantine_note: expired ? 'Imported already past its expiry date' : null, received_at: at, created_at: at, updated_at: at
    }, s());
    const movementId = randomUUID();
    await col.stockMovements().insertOne({
      _id: movementId, id: movementId, pharmacy_id: ctx.pharmacyId, medicine_id: value.__medicineId, batch_id: id, type: 'opening',
      quantity_delta: value.quantity ?? 0, balance_after: value.quantity ?? 0, reference_type: 'migration', reference_id: ctx.jobId,
      reason: 'Imported from the previous system', created_by: ctx.userId, created_at: at
    }, s());
    return { id, merged: false, collection: 'batches' };
  },

  /* Historical sales are for reporting only: no lines, no batches. */
  async sales(value, ctx) {
    const at = nowIso();
    const id = uid('SAL');
    await col.sales().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.branchId, customer_id: null, prescription_id: null, invoice_no: value.invoice_no,
      sold_at: `${value.sold_at}T12:00:00.000Z`, items: [], subtotal_paisa: (value.total_paisa ?? 0) + (value.discount_paisa ?? 0),
      discount_paisa: value.discount_paisa ?? 0, gst_paisa: 0, total_paisa: value.total_paisa ?? 0, paid_paisa: value.total_paisa ?? 0, change_paisa: 0,
      cost_paisa: value.cost_paisa ?? 0, payment_method: value.payment_method || 'cash', status: 'completed', customer_name: value.customer_name || 'Walk-in customer',
      served_by: null, served_by_name: 'Imported', notes: 'Imported from the previous system', discount_reason: null, discount_note: null,
      refunded_at: null, refunded_by: null, created_at: at, updated_at: at
    }, s());
    return { id, merged: false, collection: 'sales' };
  },

  async purchases(value, ctx) {
    const at = nowIso();
    const id = uid('PUR');
    const paid = /^(paid|yes|y|1|true)$/i.test(String(value.payment_status ?? ''));
    await col.purchases().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.branchId, supplier_id: value.__supplierId, reference: value.reference,
      invoice_no: value.invoice_no || null, purchase_date: value.purchase_date, expected_date: null, status: 'received', items: [],
      subtotal_paisa: value.total_paisa ?? 0, discount_paisa: 0, gst_paisa: 0, total_paisa: value.total_paisa ?? 0, paid_paisa: paid ? value.total_paisa ?? 0 : 0,
      payment_status: paid ? 'paid' : 'unpaid', notes: 'Imported from the previous system', created_by: ctx.userId, received_by: null, received_at: null,
      approved_by: null, approved_at: null, created_at: at, updated_at: at
    }, s());
    return { id, merged: false, collection: 'purchases' };
  },

  async prescriptions(value, ctx) {
    const at = nowIso();
    const id = uid('RX');
    await col.prescriptions().insertOne({
      _id: id, id, pharmacy_id: ctx.pharmacyId, customer_id: null, reference: value.reference || `IMP-${ctx.sequence}`, patient_name: value.patient_name,
      doctor_name: value.doctor_name, hospital: value.hospital || null, pmdc_number: value.pmdc_number || null, prescription_date: value.prescription_date,
      status: 'dispensed', notes: [value.medicines, value.notes].filter(Boolean).join('\n') || null,
      items: value.medicines ? [{ id: randomUUID(), medicine_id: null, medicine_text: sanitiseText(value.medicines, 1000), dosage: 'As written on the original prescription', duration: null, quantity: 0 }] : [],
      verified_by: null, verified_at: null, dispensed_by: null, dispensed_at: null, sale_id: null, created_by: ctx.userId, created_at: at, updated_at: at
    }, s());
    return { id, merged: false, collection: 'prescriptions' };
  }
};

/* ============================== THE IMPORT =============================== */

/** A copy of what the affected collection holds now, written before anything changes. */
async function writeBackup(job: MigrationJob): Promise<string> {
  const target = CATEGORIES[job.category].target === 'sale_items' ? 'sales' : CATEGORIES[job.category].target;
  const rows = await col.raw(target).find({ pharmacy_id: job.pharmacy_id }).toArray();
  const path = `${backupFolder()}/${job.id}-${target}-${Date.now()}.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ job: job.id, collection: target, pharmacyId: job.pharmacy_id, takenAt: nowIso(), rowCount: rows.length, rows }, null, 2), 'utf8');
  return path;
}

/**
 * Write the valid rows into the pharmacy's records, in batches inside
 * transactions. Errors and skipped rows stay where they are, with reasons.
 */
export async function runImport(input: { jobId: string; pharmacyId: string; userId: string }) {
  /* Claim the job first, so two clicks cannot run the same import twice. */
  const job = await col.migrationJobs().findOneAndUpdate(
    { _id: input.jobId, pharmacy_id: input.pharmacyId, status: { $in: ['preview', 'failed'] } },
    { $set: { status: 'importing', started_at: nowIso(), updated_at: nowIso() } },
    { returnDocument: 'after' }
  );
  if (!job) {
    const current = await col.migrationJobs().findOne({ _id: input.jobId, pharmacy_id: input.pharmacyId });
    if (!current) return { ok: false as const, reason: 'That import could not be found.' };
    if (current.status === 'importing') return { ok: false as const, reason: 'That import is already running.' };
    if (current.status === 'completed') return { ok: false as const, reason: 'That import has already finished.' };
    return { ok: false as const, reason: 'Check the rows first — the import runs after the preview.' };
  }

  const branch = await col.branches().findOne({ pharmacy_id: input.pharmacyId }, { sort: { is_main: -1, created_at: 1 } });
  const backupPath = await writeBackup(job);
  await col.migrationJobs().updateOne({ _id: job.id }, { $set: { backup_path: backupPath } });

  const writer = WRITERS[job.category];
  const context: WriteContext = { pharmacyId: input.pharmacyId, userId: input.userId, jobId: job.id, branchId: branch?.id ?? null, createdCategories: [], sequence: 0 };
  let merged = 0;
  let failed = 0;
  const failures: { fromRow: number; count: number; reason: string }[] = [];
  const pending = await col.migrationItems().find({ job_id: job.id, status: 'valid' }).sort({ row_number: 1 }).toArray();

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    let mergedHere = 0;
    try {
      await tx(async () => {
        mergedHere = 0;
        for (const item of batch) {
          context.sequence += 1;
          const written = await writer(item.mapped as Row, context);
          if (written.merged) mergedHere += 1;
          await col.migrationItems().updateOne({ _id: item._id }, {
            $set: { status: 'imported', target_collection: written.collection, target_id: written.id, resolution: written.merged ? 'merge' : item.resolution, updated_at: nowIso() }
          }, s());
        }
      });
      merged += mergedHere;
    } catch (error) {
      /* The batch rolled back, so every row in it is still to do — each marked
         with the reason rather than lost. */
      const reason = (error as Error).message;
      await col.migrationItems().updateMany({ _id: { $in: batch.map((item) => item._id) }, status: { $ne: 'imported' } }, {
        $set: { status: 'error', updated_at: nowIso() },
        $push: { errors: { code: 'import_failed', message: `This row could not be written: ${reason}`, field: null, fixable: true } }
      });
      failed += batch.length;
      failures.push({ fromRow: batch[0]?.row_number ?? 0, count: batch.length, reason });
    }
  }

  const counted = await col.migrationItems().aggregate<{ _id: string; n: number }>([{ $match: { job_id: job.id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
  const count = (status: string) => counted.find((row) => row._id === status)?.n ?? 0;
  const total = counted.reduce((sum, row) => sum + row.n, 0);
  const report = {
    finishedAt: nowIso(), category: job.category, file: job.file_name, total, imported: count('imported'), merged, skipped: count('skipped'),
    stillToFix: count('error'), categoriesCreated: context.createdCategories.length, backupPath, failures,
    /* The arithmetic is stated so nobody has to take it on trust. */
    reconciliation: `${count('imported')} imported + ${count('skipped')} skipped + ${count('error')} left to fix = ${total} rows in the file`
  };
  await col.migrationJobs().updateOne({ _id: job.id }, {
    $set: {
      status: failed && !count('imported') ? 'failed' : 'completed', imported_rows: count('imported'), skipped_rows: count('skipped'),
      error_rows: count('error'), valid_rows: count('imported'), report, finished_at: nowIso(), updated_at: nowIso()
    }
  });
  return { ok: true as const, report };
}

/**
 * Undo an import: remove exactly what it created, nothing else. A row merged
 * into an existing record is left alone — deleting it would take the
 * pharmacy's own data with it — and that is reported, not hidden.
 */
export async function rollbackJob(input: { jobId: string; pharmacyId: string }) {
  const job = await col.migrationJobs().findOne({ _id: input.jobId, pharmacy_id: input.pharmacyId });
  if (!job) return { ok: false as const, reason: 'That import could not be found.' };
  if (job.status !== 'completed' && job.status !== 'failed') return { ok: false as const, reason: 'Only a finished import can be rolled back.' };
  if (job.rolled_back_at) return { ok: false as const, reason: 'That import has already been rolled back.' };

  const items = await col.migrationItems().find({ job_id: job.id, status: 'imported', target_id: { $ne: null } }).toArray();
  let removed = 0;
  let kept = 0;
  await tx(async () => {
    for (const item of items) {
      if (item.resolution === 'merge') { kept += 1; continue; }
      const targetId = item.target_id!;
      let gone: number;
      if (job.category === 'sale_items') {
        gone = (await col.sales().updateOne({ pharmacy_id: input.pharmacyId, 'items.id': targetId }, { $pull: { items: { id: targetId } } }, s())).modifiedCount;
      } else {
        if (job.category === 'batches') await col.stockMovements().deleteMany({ batch_id: targetId, reference_type: 'migration', pharmacy_id: input.pharmacyId }, s());
        /* pharmacy_id in the filter is what stops one pharmacy's rollback
           reaching another's records. */
        gone = (await col.raw(item.target_collection ?? CATEGORIES[job.category].target).deleteOne({ _id: targetId, pharmacy_id: input.pharmacyId }, s())).deletedCount;
      }
      removed += gone;
      await col.migrationItems().updateOne({ _id: item._id }, { $set: { status: 'valid', target_id: null, updated_at: nowIso() } }, s());
    }
    await col.migrationJobs().updateOne({ _id: job.id }, { $set: { status: 'rolled_back', rolled_back_at: nowIso(), imported_rows: kept, updated_at: nowIso() } }, s());
  });
  return {
    ok: true as const, removed, kept,
    message: kept
      ? `${removed} imported record(s) removed. ${kept} record(s) were merged into rows that already existed and have been left alone — rolling those back would delete data that was not created by this import.`
      : `${removed} imported record(s) removed. The pharmacy is back exactly as it was.`
  };
}

/* ------------------------------------------------------------- reading back */
export const listJobs = (pharmacyId: string) => col.migrationJobs().find({ pharmacy_id: pharmacyId }, {
  projection: {
    _id: 0, id: 1, category: 1, source: 1, file_name: 1, status: 1, total_rows: 1, imported_rows: 1, skipped_rows: 1, error_rows: 1,
    created_by_name: 1, created_at: 1, finished_at: 1, rolled_back_at: 1
  }
}).sort({ created_at: -1 }).limit(50).toArray();

export async function jobDetail(input: { jobId: string; pharmacyId: string; status?: string | null; page?: number; size?: number }) {
  const job = await col.migrationJobs().findOne({ _id: input.jobId, pharmacy_id: input.pharmacyId });
  if (!job) return null;
  const page = Math.max(1, input.page ?? 1);
  const size = input.size ?? 50;
  const filter: Filter<MigrationItem> = { job_id: job.id };
  if (input.status) filter.status = input.status;
  const [rows, counted] = await Promise.all([
    col.migrationItems().find(filter).sort({ row_number: 1 }).skip((page - 1) * size).limit(size).toArray(),
    col.migrationItems().aggregate<{ _id: string; n: number }>([{ $match: { job_id: job.id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()
  ]);
  const count = (status: string) => counted.find((row) => row._id === status)?.n ?? 0;
  return {
    job: {
      id: job.id, category: job.category, categoryLabel: CATEGORIES[job.category]?.label ?? job.category, source: job.source, fileName: job.file_name,
      fileSize: job.file_size, status: job.status, columns: job.columns, mapping: job.mapping, report: job.report, backupPath: job.backup_path,
      createdBy: job.created_by_name, createdAt: job.created_at, finishedAt: job.finished_at, rolledBackAt: job.rolled_back_at
    },
    fields: CATEGORIES[job.category] ? publicFields(CATEGORIES[job.category]) : [],
    counts: { total: counted.reduce((sum, row) => sum + row.n, 0), valid: count('valid'), errors: count('error'), skipped: count('skipped'), imported: count('imported') },
    items: rows.map((item) => ({
      id: item.id, rowNumber: item.row_number, raw: item.raw, mapped: item.mapped, status: item.status, resolution: item.resolution,
      problems: item.errors, targetId: item.target_id
    })),
    page, size
  };
}
