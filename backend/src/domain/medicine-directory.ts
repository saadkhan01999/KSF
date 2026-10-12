/* ==========================================================================
   The medicine directory's starter set
   --------------------------------------------------------------------------
   Thirty-four medicines a Pakistani pharmacy dispenses every day, described the
   way a patient leaflet or a pharmacology reference does: what each is used
   for, what to watch for, the common side effects and the interactions that
   matter at the counter. Doses are left out on purpose — they belong to the
   prescription and the product's own leaflet.

   Every entry arrives UNVERIFIED. It becomes "verified" only when a
   pharmacist on the KSF team has checked it against its references and
   pressed Verify, which records who and when. The reference links open the
   official sources' own pages for the medicine (the U.S. National Library of
   Medicine's DailyMed prescribing information, and the NHS medicines guide),
   and the team can replace them with the exact monograph they checked.

   The brands are well-known examples with their originating company, to
   help a reader recognise the medicine — not a list of every product, and
   not an endorsement.
   ========================================================================== */

import type { DirectoryMedicine } from '../db/types.js';

export type Prescription = 'otc' | 'prescription' | 'controlled';

/** What an entry says, without who wrote it and when. */
export type DirectoryFields = Pick<DirectoryMedicine,
  'name' | 'name_key' | 'synonyms' | 'category' | 'forms' | 'brands' | 'prescription' | 'uses' | 'precautions' | 'side_effects' | 'interactions' | 'references' | 'status'>;

export const nameKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface DirectorySeed {
  name: string; synonyms?: string[]; category: string; forms: string[]; brands: Array<[string, string]>;
  prescription: Prescription; uses: string[]; precautions: string[]; sideEffects: string[]; interactions?: string[];
}

