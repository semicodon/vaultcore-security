import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
  // Only log errors and warnings—never log raw SQL queries in production
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});