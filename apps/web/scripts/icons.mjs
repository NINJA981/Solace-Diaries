// Generates the PWA icons and the social card. Run from anywhere:  node apps/web/scripts/icons.mjs
//
// - icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png:
//   the line art from scripts/source-icon.jpg (a JPEG with a baked-in checkerboard) is
//   extracted by luminance, recoloured in brass and set on the ink background.
// - og.png (1200×630): an SVG authored below, rendered with the real self-hosted fonts in
//   headless Chromium (Playwright), then compressed with sharp. librsvg can't load woff2,
//   so rendering the SVG text directly with sharp would fall back to a system serif.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const require = createRequire(import.meta.url);

const INK = '#131a2c';
const LAMP = [227, 182, 94];
const DUSK = '#a99cf0';

/** Brass line art with a real alpha channel, trimmed to its bounds. */
async function lineArt() {
  const { data, info } = await sharp(path.join(here, 'source-icon.jpg'))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const lum = data[i];
    // Lines sit around 100-140, the fake checkerboard at 200+.
    const a = Math.max(0, Math.min(1, (200 - lum) / (200 - 125)));
    rgba[i * 4] = LAMP[0];
    rgba[i * 4 + 1] = LAMP[1];
    rgba[i * 4 + 2] = LAMP[2];
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
}

function background(size, { rounded }) {
  const r = rounded ? Math.round(size * 0.22) : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="g" cx="50%" cy="38%" r="62%">
        <stop offset="0" stop-color="rgb(227,182,94)" stop-opacity="0.16"/>
        <stop offset="1" stop-color="rgb(227,182,94)" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${r}" fill="${INK}"/>
    <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  </svg>`);
}

async function icon(art, size, { scale, rounded, file }) {
  const width = Math.round(size * scale);
  const glyph = await sharp(art).resize({ width, fit: 'inside' }).toBuffer();
  const meta = await sharp(glyph).metadata();
  await sharp(background(size, { rounded }))
    .composite([
      {
        input: glyph,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - meta.height) / 2 + size * 0.01),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(pub, file));
  console.log('wrote', file);
}

function fontData(pkg, file) {
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  return readFileSync(path.join(dir, 'files', file)).toString('base64');
}

function ogSvg() {
  const serif = fontData('@fontsource-variable/newsreader', 'newsreader-latin-opsz-normal.woff2');
  const sans = fontData('@fontsource-variable/instrument-sans', 'instrument-sans-latin-wght-normal.woff2');
  // The same "W" constellation as the landing hero, joined by Solace's dusk lines.
  const stars = [
    [690, 395, 9, 'Maya'],
    [810, 215, 11, 'the lake'],
    [930, 375, 8, 'running again'],
    [1040, 175, 10, 'Dad'],
    [1120, 330, 7, ''],
  ];
  const lines = stars
    .slice(1)
    .map(([x, y], i) => `<line x1="${stars[i][0]}" y1="${stars[i][1]}" x2="${x}" y2="${y}" stroke="${DUSK}" stroke-opacity=".7" stroke-width="1.5"/>`)
    .join('');
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const dust = Array.from({ length: 70 }, () => {
    const x = (rand() * 1200).toFixed(1);
    const y = (rand() * 630).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${(0.5 + rand()).toFixed(2)}" fill="#9894b0" opacity="${(0.12 + rand() * 0.35).toFixed(2)}"/>`;
  }).join('');
  const starEls = stars
    .map(
      ([x, y, r, label]) => `
      <circle cx="${x}" cy="${y}" r="${r * 2.4}" fill="url(#halo)"/>
      <circle cx="${x}" cy="${y}" r="${r / 2}" fill="rgb(${LAMP.join(',')})"/>
      ${label ? `<text x="${x}" y="${y + (y < 300 ? -22 : 34)}" text-anchor="middle" class="label">${label}</text>` : ''}`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style>
      @font-face { font-family: 'Newsreader'; src: url(data:font/woff2;base64,${serif}) format('woff2'); font-weight: 200 800; }
      @font-face { font-family: 'Instrument Sans'; src: url(data:font/woff2;base64,${sans}) format('woff2'); font-weight: 400 700; }
      .word { font-family: 'Newsreader'; font-size: 112px; font-weight: 380; letter-spacing: -2px; fill: #ebe8f3; }
      .line { font-family: 'Newsreader'; font-size: 40px; font-weight: 360; fill: #b3afc6; }
      .label { font-family: 'Instrument Sans'; font-size: 20px; fill: ${DUSK}; }
    </style>
    <radialGradient id="lamp" cx="22%" cy="70%" r="70%">
      <stop offset="0" stop-color="rgb(227,182,94)" stop-opacity=".14"/>
      <stop offset="1" stop-color="rgb(227,182,94)" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo">
      <stop offset="0" stop-color="rgb(227,182,94)" stop-opacity=".55"/>
      <stop offset="1" stop-color="rgb(227,182,94)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${INK}"/>
  <rect width="1200" height="630" fill="url(#lamp)"/>
  ${dust}
  ${lines}
  ${starEls}
  <text x="88" y="330" class="word">Solace</text>
  <text x="92" y="400" class="line">A private journal that remembers.</text>
</svg>`;
}

async function og() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    ({ chromium } = await import('@playwright/test'));
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:${INK}">${ogSvg()}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await sharp(shot).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(pub, 'og.png'));
    console.log('wrote og.png');
  } finally {
    await browser.close();
  }
}

const art = await lineArt();
await icon(art, 192, { scale: 0.7, rounded: true, file: 'icon-192.png' });
await icon(art, 512, { scale: 0.7, rounded: true, file: 'icon-512.png' });
// Maskable: full-bleed background, artwork inside the 80% safe zone.
await icon(art, 512, { scale: 0.56, rounded: false, file: 'icon-maskable-512.png' });
// iOS applies its own corner mask.
await icon(art, 180, { scale: 0.66, rounded: false, file: 'apple-touch-icon.png' });
await og();
