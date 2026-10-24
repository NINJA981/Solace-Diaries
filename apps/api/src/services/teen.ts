/**
 * Teen mode: the age gate and parental consent.
 *
 * Privacy rules: a birth date is never stored (only an age band), the parent's email and the
 * consent token are stored as SHA-256 hashes only, and the public consent endpoints answer
 * with the same shapes whether a token exists or not.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  AGE_LIMITS,
  TEEN_ERROR_CODES,
  type AgeCheckInput,
  type ConsentDecisionInput,
  type ConsentRequestResult,
  type ConsentView,
  type Profile,
} from '@solace/shared';
import { config, teenSignupEnabled } from '../config';
import { db } from '../db/client';
import { parentalConsents, profiles } from '../db/schema';
import { badRequest, conflict, HttpError, notFound } from '../http/errors';
import { logger } from '../logger';
import { purgeAccount } from './account';
import { forgetGate, forgetProfile, getProfile, toProfile } from './profiles';
import { maskEmail, sendMail, MailError } from './mailer';

/** Bump when the teen/parent terms change; stored with every consent record. */
export const CONSENT_POLICY_VERSION = '2026-10';
const CONSENT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Consent emails one teen can request per rolling day. */
export const CONSENT_REQUESTS_PER_DAY = 3;

export type AgeBand = '13-15' | '16-17' | '18+';

// ───────────────────────── age maths ─────────────────────────

/**
 * Age in whole years from birth year + month only, never more than the truth: in the birth
 * month itself the birthday may not have happened yet, so we assume it has not (younger).
 * Uses UTC; `now` is injectable for tests.
 */
export function conservativeAge(year: number, month: number, now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return y - year - (month >= m ? 1 : 0);
}

export type AgeOutcome =
  | { kind: 'under13' }
  | { kind: 'band'; band: AgeBand; mode: 'adult' | 'teen' };

export function classifyAge(age: number): AgeOutcome {
  if (age < AGE_LIMITS.minimum) return { kind: 'under13' };
  if (age < 16) return { kind: 'band', band: '13-15', mode: 'teen' };
  if (age < AGE_LIMITS.adult) return { kind: 'band', band: '16-17', mode: 'teen' };
  return { kind: 'band', band: '18+', mode: 'adult' };
}

// ───────────────────────── profile read ─────────────────────────

/** The profile plus when a parent last decided (from the consent record). */
export async function profileForClient(userId: string): Promise<Profile> {
  const row = await getProfile(userId);
  const base = toProfile(row);
  if (row.mode !== 'teen') return base;
  const [latest] = await db
    .select({ decidedAt: parentalConsents.decidedAt })
    .from(parentalConsents)
    .where(eq(parentalConsents.userId, userId))
    .orderBy(desc(parentalConsents.requestedAt))
    .limit(1);
  return { ...base, consentDecidedAt: latest?.decidedAt?.toISOString() ?? null };
}

// ───────────────────────── the age gate ─────────────────────────

export async function confirmAge(userId: string, input: AgeCheckInput): Promise<Profile> {
  const current = await getProfile(userId);
  // Set once. Later calls never move the band (up or down), they just return the profile.
  if (current.ageBand !== null) return profileForClient(userId);

  const now = new Date();
  const age = conservativeAge(input.birthYear, input.birthMonth, now);
  if (age < 0 || age > 120) {
    throw badRequest('That birth year and month do not look right.', {
      birthYear: 'Check the year',
    });
  }
  const outcome = classifyAge(age);

  if (outcome.kind === 'under13') {
    // Retain nothing: remove the account (rows, photos, auth user) before answering.
    try {
      await purgeAccount(userId);
    } catch (err) {
      logger.error({ err }, 'could not fully delete an under-13 account');
    }
    forgetProfile(userId);
    throw new HttpError(
      403,
      'Solace is for people aged 13 and over, so we have not created an account and have deleted what was set up.',
      TEEN_ERROR_CODES.ageRestricted,
    );
  }

  if (outcome.mode === 'teen' && !teenSignupEnabled()) {
    throw new HttpError(
      503,
      'Teen accounts are not open yet. We need a way to ask a parent first. Please check back soon.',
      TEEN_ERROR_CODES.teenSignupUnavailable,
    );
  }

  // Only set while still unanswered, so two racing calls cannot change the band.
  await db
    .update(profiles)
    .set({
      ageBand: outcome.band,
      mode: outcome.mode,
      consentStatus: outcome.mode === 'teen' ? 'pending' : 'not_required',
    })
    .where(and(eq(profiles.id, userId), sql`${profiles.ageBand} is null`));
  forgetGate(userId);
  return profileForClient(userId);
}

