import { ART_MANIFEST, findAssetSpec, type AssetSpec } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { resolveAssetSource, resolveAssetSources, retinaName } from './source';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`no manifest entry for ${key}`);
  return found;
};

const plate = spec('plate-city');

describe('retinaName', () => {
  it('inserts the @2x tag before the extension (ART-BIBLE §6)', () => {
    expect(retinaName('plate-city.webp')).toBe('plate-city@2x.webp');
    expect(retinaName('ui-frame-panel.png')).toBe('ui-frame-panel@2x.png');
  });
});

describe('resolveAssetSource', () => {
  it('falls back to the procedural painter when nothing has been delivered', () => {
    expect(resolveAssetSource(plate, new Map())).toEqual({
      kind: 'procedural',
      key: 'plate-city',
      class: 'plate',
      seed: plate.seed,
    });
  });

  it('prefers a delivered file the moment one appears: the zero-code-change drop-in', () => {
    const delivered = new Map([['plate-city.webp', '/art/plate-city.webp']]);
    expect(resolveAssetSource(plate, delivered)).toEqual({
      kind: 'file',
      key: 'plate-city',
      url: '/art/plate-city.webp',
    });
  });

  it('takes the 2× delivery on a retina display', () => {
    const delivered = new Map([
      ['plate-city.webp', '/art/plate-city.webp'],
      ['plate-city@2x.webp', '/art/plate-city@2x.webp'],
    ]);
    expect(resolveAssetSource(plate, delivered, true)).toMatchObject({
      url: '/art/plate-city@2x.webp',
    });
    expect(resolveAssetSource(plate, delivered, false)).toMatchObject({
      url: '/art/plate-city.webp',
    });
  });

  it('falls back to 1× when only that has been delivered', () => {
    const delivered = new Map([['plate-city.webp', '/art/plate-city.webp']]);
    expect(resolveAssetSource(plate, delivered, true)).toMatchObject({
      url: '/art/plate-city.webp',
    });
  });

  it('ignores a delivered file that belongs to another key', () => {
    const delivered = new Map([['plane-city-sky.webp', '/art/plane-city-sky.webp']]);
    expect(resolveAssetSource(plate, delivered).kind).toBe('procedural');
  });
});

describe('resolveAssetSources', () => {
  it('resolves the whole manifest without ever throwing on a missing file', () => {
    const sources = resolveAssetSources(ART_MANIFEST, new Map());
    expect(sources.size).toBe(ART_MANIFEST.length);
    expect([...sources.values()].every((source) => source.kind === 'procedural')).toBe(true);
  });

  it('mixes delivered and procedural keys in one pass', () => {
    const sources = resolveAssetSources(
      ART_MANIFEST,
      new Map([['plate-city.webp', '/art/plate-city.webp']]),
    );
    expect(sources.get('plate-city')?.kind).toBe('file');
    expect(sources.get('plane-city-sky')?.kind).toBe('procedural');
  });
});
