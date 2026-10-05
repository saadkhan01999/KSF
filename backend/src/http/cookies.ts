/* Cookie helpers. Two cookies only:

     refresh   HttpOnly, SameSite=Strict, Path=/api/v1/auth — the browser
               sends it to the sign-in endpoints and nowhere else
     device    HttpOnly, SameSite=Lax, a long life — it is what makes a till a
               known machine rather than a new one every morning
*/

import { env } from '../config/env.js';

function serialise(name: string, value: string, { maxAge, path = '/', sameSite = 'Lax' }: { maxAge: number; path?: string; sameSite?: 'Strict' | 'Lax' }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${Math.round(maxAge)}`];
  if (env.COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

export const AUTH_COOKIE_PATH = '/api/v1/auth';

export const refreshCookie = (token: string): string =>
  serialise(env.REFRESH_COOKIE_NAME, token, { maxAge: env.JWT_REFRESH_DAYS * 86_400, path: AUTH_COOKIE_PATH, sameSite: 'Strict' });

export const clearRefreshCookie = (): string =>
  serialise(env.REFRESH_COOKIE_NAME, '', { maxAge: 0, path: AUTH_COOKIE_PATH, sameSite: 'Strict' });

export const deviceCookie = (value: string): string =>
  serialise(env.DEVICE_COOKIE_NAME, value, { maxAge: 400 * 86_400 });
