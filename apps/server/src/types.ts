import type { User } from '@frontline/shared';

/**
 * Server-only user record. `passwordHash` (bcrypt) must NEVER cross the API
 * boundary — strip down to the shared `User` type before responding.
 */
export interface UserRecord extends User {
  passwordHash: string;
}

/** JWT payload — see docs/SPEC-server.md. */
export interface JwtPayload {
  sub: string;
}
