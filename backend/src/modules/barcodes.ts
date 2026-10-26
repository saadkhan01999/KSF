/* ==========================================================================
   What a barcode says about the product: filling in a new medicine
   --------------------------------------------------------------------------
   Scan a pack KSF's pharmacy does not stock yet, and the Add medicine form
   should not start empty. One question, GET /medicines-barcode-info, answers
   from three places, the first that knows:

     1. KSF's shared barcode list. Whenever a pharmacy saves a medicine with a
        barcode, what is printed on that pack (name, generic name, maker,
        form, strength, pack size, DRAP number, prescription status) is kept
        against the barcode — never a price, stock, shelf or which pharmacy it
        was. The first pharmacy to save a barcode sets it, and only it can
        correct it later; other pharmacies only fill in what is missing, so
        nobody can overwrite somebody else's.
     2. The open product databases (Open Products, Beauty and Food Facts, and
        UPCitemdb), for a product number only, with a short timeout. Each
        answer — "not found" too — is remembered, so a barcode is asked about
        once, not at every scan, and one pharmacy can ask about only so many
        new barcodes an hour.
     3. The KSF medicine directory, for what the name implies: "Panadol" is a
        brand of Paracetamol, made by Haleon, sold over the counter.

   The person adding the medicine checks it and saves it: nothing is added to
   a catalogue from here.
   ========================================================================== */

import { col } from '../db/mongo.js';
import type { BarcodeProduct, DirectoryMedicine, Medicine } from '../db/types.js';
import { bad } from '../core/errors.js';
import { env, VERSION } from '../config/env.js';
import { escapeRegex, nowIso, rateLimit, toStr } from '../core/util.js';
import { route } from '../http/router.js';
import { barcodeVariants, canonicalBarcode, gs1Of, isProductNumber, nameFacts } from '../domain/barcodes.js';
import { nameKey } from '../domain/medicine-directory.js';

type Flag = 0 | 1;
type Source = BarcodeProduct['source'];

/** How long "nobody knows this barcode" is believed before asking again. */
const RECHECK_UNKNOWN_DAYS = 14;
/** New barcodes one pharmacy may ask the open databases about in an hour. */
const ONLINE_PER_HOUR = 120;
const SOURCE_LABEL: Record<Source, string> = {
  pharmacy: 'KSF pharmacies',
  'open-products-facts': 'Open Products Facts',
  'open-beauty-facts': 'Open Beauty Facts',
  'open-food-facts': 'Open Food Facts',
  upcitemdb: 'UPCitemdb',
  none: ''
};
/* The catalogue's own forms (frontend Medicines FORMS). */
const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Inhaler', 'Cream', 'Ointment', 'Lotion', 'Solution', 'Drops', 'Sachet', 'Powder', 'Strips', 'Piece', 'Box', 'Pack'];

const clean = (value: unknown, max = 140): string | null => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  return text || null;
};
const exactly = (value: string) => new RegExp(`^${escapeRegex(value.trim())}$`, 'i');

/* ======================================================== learning */

/**
 * Remember what a pharmacy's medicine says about its barcode. Best effort:
 * saving the medicine never depends on it.
 */
export async function learnProduct(medicine: Medicine): Promise<void> {
  const barcode = medicine.barcode;
  if (!barcode || medicine.status === 'retired') return;
  try {
    const category = medicine.category_id
      ? (await col.categories().findOne({ _id: medicine.category_id }, { projection: { name: 1 } }))?.name ?? null
      : null;
    const facts = {
      name: medicine.name, generic_name: medicine.generic_name, manufacturer: medicine.manufacturer, form: medicine.form,
      strength: medicine.strength, pack_size: medicine.pack_size, drap_reg_no: medicine.drap_reg_no, category,
      requires_prescription: medicine.requires_prescription, is_controlled: medicine.is_controlled
    };
    const at = nowIso();
    const current = await col.barcodeProducts().findOne({ _id: barcode });
    /* New, or only known from outside: what this pharmacy says. */
    if (!current || current.source !== 'pharmacy') {
      await col.barcodeProducts().updateOne(
        { _id: barcode },
        {
          $set: { ...facts, id: barcode, barcode, found: true, source: 'pharmacy', learned_from: medicine.pharmacy_id, checked_at: at, updated_at: at },
          $setOnInsert: { created_at: at }
        },
        { upsert: true }
      );
      return;
    }
    /* The pharmacy that set it corrects what it says (what others filled in stays). */
    if (current.learned_from === medicine.pharmacy_id) {
      const said = Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null && value !== ''));
      await col.barcodeProducts().updateOne({ _id: barcode }, { $set: { ...said, updated_at: at } });
      return;
    }
    const blanks = Object.fromEntries(Object.entries(facts).filter(([key, value]) =>
      value !== null && value !== '' && (current[key as keyof BarcodeProduct] ?? null) === null));
    if (Object.keys(blanks).length) await col.barcodeProducts().updateOne({ _id: barcode }, { $set: { ...blanks, updated_at: at } });
  } catch { /* the shared list is a convenience */ }
}

