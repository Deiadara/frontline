import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The production Content-Security-Policy, and the three facts about the client it stands on
 * (security pass, 2026-09-30).
 *
 * The policy lives in `deploy/Caddyfile`, which nothing runs in development or in the e2e suite, so
 * a change that breaks it is invisible until the day it is deployed: an inline `<script>` added to
 * `index.html` works in every run here and is a blank page in production. What this cannot see is
 * the built bundle doing something new at run time. That was measured by serving the production
 * build under this exact header and walking every screen in Playwright (`docs/DEPLOY.md`).
 */

const caddyfile = readFileSync('../deploy/Caddyfile', 'utf8');

function policy(): Map<string, string[]> {
  const header = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1];
  if (!header) throw new Error('deploy/Caddyfile sets no Content-Security-Policy');
  return new Map(
    header
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((words) => words[0])
      .map(([name, ...sources]) => [name!, sources]),
  );
}

describe('the production policy', () => {
  it('runs script from this origin and nothing else, never an inline or evaluated one', () => {
    expect(policy().get('script-src')).toEqual(["'self'"]);
  });

  it('takes styles from this origin only', () => {
    expect(policy().get('style-src')).toEqual(["'self'"]);
  });

  it('starts from nothing, so a kind of load nobody listed is refused', () => {
    expect(policy().get('default-src')).toEqual(["'none'"]);
  });

  it('talks to this origin only, the API and its live channel included', () => {
    expect(policy().get('connect-src')).toEqual(["'self'"]);
  });

  it('cannot be framed, cannot load plugins, and cannot move its own base', () => {
    const csp = policy();
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
  });

  it('names no third-party host anywhere', () => {
    const hosts = [...policy().values()].flat().filter((source) => /[.:]/.test(source));
    // `data:` is the only scheme allowed, for the SVG patterns Vite inlines into the stylesheet.
    expect(hosts).toEqual(['data:']);
  });

  it('sits beside the other headers that close a door by default', () => {
    expect(caddyfile).toMatch(/^\s*X-Content-Type-Options nosniff$/m);
    expect(caddyfile).toMatch(/^\s*Referrer-Policy no-referrer$/m);
    expect(caddyfile).toMatch(/^\s*X-Frame-Options DENY$/m);
  });
});

describe('what the client does that the policy allows', () => {
  const html = readFileSync('../apps/client/index.html', 'utf8');

  it('has no inline script in its page', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body!.trim()).toBe('');
    }
  });

  it('has no inline style in its page', () => {
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
  });

  /*
   * Zod compiles schemas with `new Function` unless told not to, and the policy refuses that on
   * every page load. The switch has to run before `@frontline/shared` builds its first schema,
   * so it has to be the entry point's first import.
   */
  it('turns Zod’s compiler off before anything else loads', () => {
    const entry = readFileSync('../apps/client/src/main.tsx', 'utf8');
    expect(/^import\s+['"]([^'"]+)['"]/m.exec(entry)?.index).toBe(entry.indexOf('import'));
    expect(entry).toMatch(/^import '\.\/zod-jitless';$/m);
    expect(readFileSync('../apps/client/src/zod-jitless.ts', 'utf8')).toMatch(
      /z\.config\(\{ jitless: true \}\)/,
    );
  });
});
