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
