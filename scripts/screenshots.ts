// Regenerates the README screenshots in docs/screenshots from made-up data,
// so no real phone, apps or journal ever ends up in the repo.
//
//   pnpm build && node scripts/screenshots.ts
//
// It starts the real server on a throwaway data directory seeded with a
// sample lock, serves the Mac UI against a stand-in for the Mac companion's
// API, and drives headless Chrome over the DevTools protocol.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import express from 'express';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/screenshots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TOKEN = 'screenshot-token-0123456789';
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ---- Sample data ---------------------------------------------------------------

// A soft vertical gradient PNG, standing in for journal photos.
function gradientPng(w: number, h: number, top: number[], bottom: number[]): Buffer {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const px = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
    rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from(px))]));
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const now = Date.now();
const sealedAt = new Date(now - 39.4 * DAY);
const iso = (ms: number) => new Date(ms).toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monday = (d: Date) => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return ymd(m); };

const APPS = [
  ['com.apple.mobilephone', 'Phone'], ['com.apple.MobileSMS', 'Messages'], ['com.apple.Passbook', 'Wallet'],
  ['com.apple.Health', 'Health'], ['com.apple.camera', 'Camera'], ['com.apple.AppStore', 'App Store (updates)'],
  ['net.whatsapp.WhatsApp', 'WhatsApp'], ['com.example.bank', 'Your Bank'], ['com.strava.stravaride', 'Strava'],
  ['com.google.Maps', 'Google Maps'], ['com.example.authenticator', 'Authenticator'], ['io.tailscale.ipn.ios', 'Tailscale'],
].map(([bundleId, name]) => ({ bundleId, name }));

function seed(dir: string) {
  const photos = path.join(dir, 'photos');
  mkdirSync(photos, { recursive: true });
  writeFileSync(path.join(photos, 'hike.png'), gradientPng(900, 560, [173, 208, 190], [233, 214, 172]));
  writeFileSync(path.join(photos, 'lake.png'), gradientPng(900, 480, [120, 160, 196], [226, 220, 204]));
  const lock = {
    id: 'demo-lock', createdAt: iso(sealedAt.getTime() - 5 * DAY), status: 'sealed',
    trialEndsAt: iso(sealedAt.getTime() + 2 * DAY), durationDays: 90, apps: APPS,
    webFilter: 'off', domains: [], allowWebApps: true, dnsServerUrl: 'https://dns.nextdns.io/abc123',
    baselineDailyMinutes: 200, profileIdentifier: 'xyz.amarzbar.baseline.lock',
    device: { name: 'iPhone', ecid: '0x0' }, sealedAt: iso(sealedAt.getTime()), unlockAt: iso(sealedAt.getTime() + 90 * DAY),
    round: 36449129, ciphertext: '-----BEGIN AGE ENCRYPTED FILE-----', accounts: [{ label: 'NextDNS', ciphertext: 'x' }],
    profileSeenAt: iso(now - DAY),
  };
  const journal = [
    { id: 'j4', createdAt: iso(sealedAt.getTime() + 12 * DAY), title: 'Morning by the lake', body: 'Fajr, then walked till sunrise.', tags: ['outside', 'worship'], photo: 'lake.png' },
    { id: 'j3', createdAt: iso(now - 3 * DAY), title: 'Called Mum', body: 'Forty minutes, no distractions.', tags: ['family'], photo: null },
    { id: 'j2', createdAt: iso(now - 3 * DAY - 3600e3 * 4), title: 'Finished a book', body: 'Took notes by hand.', tags: ['read'], photo: null },
    { id: 'j1', createdAt: iso(now - 2 * 3600e3), title: 'Hiked the escarpment', body: '14k steps', tags: ['outside', 'moved'], photo: 'hike.png' },
  ];
  const screenTime = Array.from({ length: 6 }, (_, i) => ({
    weekStart: monday(new Date(sealedAt.getTime() + i * 7 * DAY)), avgDailyMinutes: [150, 128, 116, 104, 112, 98][i],
  }));
  const health = Array.from({ length: 40 }, (_, i) => ({
    date: ymd(new Date(sealedAt.getTime() + i * DAY)), steps: 6000 + ((i * 2377) % 7000), workouts: i % 3 === 0 ? 1 : 0,
  }));
  writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ locks: [lock], journal, screenTime, health }));
}

