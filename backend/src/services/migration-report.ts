/* ==========================================================================
   Either side of an import: a template to start from, and a reconciliation
   to check afterwards
   --------------------------------------------------------------------------
   Neither writes anything. The reconciliation is what matters: a pharmacy
   does not verify a migration by reading four thousand rows, it holds two
   numbers against the report its old program printed — how many records and
   what they add up to. Every figure is counted from the job's own rows, so
   any difference is attributable to named rows with stated reasons.
   ========================================================================== */

import { col } from '../db/mongo.js';
import { CATEGORIES } from './migration.js';

/* Where there is no meaningful total — a catalogue, prescriptions — the
   count is the only honest check, and the report says so. */
const RECONCILE: Record<string, { countLabel: string; sumField?: string; sumLabel?: string; unit?: 'count' }> = {
  medicines: { countLabel: 'medicines' },
  suppliers: { countLabel: 'suppliers', sumField: 'balance_paisa', sumLabel: 'outstanding payable' },
  customers: { countLabel: 'customers', sumField: 'balance_paisa', sumLabel: 'outstanding udhaar' },
  batches: { countLabel: 'batches', sumField: 'quantity', sumLabel: 'units of stock', unit: 'count' },
  sales: { countLabel: 'invoices', sumField: 'total_paisa', sumLabel: 'sales value' },
  sale_items: { countLabel: 'invoice lines', sumField: 'line_total_paisa', sumLabel: 'line value' },
  purchases: { countLabel: 'purchase orders', sumField: 'total_paisa', sumLabel: 'purchase value' },
  prescriptions: { countLabel: 'prescriptions' }
};

/* Two rows of plausible data per template, so the shape of every column is
   obvious without a manual. */
const EXAMPLES: Record<string, Record<string, string>[]> = {
  medicines: [
    { name: 'Panadol 500mg', generic_name: 'Paracetamol', manufacturer: 'GSK', category: 'Painkillers', form: 'Tablet', strength: '500mg', pack_size: '10 tablets', barcode: '8964000111222', sku: 'PAN500', cost_paisa: '28.50', price_paisa: '35.00', min_stock: '50', requires_prescription: 'no', shelf_location: 'A-1' },
    { name: 'Augmentin 625mg', generic_name: 'Amoxicillin + Clavulanic acid', manufacturer: 'GSK', category: 'Antibiotics', form: 'Tablet', strength: '625mg', pack_size: '6 tablets', barcode: '8964000333444', sku: 'AUG625', cost_paisa: '410.00', price_paisa: '480.00', min_stock: '20', requires_prescription: 'yes', shelf_location: 'B-3' }
  ],
  suppliers: [
    { name: 'Muller & Phipps', contact_person: 'Imran Sheikh', phone: '+92 300 1234567', email: 'orders@mp.example.pk', address: 'Korangi Industrial Area', city: 'Karachi', ntn: '1234567-8', payment_terms: '30 days', balance_paisa: '125000.00' },
    { name: 'Zahid Pharma Distributors', contact_person: 'Zahid Ali', phone: '+92 321 9876543', email: '', address: 'Shahalam Market', city: 'Lahore', ntn: '', payment_terms: 'Cash on delivery', balance_paisa: '0' }
  ],
  customers: [
    { name: 'Fatima Bibi', phone: '+92 333 1112223', cnic: '42101-1234567-1', address: 'House 12, Block 4, Gulshan', city: 'Karachi', gender: 'female', allergies: 'Penicillin', chronic_notes: 'Type 2 diabetes', balance_paisa: '3500.00' },
    { name: 'Muhammad Akram', phone: '+92 301 4445556', cnic: '', address: '', city: 'Hyderabad', gender: 'male', allergies: '', chronic_notes: '', balance_paisa: '0' }
  ],
  batches: [
    { medicine: 'Panadol 500mg', batch_no: 'PN-2471', expiry_date: '2027-06-30', quantity: '240', cost_paisa: '28.50', price_paisa: '35.00', supplier: 'Muller & Phipps' },
    { medicine: '8964000333444', batch_no: 'AG-9912', expiry_date: '03/2027', quantity: '36', cost_paisa: '410.00', price_paisa: '480.00', supplier: 'Zahid Pharma Distributors' }
  ],
  sales: [
    { invoice_no: 'INV-10234', sold_at: '2026-08-14', customer_name: 'Fatima Bibi', total_paisa: '1285.00', discount_paisa: '15.00', cost_paisa: '980.00', payment_method: 'cash' },
    { invoice_no: 'INV-10235', sold_at: '14/08/2026', customer_name: '', total_paisa: '350.00', discount_paisa: '0', cost_paisa: '285.00', payment_method: 'easypaisa' }
  ],
  sale_items: [
    { invoice_no: 'INV-10234', medicine: 'Panadol 500mg', quantity: '2', unit_price_paisa: '35.00', line_total_paisa: '70.00', discount_paisa: '0', batch_no: 'PN-2471', expiry_date: '2027-06-30' },
    { invoice_no: 'INV-10234', medicine: 'Augmentin 625mg', quantity: '1', unit_price_paisa: '480.00', line_total_paisa: '465.00', discount_paisa: '15.00', batch_no: 'AG-9912', expiry_date: '03/2027' }
  ],
  purchases: [
    { reference: 'PO-5521', supplier: 'Muller & Phipps', purchase_date: '2026-07-02', invoice_no: 'MP-88213', total_paisa: '84500.00', payment_status: 'paid' },
    { reference: 'PO-5522', supplier: 'Zahid Pharma Distributors', purchase_date: '2026-07-09', invoice_no: '', total_paisa: '23100.00', payment_status: 'unpaid' }
  ],
  prescriptions: [
    { reference: 'RX-3312', patient_name: 'Fatima Bibi', doctor_name: 'Dr Sana Raza', prescription_date: '2026-08-14', hospital: 'Aga Khan Clinic', pmdc_number: '12345-K', medicines: 'Augmentin 625mg - 1x2 for 5 days', notes: 'Take after food' },
    { reference: '', patient_name: 'Muhammad Akram', doctor_name: 'Dr Kamran Yusuf', prescription_date: '13/08/2026', hospital: '', pmdc_number: '', medicines: 'Panadol 500mg - as needed', notes: '' }
  ]
};

