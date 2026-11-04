import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import {z, ZodError, ZodSafeParseResult} from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { encryptField } from '../utils/crypto.js';
import { recordAuditLog } from '../utils/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const accountRouter = Router();

// All account routes require a valid 15-min Bearer Access Tplem
accountRouter.use(requireAuth)

const createAccountSchema = z.object({
  creditLimitCents: z
    .number()
    .int('Credit limit must be in integer cents')
    .min(10000, 'Minimum credit limit is $100.00 (10000 cents)')
    .max(10000000, 'Maximum credit limit is $100,000.00 (10000000 cents)'),
});

const transferSchema = z.object({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amountCents: z
    .number()
    .int('Transfer amount must be in integer cents')
    .positive('Transfer amount must be greater than zero')
    .max(5000000, 'Single transfer cannot exceed $50,000.00'),
  description: z.string().trim().min(3).max(140),
  idempotencyKey: z.uuid('idempotencyKey must be a valid UUID v4'),
});

const freezeSchema = z.object({
  isFrozen: z.boolean(),
  reason: z.string().trim().min(5).max(200),
});


/**
 * Helper: Generates a cryptographically secure 16-digit account number
 */
function generateSecureAccountNumber(): string {
  let digits = '4000'; // VaultCore issuer prefix
  for (let i = 0; i < 12; i++) {
    digits += crypto.randomInt(0, 10).toString();
  }
  return digits;
}

// ***************************************
// 1. POST /api/v1/accounts
// Open a new Credit Account (Encrypted Account Number)
// ***************************************
accountRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'Invalid account parameters', details: z.treeifyError(parsed.error)});
    return;
  }

  const userId = req.user!.id;
  const rawAccountNumber = generateSecureAccountNumber();
  const accountNumberEnc = encryptField(rawAccountNumber);
  const accountLastFour = rawAccountNumber.slice(-4);

  // MODEL: Create new credit account instance and select only fields without sensitive account number
  const account = await prisma.creditAccount.create({
    data: {
      userId,
      accountNumberEnc,
      accountLastFour,
      creditLimitCents: parsed.data.creditLimitCents,
      balanceCents: 0,
    },
    // SECURITY: Never select or return accountNumberEnc in standard responses
    select: {
      id: true,
      accountLastFour: true,
      creditLimitCents: true,
      balanceCents: true,
      isFrozen: true,
      createdAt: true,
    },
  });

  await recordAuditLog({
    req,
    actorId: userId,
    action: 'CREDIT_ACCOUNT_CREATED',
    resourceId: account.id,
    metadata: { creditLimitCents: account.creditLimitCents, accountLastFour },
  });
  res.status(201).json({ account });
});


// ***************************************
// 2. GET /api/v1/accounts
// List user's Credit Accounts (Masked by default)
// ***************************************
accountRouter.get('/accounts', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const accounts = await prisma.creditAccount.findMany({
    where: { userId },
    select: {
      id: true,
      accountLastFour: true,
      creditLimitCents: true,
      balanceCents: true,
      isFrozen: true,
      createdAt: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amountCents: true,
          description: true,
          idempotencyKey: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ accounts });
});

