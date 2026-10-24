/**
 * Where the local clock sits between night and day, as smooth 0..1 factors for a decorative sky.
 * Uses the date's own local time (the caller picks the zone by choosing the Date's reading).
 * Fixed, season-free sun times: this is a mood, not an almanac.
 */

export type DayPart = 'night' | 'dawn' | 'day' | 'dusk';

export type Daylight = {
  part: DayPart;
  /** Local time as hours, 0..24. */
  hour: number;
  /** 1 in full night, 0 in full day. Stars and the moon scale with this. */
  night: number;
  /** 0..1 horizon warmth, peaking at dawn and dusk. */
  glow: number;
};

export const SUNRISE = 6.5;
export const SUNSET = 19;
/** Hours over which night gives way to day around sunrise and sunset. */
const TWILIGHT = 1.5;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export function localHour(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Daylight for a local hour. */
export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  // 0 = dark, 1 = light: rising over the sunrise twilight, falling over the sunset twilight.
  const rise = smooth((h - (SUNRISE - TWILIGHT)) / (2 * TWILIGHT));
  const set = 1 - smooth((h - (SUNSET - TWILIGHT)) / (2 * TWILIGHT));
  const light = Math.min(rise, set);
  const glow = Math.min(1, 4 * light * (1 - light));
  let part: 'night' | 'dawn' | 'day' | 'dusk';
  if (light < 0.08) part = 'night';
  else if (light > 0.92) part = 'day';
  else part = h < 12 ? 'dawn' : 'dusk';
  return { part, hour: h, night: 1 - light, glow };
}

export function daylight(date: Date): Daylight {
  return daylightAt(localHour(date));
}
