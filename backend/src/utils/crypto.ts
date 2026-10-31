// backend/src/utils/crypto.ts

import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV recommended by NIST for AES-GCM
const MASTER_KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

/**
 * Encrypts sensitive plaintext (e.g., SSN, Account Number, MFA Secret)
 * Returns format: ivHex:authTagHex:ciphertextHex
 */
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts and verifies authenticity of an AES-256-GCM payload
 */
export function decryptField(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Security integrity error: Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Security integrity error: Corrupted encrypted payload components');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    MASTER_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}