// ***************************************
// 3. POST /api/v1/accounts/transfer
// Atomic, Idempotent Double-Entry Credit Transfer
// ***************************************
accountRouter.post('/transfer', async (req: Request, res: Response) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid transfer payload', details: z.treeifyError(parsed.error) });
    return;
  }

  // Destructure validated transfer parameters from request body
  const {
    fromAccountId,
    toAccountId,
    amountCents,
    description,
    idempotencyKey } = parsed.data;
  const actorId = req.user!.id;

  // Block self-transfer attempts
  if (fromAccountId === toAccountId) {
    res.status(400).json({ error: 'Source and destination accounts cannot be identical' });
    return;
  }

  const debitKey = `${idempotencyKey}:debit`;
  const creditKey = `${idempotencyKey}:credit`;

  try {
    // Check if this exact idempotencyKey was already processed (Safe Network Retry)
    const existingEntry = await prisma.ledgerEntry.findUnique({
      where: { idempotencyKey: debitKey },
    });

    if (existingEntry) {
      res.status(200).json({
        status: 'idempotent_replay',
        message: 'Transfer already processed safely; returning original receipt.',
        ledgerEntryId: existingEntry.id,
      });
      return;
    }

    // Execute Serializable ACID Transaction
    const result = await prisma.$transaction(
      async (tx) => {
        const sourceAccount = await tx.creditAccount.findUnique({
          where: { id: fromAccountId },
        });

        const destAccount = await tx.creditAccount.findUnique({
          where: { id: toAccountId },
        });

        if (!sourceAccount || !destAccount) {
          throw new Error('ACCOUNT_NOT_FOUND');
        }

        // BOLA / IDOR Protection: Verify caller actually owns the source account
        if (sourceAccount.userId !== actorId) {
          throw new Error('FORBIDDEN_ACCOUNT_OWNERSHIP');
        }

        if (sourceAccount.isFrozen || destAccount.isFrozen) {
          throw new Error('ACCOUNT_FROZEN');
        }

        // Verify credit availability (balanceCents + amountCents <= creditLimitCents)
        if (sourceAccount.balanceCents + amountCents > sourceAccount.creditLimitCents) {
          throw new Error('CREDIT_LIMIT_EXCEEDED');
        }

        // 1. Append immutable debit entry to source account (increases credit balance used)
        const debitEntry = await tx.ledgerEntry.create({
          data: {
            accountId: sourceAccount.id,
            amountCents: amountCents,
            description: `Transfer to ••••${destAccount.accountLastFour}: ${description}`,
            idempotencyKey: debitKey,
          },
        });

        // 2. Append immutable credit entry to destination account (reduces credit balance owed)
        await tx.ledgerEntry.create({
          data: {
            accountId: destAccount.id,
            amountCents: -amountCents,
            description: `Transfer from ••••${sourceAccount.accountLastFour}: ${description}`,
            idempotencyKey: creditKey,
          },
        });

        // 3. Update cached balances atomically
        const updatedSource = await tx.creditAccount.update({
          where: { id: sourceAccount.id },
          data: {
            balanceCents: {
              increment: amountCents
            }
          },
          select: {
            id: true,
            balanceCents: true,
            creditLimitCents: true
          },
        });

        await tx.creditAccount.update({
          where: { id: destAccount.id },
          data: {
            balanceCents: {
              decrement: amountCents
            }
          },
        });

        return { debitEntry, updatedSource };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    await recordAuditLog({
      req,
      actorId,
      action: 'CREDIT_TRANSFER_COMPLETED',
      resourceId: fromAccountId,
      metadata: {
        toAccountId,
        amountCents,
        idempotencyKey,
      },
    });

    res.status(201).json({
      status: 'completed',
      ledgerEntryId: result.debitEntry.id,
      updatedAccount: result.updatedSource,
    });

  } catch (err: any) {
    const code = err?.message;

    if (code === 'FORBIDDEN_ACCOUNT_OWNERSHIP') {

      await recordAuditLog({
        req,
        actorId,
        action: 'BOLA_UNAUTHORIZED_TRANSFER_ATTEMPT',
        resourceId: fromAccountId,
      });

      res.status(403).json({ error: 'Forbidden: You do not own the source credit account' });

      return;
    }

    if (code === 'ACCOUNT_NOT_FOUND') {
      res.status(404).json({ error: 'One or both credit accounts could not be found' });
      return;
    }

    if (code === 'ACCOUNT_FROZEN') {
      res.status(423).json({ error: 'Transaction rejected: One or both credit accounts are currently frozen' });
      return;
    }

    if (code === 'CREDIT_LIMIT_EXCEEDED') {
      res.status(422).json({ error: 'Transaction declined: Insufficient available credit limit' });
      return;
    }

    throw err;
  }
});

// ***************************************
// 4. PATCH /api/v1/accounts/:accountId/freeze
// Analyst/Admin Account Freeze Control
// ***************************************
accountRouter.patch(
  '/:accountId/freeze',
  requireRole('CREDIT_ANALYST', 'SECURITY_ADMIN'),
  async (req: Request, res: Response) => {
    const parsed = freezeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: z.treeifyError(parsed.error) });
      return;
    }

    const { accountId } = req.params as { accountId: string };
    const { isFrozen, reason } = parsed.data;

    const updated = await prisma.creditAccount.update({
      where: { id: accountId },
      data: { isFrozen },
      select: { id: true, accountLastFour: true, isFrozen: true, updatedAt: true },
    });

    await recordAuditLog({
      req,
      actorId: req.user!.id,
      action: isFrozen ? 'ACCOUNT_FROZEN_BY_ANALYST' : 'ACCOUNT_UNFROZEN_BY_ANALYST',
      resourceId: updated.id,
      metadata: { reason, isFrozen },
    });

    res.json({ account: updated });
  }
);