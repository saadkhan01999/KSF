/* ==========================================================================
   Who is selling this installation.
   --------------------------------------------------------------------------
   The product's own identity — the name KSF, the strapline, the version — is
   fixed and lives in brand.ts. The *business* details are configuration: the
   legal name, the address, the telephone number, the support address, the
   NTN. They come from the server, which reads them from the environment, so a
   deployment sets them without a rebuild.

   Every field can be empty, and the components that use them print nothing
   when they are: a published number nobody answers is worse than no number
   at all.

   Fetched once per page load and cached, because it is small, public and the
   same for every visitor.
   ========================================================================== */

import { useEffect, useState } from 'react';

export interface Business {
  legalName: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  whatsapp: string;
  supportEmail: string;
  salesEmail: string;
  website: string;
  ntn: string;
  strn: string;
  supportHours: string;
}

export const EMPTY_BUSINESS: Business = {
  legalName: '', address: '', city: '', country: '', phone: '', whatsapp: '',
  supportEmail: '', salesEmail: '', website: '', ntn: '', strn: '', supportHours: ''
};

let cache: Business | null = null;
let inFlight: Promise<Business> | null = null;

export function loadBusiness(): Promise<Business> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = fetch('/api/v1/public/brand')
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { business?: Partial<Business> } | null) => {
      cache = { ...EMPTY_BUSINESS, ...(body?.business ?? {}) };
      return cache;
    })
    .catch(() => {
      /* A footer without contact details is a smaller problem than a page
         that fails to render, so an unreachable endpoint is not an error. */
      cache = EMPTY_BUSINESS;
      return cache;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

/** The configured business details, or blanks until they arrive. */
export function useBusiness(): Business {
  const [business, setBusiness] = useState<Business>(cache ?? EMPTY_BUSINESS);

  useEffect(() => {
    let live = true;
    void loadBusiness().then((value) => { if (live) setBusiness(value); });
    return () => { live = false; };
  }, []);

  return business;
}

/** "Karachi, Pakistan" from whichever parts are configured, or ''. */
export const placeOf = (business: Business): string =>
  [business.city, business.country].filter(Boolean).join(', ');
