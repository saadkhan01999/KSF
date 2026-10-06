/* Which platform notices a person sees, and which of those they have read.

   The Super Admin sees every platform notice except one addressed to
   somebody else. A team member sees the notices addressed to them, and the
   ones whose audience is a permission their role holds. Each person reads
   their own copy: one member opening a notice does not clear it for the
   rest of the desk. (Notices from before the team existed carry is_read and
   no audience, so they stay the Super Admin's, read or not as they were.) */

import type { Filter } from 'mongodb';
import type { Notification } from '../db/types.js';

export interface NoticeReader {
  userId: string;
  isPlatformAdmin: boolean;
  platformPermissions: ReadonlySet<string>;
}

export function platformNotices(who: NoticeReader): Filter<Notification> {
  if (who.isPlatformAdmin) return { pharmacy_id: null, user_id: { $in: [null, who.userId] } };
  return {
    pharmacy_id: null,
    $or: [{ user_id: who.userId }, { user_id: null, audience: { $in: [...who.platformPermissions] } }]
  };
}

export const unreadBy = (userId: string): Filter<Notification> => ({ is_read: 0, read_by: { $ne: userId } });

export const unreadPlatformNotices = (who: NoticeReader): Filter<Notification> =>
  ({ $and: [platformNotices(who), unreadBy(who.userId)] });

/** A notice as this person sees it: read or not for them, nobody else's reads. */
export function asRead(row: Notification, userId: string): Omit<Notification, 'read_by' | 'audience'> {
  const { read_by: readBy, audience: _audience, ...rest } = row;
  return { ...rest, is_read: row.is_read || (readBy ?? []).includes(userId) ? 1 : 0 };
}
