// The Mac companion: a local web app (127.0.0.1 only) that reads the phone
// over USB, builds the profile, installs it, and seals it with the time-lock.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { suggestKeep } from '../shared/apps.ts';
import { timeLock, timeUnlock } from '../shared/timelock.ts';
import type { LockView, Summary } from '../shared/types.ts';
import * as cfg from './cfgutil.ts';
import { loadConfig } from './config.ts';
import { serializeProfile } from './profile.ts';

const config = loadConfig();
cfg.setIdentity(config.cert, config.key);
const SERVER = config.server;
// The built UI: next to the bundle when installed from npm (dist/cli → dist/mac),
// or in dist/mac when run from a checkout.
const DIST = [path.join(import.meta.dirname, '../mac'), path.resolve(import.meta.dirname, '../dist/mac')]
  .find(d => existsSync(path.join(d, 'index.html'))) ?? path.resolve('dist/mac');
const DAY = 86_400_000;

const app = express();
app.use(express.json({ limit: '2mb' }));

const route = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      next(err);
    }
  };

async function server<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: globalThis.Response;
  try {
    res = await fetch(`${SERVER}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach the Baseline server at ${SERVER}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data as T;
}

async function requireDevice(): Promise<cfg.Device> {
  const device = await cfg.getDevice();
  if (!device) throw new Error('No iPhone connected. Plug it in and unlock it.');
  if (!device.supervised) throw new Error(`${device.name} is not supervised, so the profile would not be enforced.`);
  return device;
}

function profileFor(lock: LockView, removalPassword?: string): string {
  return serializeProfile({
    identifier: lock.profileIdentifier,
    bundleIds: lock.apps.map(a => a.bundleId),
    allowWebApps: lock.allowWebApps,
    domains: lock.domains,
    dnsServerUrl: lock.dnsServerUrl,
    removalPassword,
  });
}

app.get('/api/config', route(() => ({
  server: SERVER,
  hasIdentity: Boolean(config.cert && config.key),
})));

app.get('/api/device', route(async () => ({ device: await cfg.getDevice() })));

app.get('/api/apps', route(async () => {
  const device = await requireDevice();
  const apps = await cfg.getInstalledApps(device.ecid);
  return apps.map(a => ({ ...a, suggested: suggestKeep(a) }));
}));

const icons = new Map<string, Buffer | null>();
app.get('/api/icon/:bundleId', async (req, res) => {
  const id = req.params.bundleId;
  if (!icons.has(id)) {
    const device = await cfg.getDevice().catch(() => null);
    icons.set(id, device ? await cfg.getAppIcon(device.ecid, id) : null);
  }
  const png = icons.get(id);
  if (!png) return void res.status(404).end();
  res.type('png').set('Cache-Control', 'max-age=86400').send(png);
});

// Find an app by name on the App Store, for apps not installed yet.
app.get('/api/appstore', route(async req => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return [];
  const url = `https://itunes.apple.com/search?entity=software&country=${process.env.APPSTORE_COUNTRY ?? 'ca'}&limit=12&term=${encodeURIComponent(q)}`;
  const data = await (await fetch(url)).json() as { results: Record<string, string>[] };
  return data.results.map(r => ({ bundleId: r.bundleId, name: r.trackName, seller: r.sellerName, icon: r.artworkUrl100 }));
}));

// The current lock, and whether its profile is on the phone right now.
app.get('/api/lock', route(async () => {
  const { lock } = await server<Summary>('GET', '/api/summary');
  let installed: boolean | null = null;
  const device = await cfg.getDevice().catch(() => null);
  if (lock && device) {
    installed = (await cfg.installedProfileIds(device.ecid)).includes(lock.profileIdentifier);
    if (installed) await server('POST', `/api/locks/${lock.id}/seen`, { installed });
  }
  return { lock, installed, device };
}));

// Start a trial, or change a running one: save on the server, then put the
// removable trial profile on the phone.
app.post('/api/trial', route(async req => {
  const device = await requireDevice();
  const body = { ...req.body, device: { name: device.name, ecid: device.ecid } };
  const existing = typeof req.body.lockId === 'string' ? req.body.lockId : null;
  const lock = existing
    ? await server<LockView>('PUT', `/api/locks/${existing}`, body)
    : await server<LockView>('POST', '/api/locks', body);
  try {
    await cfg.installProfile(device.ecid, profileFor(lock));
  } catch (err) {
    if (!existing) await server('POST', `/api/locks/${lock.id}/cancel`).catch(() => {});
    throw err;
  }
  return lock;
}));

// Seal: make a password nobody sees, time-lock it, store the ciphertext on
// the server, then install the profile with that password. The password only
// ever exists in this function's memory.
app.post('/api/seal', route(async req => {
  const device = await requireDevice();
  const lock = await server<LockView>('GET', `/api/locks/${req.body.lockId}`);
  if (lock.phase !== 'trial') throw new Error('Only a running trial can be sealed');

  const unlockAt = new Date(Date.now() + lock.durationDays * DAY);
  let password: string | null = randomBytes(18).toString('base64url');
  const { round, ciphertext } = await timeLock(password, unlockAt);
  // Check the lock really holds before trusting it with the phone.
  if (await timeUnlock(ciphertext) !== null) throw new Error('The time-lock opened early. Not sealing.');

  await server('POST', `/api/locks/${lock.id}/seal`, { round, unlockAt: unlockAt.toISOString(), ciphertext });
  try {
    await cfg.installProfile(device.ecid, profileFor(lock, password));
    password = null;
    const ids = await cfg.installedProfileIds(device.ecid);
    if (!ids.includes(lock.profileIdentifier)) throw new Error('The phone did not report the locked profile after installing it');
  } catch (err) {
    await server('POST', `/api/locks/${lock.id}/seal-failed`).catch(() => {});
    throw err;
  } finally {
    password = null;
  }
  return server<LockView>('POST', `/api/locks/${lock.id}/sealed`);
}));

// Take the profile off: any time in a trial, or once the lock has opened.
app.post('/api/remove', route(async req => {
  const device = await requireDevice();
  const lock = await server<LockView>('GET', `/api/locks/${req.body.lockId}`);
  if (!['trial', 'trial-expired', 'unlockable'].includes(lock.phase)) throw new Error('This lock is still running');
  await cfg.removeProfile(device.ecid, lock.profileIdentifier);
  return server<LockView>('POST', `/api/locks/${lock.id}/removed`);
}));

app.post('/api/cancel', route(async req => server<LockView>('POST', `/api/locks/${req.body.lockId}/cancel`)));

app.use(express.static(DIST));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err instanceof Error ? err.message : 'Something went wrong' });
});

app.listen(config.port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${config.port}`;
  console.log(`Baseline for Mac on ${url} (server: ${SERVER})`);
  if (config.open) execFile('open', [url], () => {});
});
