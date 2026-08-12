import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./frontline.sqlite'),
  JWT_SECRET: z.string().min(1).default('dev-secret-change-me'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  jwtSecret: string;
  corsOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databasePath: parsed.DATABASE_PATH,
    jwtSecret: parsed.JWT_SECRET,
    corsOrigin: parsed.CORS_ORIGIN,
  };
}
