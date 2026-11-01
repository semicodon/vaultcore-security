import { Request } from 'express'
import { prisma } from '../db/prisma.js'

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'ssn',
  'ssnEncrypted',
  'accountNumber',
  'accessToken',
  'refreshToken',
  'mfaCode',
]);

/**
 * Recursively scrubs sensitive keys from metadata objects before saving to AuditLog.
 * Record is a type that represents a key-value pair.
 */
function redactMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  // Recursively redact sensitive keys
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      sanitized[key] = '[REDACTED]';

      // else if value is an object, recursively redact and not an array, add to sanitized
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = redactMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value; // else add to sanitized (not sensitive)
    }
  }
  return sanitized;
}

/*
 * Records an audit log entry with sanitized metadata.
 * Never throws errors, only logs them to stderr.
 */
export async function recordAuditLog(params: {
  req: Request;               // The request object containing headers and socket
  actorId?: string | null;    // Actor ID of the user performing the action
  action: string;             // Action is the name of the action performed
  resourceId?: string;        // Resource ID of the resource being audited
  metadata?: Record<string, unknown>; // Metadata is an object containing additional information about the action
}): Promise<void> {
  try {
    const ipAddress =
      (params.req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      params.req.socket.remoteAddress ||
      'unknown';

    const userAgent = params.req.headers['user-agent'] || 'unknown';
    const safeMetadata = params.metadata ? redactMetadata(params.metadata) : undefined;

    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        resourceId: params.resourceId,
        ipAddress,
        userAgent,
        metadata: safeMetadata as any,
      },
    });
  } catch (err) {
    // Never crash the main request if audit logging fails, but alert security stderr
    console.error('❌ AUDIT LOG WRITE FAILURE:', err);
  }
}