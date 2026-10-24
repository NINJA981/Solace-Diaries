/**
 * The teen's own browser remembers (for this tab session only) that an approval email went out,
 * to whom (masked) and when, so the "waiting" screen survives a reload. The parent's real address
 * is never stored here or on the server.
 */
export type ConsentRequestRecord = { sentTo: string; expiresAt: string; sentAt: number };

export const RESEND_COOLDOWN_S = 60;

const key = (userId: string | null | undefined) => `solace.consentRequest.${userId ?? 'me'}`;

export function readConsentRequest(userId?: string | null): ConsentRequestRecord | null {
  try {
    const raw = sessionStorage.getItem(key(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ConsentRequestRecord>;
    if (typeof v.sentTo !== 'string' || typeof v.expiresAt !== 'string' || typeof v.sentAt !== 'number') return null;
    // An expired link is not "waiting" any more: ask again.
    if (Date.parse(v.expiresAt) < Date.now()) return null;
    return { sentTo: v.sentTo, expiresAt: v.expiresAt, sentAt: v.sentAt };
  } catch {
    return null;
  }
}

export function saveConsentRequest(record: ConsentRequestRecord, userId?: string | null): void {
  try {
    sessionStorage.setItem(key(userId), JSON.stringify(record));
  } catch {
    /* storage unavailable: the screen just starts from the form after a reload */
  }
}

export function clearConsentRequest(userId?: string | null): void {
  try {
    sessionStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}

/** Seconds until a new email may be requested (0 = now). */
export function resendWaitSeconds(sentAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_S - (now - sentAt) / 1000));
}
