// Baseline's server on Mavis: stores locks (only the tlock ciphertext of the
// removal password, never the password itself), the journal and the progress
// numbers, and serves the status PWA. It's reachable only over the tailnet.
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { normalizeDomain } from '../shared/apps.ts';
import { timeUnlock } from '../shared/timelock.ts';
import type { AllowedApp, Lock } from '../shared/types.ts';
import { db, PHOTO_DIR, save } from './db.ts';
import { currentLock, localDate, lockView, mondayOf, summarize } from './stats.ts';

const PORT = Number(process.env.PORT ?? 3020);
const DIST = path.resolve('dist/pwa');
const DAY = 86_400_000;
const MAX_TRIAL_DAYS = 7;
const MIN_LOCK_DAYS = 90;

const app = express();
app.use(express.json({ limit: '12mb' }));

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date();
const findLock = (id: string): Lock => {
  const lock = db.locks.find(l => l.id === id);
  if (!lock) throw new HttpError(404, 'No such lock');
  return lock;
};
const view = (lock: Lock) => lockView(lock, now());

// Wraps a handler so a thrown HttpError becomes a JSON error response.
const route = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      next(err);
    }
  };

function parseLockSettings(body: Record<string, unknown>) {
  const durationDays = Math.round(Number(body.durationDays));
  if (!(durationDays >= MIN_LOCK_DAYS)) throw new HttpError(400, `A lock lasts at least ${MIN_LOCK_DAYS} days`);
  const trialDays = Number(body.trialDays ?? MAX_TRIAL_DAYS);
  if (!(trialDays > 0 && trialDays <= MAX_TRIAL_DAYS)) throw new HttpError(400, `The trial is 1 to ${MAX_TRIAL_DAYS} days`);
  const apps = (Array.isArray(body.apps) ? body.apps : []) as AllowedApp[];
  if (!apps.length || apps.some(a => typeof a?.bundleId !== 'string')) throw new HttpError(400, 'Pick at least one app');
  const domains = (Array.isArray(body.domains) ? body.domains : []).map(d => normalizeDomain(String(d)));
  if (domains.some(d => d === null)) throw new HttpError(400, 'One of the domains is not valid');
  const baseline = body.baselineDailyMinutes == null ? null : Math.round(Number(body.baselineDailyMinutes));
  return {
    durationDays,
    trialDays,
    apps: apps.map(a => ({ bundleId: a.bundleId, name: String(a.name ?? a.bundleId) })),
    domains: [...new Set(domains as string[])],
    allowWebApps: body.allowWebApps !== false,
    dnsServerUrl: typeof body.dnsServerUrl === 'string' && body.dnsServerUrl.startsWith('https://') ? body.dnsServerUrl : null,
    baselineDailyMinutes: baseline != null && baseline >= 0 ? baseline : null,
    device: body.device && typeof body.device === 'object' ? body.device as Lock['device'] : null,
  };
}

// ---- Locks -----------------------------------------------------------------

app.get('/api/summary', route(() => summarize(db, now())));
app.get('/api/locks', route(() => db.locks.map(view).reverse()));
app.get('/api/locks/:id', route(req => view(findLock(req.params.id))));

app.post('/api/locks', route(req => {
  const active = currentLock(db);
  if (active && ['trial', 'sealing', 'locked'].includes(view(active).phase)) {
    throw new HttpError(409, 'There is already an active lock or trial');
  }
  const s = parseLockSettings(req.body);
  const created = now();
  const lock: Lock = {
    id: randomUUID(),
    createdAt: created.toISOString(),
    status: 'trial',
    trialEndsAt: new Date(created.getTime() + s.trialDays * DAY).toISOString(),
    durationDays: s.durationDays,
    apps: s.apps,
    domains: s.domains,
    allowWebApps: s.allowWebApps,
    dnsServerUrl: s.dnsServerUrl,
    baselineDailyMinutes: s.baselineDailyMinutes,
    profileIdentifier: 'xyz.amarzbar.baseline.lock',
    device: s.device,
    sealedAt: null,
    unlockAt: null,
    round: null,
    ciphertext: null,
    profileSeenAt: null,
  };
  db.locks.push(lock);
  save();
  return view(lock);
}));

// Change a trial's settings. The trial's end date stays where it was.
app.put('/api/locks/:id', route(req => {
  const lock = findLock(req.params.id);
  if (view(lock).phase !== 'trial') throw new HttpError(409, 'Only a running trial can be changed');
  const { trialDays: _t, ...s } = parseLockSettings(req.body);
  Object.assign(lock, s);
  save();
  return view(lock);
}));

app.post('/api/locks/:id/cancel', route(req => {
  const lock = findLock(req.params.id);
  if (lock.status !== 'trial') throw new HttpError(409, 'Only a trial can be cancelled');
  lock.status = 'cancelled';
  save();
  return view(lock);
}));

// Step 1 of sealing: store the time-locked password before the profile goes
// on the phone, so a sealed profile never exists without its ciphertext.
app.post('/api/locks/:id/seal', route(req => {
  const lock = findLock(req.params.id);
  if (view(lock).phase !== 'trial') throw new HttpError(409, 'Only a running trial can be sealed');
  const { round, unlockAt, ciphertext } = req.body ?? {};
  const unlock = new Date(String(unlockAt));
  const earliest = now().getTime() + lock.durationDays * DAY - 10 * 60_000;
  if (Number.isNaN(unlock.getTime()) || unlock.getTime() < earliest) {
    throw new HttpError(400, `The unlock date must be ${lock.durationDays} days from now`);
  }
  if (!Number.isInteger(round) || typeof ciphertext !== 'string' || !ciphertext.includes('BEGIN AGE ENCRYPTED FILE')) {
    throw new HttpError(400, 'Missing the time-locked password');
  }
  Object.assign(lock, { status: 'sealing', round, unlockAt: unlock.toISOString(), ciphertext });
  save();
  return view(lock);
}));

