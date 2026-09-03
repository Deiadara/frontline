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
      assertDeployable(config({ JWT_SECRET: 'a-real-one' }), 'production'),
    ).not.toThrow();
  });

  it('leaves development and test alone, which is why the default exists', () => {
    expect(() => assertDeployable(config({}), 'development')).not.toThrow();
    expect(() => assertDeployable(config({}), 'test')).not.toThrow();
    expect(() => assertDeployable(config({}), undefined)).not.toThrow();
  });
});