/* ================================================ the open databases */

interface Online { name: string; manufacturer: string | null; quantity: string | null; source: Source }

const AGENT = () => `KSF-Pharmacy/${VERSION} (${env.PUBLIC_APP_URL})`;

/** A brand list ("Panadol, Haleon") as a maker: the company, not the brand the name already says. */
function makerOf(brands: unknown, name: string): string | null {
  const list = String(brands ?? '').split(',').map((brand) => brand.trim()).filter(Boolean);
  if (list.length > 1) return clean(list[list.length - 1], 120);
  return list[0] && !name.toLowerCase().startsWith(list[0].toLowerCase()) ? clean(list[0], 120) : null;
}

async function getJson(url: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': AGENT() }, signal });
  /* Open Facts answers an unknown product with 404; that is "not found", not a failure. */
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

const OPEN_FACTS: Array<[Source, string]> = [
  ['open-products-facts', 'https://world.openproductsfacts.org'],
  ['open-beauty-facts', 'https://world.openbeautyfacts.org'],
  ['open-food-facts', 'https://world.openfoodfacts.org']
];

async function openFacts(source: Source, host: string, barcode: string, signal: AbortSignal): Promise<Online | null> {
  const body = await getJson(`${host}/api/v2/product/${barcode}.json?fields=product_name,product_name_en,generic_name,brands,quantity`, signal);
  const product = body?.status === 1 ? body.product : null;
  const name = clean(product?.product_name_en) ?? clean(product?.product_name) ?? clean(product?.generic_name);
  return product && name ? { name, manufacturer: makerOf(product.brands, name), quantity: clean(product.quantity, 60), source } : null;
}

async function upcItemDb(barcode: string, signal: AbortSignal): Promise<Online | null> {
  const body = await getJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, signal);
  const item = Array.isArray(body?.items) ? body.items[0] : null;
  const name = clean(item?.title);
  return item && name ? { name, manufacturer: makerOf(item.brand, name), quantity: clean(item.size, 60), source: 'upcitemdb' } : null;
}

/** Every database at once, the first in this order that knows it; undefined when none could be asked. */
async function askOnline(barcode: string): Promise<Online | null | undefined> {
  const signal = AbortSignal.timeout(env.BARCODE_LOOKUP_TIMEOUT_MS);
  const answers = await Promise.allSettled([
    ...OPEN_FACTS.map(([source, host]) => openFacts(source, host, barcode, signal)),
    upcItemDb(barcode, signal)
  ]);
  const found = answers.find((answer) => answer.status === 'fulfilled' && answer.value);
  if (found) return (found as PromiseFulfilledResult<Online>).value;
  /* Nobody answered at all (offline, blocked): say nothing rather than "unknown". */
  return answers.some((answer) => answer.status === 'fulfilled') ? null : undefined;
}

/** What the shared list knows, asking the open databases (and remembering their answer) if it knows nothing. */
async function productFor(barcode: string, variants: string[], pharmacyId: string): Promise<BarcodeProduct | null> {
  const known = await col.barcodeProducts().find({ _id: { $in: variants } }).toArray();
  const best = known.find((row) => row.found && row.source === 'pharmacy') ?? known.find((row) => row.found);
  if (best) return best;
  const recent = known.some((row) => row.checked_at > new Date(Date.now() - RECHECK_UNKNOWN_DAYS * 86_400_000).toISOString());
  if (recent || !env.BARCODE_LOOKUP_ONLINE || !isProductNumber(barcode)) return null;
  if (!rateLimit(`barcode-online:${pharmacyId}`, ONLINE_PER_HOUR, 3_600_000).ok) return null;

  const online = await askOnline(barcode);
  if (online === undefined) return null;
  const facts = online ? nameFacts(online.name, online.quantity ?? '') : null;
  const at = nowIso();
  const row: BarcodeProduct = {
    _id: barcode, id: barcode, barcode, found: !!online,
    name: online?.name ?? null, generic_name: null, manufacturer: online?.manufacturer ?? null,
    form: facts?.form ?? null, strength: facts?.strength ?? null, pack_size: facts?.packSize ?? null,
    drap_reg_no: null, category: null, requires_prescription: null, is_controlled: null,
    source: online?.source ?? 'none', checked_at: at, created_at: at, updated_at: at
  };
  /* A pharmacy may have saved it meanwhile: theirs wins. */
  await col.barcodeProducts().updateOne({ _id: barcode, source: { $ne: 'pharmacy' } }, { $set: row }, { upsert: true }).catch(() => undefined);
  return online ? row : null;
}

