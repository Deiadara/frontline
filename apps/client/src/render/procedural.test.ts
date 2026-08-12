/**
 * Dispatch-only coverage. The painted output itself needs a real GPU/canvas and is verified in
 * Chromium (see `procedural.ts`), so these cases deliberately stop short of constructing Graphics.
 */
import { describe, expect, it } from 'vitest';
import { paintProcedural } from './procedural';
import type { AssetSource } from '../assets/source';

const procedural = (key: string): AssetSource => ({
  kind: 'procedural',
  key,
  class: 'plane',
  seed: 1,
});

describe('paintProcedural', () => {
  it('declines a delivered file — the caller uses the texture instead', () => {
    const file: AssetSource = { kind: 'file', key: 'plane-city-far', url: '/plane-city-far.webp' };
    expect(paintProcedural(file, 800, 600)).toBeNull();
  });

  it('declines an unresolved source', () => {
    expect(paintProcedural(undefined, 800, 600)).toBeNull();
  });

  it('declines a procedural key that is not a map plane', () => {
    // Portraits and icons have their own treatment; they must not silently paint as a skyline.
    expect(paintProcedural(procedural('portrait-vex'), 800, 600)).toBeNull();
  });
});
