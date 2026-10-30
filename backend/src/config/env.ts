import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Load the root .env file
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.url('DATABASE_URL must be a valid PostgreSQL connection string'),
  REDIS_URL: z.url('REDIS_URL must be a valid Redis connection string'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ CRITICAL SECURITY ERROR: Invalid environment configuration:');
  console.error(z.treeifyError(parsedEnv.error));
  process.exit(1);
}

export const env = parsedEnv.data;