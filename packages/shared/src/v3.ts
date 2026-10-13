/**
 * v3 feature contracts: time capsules, resurfacing, Unwrapped, letters from your past self,
 * life chapters, growth notes, intentions, weekly ritual, companion and milestones,
 * mood correlations, and teen mode (age gate and parental consent).
 * Conventions match contract.ts: dates are local `YYYY-MM-DD`, timestamps ISO-8601 UTC.
 */
import { z } from 'zod';
import { LIMITS, citation, entry, entrySummary, isoDate, mood, timestamp, timezone, uuid } from './contract';

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
const yearKey = z.string().regex(/^\d{4}$/, 'Expected YYYY');

// ───────────────────────── time capsules ─────────────────────────

export const CAPSULE_LIMITS = { minLeadHours: 24, maxYears: 25, titleMax: 120 } as const;

export const capsuleStatus = z.enum(['sealed', 'ready', 'opened']);
export type CapsuleStatus = z.infer<typeof capsuleStatus>;

export const capsule = z.object({
  id: uuid,
  title: z.string(),
  /** Null while sealed: the text only leaves the server once the capsule can be opened. */
  body: z.string().nullable(),
  unlockAt: timestamp,
  status: capsuleStatus,
  openedAt: timestamp.nullable(),
  createdAt: timestamp,
});
export type Capsule = z.infer<typeof capsule>;

export const capsuleList = z.object({ items: z.array(capsule) });

export const createCapsuleInput = z.object({
  title: z.string().trim().min(1).max(CAPSULE_LIMITS.titleMax),
  body: z.string().trim().min(1).max(LIMITS.bodyMax),
  /** At least CAPSULE_LIMITS.minLeadHours ahead, at most maxYears ahead (checked server-side). */
  unlockAt: timestamp,
});
export type CreateCapsuleInput = z.infer<typeof createCapsuleInput>;

// ───────────────────────── resurfacing ─────────────────────────

export const resurfaceItem = z.object({
  /** on_this_day: same date in a past year; echo: an emotionally strong older entry worth revisiting;
   *  unfinished: an entry that mentions an intention you haven't come back to. */
  kind: z.enum(['on_this_day', 'echo', 'unfinished']),
  entry: entrySummary,
  /** Plain-language reason shown on the card, e.g. "One year ago today". */
  reason: z.string(),
});
export type ResurfaceItem = z.infer<typeof resurfaceItem>;
export const resurfaceResponse = z.object({ items: z.array(resurfaceItem) });

// ───────────────────────── Unwrapped ─────────────────────────

export const unwrappedQuery = z.object({
  period: z.enum(['month', 'year']),
  /** YYYY-MM for a month, YYYY for a year. */
  at: z.union([monthKey, yearKey]),
  tz: timezone.optional(),
});
export type UnwrappedQuery = z.infer<typeof unwrappedQuery>;

const tagCount = z.object({ tag: z.string(), count: z.number().int() });

export const unwrappedSlide = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('totals'), entries: z.number().int(), words: z.number().int(), days: z.number().int() }),
  z.object({ kind: z.literal('moods'), counts: z.record(z.string(), z.number().int()), top: mood.nullable() }),
  z.object({ kind: z.literal('tags'), top: z.array(tagCount) }),
  z.object({ kind: z.literal('streak'), longest: z.number().int(), current: z.number().int() }),
  z.object({
    kind: z.literal('rhythm'),
    /** Entries per local hour (24) and per weekday (7, Monday first). */
    byHour: z.array(z.number().int()).length(24),
    byWeekday: z.array(z.number().int()).length(7),
    peakHour: z.number().int().min(0).max(23).nullable(),
  }),
  z.object({ kind: z.literal('bookends'), first: entrySummary.nullable(), last: entrySummary.nullable() }),
  /** Omitted in teen mode. */
  z.object({ kind: z.literal('people'), top: z.array(z.object({ name: z.string(), count: z.number().int() })) }),
  z.object({ kind: z.literal('highlight'), entry: entrySummary, reason: z.string() }),
]);
export type UnwrappedSlide = z.infer<typeof unwrappedSlide>;

export const journalPersona = z.object({
  key: z.string(),
  /** Short identity, e.g. "Night-owl processor". Built only from aggregates, never from text. */
  name: z.string(),
  description: z.string(),
  traits: z.array(z.string()),
});
export type JournalPersona = z.infer<typeof journalPersona>;

export const unwrapped = z.object({
  period: z.enum(['month', 'year']),
  label: z.string(),
  from: isoDate,
  to: isoDate,
  slides: z.array(unwrappedSlide),
  /** Null when the period has fewer than `minEntries` entries. */
  persona: journalPersona.nullable(),
  minEntries: z.number().int(),
});
export type Unwrapped = z.infer<typeof unwrapped>;

// ───────────────────────── letters from your past self ─────────────────────────

export const pastLetter = z.object({
  id: uuid,
  /** The month this letter was written for (YYYY-MM). */
  month: monthKey,
  /** Markdown, written in the person's own voice from entries a while back; rendered with SafeMarkdown. */
  content: z.string(),
  citations: z.array(citation),
  replyEntryId: uuid.nullable(),
  createdAt: timestamp,
});
export type PastLetter = z.infer<typeof pastLetter>;

export const pastLetterList = z.object({
  items: z.array(pastLetter),
  /** False when there aren't enough older entries yet, or this month's letter exists. */
  canWrite: z.boolean(),
  /** Entries older than ~3 months needed before the first letter. */
  minEntries: z.number().int(),
});
export type PastLetterList = z.infer<typeof pastLetterList>;

export const replyToLetterInput = z.object({ body: z.string().trim().min(1).max(LIMITS.bodyMax) });

