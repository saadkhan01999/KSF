/* ==========================================================================
   Request safety
   --------------------------------------------------------------------------
   Checks applied to every request before a handler sees it. Handlers already
   turn each field into a plain string or number (toStr, toInt) before it
   reaches a query; these are the second line, so a handler that forgets
   cannot be talked into running a database operator or reshaping an object.

     - unsafeKey: a JSON body may not carry a key that MongoDB reads as an
       operator ($gt, $where, $set …) or one that reshapes a JavaScript
       object's prototype (__proto__, constructor, prototype), and may not
       nest absurdly deep.
     - bodyLimitFor: 2 MB for a request body, except the two file imports.
     - isSafeRedirect: a redirect may only lead back into this application.
   ========================================================================== */

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;

/** The first key in a parsed body that is not allowed, or null when there is none. */
export function unsafeKey(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return '(nested too deeply)';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = unsafeKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || PROTOTYPE_KEYS.has(key)) return key;
      const found = unsafeKey((value as Record<string, unknown>)[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/* The two endpoints that carry a whole spreadsheet (as base64); the import
   itself refuses a file over 9 MB. Everything else is a form or a list. */
const LARGE_BODY_PATHS = new Set(['/api/v1/migration/jobs', '/api/v1/platform/medicine-directory/import']);

export const bodyLimitFor = (path: string): '12mb' | '2mb' => (LARGE_BODY_PATHS.has(path) ? '12mb' : '2mb');

/**
 * Only a path in this application ("/settings?tab=billing", never "//evil"
 * or "/\evil"), or an absolute address whose origin is exactly the
 * application's own — "https://ksf.example.pk.evil.com" starts with the
 * application's address but is somebody else's site.
 */
export function isSafeRedirect(target: string, appUrl: string): boolean {
  /* Browsers drop tabs and line breaks from an address: "/<tab>/evil" is "//evil". */
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(target)) return false;
  if (/^\/(?![/\\])/.test(target)) return true;
  try {
    const wanted = new URL(target);
    const own = new URL(appUrl);
    return (wanted.protocol === 'https:' || wanted.protocol === 'http:') && wanted.origin === own.origin;
  } catch {
    return false;
  }
}
