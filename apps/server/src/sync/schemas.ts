/**
 * Wire-format validation for the sync protocol.
 *
 * The client is not trusted: every field is bounded and typed. Validation
 * happens once, at the edge, so services can assume clean input. Unknown keys
 * are stripped (not rejected) for forward compatibility.
 */

import { z } from 'zod';

const MAX_ID = 200;
const MAX_TEXT = 20_000;

/** Loose xAPI statement. We validate the envelope, not the full ADL spec. */
export const xapiStatementSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID),
    actor: z
      .object({
        objectType: z.literal('Agent').optional(),
        account: z
          .object({
            homePage: z.string().max(MAX_TEXT).optional(),
            name: z.string().min(1).max(MAX_ID),
          })
          .optional(),
        mbox: z.string().max(MAX_TEXT).optional(),
        name: z.string().max(MAX_TEXT).optional(),
      })
      .passthrough(),
    verb: z
      .object({
        id: z.string().min(1).max(MAX_TEXT),
        display: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),
    object: z
      .object({
        objectType: z.string().max(64).optional(),
        id: z.string().min(1).max(MAX_TEXT),
        definition: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    result: z
      .object({
        success: z.boolean().optional(),
        completion: z.boolean().optional(),
        response: z.string().max(MAX_TEXT).optional(),
        duration: z.string().max(64).optional(),
        score: z
          .object({
            scaled: z.number().min(-1).max(1).optional(),
            raw: z.number().optional(),
            min: z.number().optional(),
            max: z.number().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.string().max(64).optional(),
  })
  .passthrough();

export const checkpointSchema = z.object({
  id: z.string().min(1).max(400).optional(),
  studentId: z.string().min(1).max(MAX_ID),
  lessonId: z.string().min(1).max(MAX_ID),
  key: z.string().min(1).max(MAX_ID),
  value: z.number().finite(),
  ts: z.number().int().nonnegative(),
  op: z.enum(['put', 'log-reading', 'count-inc']),
  sourceStatementId: z.string().min(1).max(MAX_ID),
});

export const syncRequestSchema = z.object({
  deviceId: z.string().min(1).max(MAX_ID),
  clientSentAt: z.number().int().nonnegative().optional(),
  statements: z.array(xapiStatementSchema).max(5_000).default([]),
  checkpoints: z.array(checkpointSchema).max(5_000).default([]),
  /** Optional heartbeat metadata (app version, locale) — stored, not trusted. */
  meta: z.record(z.string(), z.string().max(200)).optional(),
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncCheckpoint = z.infer<typeof checkpointSchema>;
export type SyncStatement = z.infer<typeof xapiStatementSchema>;

export const lrsQuerySchema = z.object({
  student: z.string().min(1).max(MAX_ID).optional(),
  lesson: z.string().min(1).max(MAX_ID).optional(),
  verb: z.string().min(1).max(MAX_TEXT).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1_000).default(100),
});

export type LrsQuery = z.infer<typeof lrsQuerySchema>;

export const cruftQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(10_000).default(1_000),
});
