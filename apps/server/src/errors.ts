import { z } from 'zod';

/** Domain error codes from docs/SPEC-server.md — always SCREAMING_SNAKE. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'OVERSEER_ALREADY_CHOSEN'
  | 'UNKNOWN_PRESET'
  | 'NO_BASE'
  | 'INVALID_TARGET'
  | 'MISSIONS_AT_CAPACITY'
  // the Bar (GDD §H)
  | 'RECRUIT_UNAVAILABLE'
  | 'NO_RECRUIT_SLOTS'
  | 'ROLE_TAKEN'
  | 'INSUFFICIENT_CAPS'
  | 'NO_POINTS'
  // research and discovery (GDD §B9, §F2-§F4)
  | 'RESEARCH_BUSY'
  | 'NO_RESEARCH_LEAD'
  | 'RESEARCH_OPTION_LOCKED'
  | 'RESEARCH_EXHAUSTED'
  // assignees (GDD §G)
  | 'NO_ASSIGNEES'
  | 'ASSIGNEES_AT_CAP'
  | 'NO_PROFESSOR'
  | 'MISSION_NEEDS_OFFICER'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  OVERSEER_ALREADY_CHOSEN: 409,
  UNKNOWN_PRESET: 400,
  NO_BASE: 409,
  INVALID_TARGET: 400,
  MISSIONS_AT_CAPACITY: 409,
  RECRUIT_UNAVAILABLE: 409,
  NO_RECRUIT_SLOTS: 409,
  ROLE_TAKEN: 409,
  INSUFFICIENT_CAPS: 409,
  NO_POINTS: 409,
  RESEARCH_BUSY: 409,
  NO_RESEARCH_LEAD: 409,
  RESEARCH_OPTION_LOCKED: 409,
  RESEARCH_EXHAUSTED: 409,
  NO_ASSIGNEES: 409,
  ASSIGNEES_AT_CAP: 409,
  NO_PROFESSOR: 409,
  MISSION_NEEDS_OFFICER: 409,
  INTERNAL: 500,
};

/** A thrown domain error the central error handler maps to the `{error:{code,message}}` envelope. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }
}

/** Parse a request body with a shared Zod schema; a failure becomes a 400 VALIDATION_ERROR. */
export function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', z.prettifyError(result.error));
  }
  return result.data;
}
