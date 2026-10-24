/**
 * Tonight's moon, computed from a date alone (no network, no ephemeris file).
 *
 * The moon's elongation from the sun comes from low-precision longitude series (the dominant
 * terms of Meeus' formulas, plus the evection and variation corrections). That tracks the real
 * phase to within roughly half a day, which is what a decorative sky and a greeting need; a plain
 * mean synodic month drifts by up to 14 hours.
 *
 * Pure: every function takes the Date. Nothing here reads the clock.
 */

export const SYNODIC_MONTH = 29.530588853;

export type MoonName =
  | 'New moon'
  | 'Waxing crescent'
  | 'First quarter'
  | 'Waxing gibbous'
  | 'Full moon'
  | 'Waning gibbous'
  | 'Last quarter'
  | 'Waning crescent';

export type MoonPhase = {
  /** Elongation from the sun as a fraction of a cycle, 0 = new, 0.5 = full, [0, 1). */
  cycle: number;
  /** Days since the last new moon (approximate), [0, 29.53). */
  age: number;
  /** Illuminated fraction of the disc, 0..1. */
  illuminated: number;
  /** True from new to full. */
  waxing: boolean;
  name: MoonName;
};

const RAD = Math.PI / 180;
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Julian day number of an instant. */
function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Moon minus sun ecliptic longitude, degrees [0, 360). */
export function elongation(date: Date): number {
  const d = julianDay(date) - 2451545.0;
  const Lm = 218.316 + 13.176396 * d; // moon mean longitude
  const Mm = 134.963 + 13.064993 * d; // moon mean anomaly
  const Ls = 280.46 + 0.9856474 * d; // sun mean longitude
  const Ms = 357.528 + 0.9856003 * d; // sun mean anomaly
  const D = norm360(Lm - Ls); // mean elongation
  const moonLon = Lm + 6.289 * Math.sin(Mm * RAD) + 1.274 * Math.sin((2 * D - Mm) * RAD) + 0.658 * Math.sin(2 * D * RAD);
  const sunLon = Ls + 1.915 * Math.sin(Ms * RAD) + 0.02 * Math.sin(2 * Ms * RAD);
  return norm360(moonLon - sunLon);
}

/** Half-width (in cycle fraction) around each principal phase that still carries its name. */
const PRINCIPAL = 0.0175; // about half a day

function nameFor(cycle: number): MoonName {
  const near = (target: number) => Math.min(Math.abs(cycle - target), 1 - Math.abs(cycle - target)) <= PRINCIPAL;
  if (near(0)) return 'New moon';
  if (near(0.25)) return 'First quarter';
  if (near(0.5)) return 'Full moon';
  if (near(0.75)) return 'Last quarter';
  if (cycle < 0.25) return 'Waxing crescent';
  if (cycle < 0.5) return 'Waxing gibbous';
  if (cycle < 0.75) return 'Waning gibbous';
  return 'Waning crescent';
}

export function moonPhase(date: Date): MoonPhase {
  const deg = elongation(date);
  const cycle = deg / 360;
  return {
    cycle,
    age: cycle * SYNODIC_MONTH,
    illuminated: (1 - Math.cos(deg * RAD)) / 2,
    waxing: cycle < 0.5,
    name: nameFor(cycle),
  };
}

/** "waxing crescent", "full moon": lower-case, for running text. */
export function moonNameLower(phase: Pick<MoonPhase, 'name'>): string {
  return phase.name.toLowerCase();
}

/**
 * The lit part of the disc as an SVG/canvas (Path2D) path, a circle of radius `r` centred on
 * (cx, cy), northern-hemisphere orientation (waxing is lit on the right). Null when nothing is
 * lit. The shape is the limb arc on the lit side, closed by the terminator ellipse.
 */
export function litPath(phase: Pick<MoonPhase, 'cycle' | 'waxing' | 'illuminated'>, cx: number, cy: number, r: number): string | null {
  if (phase.illuminated < 0.004) return null;
  if (phase.illuminated > 0.996) {
    return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
  const k = Math.cos(2 * Math.PI * phase.cycle); // 1 at new, -1 at full
  const rx = Math.abs(k) * r;
  const limbSweep = phase.waxing ? 1 : 0; // the right limb is drawn clockwise from the top
  // Crescent (k > 0): the terminator bulges toward the lit limb; gibbous: away from it.
  const termSweep = k > 0 === phase.waxing ? 0 : 1;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${limbSweep} ${cx} ${cy + r}A${rx} ${r} 0 0 ${termSweep} ${cx} ${cy - r}Z`;
}
