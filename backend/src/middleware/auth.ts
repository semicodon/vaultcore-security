import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { recordAuditLog } from '../utils/audit.js';
import {Role} from "@prisma/client";

/**
 * JWT Token Payload
 * @property {string} sub - User ID - 'sub' is short for 'subject'
 * @property {Role} role - User role
 */
export interface AuthTokenPayload {
  sub: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
      };
    }
  }
}

/**
 * Middleware to verify JWT access token.
 * @param req
 * @param res
 * @param next
 */
export function requireAuth(req: Request,
                            res: Response,
                            next: NextFunction): void {

  // Validate Bearer token; authHeader is the header value containing the token - e.g. 'Bearer <token>'
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required: Missing Bearer token' });
    return;
  }

  // Extract token from header - <token> from 'Bearer <token>'
  const token = authHeader.slice(7);
  try {
    // JWT verifies token by comparing signature with secret. The secret is stored in env.JWT_ACCESS_SECRET
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthTokenPayload;
    req.user = {
      id: decoded.sub,
      role: decoded.role,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/**
 * Role-Based Access Control (RBAC) Guard. The method checks if the user has the required role. If not, it returns a 403 Forbidden response and logs an audit log entry.
 * @param allowedRoles - Array of roles that are allowed to access the resource
 * @returns Middleware function that checks if the user has the required role
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (req: Request,
                res: Response,
                next: NextFunction): Promise<void> => {

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // If the request user is not in 'allowedRoles' record it in the audit log as an unauthorized attempt.
    if (!allowedRoles.includes(req.user.role)) {
      await recordAuditLog({
        req,
        actorId: req.user.id,
        action: 'UNAUTHORIZED_ROLE_ACCESS_ATTEMPT',
        metadata: {
          requiredRoles: allowedRoles,
          actualRole: req.user.role,
          path: req.originalUrl
        },
      });
      res.status(403).json({ error: 'Forbidden: Insufficient security clearance' });
      return;
    }

    next();
  };
}