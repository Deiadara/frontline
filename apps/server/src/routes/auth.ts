import { randomUUID } from 'node:crypto';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  UserSchema,
  type AuthResponse,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import type { UserRecord } from '../types.js';

const BCRYPT_COST = 10;

function authResponse(app: FastifyInstance, record: UserRecord): AuthResponse {
  const user = UserSchema.parse(record); // strips passwordHash
  return { token: app.jwt.sign({ sub: user.id }), user };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/auth/register', async (request, reply) => {
    const body = parseBody(RegisterRequestSchema, request.body);

    // Hash first, then run the uniqueness check + insert with no `await` between them: on Node's
    // single-threaded loop that keeps them atomic, so two concurrent registrations of the same
    // username can't both pass the check and collide on the DB constraint (which would 500).
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);

    if (app.repos.users.findByUsername(body.username)) {
      throw new AppError('USERNAME_TAKEN', 'That username is already taken');
    }

    const record: UserRecord = {
      id: randomUUID(),
      username: body.username,
      overseerId: null,
      createdAt: new Date().toISOString(),
      passwordHash,
    };
    app.repos.users.insert(record);

    reply.code(201);
    return authResponse(app, record);
  });

  app.post('/auth/login', async (request) => {
    const body = parseBody(LoginRequestSchema, request.body);

    const record = app.repos.users.findByUsername(body.username);
    const passwordMatches = record
      ? await bcrypt.compare(body.password, record.passwordHash)
      : false;
    if (!record || !passwordMatches) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password');
    }

    return authResponse(app, record);
  });
}
