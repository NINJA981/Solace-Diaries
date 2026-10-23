// World validator CLI: every world defines every token for light and dark, and every
// text/background pair meets WCAG AA. Same checks as src/worlds/contrast.test.ts, with a table.
//   npm run check:worlds -w @solace/web            (all worlds)
//   node apps/web/scripts/check-worlds.ts jelly     (one world)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pairContrast, parseWorldTokens, validateWorld } from '../src/worlds/contrast.ts';

const dir = fileURLToPath(new URL('../src/worlds/', import.meta.url));
const only = process.argv[2];
const worlds = readdirSync(dir).filter((d) => existsSync(`${dir}${d}/tokens.css`) && (!only || d === only));
const PAIRS: [string, string][] = [
  ['fg', 'canvas'],
  ['fg-muted', 'canvas'],
  ['fg-faint', 'sunken'],
  ['accent', 'canvas'],
  ['accent-fg', 'accent'],
  ['ai', 'canvas'],
  ['danger', 'canvas'],
  ['focus', 'raised'],
];

let failed = 0;
for (const world of worlds) {
  const tokens = parseWorldTokens(readFileSync(`${dir}${world}/tokens.css`, 'utf8'), world);
  console.log(`\n${world}`);
  for (const theme of ['light', 'dark'] as const) {
    const row = PAIRS.map(([fg, bg]) => `${fg}/${bg} ${pairContrast(tokens, theme, fg, bg)?.toFixed(2) ?? '?'}`);
    console.log(`  ${theme.padEnd(5)} ${row.join('  ')}`);
  }
  const failures = validateWorld(tokens);
  for (const f of failures) console.log(`  ✗ ${f.theme}: ${f.message}`);
  if (!failures.length) console.log('  ✓ all tokens defined, every pair passes AA');
  failed += failures.length;
}
process.exit(failed ? 1 : 0);
