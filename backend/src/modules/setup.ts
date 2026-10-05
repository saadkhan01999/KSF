/* ==========================================================================
   Finishing the setup, after the account already exists
   --------------------------------------------------------------------------
   Registration asks for four things. The pharmacy's real name, address,
   licence numbers and plan are asked for here, one card at a time, in any
   order.

   1. Progress is never a stored flag. Each step reports done or not by
      looking at the record it would have written; a checklist that stores its
      own answer starts lying the moment somebody edits the underlying data.
   2. Nothing here can activate a paid plan. Choosing one records interest and
      sends the Admin to Billing, which goes through the payment provider.
   ========================================================================== */

import { col } from '../db/mongo.js';
import { bad } from '../core/errors.js';
import { auditLog, getSetting, logActivity, setSetting } from '../core/trails.js';
import { isPkPhone, nowIso, sanitiseText, toStr } from '../core/util.js';
import { route } from '../http/router.js';
import { listPlans } from '../services/subscriptions.js';

const PHARMACY_TYPES = ['retail', 'chain', 'hospital', 'clinic', 'wholesale', 'online', 'compounding'];
const PROVINCES = ['Sindh', 'Punjab', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu and Kashmir'];

/* The name a brand-new account is given. While it is still there, "name your
   pharmacy" is genuinely outstanding. */
const isPlaceholderName = (name: unknown): boolean => /^(.+'s Pharmacy|My Pharmacy)$/.test(String(name ?? ''));

async function checklist(pharmacyId: string) {
  const [pharmacy, staff, medicines, planChosen, dismissed] = await Promise.all([
    col.pharmacies().findOne({ _id: pharmacyId }),
    col.users().countDocuments({ pharmacy_id: pharmacyId, status: 'active' }),
    col.medicines().countDocuments({ pharmacy_id: pharmacyId, status: 'active' }),
    getSetting(pharmacyId, 'setup.planChosen'),
    getSetting(pharmacyId, 'setup.dismissed')
  ]);
  const steps = [
    { key: 'pharmacy', label: 'Name your pharmacy', note: 'The name and type that appear on every receipt and report.', to: '/setup', done: !!pharmacy?.name && !isPlaceholderName(pharmacy.name) },
    { key: 'address', label: 'Where you are', note: 'Street, city and phone number — printed on receipts, and used on returns to suppliers.', to: '/setup', done: !!(pharmacy?.address && pharmacy?.city && pharmacy?.phone) },
    { key: 'licence', label: 'Licence and tax details', note: 'DRAP licence, NTN and business registration. Required on receipts in some cities.', to: '/setup', optional: true, done: !!(pharmacy?.drap_licence || pharmacy?.ntn || pharmacy?.registration_no) },
    { key: 'plan', label: 'Choose a plan', note: 'Basic is free and permanent. Nothing is charged until a payment is confirmed.', to: '/settings?tab=billing', optional: true, done: planChosen === 'yes' },
    { key: 'staff', label: 'Add your staff', note: 'Each person needs their own account — that is how KSF can tell you who served a sale.', to: '/staff', optional: true, done: staff > 1 },
    { key: 'medicines', label: 'Bring your medicines across', note: 'Import a CSV or Excel file from your old system, or add them by hand.', to: '/settings?tab=migration', done: medicines > 0 }
  ];
  /* Optional steps count towards nothing, so a one-person pharmacy is not
     left at 80% for ever. */
  const required = steps.filter((step) => !step.optional);
  const doneRequired = required.filter((step) => step.done).length;
  return {
    steps,
    percent: Math.round((doneRequired / required.length) * 100),
    complete: doneRequired === required.length,
    dismissed: dismissed === 'yes',
    pharmacy: {
      name: pharmacy?.name ?? '', placeholderName: isPlaceholderName(pharmacy?.name), type: pharmacy?.pharmacy_type ?? 'retail',
      address: pharmacy?.address ?? '', city: pharmacy?.city ?? '', province: pharmacy?.province ?? 'Sindh', postcode: pharmacy?.postcode ?? '',
      phone: pharmacy?.phone ?? '', website: pharmacy?.website ?? '', drapLicence: pharmacy?.drap_licence ?? '', ntn: pharmacy?.ntn ?? '',
      registrationNo: pharmacy?.registration_no ?? ''
    },
    options: { types: PHARMACY_TYPES, provinces: PROVINCES }
  };
}

route('GET', '/api/v1/setup/state', null, async (ctx) => ({ data: await checklist(ctx.pharmacyId) }));

/* The pharmacy's own details are a settings write: refused here for anybody
   without it, not merely hidden behind a missing button. */
route('POST', '/api/v1/setup/pharmacy', 'settings.write', async (ctx) => {
  const name = sanitiseText(ctx.body.name, 140);
  const type = toStr(ctx.body.type, 30).toLowerCase();
  if (!name) bad('Enter the name of your pharmacy.', 'name');
  if (!PHARMACY_TYPES.includes(type)) bad('Choose the kind of pharmacy this is.', 'type');
  const at = nowIso();
  await col.pharmacies().updateOne({ _id: ctx.pharmacyId }, [{
    $set: { name, legal_name: { $ifNull: ['$legal_name', name] }, pharmacy_type: type, logo_initials: name.slice(0, 3).toUpperCase(), updated_at: at }
  }]);
  /* The first branch was created with the placeholder name too. */
  await col.branches().updateOne({ pharmacy_id: ctx.pharmacyId, code: 'MAIN' }, { $set: { name, updated_at: at } });
  await logActivity(ctx, { action: 'pharmacy.updated', entity: 'pharmacy', entityId: ctx.pharmacyId, summary: `Pharmacy named ${name}` });
  return { data: await checklist(ctx.pharmacyId), message: 'Saved.' };
});

route('POST', '/api/v1/setup/address', 'settings.write', async (ctx) => {
  const address = sanitiseText(ctx.body.address, 300);
  const city = sanitiseText(ctx.body.city, 80);
  const province = toStr(ctx.body.province, 60) || 'Sindh';
  const postcode = toStr(ctx.body.postcode, 20);
  const phone = toStr(ctx.body.phone, 40);
  if (!address) bad('Enter the street address.', 'address');
  if (!city) bad('Enter the city.', 'city');
  if (!PROVINCES.includes(province)) bad('Choose a province.', 'province');
  if (!phone) bad('Enter a telephone number for the pharmacy.', 'phone');
  if (!isPkPhone(phone)) bad('Enter a valid Pakistani number, for example 021 34567890 or 0300 1234567.', 'phone');
  const at = nowIso();
  await col.pharmacies().updateOne({ _id: ctx.pharmacyId }, { $set: { address, city, province, postcode: postcode || null, phone, updated_at: at } });
  await col.branches().updateOne({ pharmacy_id: ctx.pharmacyId, code: 'MAIN' }, { $set: { address, city, province, phone, updated_at: at } });
  await logActivity(ctx, { action: 'pharmacy.updated', entity: 'pharmacy', entityId: ctx.pharmacyId, summary: 'Address and telephone number set' });
  return { data: await checklist(ctx.pharmacyId), message: 'Saved.' };
});

route('POST', '/api/v1/setup/licence', 'settings.write', async (ctx) => {
  const website = toStr(ctx.body.website, 200);
  if (website && !/^https?:\/\/[^\s]+\.[^\s]{2,}$/i.test(website)) bad('Enter the website as a full address, for example https://example.pk', 'website');
  await col.pharmacies().updateOne({ _id: ctx.pharmacyId }, {
    $set: {
      drap_licence: toStr(ctx.body.drapLicence, 60) || null, ntn: toStr(ctx.body.ntn, 40) || null,
      registration_no: toStr(ctx.body.registrationNo, 60) || null, website: website || null, updated_at: nowIso()
    }
  });
  /* Licence numbers are what an inspector asks about, so the change goes
     into the provable trail. */
  await auditLog(ctx, { action: 'pharmacy.licence-updated', entity: 'pharmacy', entityId: ctx.pharmacyId, summary: 'Licence and tax details updated' });
  return { data: await checklist(ctx.pharmacyId), message: 'Saved.' };
});

/* Records which plan the Admin is interested in, and nothing else. */
route('POST', '/api/v1/setup/plan', 'settings.write', async (ctx) => {
  const planKey = toStr(ctx.body.planKey, 30) || 'basic';
  const plan = (await listPlans()).find((entry) => entry.key === planKey);
  if (!plan) return bad('Choose one of the available plans.', 'planKey');
  await setSetting(ctx.pharmacyId, 'setup.planChosen', 'yes');
  await setSetting(ctx.pharmacyId, 'setup.planInterest', planKey);
  return {
    data: await checklist(ctx.pharmacyId),
    message: plan.isFree ? 'You are on the free Basic plan.' : `Noted. Nothing has been charged — finish ${plan.name} from Billing when you are ready.`
  };
});

/* "Not now." The checklist stays under Settings; it stops opening by itself. */
route('POST', '/api/v1/setup/dismiss', 'settings.write', async (ctx) => {
  await setSetting(ctx.pharmacyId, 'setup.dismissed', ctx.body.dismissed === false ? 'no' : 'yes');
  return { data: await checklist(ctx.pharmacyId) };
});