// ---- Stand-in for the Mac companion's API -------------------------------------

function macDemo(port: number): Promise<() => void> {
  const app = express();
  app.use(express.json());
  const device = { ecid: '0x0', name: 'iPhone', supervised: true, iosVersion: '27.0' };
  const phoneApps = [
    ...APPS.filter(a => !a.bundleId.startsWith('com.apple.')).map(a => ({ ...a, suggested: true })),
    { bundleId: 'com.burbn.instagram', name: 'Instagram', suggested: false },
    { bundleId: 'com.zhiliaoapp.musically', name: 'TikTok', suggested: false },
    { bundleId: 'com.example.browser', name: 'Some Browser', suggested: false },
    { bundleId: 'com.example.recipes', name: 'Recipes', suggested: false },
    { bundleId: 'com.example.notes', name: 'Notebook', suggested: false },
  ].sort((a, b) => a.name.localeCompare(b.name));
  app.get('/api/config', (_q, r) => r.json({ server: 'https://baseline.example.com', hasIdentity: true }));
  app.get('/api/lock', (_q, r) => r.json({ lock: null, installed: null, device }));
  app.get('/api/device', (_q, r) => r.json({ device }));
  app.get('/api/apps', (_q, r) => r.json(phoneApps));
  app.get('/api/icon/:id', (_q, r) => r.status(404).end());
  app.post('/api/dns-test', (_q, r) => r.json(['instagram.com', 'tiktok.com', 'reddit.com'].map(name => ({ name, result: 'blocked' }))
    .concat([{ name: 'whatsapp.net', result: 'resolves' }, { name: 'example.com', result: 'resolves' }])));
  app.use(express.static(path.join(ROOT, 'dist/mac')));
  return new Promise(resolve => { const s = app.listen(port, () => resolve(() => s.close())); });
}

// ---- Headless Chrome over the DevTools protocol --------------------------------

async function chrome() {
  const profile = mkdtempSync(path.join(tmpdir(), 'baseline-shots-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch('http://127.0.0.1:9333/json').then(r => r.json()).then(l => l.find((t: { type: string }) => t.type === 'page')).catch(() => undefined);
  }
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.addEventListener('message', e => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); }
  });
  const send = (method: string, params: object = {}) => new Promise<any>(res => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
  const eval_ = (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true });
  const shot = async (name: string) => {
    await sleep(900);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log('wrote', name);
  };
  const click = (text: string) => eval_(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`);
  const go = async (url: string) => { await send('Page.navigate', { url }); await sleep(1500); };
  return { send, eval: eval_, shot, click, go, close: () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000); } };
}

// ---- Run --------------------------------------------------------------------------

const data = mkdtempSync(path.join(tmpdir(), 'baseline-demo-'));
seed(data);
const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT, env: { ...process.env, DATA_DIR: data, PORT: '3091', BASELINE_TOKEN: TOKEN }, stdio: 'ignore',
});
const stopMac = await macDemo(3092);
await sleep(1200);
const c = await chrome();

try {
  await c.send('Page.enable');
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  // PWA, at iPhone size.
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await c.go('http://127.0.0.1:3091/');
  await c.eval(`fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: '${TOKEN}' }) })`);
  await c.go('http://127.0.0.1:3091/');
  await c.shot('pwa-today');
  await c.click('Journal');
  await c.shot('pwa-journal');
  await c.click('Lock');
  await c.shot('pwa-lock');

  // Mac app, at window size.
  await c.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 700, deviceScaleFactor: 2, mobile: false });
  await c.go('http://127.0.0.1:3092/');
  await sleep(1000);
  await c.click('Continue');
  await c.shot('mac-apps');
  await c.click('Continue');
  await c.eval(`(() => { const i = document.querySelector('input[placeholder="e.g. abc123"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'abc123'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  await c.click('Test it');
  await c.shot('mac-blocking');
  await c.click('Continue');
  await c.click('Continue');
  await c.shot('mac-review');
} finally {
  c.close();
  stopMac();
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
