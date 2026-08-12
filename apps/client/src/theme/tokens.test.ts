import { describe, expect, it } from 'vitest';
import { hex, palette, ramps, type RampName } from './tokens';

const RAMP_NAMES: readonly RampName[] = [
  'abyss',
  'smog',
  'ferrite',
  'hextech',
  'sear',
  'ember',
  'bile',
  'flesh',
];

describe('ART-BIBLE §2.1 ramps', () => {
  it('declares exactly the eight named ramps', () => {
    expect(Object.keys(ramps)).toEqual([...RAMP_NAMES]);
  });

  it.each(RAMP_NAMES)('%s has five stops in 950→100 order, all lower-hex', (name) => {
    const ramp = ramps[name];
    expect(Object.keys(ramp)).toEqual(['100', '300', '500', '700', '950']);
    for (const value of Object.values(ramp)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('bans pure black and pure white outright (ART-BIBLE §2.3)', () => {
    const all = Object.values(ramps).flatMap((ramp) => Object.values(ramp));
    expect(all).not.toContain('#000000');
    expect(all).not.toContain('#ffffff');
  });

  it('keeps the legacy tokens as aliases into the ramps, not as rival colours', () => {
    expect(palette.night.DEFAULT).toBe(ramps.abyss[700]);
    expect(palette.night.raised).toBe(ramps.abyss[500]);
    expect(palette.night.overlay).toBe(ramps.abyss[300]);
    expect(palette.steel[900]).toBe(ramps.ferrite[950]);
    expect(palette.steel[700]).toBe(ramps.ferrite[700]);
    expect(palette.steel[500]).toBe(ramps.ferrite[500]);
    expect(palette.steel[300]).toBe(ramps.ferrite[300]);
    expect(palette.steel[100]).toBe(ramps.ferrite[100]);
    expect(palette.neon.cyan).toBe(ramps.hextech[300]);
    expect(palette.neon.magenta).toBe(ramps.sear[300]);
    expect(palette.warning).toBe(ramps.ember[300]);
  });
});

describe('hex', () => {
  it('converts a css hex string to the numeric form Pixi wants', () => {
    expect(hex(ramps.hextech[300])).toBe(0x22d3ee);
    expect(hex(ramps.abyss[950])).toBe(0x05070d);
  });
});
