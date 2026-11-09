/* Copy shared by the public pages.

   Kept out of the components so the same plan summary and the same answers
   appear on the landing page, the pricing page and the subscription page
   without being written three times and drifting apart. */

/* Feature keys are what the server enforces; these are what a person reads. */
export const FEATURE_NAMES: Record<string, string> = {
  'pos.core': 'Point of sale and invoicing',
  'inventory.batches': 'Batch and expiry control',
  'inventory.multi_branch': 'Stock across several branches',
  'reports.core': 'Daily and monthly summaries',
  'reports.advanced': 'Profitability, supplier and staff analytics',
  'reports.export': 'Export any report to CSV',
  'messaging.internal': 'Internal messaging between roles',
  'staff.roles': 'Custom roles and permissions',
  'migration.import': 'Import data from your old system',
  'backup.scheduled': 'Scheduled encrypted backups',
  'devices.extra': 'Additional registered devices',
  'support.priority': 'Priority support'
};

export interface Question {
  q: string;
  a: string;
}

export const FAQ: Question[] = [
  {
    q: 'What happens to my data if I stop paying?',
    a: 'Nothing is deleted. Every medicine, batch, sale, purchase and prescription stays exactly where it was, and you can still look at it and export it. Changing records waits until a plan is paid for, and then everything carries on where it stopped. If a renewal fails you also get a grace period first, and we tell you before anything changes.'
  },
  {
    q: 'Do I have to pay to start?',
    a: 'No. Every pharmacy starts on the Demo plan: fifteen days free, with complete access, every feature and unlimited data. No card is asked for. When the fifteen days are up you choose Pro or Diamond Annual — and the days you had left are never lost when you pay early.'
  },
  {
    q: 'Can I move my existing records into KSF?',
    a: 'Yes. Export what your current system holds as CSV, Excel or JSON and KSF will read it, match the columns for you, and show you exactly what it found before writing anything. Rows it cannot read are listed with the reason so you can correct or skip them — none are ever silently discarded. A backup is taken first and the whole import can be rolled back.'
  },
  {
    q: 'How many computers can use one account?',
    a: 'Three computers and three phones or tablets per person, on every plan — enough for the counter, the back office and home, and few enough that one password cannot be passed round a whole market. The pharmacy Admin can remove an old device at any time; KSF asks for the password first. Staff accounts are unlimited.'
  },
  {
    q: 'Does it work without the internet?',
    a: 'KSF runs on a computer in your own shop, so the till keeps working whether or not the connection is up. You only need the internet to reach it from somewhere else, or to take a payment for the subscription.'
  },
  {
    q: 'Is my prescription data safe?',
    a: 'Prescription records never leave your installation. There is no advertising, no analytics service and no third party in the application at all. Passwords are stored only as a memory-hard hash, sensitive actions are recorded in a tamper-evident audit trail, and you can export or delete everything yourself.'
  },
  {
    q: 'Can I change plan later?',
    a: 'Yes. Monthly is a starter plan for your first three months; Yearly can be chosen at any time, and it starts where your current plan ends, so no paid day is lost. Cancelling stops the renewal and you keep the plan until the period you already paid for runs out.'
  },
  {
    q: 'What if two people need the till at once?',
    a: 'Give each of them their own account. KSF records who served every sale, which is the point — a shared login tells you nothing when the cash is short at closing. Staff accounts are unlimited on every plan.'
  },
  {
    q: 'Do you support Easypaisa and JazzCash?',
    a: 'Yes, as payment methods on a sale, alongside cash, card and udhaar (credit). The day\'s takings are broken down by method so the drawer can be reconciled properly.'
  },
  {
    q: 'What happens when a medicine expires?',
    a: 'It is flagged ninety days out on the dashboard, and the day it passes its date the till refuses to sell it — not a warning, a refusal. You can quarantine the batch, write it off, and keep the record for the supplier credit note.'
  },
  {
    q: 'Can I try it before deciding?',
    a: 'Yes. Open an account — it takes two minutes — and you have fifteen days of the full system, free. With a referral code from another pharmacy, Monthly then costs Rs 1,300 instead of Rs 1,500. Nothing is charged until you choose a plan and pay for it.'
  },
  {
    q: 'Who can see the reports?',
    a: 'Whoever you say. Every screen is behind a permission, and you can build a role that sees the money screens and nothing else, or the stock screens and nothing else. A cashier sees their own sales, not the pharmacy\'s margins.'
  }
];

