import type { Graph, GraphKind } from '@solace/shared';

/** Six graph kinds folded into three star families (three hues stay distinguishable for everyone). */
export type Family = 'world' | 'aims' | 'feelings';
export const FAMILY_OF: Record<GraphKind, Family> = {
  person: 'world',
  place: 'world',
  project: 'aims',
  goal: 'aims',
  habit: 'aims',
  emotion: 'feelings',
};
/** Legend order and labels; each skin decides the colour token per family. */
export const FAMILIES: { key: Family; label: string }[] = [
  { key: 'world', label: 'People and places' },
  { key: 'aims', label: 'Goals, projects and habits' },
  { key: 'feelings', label: 'Feelings' },
];

export type Star = {
  id: string;
  name: string;
  kind: GraphKind;
  family: Family;
  weight: number;
  /** Normalized position in [0, 1] × [0, 1]. */
  x: number;
  y: number;
  /** Radius in CSS px before DPR. */
  r: number;
  phase: number;
};
export type Link = { a: number; b: number; w: number };

export const MAX_STARS = 140;

/** Small deterministic PRNG so the same graph always lays out the same sky. */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Force layout computed once (not per frame): repulsion between all stars, springs along
 * edges, gentle pull to the centre. Output is normalized so it can be scaled to any size.
 */
export function layoutConstellation(graph: Graph, aspect = 2): { stars: Star[]; links: Link[] } {
  const nodes = [...graph.nodes].sort((a, b) => b.weight - a.weight).slice(0, MAX_STARS);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links: Link[] = [];
  for (const e of graph.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) links.push({ a, b, w: e.weight });
  }
  const rand = mulberry32(hash(nodes.map((n) => n.id).join('|')) || 1);
  const maxW = Math.max(1, ...nodes.map((n) => n.weight));
  const N = nodes.length;
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // Phyllotaxis seed: even spread, no initial overlaps.
    const r = Math.sqrt(i + 0.5) * 18;
    const t = i * 2.399963 + rand() * 0.3;
    px[i] = Math.cos(t) * r * aspect * 0.7;
    py[i] = Math.sin(t) * r * 0.7;
  }
  const maxLinkW = Math.max(1, ...links.map((l) => l.w));
  const iterations = N > 80 ? 220 : 300;
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = px[i]! - px[j]!;
        let dy = py[i]! - py[j]!;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          d2 = 0.25;
        }
        if (d2 > 90_000) continue;
        const f = (900 / d2) * alpha;
        const d = Math.sqrt(d2);
        vx[i]! += (dx / d) * f;
        vy[i]! += (dy / d) * f;
        vx[j]! -= (dx / d) * f;
        vy[j]! -= (dy / d) * f;
      }
    }
    for (const l of links) {
      const dx = px[l.b]! - px[l.a]!;
      const dy = py[l.b]! - py[l.a]!;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 46;
      const k = 0.02 * (0.4 + (0.6 * l.w) / maxLinkW) * alpha;
      const f = (d - target) * k;
      vx[l.a]! += (dx / d) * f;
      vy[l.a]! += (dy / d) * f;
      vx[l.b]! -= (dx / d) * f;
      vy[l.b]! -= (dy / d) * f;
    }
    for (let i = 0; i < N; i++) {
      vx[i]! -= (px[i]! / aspect) * 0.012 * alpha;
      vy[i]! -= py[i]! * 0.012 * aspect * 0.5 * alpha;
      vx[i]! *= 0.6;
      vy[i]! *= 0.6;
      px[i]! += vx[i]!;
      py[i]! += vy[i]!;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, px[i]!);
    maxX = Math.max(maxX, px[i]!);
    minY = Math.min(minY, py[i]!);
    maxY = Math.max(maxY, py[i]!);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const stars: Star[] = nodes.map((n, i) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    family: FAMILY_OF[n.kind],
    weight: n.weight,
    x: (px[i]! - minX) / spanX,
    y: (py[i]! - minY) / spanY,
    r: 2.2 + Math.sqrt(n.weight / maxW) * 5,
    phase: rand() * Math.PI * 2,
  }));
  return { stars, links };
}
