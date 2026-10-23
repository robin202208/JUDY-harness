/**
 * fs domain zod schemas (names derived from map keys: fsListVersionsRequestSchema /
 * fsListVersionsValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { WorkspaceFileVersion } from './fs.ts'

/** Upper bounds for one snapshot; the host clamps to these regardless of the request. */
export const MAX_SNAPSHOT_DEPTH = 32
export const MAX_SNAPSHOT_ENTRIES = 200_000

/** One file's identity at snapshot time. */
export const workspaceFileVersionSchema = z.object({
  path: z.string().min(1),
  version: z.string().min(1),
  size: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<WorkspaceFileVersion>>

/** fs.listVersions request payload. */
export const fsListVersionsRequestSchema = z.object({
  sessionId: sessionIdSchema,
  maxDepth: z.number().int().positive().max(MAX_SNAPSHOT_DEPTH).optional(),
  maxEntries: z.number().int().positive().max(MAX_SNAPSHOT_ENTRIES).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'fs.listVersions'>>>

/** fs.listVersions response value. */
export const fsListVersionsValueSchema = z.object({
  root: z.string().min(1),
  entries: z.array(workspaceFileVersionSchema),
  truncated: z.boolean(),
  unreadable: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'fs.listVersions'>>>
