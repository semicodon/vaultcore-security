import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAuditLog } from '../utils/audit.js';

export const adminRouter = Router();

// All routes in this router require a valid Bearer JWT
adminRouter.use(requireAuth);

const freezeAccountSchema = z.object({
  isFrozen: z.boolean(),
  reason: z
    .string()
    .trim()
    .min(5, 'Incident reason must be at least 5 characters for compliance auditing')
    .max(250, 'Incident reason cannot exceed 250 characters'),
});

/**
 * Computes a deterministic SHA-256 integrity fingerprint for an audit log row
 */
function computeAuditFingerprint(log: {
  id: string;
  actorId: string | null;
  action: string;
  resourceId: string | null;
  ipAddress: string;
  createdAt: Date;
}): string {
  const canonicalPayload = [
    log.id,
    log.actorId ?? 'ANONYMOUS',
    log.action,
    log.resourceId ?? 'NONE',
    log.ipAddress,
    log.createdAt.toISOString(),
  ].join('|');

  return crypto.createHash('sha256').update(canonicalPayload).digest('hex').slice(0, 16);
}


// ============================================================================
// 1. GET /api/v1/admin/audit-logs
// Tamper-Evident Security Audit Log Stream (SECURITY_ADMIN & CREDIT_ANALYST)
// ============================================================================
adminRouter.get(
  '/audit-logs',
  requireRole('SECURITY_ADMIN', 'CREDIT_ANALYST'),
  async (req: Request, res: Response) => {

    const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const logs = await prisma.auditLog.findMany({
      where: actionFilter ? { action: actionFilter } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const enrichedLogs = logs.map((log) => ({
      ...log,
      integrityHash: computeAuditFingerprint(log),
    }));

    res.json({ logs: enrichedLogs });
  }
);


// ============================================================================
// 2. GET /api/v1/admin/accounts
// Overview of All Credit Accounts (Masked by Default - Least Privilege)
// ============================================================================
adminRouter.get(
  '/accounts',
  requireRole('SECURITY_ADMIN', 'CREDIT_ANALYST'),
  async (_req: Request, res: Response) => {

    const accounts = await prisma.creditAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        accountLastFour: true,
        creditLimitCents: true,
        balanceCents: true,
        isFrozen: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            ssnLastFour: true,
          },
        },
      },
    });

    res.json({ accounts });
  }
);


// ============================================================================
// 3. PATCH /api/v1/admin/accounts/:accountId/freeze
// Incident Response: Freeze or Unfreeze a Credit Account (SECURITY_ADMIN Only)
// ============================================================================
adminRouter.patch(
  '/accounts/:accountId/freeze',
  requireRole('SECURITY_ADMIN'),
  async (req: Request,
         res: Response) => {

    const accountId = req.params.accountId as string;
    if (!accountId) {
      res.status(400).json({ error: 'Account ID is required' });
      return;
    }

    // Check if the parsed schema contains safe params (non frozen acc)
    const parsed = freezeAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid freeze parameters',
        details: z.treeifyError(parsed.error),
      });
      return;
    }

    const { isFrozen, reason } = parsed.data;

    // Find the existing account
    const existingAccount = await prisma.creditAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        accountLastFour: true,
        isFrozen: true,
        userId: true
      },
    });

    if (!existingAccount) {
      res.status(404).json({ error: 'Credit account not found' });
      return;
    }

    // Update the account in only the isFrozen field
    const updatedAccount = await prisma.creditAccount.update({
      where: { id: accountId },
      data: { isFrozen },
      select: {
        id: true,
        accountLastFour: true,
        creditLimitCents: true,
        balanceCents: true,
        isFrozen: true,
        updatedAt: true,
      },
    });

    // Record the audit log
    await recordAuditLog({
      req,
      actorId: req.user!.id,
      action: isFrozen ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
      resourceId: updatedAccount.id,
      metadata: {
        targetUserId: existingAccount.userId,
        accountLastFour: updatedAccount.accountLastFour,
        previousState: existingAccount.isFrozen,
        newState: isFrozen,
        reason,
      },
    });

    res.json({ account: updatedAccount });
  }
);