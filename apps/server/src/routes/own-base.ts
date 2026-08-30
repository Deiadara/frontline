import type { FastifyInstance } from 'fastify';
import type { Base } from '@frontline/shared';
import { AppError } from '../errors.js';

/**
 * The crew this request belongs to, or a refusal.
 *
 * Every write route needs the same three lines and six of them carried their own copy: five byte
 * for byte, and one (the crew route) that had quietly grown a settle in the middle. That is the
 * shape a duplicated helper always ends up in, and it is the dangerous one: five callers agreeing
 * and a sixth doing something more, with nothing in the type system to say which is which.
 *
 * The extra step lives at its call site now rather than inside a same-named function, so a reader
 * of that route sees the settle at the point it happens instead of having to go and read a local
 * `ownBase` to find out it was there.
 */
export function ownBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}
