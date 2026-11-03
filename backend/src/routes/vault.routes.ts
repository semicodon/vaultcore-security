import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { decryptField } from '../utils/crypto.js';
import { recordAuditLog } from '../utils/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {authLimiter} from "../middleware/ratelimiter";

export const vaultRouter = Router();

vaultRouter.use(requireAuth);

const stepUpSchema = z.object({
  password: z.string().min(1, 'Current password is required for step-up verification'),
  accountId: z.uuid().optional(),
});

/***********************************************
* 1. POST /api/v1/vault/reveal-pii
* Step-Up Auth to Decrypt User's Own SSN & Optional Account Number
************************************************/
vaultRouter.post('/reveal-pii',
  authLimiter, async (
    req: Request,
    res: Response) => {
  const parsed = stepUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Password is required for step-up authentication' });
    return;
  }

  const userId = req.user!.id;
  const { password, accountId } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Verify live presence via memory-hard Argon2id check
  const isPasswordValid = await argon2.verify(user.passwordHash, password);
  if (!isPasswordValid) {
    await recordAuditLog({
      req,
      actorId: userId,
      action: 'STEP_UP_AUTH_FAILED',
      resourceId: userId,
    });
    res.status(401).json({ error: 'Step-up authentication failed: Incorrect password' });
    return;
  }

  // Decrypt SSN in memory using Phase 2 AES-256-GCM utility (verifies GCM authTag automatically)
  const decryptedSsn = user.ssnEncrypted ? decryptField(user.ssnEncrypted) : null;

  let decryptedAccountNumber: string | null = null;
  if (accountId) {
    const account = await prisma.creditAccount.findFirst({
      where: {
        id:
          accountId,
          userId },
    });
    if (!account) {
      res.status(404).json({ error: 'Specified credit account not found for this user' });
      return;
    }
    decryptedAccountNumber = decryptField(account.accountNumberEnc);
  }

  await recordAuditLog({
    req,
    actorId: userId,
    action: 'STEP_UP_PII_REVEALED',
    resourceId: accountId ?? userId,
    metadata: {
      revealedSsn: Boolean(decryptedSsn),
      revealedAccountNumber: Boolean(decryptedAccountNumber),
    },
  });

  // Prevent browser or proxy caching of decrypted sensitive PII
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  res.json({
    ssn: decryptedSsn,
    ...(decryptedAccountNumber && { accountNumber: decryptedAccountNumber }),
    expiresInSeconds: 30, // Hint for frontend UI to auto-mask after 30 seconds
  });
});

/***********************************************
 * 2. GET /api/v1/vault/audit-logs
 * Security Admin & Analyst Compliance Feed
 ************************************************/
vaultRouter.get(
  '/audit-logs',
  requireRole('SECURITY_ADMIN', 'CREDIT_ANALYST'),
  async (req: Request, res: Response) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            role: true
          },
        },
      },
    });

    res.json({ auditLogs: logs });
  }
);