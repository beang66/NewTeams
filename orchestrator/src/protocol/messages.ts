import { z } from 'zod'

export const MessageTypeSchema = z.enum([
  'CHAT', 'ASSIGN', 'ESCALATE', 'GUIDANCE', 'REPORT', 'REVIEW_REQUEST', 'REJECT',
  'REVISION', 'APPROVE', 'STATE_CHANGE', 'PAUSED', 'RESUMED', 'HUMAN_REQUIRED',
])
export type MessageType = z.infer<typeof MessageTypeSchema>

export const UsageSchema = z.object({
  in: z.number(), out: z.number(), cached: z.number(), costUsd: z.number().optional(),
})
export type Usage = z.infer<typeof UsageSchema>

export const EnvelopeSchema = z.object({
  id: z.string(),
  ts: z.string(),
  type: MessageTypeSchema,
  from: z.string(),
  to: z.string(),
  task: z.string().optional(),
  round: z.number().optional(),
  payload: z.unknown(),
  promptRef: z.string().optional(),
  sessionRef: z.string().optional(),
  usage: UsageSchema.optional(),
})
export type Envelope = z.infer<typeof EnvelopeSchema>
export type NewEnvelope = Omit<Envelope, 'id' | 'ts'>

export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['blocker', 'major', 'minor']),
  file: z.string().nullish().transform((v) => v ?? undefined).optional(),
  issue: z.string(),
  evidence_ref: z.string().nullish().transform((v) => v ?? undefined).optional(),
})
export type Finding = z.infer<typeof FindingSchema>

export const VerdictSchema = z.object({
  verdict: z.enum(['approve', 'reject']),
  findings: z.array(FindingSchema),
  resolved: z.array(z.string()),
})
export type Verdict = z.infer<typeof VerdictSchema>

// Codex --output-schema (structured output) 용. 모든 객체에 additionalProperties:false.
export const verdictJsonSchema: object = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings', 'resolved'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'reject'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'severity', 'file', 'issue', 'evidence_ref'],
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: ['string', 'null'] },
          issue: { type: 'string' },
          evidence_ref: { type: ['string', 'null'] },
        },
      },
    },
    resolved: { type: 'array', items: { type: 'string' } },
  },
}
