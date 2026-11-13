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

// Inside the Electron app (electron/main.ts) there are no command-line flags:
// settings come from the config file, on a free port, with no browser.
const inElectron = Boolean(process.versions.electron);
const config = loadConfig(inElectron ? ['--no-open', '--port', '0'] : undefined);
cfg.setIdentity(config.cert, config.key);
const SERVER = config.server;
const DIST = process.env.BASELINE_UI_DIR ?? path.resolve(import.meta.dirname, '../dist/mac');
if (!existsSync(path.join(DIST, 'index.html'))) console.warn('No built UI in dist/mac yet: run `pnpm build` first.');
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
    webFilter: lock.webFilter,
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

// Icons never hold a request open: the browser only keeps six connections to
// this server, and slow icon fetches would block installs behind them. A miss
// answers 404 at once and fetches in the background; the page asks again later.
const icons = new Map<string, Buffer | null>();
const fetching = new Set<string>();

app.get('/api/icon/:bundleId', (req, res) => {
  const id = req.params.bundleId;
  const png = icons.get(id);
  if (png) return void res.type('png').set('Cache-Control', 'max-age=86400').send(png);
  res.status(icons.has(id) ? 404 : 202).end();
  if (icons.has(id) || fetching.has(id)) return;
  fetching.add(id);
  cfg.getDevice()
    .then(device => (device ? cfg.getAppIcon(device.ecid, id) : null))
    .catch(() => null)
    .then(data => { icons.set(id, data); fetching.delete(id); });
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
// ?phone=0 skips the phone (each cfgutil call takes seconds), for a quick first paint.
app.get('/api/lock', route(async req => {
  const { lock } = await server<Summary>('GET', '/api/summary');
  if (req.query.phone === '0') return { lock, installed: null, device: null };
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

  const pending = pendingAccounts.get(lock.id) ?? [];
  if (pending.some(a => !a.confirmed)) throw new Error('Finish changing every account password first, or remove it from the list');

  const unlockAt = new Date(Date.now() + lock.durationDays * DAY);
  let password: string | null = randomBytes(18).toString('base64url');
  const { round, ciphertext } = await timeLock(password, unlockAt);
  // Check the lock really holds before trusting it with the phone.
  if (await timeUnlock(ciphertext) !== null) throw new Error('The time-lock opened early. Not sealing.');
  const accounts = [];
  for (const a of pending) accounts.push({ label: a.label, ciphertext: (await timeLock(a.password, unlockAt)).ciphertext });

  await server('POST', `/api/locks/${lock.id}/seal`, { round, unlockAt: unlockAt.toISOString(), ciphertext, accounts });
  try {
    await cfg.installProfile(device.ecid, profileFor(lock, password));
    password = null;
    const ids = await cfg.installedProfileIds(device.ecid);
    if (!ids.includes(lock.profileIdentifier)) throw new Error('The phone did not report the locked profile after installing it');
  } catch (err) {
    // The account passwords stay in memory, so a retry (or Discard) still has them.
    await server('POST', `/api/locks/${lock.id}/seal-failed`).catch(() => {});
    throw err;
  } finally {
    password = null;
  }
  pendingAccounts.delete(lock.id);
  await copy('');
  return server<LockView>('POST', `/api/locks/${lock.id}/sealed`);
}));

// ---- Accounts locked with the profile -----------------------------------------
//
// Passwords for accounts that could undo the lock (the DNS provider, its
// mailbox). Each is made here, goes to the clipboard so the user can paste it
// into the site's change-password page, and is never shown, stored or logged.
// Sealing time-locks them with the profile's password.

interface PendingAccount { label: string; password: string; confirmed: boolean }
const pendingAccounts = new Map<string, PendingAccount[]>();

function copy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = execFile('pbcopy', err => (err ? reject(err) : resolve()));
    p.stdin?.end(text);
  });
}

const accountList = (lockId: string) =>
  (pendingAccounts.get(lockId) ?? []).map(a => ({ label: a.label, confirmed: a.confirmed }));

app.get('/api/accounts/:lockId', route(req => accountList(req.params.lockId)));

app.post('/api/accounts/:lockId', route(async req => {
  const label = String(req.body?.label ?? '').trim();
  if (!label) throw new Error('Name the account, like "NextDNS"');
  const list = pendingAccounts.get(req.params.lockId) ?? [];
  // Letters, digits and a symbol, so it passes most sites' password rules.
  list.push({ label, password: `${randomBytes(18).toString('base64url')}#7a`, confirmed: false });
  pendingAccounts.set(req.params.lockId, list);
  await copy(list[list.length - 1].password);
  return accountList(req.params.lockId);
}));

app.post('/api/accounts/:lockId/:index/copy', route(async req => {
  const a = pendingAccounts.get(req.params.lockId)?.[Number(req.params.index)];
  if (!a) throw new Error('No such account');
  await copy(a.password);
}));

app.post('/api/accounts/:lockId/:index/confirm', route(async req => {
  const a = pendingAccounts.get(req.params.lockId)?.[Number(req.params.index)];
  if (!a) throw new Error('No such account');
  a.confirmed = true;
  await copy('');
  return accountList(req.params.lockId);
}));

// Giving up on locking accounts: hand the passwords back, since they may
// already be set on the sites.
app.post('/api/accounts/:lockId/discard', route(async req => {
  const list = pendingAccounts.get(req.params.lockId) ?? [];
  pendingAccounts.delete(req.params.lockId);
  await copy('');
  return list.map(a => ({ label: a.label, password: a.password }));
}));

// Does this encrypted DNS server actually block? Asks it for a few names over
// DNS-over-HTTPS and reports which come back blocked (no address, or 0.0.0.0).
app.post('/api/dns-test', route(async req => {
  const url = String(req.body?.url ?? '');
  if (!url.startsWith('https://')) throw new Error('Enter an https:// DNS-over-HTTPS address');
  const query = (name: string) => {
    const labels = Buffer.concat([...name.split('.').map(l => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
    return Buffer.concat([Buffer.from([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), labels, Buffer.from([0, 1, 0, 1])]).toString('base64url');
  };
  const names = ['instagram.com', 'tiktok.com', 'reddit.com', 'whatsapp.net', 'example.com'];
  return Promise.all(names.map(async name => {
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}dns=${query(name)}`, { headers: { accept: 'application/dns-message' } });
      const b = Buffer.from(await res.arrayBuffer());
      if (!res.ok || b.length < 12) return { name, result: 'error' };
      const answers = b.readUInt16BE(6);
      // Resolvers block in different ways: NXDOMAIN, no answer, 0.0.0.0, or a
      // CNAME to a block page with an Extended DNS Error (NextDNS does this).
      const blocked = (b[3] & 0xf) === 3 || answers === 0 || b.subarray(-4).equals(Buffer.from([0, 0, 0, 0]))
        || b.includes('blockpage') || b.includes('Blocked') || b.includes('Filtered');
      return { name, result: blocked ? 'blocked' : 'resolves' };
    } catch {
      return { name, result: 'error' };
    }
  }));
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

// Resolves with the local URL once the server is listening.
export const ready = new Promise<string>(resolve => {
  const listener = app.listen(config.port, '127.0.0.1', () => {
    const { port } = listener.address() as { port: number };
    const url = `http://127.0.0.1:${port}`;
    console.log(`Baseline for Mac on ${url} (server: ${SERVER})`);
    if (config.open) execFile('open', [url], () => {});
    resolve(url);
  });
});
