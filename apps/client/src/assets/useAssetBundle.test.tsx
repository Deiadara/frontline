import { findAssetSpec, type AssetSpec } from '@frontline/shared';
import { render, screen, waitFor } from '@testing-library/react';
import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { AssetBundleName } from './bundles';
import { createArtLoader } from './loader';
import { useAssetBundle } from './useAssetBundle';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`no manifest entry for ${key}`);
  return found;
};

const SPECS: Record<AssetBundleName, readonly AssetSpec[]> = {
  splash: [spec('splash-auth')],
  overseer: [spec('portrait-overseer-1')],
  crew: [],
  city: [spec('plate-city')],
  base: [spec('building-nexus')],
  units: [spec('unit-razors')],
  ui: [spec('ui-frame-panel')],
};

function Probe({ loader }: { loader: ReturnType<typeof createArtLoader> }) {
  const state = useAssetBundle('city', loader);
  return <p data-testid="state">{`${state.status} ${state.progress}`}</p>;
}

describe('useAssetBundle', () => {
  it('renders ready on the first paint when the bundle is fully procedural', () => {
    const loader = createArtLoader({ specs: SPECS, delivered: new Map() });
    render(<Probe loader={loader} />);
    // No intermediate 'idle'/'loading' text ever hits the DOM: nothing to flash.
    expect(screen.getByTestId('state')).toHaveTextContent('ready 1');
  });

  it('re-renders as the delivered files land', async () => {
    let resolve: ((texture: Texture) => void) | undefined;
    const loader = createArtLoader({
      specs: SPECS,
      delivered: new Map([['plate-city.webp', '/art/plate-city.webp']]),
      loadTexture: vi.fn(() => new Promise<Texture>((r) => (resolve = r))),
    });

    render(<Probe loader={loader} />);
    expect(screen.getByTestId('state')).toHaveTextContent('loading 0');

    resolve?.({} as Texture);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready 1'));
  });
});
