import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err.message);
});

/**
 * redis.set(): Stores a valid Refresh Token JTI (JWT ID) in Redis with automatic expiration (TTL)
 */
export async function storeRefreshSession(
  userId: string,
  jti: string,
  ttlSeconds: number): Promise<void> {
    const key = `session:${userId}:${jti}`;
    await redis.set(key, 'active', 'EX', ttlSeconds);
}

/**
 * redis.get(): Checks if a Refresh Token JTI is still valid (has not been revoked or rotated)
 */
export async function isRefreshSessionValid(
  userId: string,
  jti: string): Promise<boolean> {
    const key = `session:${userId}:${jti}`;
    const status = await redis.get(key);
    return status === 'active';
}

/**
 * redis.del(): Instantly revokes a single Refresh Token JTI (used during token rotation or logout)
 */
export async function revokeRefreshSession(
  userId: string,
  jti: string): Promise<void> {
    const key = `session:${userId}:${jti}`;
    await redis.del(key);
}