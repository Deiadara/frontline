import { describe, expect, it } from 'vitest';
import { assertDeployable, loadConfig } from './config.js';
/**
 * What a production boot refuses to serve.
 *
 * The development JWT secret is in this repository, so a server still using it is one anybody can
 * mint a token for, as any account. It has a default precisely so `pnpm dev` needs no setup, and
 * the cost of that convenience is one forgotten environment variable between a working game and a
 * total authentication bypass. This is the check that makes forgetting it loud.
 */
describe('refusing to deploy an unsafe configuration', () => {
  const config = (env: Record<string, string>) => loadConfig({ DATABASE_PATH: ':memory:', ...env });

  it('refuses a production boot still carrying the committed development secret', () => {
    expect(() => assertDeployable(config({}), 'production')).toThrow(/JWT_SECRET/);
  });

  it('accepts a production boot with a real secret', () => {
    expect(() =>
      assertDeployable(
        config({ JWT_SECRET: '9f2c47d1b8e0a6f35c1d4e7b2a9f8c06d3e5b1a7c4f2e9d8b0a6c3f1e7d5b2a4' }),
        'production',
      ),
    ).not.toThrow();
  });

  it('refuses a production boot with the Console on, which it is unless somebody says otherwise', () => {
    // A real secret, so the only thing wrong with this configuration is the bench.
    expect(() =>
      assertDeployable(
        config({
          JWT_SECRET: '9f2c47d1b8e0a6f35c1d4e7b2a9f8c06d3e5b1a7c4f2e9d8b0a6c3f1e7d5b2a4',
          ADMIN: 'true',
        }),
        'production',
      ),
    ).toThrow(/ADMIN/);
    expect(() =>
      assertDeployable(
        config({
          JWT_SECRET: '9f2c47d1b8e0a6f35c1d4e7b2a9f8c06d3e5b1a7c4f2e9d8b0a6c3f1e7d5b2a4',
          ADMIN: 'false',
        }),
        'production',
      ),
    ).not.toThrow();
  });

  it('refuses a production secret short enough to guess offline from any token', () => {
    expect(() => assertDeployable(config({ JWT_SECRET: 'a-real-one' }), 'production')).toThrow(
      /shorter than/,
    );
  });

  it('refuses the end-game sandbox in production, where anybody can register the dev name', () => {
    const secret = '9f2c47d1b8e0a6f35c1d4e7b2a9f8c06d3e5b1a7c4f2e9d8b0a6c3f1e7d5b2a4';
    expect(() =>
      assertDeployable(
        config({ JWT_SECRET: secret, ADMIN: 'false', UNLOCKED: 'true' }),
        'production',
      ),
    ).toThrow(/UNLOCKED/);
  });

  it('leaves development and test alone, which is why the default exists', () => {
    expect(() => assertDeployable(config({}), 'development')).not.toThrow();
    expect(() => assertDeployable(config({}), 'test')).not.toThrow();
    expect(() => assertDeployable(config({}), undefined)).not.toThrow();
  });
});
