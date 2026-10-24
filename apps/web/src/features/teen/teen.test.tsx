import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { birthYearOptions, conservativeAge, gateTarget, isTeenAge, parseBirth } from './age';
import { CrisisResources } from './CrisisResources';
import { CRISIS_LAST_REVIEWED, HELPLINES } from './crisis-data';
import {
  RESEND_COOLDOWN_S,
  clearConsentRequest,
  readConsentRequest,
  resendWaitSeconds,
  saveConsentRequest,
} from './consent-request';
import { teenFlags } from './flags';

describe('age helpers', () => {
  it('lists a hundred years, newest first, including under-13 years', () => {
    const years = birthYearOptions(new Date('2026-10-24T00:00:00'));
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1926);
    expect(years).toContain(2020);
  });

  it('parses month and year, rejecting blanks and nonsense', () => {
    expect(parseBirth('2011', '3')).toEqual({ birthYear: 2011, birthMonth: 3 });
    expect(parseBirth('', '3')).toBeNull();
    expect(parseBirth('2011', '')).toBeNull();
    expect(parseBirth('2011', '13')).toBeNull();
    expect(parseBirth('1800', '3')).toBeNull();
    expect(parseBirth('abc', '3')).toBeNull();
  });

  it('mirrors the server: the birth month counts as not yet birthday', () => {
    const now = new Date('2026-03-15T00:00:00Z');
    expect(conservativeAge(2010, 3, now)).toBe(15);
    expect(conservativeAge(2010, 2, now)).toBe(16);
    expect(conservativeAge(2013, 12, new Date('2026-01-01T00:00:00Z'))).toBe(12);
    expect(isTeenAge(12)).toBe(false);
    expect(isTeenAge(13)).toBe(true);
    expect(isTeenAge(17)).toBe(true);
    expect(isTeenAge(18)).toBe(false);
  });
});

describe('route gating', () => {
  const base = { ageConfirmed: true, mode: 'adult' as const, consentStatus: 'not_required' as const };
  it('sends people who have not answered the age gate to /age', () => {
    expect(gateTarget({ ...base, ageConfirmed: false })).toBe('/age');
  });
  it('sends a teen without a granted approval to /teen', () => {
    for (const consentStatus of ['pending', 'revoked'] as const) {
      expect(gateTarget({ ...base, mode: 'teen', consentStatus })).toBe('/teen');
    }
  });
  it('lets adults and approved teens through', () => {
    expect(gateTarget(base)).toBeNull();
    expect(gateTarget({ ...base, mode: 'teen', consentStatus: 'granted' })).toBeNull();
  });
});

describe('teen flags', () => {
  it('turns off streaks, nudges, share cards and the people map for teens', () => {
    expect(teenFlags({ mode: 'teen' })).toEqual({
      isTeen: true,
      streaks: false,
      nudges: false,
      shareCards: false,
      peopleMap: false,
    });
  });
  it('leaves adults with everything', () => {
    expect(teenFlags({ mode: 'adult' })).toEqual({
      isTeen: false,
      streaks: true,
      nudges: true,
      shareCards: true,
      peopleMap: true,
    });
  });
  it('uses the strict rules while the profile is loading', () => {
    expect(teenFlags(undefined).streaks).toBe(false);
    expect(teenFlags(null).nudges).toBe(false);
  });
});

describe('crisis resources', () => {
  afterEach(() => sessionStorage.clear());

  it('lists the required lines with tel links and a review date', () => {
    const byId = Object.fromEntries(HELPLINES.map((h) => [h.id, h]));
    expect(byId['tele-manas']).toMatchObject({ number: '14416', tel: '14416' });
    expect(byId.kiran).toMatchObject({ number: '1800-599-0019', tel: '18005990019' });
    expect(byId['988']?.tel).toBe('988');
    expect(byId.samaritans).toMatchObject({ number: '116 123', tel: '116123' });
    expect(byId.findahelpline?.url).toBe('https://findahelpline.com');
    expect(CRISIS_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const h of HELPLINES) expect(h.tel ?? h.url).toBeTruthy();
  });

  it('renders accessible call links', () => {
    render(<CrisisResources />);
    expect(screen.getByRole('heading', { name: 'Need to talk to someone?' })).toBeTruthy();
    const call = screen.getByRole('link', { name: 'Call Tele-MANAS on 14416' });
    expect(call.getAttribute('href')).toBe('tel:14416');
    const dir = screen.getByRole('link', { name: /Find a Helpline/ });
    expect(dir.getAttribute('rel')).toContain('noopener');
  });

  it('remembers a sent request for the tab and honours the resend cooldown', () => {
    const rec = { sentTo: 'm•••@example.com', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), sentAt: Date.now() };
    saveConsentRequest(rec, 'u1');
    expect(readConsentRequest('u1')).toEqual(rec);
    expect(readConsentRequest('u2')).toBeNull();
    clearConsentRequest('u1');
    expect(readConsentRequest('u1')).toBeNull();
    saveConsentRequest({ ...rec, expiresAt: new Date(Date.now() - 1000).toISOString() }, 'u1');
    expect(readConsentRequest('u1')).toBeNull();
    expect(resendWaitSeconds(1000, 1000)).toBe(RESEND_COOLDOWN_S);
    expect(resendWaitSeconds(1000, 1000 + 59_500)).toBe(1);
    expect(resendWaitSeconds(1000, 1000 + 61_000)).toBe(0);
  });
});