export const FEATURE_SECTIONS = [
  {
    id: 'pos',
    title: 'Point of sale',
    lede: 'The screen your counter staff live on. It has to be fast, it has to be obvious, and it must not let anybody sell something they should not.',
    items: [
      ['Search or scan', 'Type three letters of a brand or generic name, or scan the barcode. The list narrows as you type and never makes you wait.'],
      ['First-expiry-first-out', 'The till takes stock from the batch that expires soonest, automatically. Nobody has to remember.'],
      ['Prescription-only medicines', 'A prescription-only item cannot be added to a sale without a prescription a pharmacist has verified. The refusal names the medicine.'],
      ['Cash, card, Easypaisa, JazzCash, udhaar', 'Change is calculated, credit goes on the customer\'s balance, and the day\'s takings break down by method.'],
      ['Refunds with a reason', 'A refund puts the stock back if the batch is still in date, quarantines it if not, and records who authorised it and why.'],
      ['Hold and resume', 'Put a sale aside when somebody goes back for another item, and pick it up again without retyping.']
    ]
  },
  {
    id: 'inventory',
    title: 'Inventory and batches',
    lede: 'Stock is held per batch, because a pharmacy that only knows it has "forty Panadol" does not know which forty.',
    items: [
      ['Batch numbers and expiry dates', 'Recorded when stock arrives, carried through every sale, and printed on the receipt.'],
      ['Adjustments with a reason', 'Correct a count, record breakage or a theft — with a note, an author and a timestamp on every change.'],
      ['A ledger that explains itself', 'Every movement in and out, with what caused it. The number on the screen can always be accounted for.'],
      ['Reorder levels', 'Set per medicine. What has fallen below is on the dashboard the moment you sign in.'],
      ['Stock valuation', 'At cost and at retail, by category, so you know what is on the shelves in rupees.']
    ]
  },
  {
    id: 'expiry',
    title: 'Expiry control',
    lede: 'The most expensive thing in a pharmacy is stock that quietly went out of date on the shelf.',
    items: [
      ['Ninety days of warning', 'Near-expiry batches appear on the dashboard and in their own screen, oldest first, with what they are worth.'],
      ['A hard block, not a warning', 'The day a batch passes its date the till will not sell it. There is no override on the counter.'],
      ['Quarantine in one click', 'Move every expired batch off the shelf in the system as well as physically, with a note.'],
      ['Write off, with the paperwork', 'Record the loss against the supplier so the credit note can be chased.']
    ]
  },
  {
    id: 'people',
    title: 'Staff, roles and messaging',
    lede: 'Six roles ship ready to use, and you can build any other role by ticking what it may do.',
    items: [
      ['Owner, admin, regional manager, manager, pharmacist, cashier', 'Sensible defaults that match how a pharmacy is actually staffed.'],
      ['Custom roles', 'Tick permissions to build a stock controller, a night cashier, an accountant who only sees money screens.'],
      ['Nobody promotes themselves', 'You cannot grant a permission you do not hold, or act on somebody at or above your own level.'],
      ['Messaging inside the system', 'Address one person, a whole role, or everybody. Somebody promoted into Pharmacist tomorrow joins the Pharmacist threads still open.'],
      ['A full activity trail', 'Who did what, from where, and when — exportable, and readable by anyone you give audit access to.']
    ]
  },
  {
    id: 'migration',
    title: 'Bringing your data across',
    lede: 'A pharmacy that has been trading for years does not retype its catalogue. Export it, and KSF reads it.',
    items: [
      ['CSV, Excel and JSON', 'Excel files are read directly — no converting, no saving as something else first.'],
      ['Columns matched for you', 'KSF recognises what old systems call things: "Trade Price" is cost, "MRP" is retail, "Salt" is the generic name. Change any of it by hand.'],
      ['Validated before anything is written', 'Missing names, impossible prices, dates that are not dates, duplicates, batches for medicines you do not have — all found and listed.'],
      ['Nothing is silently discarded', 'Every row that cannot be imported is kept with the reason. Correct it, skip it, or merge it into the record you already have.'],
      ['A backup first, a rollback after', 'The affected table is copied before the import starts, and the whole job can be undone — removing exactly what it created and nothing else.']
    ]
  },
  {
    id: 'security',
    title: 'Security and privacy',
    lede: 'A pharmacy holds prescription records. KSF is built as though somebody will eventually try to reach them.',
    items: [
      ['Modern password hashing', 'Memory-hard, salted, and never reversible. An older hash is upgraded silently the next time that person signs in.'],
      ['Two-factor authentication', 'An authenticator app plus ten printed recovery codes. Required again before any security setting is changed.'],
      ['Registered devices', 'Only machines you have registered may sign in. Removing one signs it out everywhere and needs your password.'],
      ['Sessions you can see and end', 'Where you are signed in, from what, and when. End one, or all of them, from anywhere.'],
      ['A tamper-evident audit trail', 'Sensitive actions are hash-chained. Altering a record directly in the database breaks the chain, and KSF names the entry.'],
      ['No tracking of any kind', 'No fingerprinting, no analytics, no advertising, no third-party scripts. The application cannot send your data anywhere.']
    ]
  }
];