// ───────────────────────── life chapters ─────────────────────────

export const chapter = z.object({
  id: uuid,
  title: z.string(),
  summary: z.string(),
  from: isoDate,
  /** Null for the chapter you're in now. */
  to: isoDate.nullable(),
  /** A theme colour role for the chapter: one of mood-1..mood-5, accent or ai. */
  color: z.string(),
  cast: z.array(z.string()),
  keyEntryIds: z.array(uuid),
});
export type Chapter = z.infer<typeof chapter>;

export const chapterList = z.object({
  items: z.array(chapter),
  generatedAt: timestamp.nullable(),
  /** True when enough new writing exists that a refresh would change things. */
  stale: z.boolean(),
  minEntries: z.number().int(),
});
export type ChapterList = z.infer<typeof chapterList>;

// ───────────────────────── growth notes ─────────────────────────

export const growthNote = z.object({
  id: uuid,
  /** Gentle observation of change, e.g. "In March you wrote X; lately Y". Always cited. */
  text: z.string(),
  citations: z.array(citation),
  weekStart: isoDate,
  createdAt: timestamp,
});
export type GrowthNote = z.infer<typeof growthNote>;
export const growthNoteList = z.object({ items: z.array(growthNote) });

// ───────────────────────── intentions (habits & goals) ─────────────────────────

export const intentionKind = z.enum(['habit', 'goal']);
export const intentionCadence = z.enum(['daily', 'weekly', 'none']);
export const intentionStatus = z.enum(['active', 'paused', 'done']);

export const intentionCheckin = z.object({ date: isoDate, note: z.string().nullable() });

export const intention = z.object({
  id: uuid,
  title: z.string(),
  kind: intentionKind,
  cadence: intentionCadence,
  status: intentionStatus,
  source: z.enum(['user', 'detected']),
  memoryId: uuid.nullable(),
  /** Check-ins from the last 90 days, newest first. */
  checkins: z.array(intentionCheckin),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Intention = z.infer<typeof intention>;
export const intentionList = z.object({ items: z.array(intention) });

export const createIntentionInput = z.object({
  title: z.string().trim().min(1).max(120),
  kind: intentionKind,
  cadence: intentionCadence.default('none'),
  /** When adopting a detected suggestion. */
  memoryId: uuid.optional(),
});
export type CreateIntentionInput = z.infer<typeof createIntentionInput>;

export const updateIntentionInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    cadence: intentionCadence,
    status: intentionStatus,
  })
  .partial();
export type UpdateIntentionInput = z.infer<typeof updateIntentionInput>;

export const checkinInput = z.object({ date: isoDate, note: z.string().trim().max(280).optional() });

/** Goals and habits Solace noticed in entries (from memories), not yet adopted. No AI call. */
export const intentionSuggestions = z.object({
  items: z.array(z.object({ memoryId: uuid, title: z.string(), kind: intentionKind })),
});

// ───────────────────────── weekly ritual ─────────────────────────

export const weeklyRitualInput = z.object({
  highs: z.string().trim().max(2_000).default(''),
  lows: z.string().trim().max(2_000).default(''),
  /** Optional intention for next week; becomes an Intention. */
  intention: createIntentionInput.optional(),
  tz: timezone.optional(),
});
export type WeeklyRitualInput = z.infer<typeof weeklyRitualInput>;
export const weeklyRitualResult = z.object({ entry, intention: intention.nullable() });

// ───────────────────────── companion & milestones ─────────────────────────

export const companionState = z.object({
  /** 1 (just hatched) … 7. Grows with writing, never shrinks for missed days. */
  stage: z.number().int().min(1).max(7),
  xp: z.number().int(),
  nextStageAt: z.number().int().nullable(),
  /** How it looks right now, from recent activity; never guilt-tripping. */
  mood: z.enum(['sleepy', 'content', 'glowing', 'proud']),
  lastWroteAt: timestamp.nullable(),
});
export type CompanionState = z.infer<typeof companionState>;

export const milestone = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  achievedAt: timestamp.nullable(),
});
export type Milestone = z.infer<typeof milestone>;

export const companionResponse = z.object({ companion: companionState, milestones: z.array(milestone) });

// ───────────────────────── mood correlations ─────────────────────────

export const correlation = z.object({
  tag: z.string(),
  entries: z.number().int(),
  /** Average MOOD_SCORE of entries with this tag vs. all entries in the window. */
  avgMood: z.number(),
  baseline: z.number(),
  delta: z.number(),
});
export type Correlation = z.infer<typeof correlation>;
export const correlationList = z.object({ items: z.array(correlation), minEntries: z.number().int() });

// ───────────────────────── teen mode ─────────────────────────

export const AGE_LIMITS = { minimum: 13, adult: 18 } as const;

/** Only used to compute an age band; the birth date itself is never stored. */
export const ageCheckInput = z.object({
  birthYear: z.number().int().min(1900).max(2100),
  birthMonth: z.number().int().min(1).max(12),
});
export type AgeCheckInput = z.infer<typeof ageCheckInput>;

export const consentRequestInput = z.object({ parentEmail: z.string().trim().email() });
export const consentRequestResult = z.object({
  /** Masked, e.g. "p•••@gmail.com". */
  sentTo: z.string(),
  expiresAt: timestamp,
});

/** Public (no auth): what a parent sees when opening the consent link. */
export const consentView = z.object({
  teenFirstName: z.string(),
  status: z.enum(['pending', 'granted', 'denied', 'revoked', 'expired']),
  policyVersion: z.string(),
  expiresAt: timestamp,
});
export type ConsentView = z.infer<typeof consentView>;
export const consentDecisionInput = z.object({ decision: z.enum(['grant', 'deny', 'revoke']) });