/** The two references every starter entry carries, built from its name. */
export function starterReferences(name: string): Array<{ source: string; title: string; url: string }> {
  const query = encodeURIComponent(name.toLowerCase());
  return [
    { source: 'DailyMed — U.S. National Library of Medicine', title: `Prescribing information for ${name}`, url: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${query}` },
    { source: 'NHS medicines A to Z', title: `${name} — NHS guidance`, url: `https://www.nhs.uk/search/results?q=${query}` }
  ];
}

export const MEDICINE_CATEGORIES = [
  'Pain and fever', 'Antibiotics', 'Antifungals', 'Antiparasitics', 'Stomach and gut', 'Diabetes', 'Heart and blood pressure',
  'Cholesterol', 'Blood thinners', 'Allergy', 'Breathing', 'Thyroid', 'Steroids', 'Nausea and vomiting', 'Vitamins and minerals'
];

export const DIRECTORY_SEED: DirectorySeed[] = [
  {
    name: 'Paracetamol', synonyms: ['Acetaminophen'], category: 'Pain and fever', forms: ['Tablet 500 mg', 'Syrup 120 mg/5 ml', 'Suspension 250 mg/5 ml', 'Infusion'],
    brands: [['Panadol', 'Haleon (formerly GSK)'], ['Calpol', 'Haleon (formerly GSK)']], prescription: 'otc',
    uses: ['Mild to moderate pain: headache, toothache, period pain, muscle and joint aches', 'Fever, including after vaccinations'],
    precautions: ['Never take more than the maximum daily amount, and check other medicines for hidden paracetamol', 'Take extra care with liver disease, heavy alcohol use or very low body weight', 'An overdose can damage the liver even when the person feels well — get urgent help'],
    sideEffects: ['Side effects are rare at normal doses', 'Allergic skin rash (rare)'],
    interactions: ['Warfarin: regular use can raise the INR', 'Other products that contain paracetamol (cold and flu remedies)']
  },
  {
    name: 'Ibuprofen', category: 'Pain and fever', forms: ['Tablet 200 mg', 'Tablet 400 mg', 'Suspension 100 mg/5 ml'],
    brands: [['Brufen', 'Abbott']], prescription: 'otc',
    uses: ['Pain with inflammation: sprains, back pain, dental pain, period pain', 'Fever', 'Arthritis pain'],
    precautions: ['Take with or after food', 'Avoid with a stomach ulcer or bleeding, severe heart failure or kidney disease', 'Not in the last three months of pregnancy', 'Can make asthma worse in some people'],
    sideEffects: ['Indigestion, heartburn, nausea', 'Stomach bleeding (black stools or vomiting blood need urgent help)', 'Raised blood pressure, fluid retention'],
    interactions: ['Blood thinners and low-dose aspirin: more bleeding', 'Blood pressure medicines and diuretics: less effect, kidney strain', 'Other NSAIDs such as diclofenac']
  },
  {
    name: 'Diclofenac', category: 'Pain and fever', forms: ['Tablet 50 mg', 'Tablet SR 100 mg', 'Gel 1%', 'Injection 75 mg'],
    brands: [['Voltaren', 'Novartis']], prescription: 'prescription',
    uses: ['Joint and muscle pain and swelling', 'Arthritis', 'Gout attacks', 'Renal colic'],
    precautions: ['Take with food', 'Avoid with stomach ulcers, heart disease, stroke, or kidney disease', 'Not in the last three months of pregnancy'],
    sideEffects: ['Indigestion, stomach pain', 'Stomach bleeding', 'Raised blood pressure; heart attack and stroke risk with long use'],
    interactions: ['Blood thinners: more bleeding', 'Other NSAIDs', 'Lithium and methotrexate: higher levels']
  },
  {
    name: 'Mefenamic acid', category: 'Pain and fever', forms: ['Capsule 250 mg', 'Tablet 500 mg', 'Suspension 50 mg/5 ml'],
    brands: [['Ponstan', 'Pfizer']], prescription: 'prescription',
    uses: ['Period pain and heavy periods', 'Mild to moderate pain'],
    precautions: ['Take with food', 'Stop if diarrhoea develops', 'Avoid with stomach ulcers, inflammatory bowel disease or kidney disease'],
    sideEffects: ['Diarrhoea', 'Nausea, stomach pain', 'Drowsiness, dizziness'],
    interactions: ['Blood thinners: more bleeding', 'Other NSAIDs']
  },
  {
    name: 'Aspirin (low dose)', synonyms: ['Acetylsalicylic acid'], category: 'Blood thinners', forms: ['Tablet 75 mg', 'Tablet 150 mg', 'Dispersible tablet 300 mg'],
    brands: [['Disprin', 'Reckitt']], prescription: 'otc',
    uses: ['Preventing heart attack and stroke in people at risk (low dose, on medical advice)', 'Pain and fever in adults (higher dose)'],
    precautions: ['Not for children under 16 (risk of Reye’s syndrome)', 'Avoid with a stomach ulcer or a bleeding disorder', 'Tell the dentist or surgeon before a procedure'],
    sideEffects: ['Indigestion', 'Bruising and bleeding more easily', 'Stomach bleeding'],
    interactions: ['Other blood thinners and NSAIDs: more bleeding', 'Methotrexate']
  },
  {
    name: 'Amoxicillin', category: 'Antibiotics', forms: ['Capsule 250 mg', 'Capsule 500 mg', 'Suspension 125 mg/5 ml', 'Suspension 250 mg/5 ml'],
    brands: [['Amoxil', 'GSK']], prescription: 'prescription',
    uses: ['Chest, ear, throat and sinus infections', 'Urinary tract infections', 'Dental infections', 'Part of H. pylori treatment'],
    precautions: ['Do not take with a penicillin allergy', 'Finish the whole course', 'Tell the doctor about glandular fever (risk of rash)'],
    sideEffects: ['Diarrhoea, nausea', 'Skin rash', 'Severe allergy (swelling, breathing difficulty) — urgent help'],
    interactions: ['Methotrexate', 'Warfarin: INR may rise']
  },
  {
    name: 'Co-amoxiclav', synonyms: ['Amoxicillin with clavulanic acid'], category: 'Antibiotics', forms: ['Tablet 375 mg', 'Tablet 625 mg', 'Tablet 1 g', 'Suspension'],
    brands: [['Augmentin', 'GSK']], prescription: 'prescription',
    uses: ['Infections resistant to amoxicillin alone: chest, sinus, ear, skin, bite wounds, urinary tract'],
    precautions: ['Do not take with a penicillin allergy', 'Previous jaundice or liver problems with co-amoxiclav', 'Take at the start of a meal'],
    sideEffects: ['Diarrhoea', 'Nausea, thrush', 'Liver problems (yellow skin or eyes) — rare'],
    interactions: ['Methotrexate', 'Warfarin: INR may rise']
  },
  {
    name: 'Azithromycin', category: 'Antibiotics', forms: ['Tablet 250 mg', 'Tablet 500 mg', 'Suspension 200 mg/5 ml'],
    brands: [['Zithromax', 'Pfizer']], prescription: 'prescription',
    uses: ['Chest and throat infections', 'Typhoid (on specialist advice)', 'Some sexually transmitted infections', 'Skin infections'],
    precautions: ['Heart rhythm problems (long QT) or low potassium', 'Liver disease', 'Finish the course exactly as prescribed'],
    sideEffects: ['Diarrhoea, nausea, stomach pain', 'Abnormal heart rhythm (rare)'],
    interactions: ['Other medicines that prolong the QT interval', 'Antacids with aluminium or magnesium: take apart']
  },
  {
    name: 'Ciprofloxacin', category: 'Antibiotics', forms: ['Tablet 250 mg', 'Tablet 500 mg', 'Eye and ear drops', 'Infusion'],
    brands: [['Ciproxin', 'Bayer']], prescription: 'prescription',
    uses: ['Urinary tract infections', 'Gut infections, including typhoid on specialist advice', 'Bone and joint infections'],
    precautions: ['Stop and seek advice with tendon pain or swelling', 'Not usually for children or in pregnancy', 'Epilepsy, myasthenia gravis, heart rhythm problems'],
    sideEffects: ['Nausea, diarrhoea', 'Tendon damage', 'Sensitivity to sunlight', 'Dizziness'],
    interactions: ['Antacids, iron, zinc and calcium: take two hours apart', 'Theophylline', 'Warfarin']
  },
  {
    name: 'Metronidazole', category: 'Antibiotics', forms: ['Tablet 200 mg', 'Tablet 400 mg', 'Suspension', 'Infusion', 'Gel'],
    brands: [['Flagyl', 'Sanofi']], prescription: 'prescription',
    uses: ['Amoebic dysentery and giardiasis', 'Dental and gum infections', 'Bacterial vaginosis and trichomoniasis', 'Infections after surgery'],
    precautions: ['No alcohol during the course and for 48 hours after', 'Liver disease', 'Long courses can affect the nerves'],
    sideEffects: ['Metallic taste', 'Nausea', 'Dark urine'],
    interactions: ['Alcohol: severe sickness and flushing', 'Warfarin: INR rises', 'Lithium']
  },
  {
    name: 'Doxycycline', category: 'Antibiotics', forms: ['Capsule 100 mg'],
    brands: [['Vibramycin', 'Pfizer']], prescription: 'prescription',
    uses: ['Chest infections', 'Acne and rosacea', 'Some sexually transmitted infections', 'Malaria prevention (on advice)'],
    precautions: ['Swallow upright with plenty of water, not at bedtime', 'Not for children under 12 or in pregnancy', 'Avoid strong sunlight'],
    sideEffects: ['Heartburn, nausea', 'Sensitivity to sunlight', 'Irritation of the gullet if taken lying down'],
    interactions: ['Antacids, iron, zinc and calcium: take apart', 'Warfarin']
  },
  {
    name: 'Fluconazole', category: 'Antifungals', forms: ['Capsule 50 mg', 'Capsule 150 mg', 'Suspension'],
    brands: [['Diflucan', 'Pfizer']], prescription: 'prescription',
    uses: ['Vaginal thrush', 'Oral and throat thrush', 'Other fungal infections'],
    precautions: ['Liver or kidney disease', 'Heart rhythm problems', 'Pregnancy'],
    sideEffects: ['Headache', 'Nausea, stomach pain', 'Rash'],
    interactions: ['Warfarin', 'Some statins', 'Medicines that prolong the QT interval', 'Sulfonylureas: low blood sugar']
  },
  {
    name: 'Albendazole', category: 'Antiparasitics', forms: ['Tablet 400 mg', 'Suspension 200 mg/5 ml'],
    brands: [['Zentel', 'GSK']], prescription: 'otc',
    uses: ['Roundworm, hookworm, whipworm and threadworm', 'Some tapeworm infections (on specialist advice)'],
    precautions: ['Not in pregnancy', 'Longer courses need blood and liver checks'],
    sideEffects: ['Stomach pain, nausea', 'Headache, dizziness'],
    interactions: ['Some antiepileptic medicines lower its effect']
  },
  {
    name: 'Omeprazole', category: 'Stomach and gut', forms: ['Capsule 20 mg', 'Capsule 40 mg', 'Injection'],
    brands: [['Losec', 'AstraZeneca'], ['Risek', 'Getz Pharma']], prescription: 'otc',
    uses: ['Heartburn and acid reflux', 'Stomach and duodenal ulcers', 'Part of H. pylori treatment', 'Protecting the stomach when taking NSAIDs'],
    precautions: ['See a doctor with difficulty swallowing, weight loss or vomiting blood', 'Long-term use can lower magnesium and vitamin B12', 'Take before a meal'],
    sideEffects: ['Headache', 'Diarrhoea or constipation', 'Wind, stomach pain'],
    interactions: ['Clopidogrel: less effect', 'Methotrexate', 'Some HIV medicines']
  },
  {
    name: 'Esomeprazole', category: 'Stomach and gut', forms: ['Tablet 20 mg', 'Tablet 40 mg', 'Sachet'],
    brands: [['Nexium', 'AstraZeneca']], prescription: 'prescription',
    uses: ['Acid reflux and heartburn', 'Ulcers', 'Part of H. pylori treatment'],
    precautions: ['As for omeprazole: alarm symptoms need a doctor', 'Long-term use can lower magnesium'],
    sideEffects: ['Headache', 'Diarrhoea, constipation', 'Nausea'],
    interactions: ['Clopidogrel: less effect', 'Methotrexate']
  },
  {
    name: 'Domperidone', category: 'Nausea and vomiting', forms: ['Tablet 10 mg', 'Suspension 5 mg/5 ml'],
    brands: [['Motilium', 'Janssen']], prescription: 'prescription',
    uses: ['Nausea and vomiting, for the shortest time possible'],
    precautions: ['Heart rhythm problems or heart disease', 'Moderate to severe liver disease', 'Usually no longer than one week'],
    sideEffects: ['Dry mouth', 'Abnormal heart rhythm (rare, more likely over 60)'],
    interactions: ['Medicines that prolong the QT interval', 'Strong CYP3A4 inhibitors such as clarithromycin and ketoconazole']
  },
  {
    name: 'Ondansetron', category: 'Nausea and vomiting', forms: ['Tablet 4 mg', 'Tablet 8 mg', 'Syrup', 'Injection'],
    brands: [['Zofran', 'Novartis']], prescription: 'prescription',
    uses: ['Nausea and vomiting after surgery or with cancer treatment'],
    precautions: ['Heart rhythm problems', 'Liver disease', 'Bowel obstruction'],
    sideEffects: ['Headache', 'Constipation', 'Feeling warm or flushed'],
    interactions: ['Medicines that prolong the QT interval', 'Serotonergic medicines (serotonin syndrome, rare)']
  },
  {
    name: 'Loperamide', category: 'Stomach and gut', forms: ['Capsule 2 mg'],
    brands: [['Imodium', 'Kenvue (formerly Johnson & Johnson)']], prescription: 'otc',
    uses: ['Short-term diarrhoea in adults'],
    precautions: ['Not for children under 12 without advice', 'Not with blood in the stool or a high fever', 'Drink plenty of fluids; oral rehydration salts may be needed'],
    sideEffects: ['Constipation', 'Stomach cramps, bloating', 'Dizziness'],
    interactions: ['High doses with some heart and antifungal medicines can affect heart rhythm']
  },
  {
    name: 'Oral rehydration salts', synonyms: ['ORS'], category: 'Stomach and gut', forms: ['Sachet (low-osmolarity, WHO formula)'],
    brands: [], prescription: 'otc',
    uses: ['Replacing water and salts lost with diarrhoea or vomiting, in children and adults'],
    precautions: ['Mix with exactly the stated amount of clean water', 'Seek help for a baby, blood in the stool, or signs of severe dehydration', 'Kidney disease'],
    sideEffects: ['Vomiting if drunk too fast — give small, frequent sips'],
    interactions: []
  },
  {
    name: 'Metformin', category: 'Diabetes', forms: ['Tablet 500 mg', 'Tablet 850 mg', 'Tablet 1 g', 'Extended-release tablet'],
    brands: [['Glucophage', 'Merck']], prescription: 'prescription',
    uses: ['Type 2 diabetes', 'Polycystic ovary syndrome (on specialist advice)'],
    precautions: ['Take with meals', 'Kidney function must be checked; stop when very unwell or dehydrated', 'Stop before contrast X-rays and major surgery as advised', 'Avoid heavy alcohol'],
    sideEffects: ['Nausea, diarrhoea, stomach pain (usually settles)', 'Metallic taste', 'Low vitamin B12 with long use', 'Lactic acidosis (rare, serious)'],
    interactions: ['Iodinated contrast media', 'Alcohol']
  },
  {
    name: 'Gliclazide', category: 'Diabetes', forms: ['Tablet 80 mg', 'Modified-release tablet 30 mg', 'Modified-release tablet 60 mg'],
    brands: [['Diamicron', 'Servier']], prescription: 'prescription',
    uses: ['Type 2 diabetes'],
    precautions: ['Risk of low blood sugar, especially if a meal is missed', 'Kidney or liver disease', 'Take care when fasting, including in Ramadan — seek advice'],
    sideEffects: ['Low blood sugar (shaking, sweating, confusion)', 'Weight gain', 'Stomach upset'],
    interactions: ['Fluconazole and some antibiotics: low blood sugar', 'Beta-blockers can mask the warning signs', 'Alcohol']
  },
  {
    name: 'Glibenclamide', synonyms: ['Glyburide'], category: 'Diabetes', forms: ['Tablet 5 mg'],
    brands: [['Daonil', 'Sanofi']], prescription: 'prescription',
    uses: ['Type 2 diabetes'],
    precautions: ['Higher risk of prolonged low blood sugar than other sulfonylureas, especially in older people', 'Kidney or liver disease', 'Fasting'],
    sideEffects: ['Low blood sugar', 'Weight gain', 'Stomach upset'],
    interactions: ['Fluconazole, some antibiotics: low blood sugar', 'Beta-blockers', 'Alcohol']
  },
  {
    name: 'Sitagliptin', category: 'Diabetes', forms: ['Tablet 50 mg', 'Tablet 100 mg', 'With metformin'],
    brands: [['Januvia', 'MSD']], prescription: 'prescription',
    uses: ['Type 2 diabetes, alone or with other diabetes medicines'],
    precautions: ['Kidney disease (lower dose)', 'Stop and seek help with severe, persistent stomach pain (pancreatitis)', 'History of pancreatitis'],
    sideEffects: ['Headache', 'Cold-like symptoms', 'Low blood sugar when combined with sulfonylureas or insulin'],
    interactions: ['Sulfonylureas and insulin: more low blood sugar']
  },
  {
    name: 'Amlodipine', category: 'Heart and blood pressure', forms: ['Tablet 5 mg', 'Tablet 10 mg'],
    brands: [['Norvasc', 'Pfizer']], prescription: 'prescription',
    uses: ['High blood pressure', 'Angina'],
    precautions: ['Severe aortic stenosis or very low blood pressure', 'Liver disease'],
    sideEffects: ['Ankle swelling', 'Flushing, headache', 'Dizziness'],
    interactions: ['Simvastatin: keep the simvastatin dose low', 'Grapefruit juice', 'Other blood pressure medicines']
  },
  {
    name: 'Losartan', category: 'Heart and blood pressure', forms: ['Tablet 25 mg', 'Tablet 50 mg', 'Tablet 100 mg', 'With hydrochlorothiazide'],
    brands: [['Cozaar', 'Organon (formerly MSD)']], prescription: 'prescription',
    uses: ['High blood pressure', 'Kidney protection in type 2 diabetes', 'Heart failure'],
    precautions: ['Must not be taken in pregnancy', 'Kidney function and potassium need checking', 'Dehydration'],
    sideEffects: ['Dizziness', 'High potassium', 'Changes in kidney function'],
    interactions: ['Potassium supplements and salt substitutes', 'NSAIDs: less effect, kidney strain', 'ACE inhibitors and aliskiren']
  },
  {
    name: 'Atorvastatin', category: 'Cholesterol', forms: ['Tablet 10 mg', 'Tablet 20 mg', 'Tablet 40 mg', 'Tablet 80 mg'],
    brands: [['Lipitor', 'Pfizer']], prescription: 'prescription',
    uses: ['High cholesterol', 'Preventing heart attack and stroke'],
    precautions: ['Report unexplained muscle pain, tenderness or weakness', 'Liver disease', 'Not in pregnancy or while breastfeeding'],
    sideEffects: ['Muscle aches', 'Headache', 'Stomach upset', 'Raised liver enzymes'],
    interactions: ['Clarithromycin and some antifungals and HIV medicines: higher levels', 'Large amounts of grapefruit juice']
  },
  {
    name: 'Clopidogrel', category: 'Blood thinners', forms: ['Tablet 75 mg'],
    brands: [['Plavix', 'Sanofi']], prescription: 'prescription',
    uses: ['Preventing heart attack and stroke after one, or after a stent'],
    precautions: ['Never stop without asking the cardiologist, especially after a stent', 'Tell the dentist or surgeon', 'Active bleeding'],
    sideEffects: ['Bleeding and bruising', 'Diarrhoea, indigestion'],
    interactions: ['Omeprazole and esomeprazole: less effect', 'NSAIDs and other blood thinners: more bleeding']
  },
  {
    name: 'Cetirizine', category: 'Allergy', forms: ['Tablet 10 mg', 'Syrup 5 mg/5 ml'],
    brands: [['Zyrtec', 'UCB']], prescription: 'otc',
    uses: ['Hay fever and allergic rhinitis', 'Itchy rash and hives', 'Allergic itching'],
    precautions: ['Kidney disease (lower dose)', 'Can cause drowsiness in some people — care when driving'],
    sideEffects: ['Drowsiness', 'Dry mouth', 'Headache'],
    interactions: ['Alcohol and other sedating medicines']
  },
  {
    name: 'Loratadine', category: 'Allergy', forms: ['Tablet 10 mg', 'Syrup 5 mg/5 ml'],
    brands: [['Claritin', 'Bayer']], prescription: 'otc',
    uses: ['Hay fever', 'Hives and itchy skin'],
    precautions: ['Severe liver disease'],
    sideEffects: ['Headache', 'Tiredness (uncommon)', 'Dry mouth'],
    interactions: []
  },
  {
    name: 'Montelukast', category: 'Breathing', forms: ['Tablet 10 mg', 'Chewable tablet 4 mg', 'Chewable tablet 5 mg', 'Granules'],
    brands: [['Singulair', 'Organon (formerly MSD)']], prescription: 'prescription',
    uses: ['Preventing asthma symptoms', 'Exercise-induced asthma', 'Allergic rhinitis in people with asthma'],
    precautions: ['Not for an acute asthma attack', 'Watch for mood changes, bad dreams or sleep problems, especially in children'],
    sideEffects: ['Headache', 'Stomach pain', 'Mood and sleep changes'],
    interactions: ['Phenobarbital and rifampicin can lower its effect']
  },
  {
    name: 'Salbutamol', synonyms: ['Albuterol'], category: 'Breathing', forms: ['Inhaler 100 micrograms per puff', 'Nebuliser solution', 'Syrup', 'Tablet'],
    brands: [['Ventolin', 'GSK']], prescription: 'prescription',
    uses: ['Quick relief of asthma and COPD symptoms', 'Before exercise for exercise-induced asthma'],
    precautions: ['Needing it more than usual means asthma is poorly controlled — see a doctor', 'Overactive thyroid, heart disease'],
    sideEffects: ['Shaky hands', 'Fast heartbeat', 'Headache', 'Low potassium at high doses'],
    interactions: ['Non-selective beta-blockers such as propranolol', 'Diuretics and steroids: low potassium']
  },
  {
    name: 'Levothyroxine', synonyms: ['Thyroxine'], category: 'Thyroid', forms: ['Tablet 25 micrograms', 'Tablet 50 micrograms', 'Tablet 100 micrograms'],
    brands: [['Euthyrox', 'Merck']], prescription: 'prescription',
    uses: ['Underactive thyroid (hypothyroidism)'],
    precautions: ['Take on an empty stomach, 30 to 60 minutes before breakfast', 'Heart disease: start low', 'Regular blood tests to adjust the dose'],
    sideEffects: ['Signs of too high a dose: palpitations, sweating, weight loss, poor sleep'],
    interactions: ['Calcium, iron and antacids: take four hours apart', 'Warfarin: effect may change']
  },
  {
    name: 'Prednisolone', category: 'Steroids', forms: ['Tablet 5 mg', 'Soluble tablet', 'Syrup'],
    brands: [['Deltacortril', 'Pfizer']], prescription: 'prescription',
    uses: ['Asthma and COPD flare-ups', 'Severe allergies', 'Inflammatory conditions such as arthritis and bowel disease'],
    precautions: ['Do not stop suddenly after more than a few weeks', 'Take in the morning with food', 'Raises blood sugar; care in diabetes', 'Avoid contact with chickenpox and measles if not immune'],
    sideEffects: ['Increased appetite, weight gain', 'Mood changes, poor sleep', 'Raised blood sugar and blood pressure', 'Thinning bones with long use'],
    interactions: ['NSAIDs: stomach ulcers', 'Diabetes medicines: less effect', 'Live vaccines']
  },
  {
    name: 'Folic acid', category: 'Vitamins and minerals', forms: ['Tablet 400 micrograms', 'Tablet 5 mg'],
    brands: [], prescription: 'otc',
    uses: ['Before and in early pregnancy, to lower the risk of neural tube defects', 'Folate-deficiency anaemia'],
    precautions: ['Vitamin B12 deficiency must be ruled out before treating anaemia'],
    sideEffects: ['Rare: stomach upset'],
    interactions: ['Some antiepileptic medicines', 'Methotrexate']
  }
];

/** The starter set as directory entries, ready to store. */
export function starterFields(): DirectoryFields[] {
  return DIRECTORY_SEED.map((seed) => ({
    name: seed.name, name_key: nameKey(seed.name), synonyms: seed.synonyms ?? [], category: seed.category, forms: seed.forms,
    brands: seed.brands.map(([name, manufacturer]) => ({ name, manufacturer })), prescription: seed.prescription,
    uses: seed.uses, precautions: seed.precautions, side_effects: seed.sideEffects, interactions: seed.interactions ?? [],
    references: starterReferences(seed.name), status: 'published'
  }));
}
