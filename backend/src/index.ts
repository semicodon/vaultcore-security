import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.routes.js';
import { requireAuth } from './middleware/auth.js';
import {apiLimiter} from "./middleware/ratelimiter";

const app = express();

// 1. Disable X-Powered-By header & enforce HTTP Security Headers
app.disable('x-powered-by');
app.use(helmet());

// 2. Strict CORS Configuration (Never use wildcard '*' with credentials)
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
);

// 3. Payload Size Limit (Prevents JSON Body DoS Attacks) & Cookie Parsing
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// 4. Global Redis Rate Limiter
app.use('/api', apiLimiter);

// 5. Health Check Endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'vaultcore-api' });
});

// 6. Mount Zero-Trust Auth Routes
app.use('/api/v1/auth', authRouter);

// 7. Protected Test Route (Verifies Bearer JWT & RBAC context)
app.get('/api/v1/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// 8. Global Sanitized Error Handler (Prevents Stack Trace Leakage)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('❌ Unhandled Application Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    ...(env.NODE_ENV === 'development' && { debug: err.message }),
  });
});

app.listen(env.PORT, () => {
  console.log(`🔒 VaultCore Hardened API listening on [http://127.0.0.1](http://127.0.0.1):${env.PORT}`);
});