// ───────────────────────── consent: hashing ─────────────────────────

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hashToken = (token: string) => sha256(token);
export const hashEmail = (email: string) => sha256(email.trim().toLowerCase());

// ───────────────────────── consent: request ─────────────────────────

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}

function consentEmail(opts: { name: string; link: string; expires: Date }) {
  const who = opts.name || 'A teenager';
  const them = opts.name || 'they';
  const free = config.AI_TIER === 'free';
  const text = [
    'Hello,',
    '',
    `${who} (aged 13 to 17) would like to use Solace Diaries, and needs a parent or guardian to say yes first. Nothing is used until you approve.`,
    '',
    'What Solace is',
    `A private journaling app. ${opts.name ? `${opts.name} writes` : 'They write'} entries, and an AI (Google Gemini) helps with summaries, moods and reflection prompts.`,
    '',
    'What is stored',
    `The entries and photos ${them === 'they' ? 'they add' : `${opts.name} adds`}, summaries and notes the AI makes from them, and app settings. Your email address is kept only as a one-way hash, so we can show consent was given but cannot read it back. We do not sell data and there are no ads.`,
    free
      ? 'Solace currently uses a free Google AI service. Google may use what is sent to it to improve its products, and people at Google may review some of it.'
      : 'Solace uses a paid Google AI service, which does not use what is sent to train its models.',
    '',
    'What teen mode changes',
    'No streaks or nudges, no share cards, no map of the people in the journal, and the AI does not record facts about other people. Help lines are one tap away.',
    '',
    'What you are agreeing to',
    `That ${opts.name || 'they'} may use Solace in teen mode, with entries processed as described above.`,
    '',
    `Review and decide here (the link works until ${opts.expires.toUTCString()}):`,
    opts.link,
    '',
    `You can withdraw approval at any time from the same link. The account locks straight away, and ${opts.name || 'they'} can export or delete the journal. You cannot read the journal through this link; it stays private.`,
    '',
    'If you were not expecting this, ignore this email or choose Decline at the link.',
    '',
    'Solace Diaries',
  ].join('\n');
  return { subject: `${who} asked for your OK to use Solace Diaries`, text };
}

export async function requestConsent(
  userId: string,
  parentEmail: string,
): Promise<ConsentRequestResult> {
  // Same guard as the age gate: with no way to actually deliver the email (production without
  // a mail provider) nothing is created and the teen is told the truth.
  if (!teenSignupEnabled()) {
    throw new HttpError(
      503,
      'Teen accounts are not open yet. We need a way to ask a parent first. Please check back soon.',
      TEEN_ERROR_CODES.teenSignupUnavailable,
    );
  }
  const row = await getProfile(userId);
  if (row.mode !== 'teen') {
    throw new HttpError(403, 'Parental consent only applies to teen accounts.', 'forbidden');
  }
  if (row.consentStatus === 'granted') {
    throw conflict('A parent has already approved this account.', 'consent_already_granted');
  }
  const email = parentEmail.trim();
  if (email.toLowerCase() === row.email.toLowerCase()) {
    throw badRequest('Use a parent or guardian’s email, not your own.', {
      parentEmail: 'Use a parent or guardian’s email',
    });
  }

  const [latest] = await db
    .select({ status: parentalConsents.status })
    .from(parentalConsents)
    .where(eq(parentalConsents.userId, userId))
    .orderBy(desc(parentalConsents.requestedAt))
    .limit(1);
  // After a parent withdrew approval the account stays locked; only a decline can be re-asked.
  if (row.consentStatus === 'revoked' && latest?.status !== 'denied') {
    throw conflict('A parent withdrew approval for this account.', 'consent_revoked');
  }

  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(parentalConsents)
    .where(and(eq(parentalConsents.userId, userId), gt(parentalConsents.requestedAt, since)));
  if (n >= CONSENT_REQUESTS_PER_DAY) {
    throw new HttpError(
      429,
      'You have used today’s three approval emails. Try again tomorrow, or use the last one you sent.',
      'rate_limited',
    );
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CONSENT_TTL_MS);
  const link = `${config.WEB_ORIGIN[0] ?? ''}/consent/${token}`;

  const id = await db.transaction(async (tx) => {
    // An older, still-open link stops working once a newer one is sent.
    await tx
      .update(parentalConsents)
      .set({ expiresAt: new Date() })
      .where(and(eq(parentalConsents.userId, userId), eq(parentalConsents.status, 'pending')));
    const [created] = await tx
      .insert(parentalConsents)
      .values({
        userId,
        parentEmailHash: hashEmail(email),
        tokenHash: hashToken(token),
        policyVersion: CONSENT_POLICY_VERSION,
        expiresAt,
      })
      .returning({ id: parentalConsents.id });
    await tx
      .update(profiles)
      .set({ consentStatus: 'pending' })
      .where(eq(profiles.id, userId));
    return created!.id;
  });
  forgetGate(userId);

  const mail = consentEmail({ name: firstName(row.displayName), link, expires: expiresAt });
  try {
    await sendMail({ to: email, ...mail });
  } catch (err) {
    // No email went out, so the link is useless: remove it and let the teen retry.
    logger.error({ err: err instanceof MailError ? err.message : 'send failed' }, 'consent mail failed');
    await db.delete(parentalConsents).where(eq(parentalConsents.id, id));
    throw new HttpError(
      503,
      'We could not send the email just now. Check the address and try again in a few minutes.',
      TEEN_ERROR_CODES.emailUnavailable,
    );
  }
  return { sentTo: maskEmail(email), expiresAt: expiresAt.toISOString() };
}