// Step 2: the Mac confirms the locked profile is on the phone.
app.post('/api/locks/:id/sealed', route(req => {
  const lock = findLock(req.params.id);
  if (lock.status !== 'sealing') throw new HttpError(409, 'This lock is not being sealed');
  Object.assign(lock, { status: 'sealed', sealedAt: now().toISOString(), profileSeenAt: now().toISOString() });
  save();
  return view(lock);
}));

// The profile didn't install: back to the trial, and the ciphertext goes.
app.post('/api/locks/:id/seal-failed', route(req => {
  const lock = findLock(req.params.id);
  if (lock.status !== 'sealing') throw new HttpError(409, 'This lock is not being sealed');
  Object.assign(lock, { status: 'trial', round: null, unlockAt: null, ciphertext: null });
  save();
  return view(lock);
}));

app.post('/api/locks/:id/seen', route(req => {
  const lock = findLock(req.params.id);
  if (req.body?.installed) lock.profileSeenAt = now().toISOString();
  save();
  return view(lock);
}));

// Opens the time-lock. drand, not this server, decides whether it's time.
app.post('/api/locks/:id/reveal', route(async (req, res) => {
  const lock = findLock(req.params.id);
  if (lock.status !== 'sealed' && lock.status !== 'removed') throw new HttpError(409, 'This lock was never sealed');
  if (!lock.ciphertext) throw new HttpError(500, 'The time-locked password is missing');
  const password = await timeUnlock(lock.ciphertext);
  if (password === null) {
    res.status(423).json({ error: 'Still locked', unlockAt: lock.unlockAt });
    return;
  }
  return { password };
}));

app.post('/api/locks/:id/removed', route(req => {
  const lock = findLock(req.params.id);
  if (!['unlockable', 'trial', 'trial-expired'].includes(view(lock).phase)) {
    throw new HttpError(409, 'This lock is still running');
  }
  lock.status = lock.status === 'trial' ? 'cancelled' : 'removed';
  save();
  return view(lock);
}));

// ---- Journal ---------------------------------------------------------------

app.get('/api/journal', route(() => [...db.journal].reverse()));

app.post('/api/journal', route(req => {
  const { title, body, tags, photo } = req.body ?? {};
  if (!String(title ?? '').trim() && !photo) throw new HttpError(400, 'Add a title or a photo');
  let file: string | null = null;
  if (typeof photo === 'string') {
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(photo);
    if (!m) throw new HttpError(400, 'Photos must be JPEG, PNG or WebP');
    file = `${randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    writeFileSync(path.join(PHOTO_DIR, file), Buffer.from(m[2], 'base64'));
  }
  const entry = {
    id: randomUUID(),
    createdAt: now().toISOString(),
    title: String(title ?? '').trim().slice(0, 140),
    body: String(body ?? '').trim().slice(0, 4000),
    tags: Array.isArray(tags) ? tags.map(String).slice(0, 6) : [],
    photo: file,
  };
  db.journal.push(entry);
  save();
  return entry;
}));

app.delete('/api/journal/:id', route(req => {
  const i = db.journal.findIndex(j => j.id === req.params.id);
  if (i < 0) throw new HttpError(404, 'No such entry');
  const [entry] = db.journal.splice(i, 1);
  if (entry.photo && existsSync(path.join(PHOTO_DIR, entry.photo))) unlinkSync(path.join(PHOTO_DIR, entry.photo));
  save();
}));

app.use('/photos', express.static(PHOTO_DIR, { maxAge: '30d', immutable: true }));

// ---- Progress --------------------------------------------------------------

// Weekly screen time, typed in from Settings → Screen Time.
app.post('/api/screentime', route(req => {
  const minutes = Math.round(Number(req.body?.avgDailyMinutes));
  if (!(minutes >= 0 && minutes < 24 * 60)) throw new HttpError(400, 'Daily average must be in minutes');
  const weekStart = req.body?.weekStart ? mondayOf(new Date(`${req.body.weekStart}T12:00:00`)) : mondayOf(now());
  db.screenTime = db.screenTime.filter(w => w.weekStart !== weekStart);
  db.screenTime.push({ weekStart, avgDailyMinutes: minutes });
  save();
  return { weekStart, avgDailyMinutes: minutes };
}));

// Daily health numbers, posted by an iOS Shortcut. Shortcuts sends numbers
// as text, hence the Number() calls.
app.post('/api/health', route(req => {
  const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : localDate(now());
  const steps = Math.max(0, Math.round(Number(req.body?.steps ?? 0)) || 0);
  const workouts = Math.max(0, Math.round(Number(req.body?.workouts ?? 0)) || 0);
  db.health = db.health.filter(h => h.date !== date);
  db.health.push({ date, steps, workouts });
  save();
  return { date, steps, workouts };
}));

// ---- PWA -------------------------------------------------------------------

app.use(express.static(DIST, { index: false, maxAge: '1h' }));
app.get(/^\/(?!api\/|photos\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err instanceof Error ? err.message : 'Something went wrong' });
});

app.listen(PORT, () => console.log(`Baseline server on :${PORT}`));
