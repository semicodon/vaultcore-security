// backend/src/db/prisma.ts

import { env } from '../config/env.js';
import {PrismaClient} from "@prisma/client/extension";

export const prisma = new PrismaClient({
  // Only log errors and warnings—never log raw SQL queries in production as they may contain parameters
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});