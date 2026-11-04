import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { encryptField } from '../utils/crypto.js';
import { recordAuditLog } from '../utils/audit.js';
import {
  storeRefreshSession,
  isRefreshSessionValid,
  revokeRefreshSession,
} from '../db/redis.js';
import {authLimiter} from "../middleware/ratelimiter";


export const authRouter = Router();

const registerSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must match format XXX-XX-XXXX'),
});

const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1),
});

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie('vaultcore_refresh', refreshToken, {
    httpOnly: true, // Invisible to client-side JavaScript (XSS protection)
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict', // CSRF protection
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_EXPIRES_IN_SECONDS * 1000,
  });
}

/***************************************
*     POST /api/v1/auth/register
***************************************/
authRouter.post(
  '/register',
  authLimiter,
  async (
    req: Request,
    res: Response
  ) => {

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: z.treeifyError(parsed.error)
      });
      return;
    }

  const { email, password, ssn } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    // Generic message to prevent email enumeration
    res.status(409).json({ error: 'Unable to complete registration with provided credentials' });
    return;
  }

  // -- At this point, we have validated the input and confirmed the user does not exist --

  // Hash password with memory-hard Argon2id
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
  });

  // Encrypt full SSN using Phase 2 AES-256-GCM utility & extract safe last 4 digits
  const ssnEncrypted = encryptField(ssn);
  const ssnLastFour = ssn.slice(-4);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      ssnEncrypted,
      ssnLastFour,
    },
    select: {
      id: true,
      email: true,
      role: true,
      ssnLastFour: true,
      createdAt: true
    },
  });

  await recordAuditLog({
    req,
    actorId: user.id,
    action: 'USER_REGISTERED',
    resourceId: user.id,
    metadata: { email: user.email, role: user.role },
  });

  res.status(201).json({ user });
});


/***************************************
 *     POST /api/v1/auth/login
 ***************************************/
authRouter.post(
  '/login',
  authLimiter,
  async (
    req: Request,
    res: Response
  ) => {

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid credentials format. Error:  ${z.treeifyError(parsed.error)}` });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await recordAuditLog({
      req,
      action: 'LOGIN_FAILED_UNKNOWN_USER',
      metadata: { attemptedEmail: email },
    });
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const validPassword = await argon2.verify(user.passwordHash, password);
  if (!validPassword) {
    await recordAuditLog({
      req,
      actorId: user.id,
      action: 'LOGIN_FAILED_BAD_PASSWORD',
      resourceId: user.id,
    });
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  // -- At this point, we have validated the input and confirmed the user exists --

  // Issue Short-Lived Access Token (15m) + Redis-Tracked Refresh Token (7d)
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign({
    sub: user.id,
    role: user.role
  }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
  });
  const refreshToken = jwt.sign({
    sub: user.id,
    jti
  }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN_SECONDS,
  });

  await storeRefreshSession(
    user.id,
    jti,
    env.JWT_REFRESH_EXPIRES_IN_SECONDS
  );
  setRefreshCookie(
    res,
    refreshToken
  );

  await recordAuditLog({
    req,
    actorId: user.id,
    action: 'LOGIN_SUCCESS',
    resourceId: user.id,
  });

  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      ssnLastFour: user.ssnLastFour,
    },
  });
});


/***************************************
 *     POST /api/v1/auth/refresh (Token Rotation)
 ***************************************/
authRouter.post(
  '/refresh',
  async (
    req: Request,
    res: Response
  ) => {

  const token = req.cookies?.vaultcore_refresh;
  if (!token) {
    res.status(401).json({ error: 'Missing refresh token cookie' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      sub: string;
      jti: string
    };
    const isValid = await isRefreshSessionValid(
      decoded.sub,
      decoded.jti);

    if (!isValid) {
      await recordAuditLog({
        req,
        actorId: decoded.sub,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
      });
      res.clearCookie('vaultcore_refresh', { path: '/api/v1/auth' });
      res.status(401).json({ error: 'Session expired or revoked' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub } });

    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }

    // Rotate token: Revoke old JTI and issue a fresh JTI
    await revokeRefreshSession(user.id, decoded.jti);
    const newJti = crypto.randomUUID();

    const newAccessToken = jwt.sign({
      sub: user.id,
      role: user.role
    }, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
    });

    const newRefreshToken = jwt.sign({
      sub: user.id,
      jti: newJti
    }, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN_SECONDS,
    });

    await storeRefreshSession(
      user.id,
      newJti,
      env.JWT_REFRESH_EXPIRES_IN_SECONDS);

    setRefreshCookie(res, newRefreshToken);

    res.json({ accessToken: newAccessToken });

  } catch {
    // Clear invalid refresh token cookie
    res.clearCookie(
       'vaultcore_refresh', {
      path: '/api/v1/auth' });
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});


/***************************************
 *     POST /api/v1/auth/logout
 ***************************************/
authRouter.post(
  '/logout',
  async (
    req: Request,
    res: Response
  ) => {
  const token = req.cookies?.vaultcore_refresh;
  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; jti: string };
      await revokeRefreshSession(decoded.sub, decoded.jti);
      await recordAuditLog({
        req,
        actorId: decoded.sub,
        action: 'LOGOUT_SUCCESS',
      });
    } catch {
      // Ignore invalid token on logout, still clear cookie
    }
  }

  res.clearCookie('vaultcore_refresh', { path: '/api/v1/auth' });
  res.status(204).send();
});