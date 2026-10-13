/** AI budget visibility: how much of today's AI allowance is left (Settings meter). */
import { z } from 'zod';
import { timestamp } from './contract';

const budget = z.object({ used: z.number().int(), limit: z.number().int() });

export const aiUsage = z.object({
  /** Gemini API tier of the server key; decides what we may promise about data use. */
  tier: z.enum(['free', 'paid']),
  /** True when the request carried the person's own Gemini key (their budget is unlimited here). */
  ownKey: z.boolean(),
  /** Search, Reflect, letters and other things the person asks for. */
  interactive: budget,
  /** Background analysis of entries and photos. */
  enrichment: budget,
  /** When both daily budgets reset (start of the next UTC day). */
  resetsAt: timestamp,
});
export type AiUsage = z.infer<typeof aiUsage>;
