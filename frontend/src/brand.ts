/* ==========================================================================
   The product identity, in one place.
   --------------------------------------------------------------------------
   What is here: facts about the software. The name, the strapline, the
   positioning line, the release number. They are the same on every
   installation and they are the same in the browser tab, the sidebar, the
   sign-in screen, the marketing pages and the footer, because every one of
   those reads them from this object.

   What is NOT here: anything about the business selling it — the legal name,
   the address, the telephone number, the support address, the NTN. Those are
   configuration, they differ per deployment, and they come from the server
   through services/business.ts. The mark itself is documented in
   docs/BRAND_GUIDE.md.
   ========================================================================== */

export const BRAND = {
  /** What people call it, and what the wordmark says. */
  name: 'KSF',
  /** The full title: browser tab, manifest, invoices, letterheads. */
  fullName: 'KSF Pharmacy Management System',
  /** Under the wordmark. Kept short — it sits at 8-9px in the sidebar. */
  strapline: 'PHARMACY SYSTEM',
  /** One line, for the tab title and the marketing meta description. */
  tagline: 'Pharmacy management, built for Pakistan',
  version: '2.3.0'
} as const;

/** "KSF 2.3.0" — the string the footer, About and Settings all show. */
export const versionLabel = `${BRAND.name} ${BRAND.version}`;