/**
 * A blank file in the shape KSF expects, with two example rows. Headers are
 * the field labels, which the mapping step matches on — so a filled-in
 * template maps itself.
 */
export function template(categoryKey: string) {
  const category = CATEGORIES[categoryKey];
  if (!category) return null;
  return {
    category: categoryKey,
    label: category.label,
    filename: `ksf-template-${categoryKey.replace(/_/g, '-')}`,
    headers: category.fields.map((field) => field.label),
    rows: (EXAMPLES[categoryKey] ?? []).map((example) => Object.fromEntries(category.fields.map((field) => [field.label, example[field.key] ?? '']))),
    required: category.fields.filter((field) => field.required).map((field) => field.label),
    notes: [
      'Delete the two example rows before importing, or leave them and skip them at the preview step.',
      'Money goes in rupees, not paisa: 1285.50 means Rs 1,285.50.',
      'Dates may be 2026-08-14 or 14/08/2026. A batch expiry written 03/2027 is read as the end of March 2027.',
      'A barcode that begins with a zero has to be kept as text, or Excel will drop the zero. KSF copes with it either way, but the file is easier to read if it is right.',
      category.requires
    ].filter(Boolean)
  };
}

/** What landed, against what was in the file. Null when the job is not this pharmacy's. */
export async function reconciliation(input: { jobId: string; pharmacyId: string }) {
  const job = await col.migrationJobs().findOne({ _id: input.jobId, pharmacy_id: input.pharmacyId });
  if (!job) return null;
  const rule = RECONCILE[job.category] ?? { countLabel: 'records' };
  const items = await col.migrationItems().find({ job_id: job.id }, { projection: { row_number: 1, status: 1, mapped: 1, errors: 1 } }).sort({ row_number: 1 }).toArray();

  const sumOf = (rows: typeof items): number => (rule.sumField ? rows.reduce((total, item) => total + Number((item.mapped as Record<string, unknown>)[rule.sumField!] ?? 0), 0) : 0);
  const imported = items.filter((item) => item.status === 'imported');
  const skipped = items.filter((item) => item.status === 'skipped');
  const outstanding = items.filter((item) => item.status !== 'imported' && item.status !== 'skipped');
  const inFile = sumOf(items);
  const landed = sumOf(imported);
  const difference = rule.sumField ? inFile - landed : null;
  const shortfall = rule.unit === 'count' ? String(difference) : `Rs ${((difference ?? 0) / 100).toLocaleString('en-PK')}`;

  return {
    job: {
      id: job.id, category: job.category, categoryLabel: CATEGORIES[job.category]?.label ?? job.category, file: job.file_name, status: job.status,
      finishedAt: job.finished_at, rolledBackAt: job.rolled_back_at, duplicateOf: job.duplicate_of
    },
    counts: { inFile: items.length, imported: imported.length, skipped: skipped.length, notImported: outstanding.length, label: rule.countLabel },
    totals: rule.sumField
      ? { field: rule.sumField, label: rule.sumLabel, unit: rule.unit === 'count' ? 'count' : 'paisa', inFile, imported: landed, difference }
      : null,
    /* The rows not in KSF, with the reason, so the difference is never a mystery. */
    notImported: outstanding.slice(0, 200).map((item) => ({ row: item.row_number, status: item.status, reasons: item.errors.map((error) => error.message) })),
    notImportedTruncated: Math.max(0, outstanding.length - 200),
    statement: `The file held ${items.length} ${rule.countLabel}. ${imported.length} were imported, ${skipped.length} were skipped on purpose, and ${outstanding.length} are not in KSF.`
      + (rule.sumField && difference ? ` ${shortfall} of ${rule.sumLabel} is in the file but not in KSF — that is those ${outstanding.length + skipped.length} row(s).` : ''),
    howToCheck: rule.sumField
      ? `Print the same list from your old system and compare two numbers: the number of ${rule.countLabel}, and the total ${rule.sumLabel}. They should match the "imported" column exactly. If they do not, the rows below are the difference.`
      : `Print the same list from your old system and compare how many ${rule.countLabel} it shows against the "imported" count. There is no total to compare for this kind of import.`
  };
}
