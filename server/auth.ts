// One shared secret, BASELINE_TOKEN. The Mac and the Health Shortcut send it
// as a Bearer header; the PWA trades it once for a long-lived HttpOnly cookie
// (an <img> for a journal photo can't send a header).
//
// Even with the token, nobody can open a sealed lock early: that's tlock's job.
// The token keeps the journal private and stops strangers changing a trial.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE = 'baseline';
const YEAR = 365 * 86_400;

const TOKEN = process.env.BASELINE_TOKEN ?? '';
if (TOKEN.length < 16) {
  console.error('Set BASELINE_TOKEN to a secret of at least 16 characters (e.g. `openssl rand -base64 32`).');
  process.exit(1);
}

const SESSION = createHmac('sha256', TOKEN).update('baseline-session-v1').digest('hex');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(req: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}

export function isAuthed(req: Request): boolean {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (bearer && same(bearer, TOKEN)) return true;
  const c = cookie(req);
  return Boolean(c && same(c, SESSION));
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Sign in first' });
}

// Five tries a minute per address. With trust proxy on, req.ip is the client
// address Nginx Proxy Manager forwards in X-Forwarded-For.
const attempts = new Map<string, number[]>();

export function login(req: Request, res: Response): void {
  const ip = String(req.ip);
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= 5) {
    res.status(429).json({ error: 'Too many tries. Wait a minute.' });
    return;
  }
  if (!same(String(req.body?.token ?? ''), TOKEN)) {
    attempts.set(ip, [...recent, now]);
    res.status(401).json({ error: 'That token is not right' });
    return;
  }
  attempts.delete(ip);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${SESSION}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Strict${secure}`);
  res.json({ ok: true });
}
