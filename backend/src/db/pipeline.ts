/* Small aggregation-pipeline builders used across the reports and lists. */

import type { Document } from 'mongodb';

/** Pull one field from another collection by id: e.g. a user's name. */
export function lookupField(from: string, localField: string, field: string, as: string): Document[] {
  return [
    { $lookup: { from, localField, foreignField: '_id', as: `__${as}`, pipeline: [{ $project: { [field]: 1 } }] } },
    { $set: { [as]: { $ifNull: [{ $first: `$__${as}.${field}` }, null] } } },
    { $unset: `__${as}` }
  ];
}

/** $match + $count as one number. */
export const countStage = (): Document[] => [{ $count: 'n' }];

/** Sum of a field, zero when nothing matches. */
export const sumOf = (expression: unknown, when?: unknown): Document =>
  when === undefined ? { $sum: expression } : { $sum: { $cond: [when, expression, 0] } };

/** The YYYY-MM-DD part of an ISO timestamp field. */
export const dayOf = (field: string): Document => ({ $substrBytes: [`$${field}`, 0, 10] });

/** The YYYY-MM part of an ISO timestamp field. */
export const monthOf = (field: string): Document => ({ $substrBytes: [`$${field}`, 0, 7] });
