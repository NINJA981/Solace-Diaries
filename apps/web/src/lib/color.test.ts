import { describe, expect, it } from 'vitest';
import { composite, contrast, isLightColor, mixOklab, parseColor, rgba, toHex } from './color';

describe('parseColor', () => {
  it('reads hex in every length', () => {
    expect(parseColor('#e3b65e')).toEqual({ r: 227, g: 182, b: 94, a: 1 });
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 0.533 });
    expect(parseColor('#13 1a2c')).toBeNull();
  });

  it('reads rgb() in modern and legacy syntax, with alpha', () => {
    expect(parseColor('rgb(227 182 94 / 0.14)')).toEqual({ r: 227, g: 182, b: 94, a: 0.14 });
    expect(parseColor('rgba(227, 182, 94, 0.5)')).toEqual({ r: 227, g: 182, b: 94, a: 0.5 });
    expect(parseColor('rgb(100% 0% 50% / 50%)')).toEqual({ r: 255, g: 0, b: 128, a: 0.5 });
  });

  it('reads hsl(), oklch(), oklab() and color(srgb)', () => {
    expect(parseColor('hsl(0 100% 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('hsl(120deg, 100%, 25%)')).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseColor('oklch(1 0 0)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('oklch(0% 0 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    const brass = parseColor('oklch(0.7889 0.1145 80.5)')!;
    expect(Math.abs(brass.r - 227) + Math.abs(brass.g - 182) + Math.abs(brass.b - 94)).toBeLessThan(12);
    expect(parseColor('oklab(0.5 0 0 / 0.5)')?.a).toBe(0.5);
    expect(parseColor('color(srgb 1 0.5 0)')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
  });

  it('reads keywords and rejects what it doesn’t know', () => {
    expect(parseColor('transparent')?.a).toBe(0);
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('var(--accent)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('rgb(1 2)')).toBeNull();
  });
});

describe('colour maths', () => {
  it('measures WCAG contrast', () => {
    expect(contrast(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 1);
    expect(contrast(parseColor('#777777')!, parseColor('#ffffff')!)).toBeCloseTo(4.48, 2);
  });

  it('composites translucent colours over a background', () => {
    expect(composite({ r: 255, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 255, a: 1 })).toEqual({ r: 128, g: 0, b: 128, a: 1 });
  });

  it('mixes in oklab like CSS color-mix', () => {
    expect(mixOklab(parseColor('#fff')!, parseColor('#000')!, 1)).toEqual(parseColor('#fff'));
    const mid = mixOklab(parseColor('#fff')!, parseColor('#000')!, 0.5);
    expect(mid.r).toBe(mid.g);
    expect(mid.r).toBeGreaterThan(90);
    expect(mid.r).toBeLessThan(110);
  });

  it('tells paper from ink and formats for canvas', () => {
    expect(isLightColor(parseColor('#ebe9f2')!)).toBe(true);
    expect(isLightColor(parseColor('#0f1524')!)).toBe(false);
    expect(rgba({ r: 1, g: 2, b: 3, a: 1 }, 0.25)).toBe('rgba(1, 2, 3, 0.25)');
    expect(toHex({ r: 19, g: 26, b: 44, a: 1 })).toBe('#131a2c');
  });
});