/* ===================================================== the directory */

/** The directory entry a product's name or generic name points to, and the brand it matched. */
async function directoryMatch(name: string | null, generic: string | null): Promise<{ entry: DirectoryMedicine; brand: DirectoryMedicine['brands'][number] | null } | null> {
  const words = (name ?? '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const leading = [3, 2, 1].map((count) => words.slice(0, count).join(' ')).filter((text, at, all) => text && all.indexOf(text) === at);
  const or: object[] = [];
  if (generic) or.push({ name_key: nameKey(generic) }, { synonyms: exactly(generic) });
  if (leading.length) {
    or.push({ 'brands.name': { $in: leading.map(exactly) } }, { name_key: { $in: leading.map(nameKey) } }, { synonyms: { $in: leading.map(exactly) } });
  }
  if (!or.length) return null;
  const entries = await col.directory().find({ status: 'published', $or: or }).limit(10).toArray();
  if (!entries.length) return null;
  const byGeneric = generic ? entries.find((entry) => entry.name_key === nameKey(generic)) : undefined;
  for (const text of leading) {
    const entry = entries.find((row) => row.brands.some((brand) => brand.name.toLowerCase() === text.toLowerCase()));
    if (entry && (!byGeneric || entry === byGeneric)) {
      return { entry, brand: entry.brands.find((brand) => brand.name.toLowerCase() === text.toLowerCase()) ?? null };
    }
  }
  const entry = byGeneric ?? entries.find((row) => leading.some((text) => row.name_key === nameKey(text) || row.synonyms.some((other) => other.toLowerCase() === text.toLowerCase())));
  return entry ? { entry, brand: null } : null;
}

/** "Tablet 500 mg" (a directory form) as the catalogue's form, if it is one. */
const formOf = (text: string | undefined): string | null =>
  (text ? FORMS.find((form) => text.toLowerCase().startsWith(form.toLowerCase())) : undefined) ?? null;

/* ============================================================ route */

route('GET', '/api/v1/medicines-barcode-info', 'medicines.write', async (ctx) => {
  const code = toStr(ctx.query.get('code'), 120).trim();
  if (!code) bad('Scan or type a barcode.', 'code');
  const barcode = canonicalBarcode(code);
  const variants = barcodeVariants(code);

  const [existing, product] = await Promise.all([
    col.medicines().findOne({ pharmacy_id: ctx.pharmacyId, status: { $ne: 'retired' }, barcode: { $in: variants } }, { projection: { _id: 1, name: 1 } }),
    productFor(barcode, variants, ctx.pharmacyId)
  ]);
  const match = product ? await directoryMatch(product.name, product.generic_name) : null;
  const entry = match?.entry ?? null;
  const facts = product?.name ? nameFacts(product.name, product.pack_size ?? '') : null;

  const categoryName = product?.category ?? entry?.category ?? null;
  const category = categoryName
    ? await col.categories().findOne({ pharmacy_id: ctx.pharmacyId, status: { $ne: 'archived' }, name: exactly(categoryName) }, { projection: { _id: 1 } })
    : null;
  const flag = (value: Flag | null | undefined, fallback: boolean | null): boolean | null => (value === 0 || value === 1 ? value === 1 : fallback);

  const fields = product ? {
    name: product.name,
    genericName: product.generic_name ?? entry?.name ?? null,
    manufacturer: product.manufacturer ?? match?.brand?.manufacturer ?? null,
    form: product.form ?? facts?.form ?? formOf(entry?.forms[0]),
    strength: product.strength ?? facts?.strength ?? null,
    packSize: product.pack_size ?? facts?.packSize ?? null,
    drapRegNo: product.drap_reg_no,
    categoryId: category?._id ?? null,
    categoryName,
    requiresPrescription: flag(product.requires_prescription, entry ? entry.prescription !== 'otc' : null),
    isControlled: flag(product.is_controlled, entry ? entry.prescription === 'controlled' : null)
  } : null;

  return {
    code, barcode, gs1: gs1Of(code),
    existing: existing ? { id: existing._id, name: existing.name } : null,
    found: !!fields,
    source: product ? { kind: product.source === 'pharmacy' ? 'ksf' : 'online', label: SOURCE_LABEL[product.source] } : null,
    directory: entry ? { id: entry.id, name: entry.name, prescription: entry.prescription } : null,
    fields
  };
});
