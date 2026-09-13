import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/client.ts';
import { config } from '../config/eventConfig.ts';

// In-memory active session tokens map (or verified signed token)
const activeSessions = new Map<string, { userId: string; email: string; role: string; expiresAt: number }>();

// Simple in-memory rate limiting for login attempts
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

export function createAdminSession(user: { id: string; email: string; role: string }): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  activeSessions.set(token, {
    userId: user.id,
    email: user.email,
    role: user.role,
    expiresAt,
  });
  return token;
}

export function destroyAdminSession(token: string) {
  activeSessions.delete(token);
}

export function getAdminSession(token?: string) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

// Express Auth Middleware
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.cookies && req.cookies.admin_session) || (req.headers.authorization?.replace('Bearer ', ''));

  const session = getAdminSession(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' },
    });
  }

  (req as any).adminUser = session;
  next();
}
