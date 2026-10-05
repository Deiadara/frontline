import { z } from 'zod';

/**
 * Zod without its compiler, set before any schema exists (security pass, 2026-09-30).
 *
 * Zod compiles object schemas into faster parsers with `new Function`, and finds out whether it may
 * by trying one. The production Content-Security-Policy (`deploy/Caddyfile`) forbids evaluating
 * strings, which is most of what it is for, so the try is refused and the browser reports a
 * violation on every page load. Switched off here, Zod parses the plain way and never asks.
 *
 * Its own module, imported first in `main.tsx`, because the check runs when a schema is built,
 * and `@frontline/shared` builds hundreds of them as it loads: a call placed in `main.tsx` itself
 * would run after every import had already been evaluated.
 */
z.config({ jitless: true });
