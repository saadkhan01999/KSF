/* ==========================================================================
   Profile photos
   --------------------------------------------------------------------------
   The browser shrinks a photo to a small square JPEG before it is sent, so
   what arrives is a data: URL of a few dozen kilobytes. Here it is checked,
   by its bytes and not by what it claims to be, stored in the database —
   a hosted container's disk is wiped on every deploy — and served back at
   /api/v1/avatars/<id>.

   The id is random and a new photo always gets a new one. That is what lets
   the image be cached for a year, and it means the address of a photo
   cannot be guessed from the person it belongs to.
   ========================================================================== */

import type { Response } from 'express';
import { Binary } from 'mongodb';
import { col } from '../db/mongo.js';
import type { Avatar } from '../db/types.js';
import { bad } from '../core/errors.js';
import { nowIso } from '../core/util.js';
import { secret } from '../security/crypto.js';

/** Plenty for a 512px JPEG; a full-size camera photo is refused, not stored. */
export const AVATAR_MAX_BYTES = 300 * 1024;

type ImageType = Avatar['content_type'];

/* What each format's first bytes must be. A file renamed to .jpg, or an SVG
   (which can carry script), never matches. */
const SIGNATURES: Array<{ type: ImageType; matches: (bytes: Buffer) => boolean }> = [
  { type: 'image/jpeg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', matches: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' }
];

/** Read a data: URL into image bytes, or explain what is wrong with it. */
export function readImage(input: unknown): { type: ImageType; bytes: Buffer } {
  const text = typeof input === 'string' ? input : '';
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(text);
  if (!match) return bad('Choose a JPEG, PNG or WebP photo.', 'image');
  /* Measured before decoding, so an enormous string costs nothing to refuse. */
  if (match[2].length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 8) return bad('That photo is too large. Choose one under 300 KB.', 'image');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES) return bad('That photo is too large. Choose one under 300 KB.', 'image');
  const actual = SIGNATURES.find((signature) => signature.matches(bytes))?.type;
  if (!actual) return bad('That file is not a JPEG, PNG or WebP photo.', 'image');
  return { type: actual, bytes };
}

export const avatarUrl = (avatarId: string | null | undefined): string | null =>
  avatarId ? `/api/v1/avatars/${avatarId}` : null;

/** Give a person a new photo, retiring the old one. Returns the new id. */
export async function replaceAvatar(userId: string, input: unknown): Promise<string> {
  const image = readImage(input);
  const id = `AV${secret(18)}`;
  await col.avatars().insertOne({
    _id: id, id, user_id: userId, content_type: image.type, bytes: image.bytes.length,
    data: new Binary(image.bytes) as unknown as Buffer, created_at: nowIso()
  });
  await col.users().updateOne({ _id: userId }, { $set: { avatar_id: id, updated_at: nowIso() } });
  await col.avatars().deleteMany({ user_id: userId, _id: { $ne: id } });
  return id;
}

export async function removeAvatar(userId: string): Promise<void> {
  await col.users().updateOne({ _id: userId }, { $set: { avatar_id: null, updated_at: nowIso() } });
  await col.avatars().deleteMany({ user_id: userId });
}

/** GET /api/v1/avatars/:id — the image itself, or a 404. */
export async function sendAvatar(id: string, res: Response): Promise<void> {
  const avatar = /^AV[A-Za-z0-9_-]{20,40}$/.test(id) ? await col.avatars().findOne({ _id: id }) : null;
  if (!avatar) {
    res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Not found');
    return;
  }
  const data = avatar.data as unknown as Binary | Buffer;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from((data as Binary).buffer);
  res.status(200).set({
    'Content-Type': avatar.content_type,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Disposition': 'inline',
    /* Belt and braces: even opened on its own, an image can run nothing. */
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin'
  }).send(bytes);
}
