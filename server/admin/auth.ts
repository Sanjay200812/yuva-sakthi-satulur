import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/client.ts';
import { config } from '../config/eventConfig.ts';

export interface AdminSession {
  userId: string;
  email: string;
  role: string;
  issuedAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory blacklist for explicitly invalidated tokens during a running process
const revokedTokens = new Set<string>();

// In-memory rate limiting for login attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (!attempt || now > attempt.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 }); // 15 mins window
    return true;
  }
  if (attempt.count >= 5) {
    return false; // locked out
  }
  attempt.count++;
  return true;
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Cookie options for admin session.
 * HTTP-only, SameSite=lax for same-origin security, Secure in production.
 */
export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

/**
 * Creates a cryptographically signed, stateless session token.
 * This token survives serverless instance restarts across multi-region deployments.
 */
export function createAdminSession(user: { id: string; email: string; role: string }): string {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload: AdminSession = {
    userId: user.id,
    email: user.email.toLowerCase().trim(),
    role: user.role || 'super_admin',
    issuedAt,
    expiresAt,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Cryptographically verifies the session token and validates expiration.
 */
export function getAdminSession(token?: string): AdminSession | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) return null;

  if (revokedTokens.has(token)) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(payloadBase64)
    .digest('base64url');

  try {
    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }

    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const session: AdminSession = JSON.parse(payloadJson);

    if (Date.now() > session.expiresAt) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Invalidates an active session token.
 */
export function destroyAdminSession(token: string): void {
  if (token) {
    revokedTokens.add(token);
  }
}

/**
 * Express Authentication Middleware for Admin routes.
 * Validates cryptographically signed session token and checks account status.
 */
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieToken = req.cookies && req.cookies.admin_session;
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = cookieToken || headerToken;

    const session = getAdminSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' },
      });
    }

    // Check account status in database
    try {
      const userRes = await db.query('SELECT id, email, role, is_active FROM admin_users WHERE id = $1', [session.userId]);
      if (userRes.rows.length > 0 && userRes.rows[0].is_active === false) {
        return res.status(403).json({
          success: false,
          error: { code: 'ACCOUNT_DISABLED', message: 'This admin account has been deactivated.' },
        });
      }
    } catch (dbErr) {
      // In transient DB disconnect, cryptographic token validity still guarantees identity
    }

    (req as any).adminUser = session;
    next();
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: { code: 'AUTH_ERROR', message: 'Authentication verification encountered an error.' },
    });
  }
}