// ───────────────────────── consent: parent's page ─────────────────────────

const GENERIC_NOT_FOUND = 'This link is not valid or has expired.';
const linkNotFound = () => notFound(GENERIC_NOT_FOUND);

type ConsentRow = typeof parentalConsents.$inferSelect;

async function findByToken(token: string) {
  // Tokens are 43 base64url chars; reject junk cheaply with the same answer.
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
    await db.execute(sql`select 1`); // keep the shape of the work similar
    return undefined;
  }
  const [row] = await db
    .select({ c: parentalConsents, name: profiles.displayName })
    .from(parentalConsents)
    .innerJoin(profiles, eq(profiles.id, parentalConsents.userId))
    .where(eq(parentalConsents.tokenHash, hashToken(token)));
  return row;
}

/** Pending links expire; once a decision is made the link stays usable (to withdraw approval). */
function isLive(c: ConsentRow, now = Date.now()): boolean {
  return c.status !== 'pending' || c.expiresAt.getTime() > now;
}

function viewOf(c: ConsentRow, displayName: string, status: ConsentView['status']): ConsentView {
  return {
    teenFirstName: firstName(displayName) || 'Your teen',
    status,
    policyVersion: c.policyVersion,
    expiresAt: c.expiresAt.toISOString(),
  };
}

export async function viewConsent(token: string): Promise<ConsentView> {
  const found = await findByToken(token);
  if (!found || !isLive(found.c)) throw linkNotFound();
  return viewOf(found.c, found.name, found.c.status);
}

export async function decideConsent(
  token: string,
  input: ConsentDecisionInput,
): Promise<ConsentView> {
  const found = await findByToken(token);
  if (!found || !isLive(found.c)) throw linkNotFound();
  const { c, name } = found;

  const now = new Date();
  const from = input.decision === 'revoke' ? 'granted' : 'pending';
  const to = input.decision === 'grant' ? 'granted' : input.decision === 'deny' ? 'denied' : 'revoked';
  const profileStatus = input.decision === 'grant' ? 'granted' : 'revoked';

  const updated = await db.transaction(async (tx) => {
    // One-time: the row only moves out of its current state once (and a pending one only
    // while it has not expired).
    const [row] = await tx
      .update(parentalConsents)
      .set({ status: to, decidedAt: now })
      .where(
        and(
          eq(parentalConsents.id, c.id),
          eq(parentalConsents.status, from),
          ...(from === 'pending' ? [gt(parentalConsents.expiresAt, now)] : []),
        ),
      )
      .returning();
    if (!row) return undefined;
    await tx
      .update(profiles)
      .set({ consentStatus: profileStatus })
      .where(and(eq(profiles.id, c.userId), eq(profiles.mode, 'teen')));
    return row;
  });
  forgetGate(c.userId);
  if (!updated) {
    throw conflict('This link has already been used for that.', 'consent_closed');
  }
  return viewOf(updated, name, updated.status);
}
