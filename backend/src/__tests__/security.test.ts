import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { encryptField, decryptField } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { app } from '../index.js';

describe('VaultCore Phase 6 Automated Security Suite', () => {

  describe('AES-256-GCM Field-Level Encryption Engine', () => {

    it('encrypts plaintext with random IVs (non-deterministic ciphertext)', () => {

      const ssn = '123-45-6789';
      const cipherA = encryptField(ssn);
      const cipherB = encryptField(ssn);

      expect(cipherA).not.toEqual(ssn);
      expect(cipherA).not.toEqual(cipherB);
      expect(decryptField(cipherA)).toBe(ssn);
      expect(decryptField(cipherB)).toBe(ssn);
    });


    it('detects single-byte database tampering via GCM AuthTag verification', () => {
      const encrypted = encryptField('999-88-7777');
      const [iv, authTag, ciphertext] = encrypted.split(':');
      const firstChar = ciphertext![0] === 'a' ? 'b' : 'a';
      const tamperedPayload = `${iv}:${authTag}:${firstChar}${ciphertext!.slice(1)}`;
      expect(() => decryptField(tamperedPayload)).toThrow();
    });
  });

// -------------------------------

  describe('HTTP Security Headers & Fingerprinting Prevention', () => {

    it('enforces Helmet security headers and strips X-Powered-By', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });

// -------------------------------

  describe('Zero-Trust JWT & Role-Based Access Control (RBAC)', () => {
    it('blocks unauthenticated requests to protected endpoints with 401', async () => {
      const res = await request(app).get('/api/v1/admin/audit-logs');
      expect(res.status).toBe(401);
    });

    it('rejects tokens signed with an invalid/forged secret key', async () => {
      const forgedToken = jwt.sign(
        { sub: 'fake-user-id', role: 'SECURITY_ADMIN' },
        'wrong-secret-key-from-attacker-000000000000'
      );

      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
    });

    it('blocks a standard CUSTOMER from accessing SECURITY_ADMIN endpoints with 403', async () => {
      const customerToken = jwt.sign(
        { sub: '00000000-0000-0000-0000-000000000000', role: 'CUSTOMER' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '5m' }
      );

      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });
  });
});