/* ==========================================================================
   Pricing page copy
   --------------------------------------------------------------------------
   Kept here rather than in Pricing.tsx so the wording can be changed without
   touching a component, and so the same sentences can be quoted on the
   in-app Billing screen. Prices themselves are never in this file — they come
   from the subscription_plans table.
   ========================================================================== */

/** What the free trial is, and — more usefully — what happens when it ends. */
export const TRIAL_POINTS: string[] = [
  'It starts when you confirm your e-mail address, with complete access, every feature and unlimited data.',
  'No card is asked for, and nothing is charged when the trial ends.',
  'Choose Pro or Diamond Annual whenever you are ready: the plan starts where the trial ends, so no free day is lost.',
  'One trial per account, ever — it cannot be restarted by registering again.',
  'When it ends, every medicine, batch, sale and prescription stays exactly where it is. Choose a plan and carry on.'
];

/** How renewal actually works here. Written plainly because this is the part
    people are most often surprised by on other products. */
export const RENEWAL_POINTS: string[] = [
  'A paid plan renews automatically at the end of its period, so the till does not stop mid-shift.',
  'You are told before it renews, and the renewal is only ever recorded after the payment provider confirms it on the server.',
  'Cancelling stops the next renewal. You keep the plan until the period you have already paid for runs out.',
  'If a payment fails there is a grace period first, and a warning, before anything changes.',
  'A refused payment never deletes anything. The worst case is a pause on changes until a plan is paid for, with all of your records intact.'
];

/** The conditions in short sentences, so nobody has to read a contract to
    understand what they are agreeing to. */
export const SUBSCRIPTION_TERMS: { title: string; body: string }[] = [
  {
    title: 'Every plan is the whole system',
    body: 'Demo, Pro and Diamond Annual all include every feature and unlimited records. The plans differ in how long they run and what they cost — never in what your pharmacy can do.'
  },
  {
    title: 'Monthly is a starter plan',
    body: 'It is paid month by month for up to three months — Rs 1,300 a month through a referral, Rs 1,500 without one. After that, Yearly carries on at about Rs 1,000 a month.'
  },
  {
    title: 'Prices are in Pakistani rupees',
    body: 'They exclude any tax that applies to your business. The amount you are charged is always shown before you confirm anything.'
  },
  {
    title: 'Changing plan',
    body: 'A new plan starts when its payment clears, at the end of the days you already have. Nothing is charged twice and nothing is lost.'
  },
  {
    title: 'Your data is yours',
    body: 'Export everything, at any time, from the Security Centre. Nothing is held back to make leaving harder.'
  },
  {
    title: 'One subscription, one pharmacy',
    body: 'Device and staff allowances are per plan and shown on every card. The owner can see and remove registered devices at any time.'
  }
];
