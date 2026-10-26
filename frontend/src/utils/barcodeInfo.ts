/* What KSF knows about a scanned pack, for filling in a new medicine
   (GET /medicines-barcode-info, backend modules/barcodes.ts). */

export interface BarcodeFields {
  name: string | null;
  genericName: string | null;
  manufacturer: string | null;
  form: string | null;
  strength: string | null;
  packSize: string | null;
  drapRegNo: string | null;
  categoryId: string | null;
  categoryName: string | null;
  requiresPrescription: boolean | null;
  isControlled: boolean | null;
}

export interface BarcodeInfo {
  code: string;
  /** The barcode to keep on the medicine (a GS1 code's product number, as on the box). */
  barcode: string;
  gs1: { gtin: string; expiry: string | null; batch: string | null; serial: string | null } | null;
  /** Already in this pharmacy's catalogue. */
  existing: { id: string; name: string } | null;
  found: boolean;
  source: { kind: 'ksf' | 'online'; label: string } | null;
  directory: { id: string; name: string; prescription: string } | null;
  fields: BarcodeFields | null;
}

/** The form's fields, and the words for them, that a lookup can fill. */
export const FILLABLE: Array<[keyof BarcodeFields, string]> = [
  ['name', 'name'], ['genericName', 'generic name'], ['manufacturer', 'manufacturer'], ['categoryId', 'category'],
  ['form', 'form'], ['strength', 'strength'], ['packSize', 'pack size'], ['drapRegNo', 'DRAP number'],
  ['requiresPrescription', 'prescription status'], ['isControlled', 'controlled status']
];

/** One line about the product: generic name, maker, form and pack. */
export const productLine = (fields: BarcodeFields): string =>
  [fields.genericName, fields.manufacturer, [fields.strength, fields.form].filter(Boolean).join(' '), fields.packSize].filter(Boolean).join(' · ');

/** "KSF pharmacies and the medicine directory" — where the details came from. */
export const sourceLine = (info: BarcodeInfo): string =>
  [info.source?.label, info.directory ? 'the medicine directory' : ''].filter(Boolean).join(' and ');
