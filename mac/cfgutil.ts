// Talks to the iPhone through cfgutil, Apple Configurator's command-line tool.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AllowedApp } from '../shared/types.ts';

const run = promisify(execFile);
const CFGUTIL = process.env.CFGUTIL ?? '/Applications/Apple Configurator.app/Contents/MacOS/cfgutil';

// The supervision identity, exported from Configurator as DER files. Without
// it cfgutil may stop and ask on the phone before installing a profile.
let identity: string[] = [];
export function setIdentity(cert: string | null, key: string | null): void {
  identity = cert && key ? ['-C', cert, '-K', key] : [];
}

export interface Device {
  ecid: string;
  name: string;
  supervised: boolean;
  iosVersion: string;
}

// cfgutil talks to the phone one command at a time; started in parallel they
// just queue inside it, so a profile install could wait behind dozens of icon
// fetches. Run them one by one here instead, installs and checks first.
type Priority = 'high' | 'normal' | 'low';
const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const waiting: { rank: number; start: () => void }[] = [];
let running = false;

function next() {
  if (running) return;
  const job = waiting.shift();
  if (!job) return;
  running = true;
  job.start();
}

function queued<T>(priority: Priority, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job = {
      rank: RANK[priority],
      start: () => task().then(resolve, reject).finally(() => { running = false; next(); }),
    };
    const at = waiting.findIndex(j => j.rank > job.rank);
    if (at < 0) waiting.push(job); else waiting.splice(at, 0, job);
    next();
  });
}

function cfgutil(args: string[], opts: { cwd?: string; ecid?: string; priority?: Priority; timeout?: number } = {}): Promise<unknown> {
  return queued(opts.priority ?? 'normal', () => runCfgutil(args, opts));
}

async function runCfgutil(args: string[], opts: { cwd?: string; ecid?: string; timeout?: number }): Promise<unknown> {
  const ecid = opts.ecid ? ['-e', opts.ecid] : [];
  try {
    const { stdout } = await run(CFGUTIL, ['--format', 'JSON', ...identity, ...ecid, ...args], {
      cwd: opts.cwd,
      // cfgutil saves files relative to $PWD, not the process's working directory.
      env: opts.cwd ? { ...process.env, PWD: opts.cwd } : process.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: opts.timeout ?? 120_000,
    });
    // Some commands (get-app-icon) print plain text even in JSON mode.
    let out: { Type?: string; Message?: string };
    try {
      out = JSON.parse(stdout || '{}');
    } catch {
      return { text: stdout };
    }
    if (out.Type === 'Error') throw new Error(out.Message ?? 'cfgutil failed');
    return out;
  } catch (err) {
    const e = err as { code?: string | number; stdout?: string; stderr?: string; message: string };
    if (e.code === 'ENOENT') throw new Error('Apple Configurator is not installed (cfgutil not found)');
    if ((err as { killed?: boolean }).killed) throw new Error(`cfgutil ${args[0]}: timed out. Is the phone unlocked and still plugged in?`);
    // On failure cfgutil puts the reason in its JSON output, not on stderr.
    let reason = '';
    try {
      const out = JSON.parse(e.stdout ?? '');
      reason = [out.Message, out.FailureReason, out.Code && `(code ${out.Code})`].filter(Boolean).join(' ');
    } catch {
      reason = (e.stdout ?? '').trim();
    }
    console.error(`cfgutil ${args[0]} failed:`, e.stdout, e.stderr);
    throw new Error(`cfgutil ${args[0]}: ${reason || (e.stderr || e.message).trim()}`);
  }
}

// cfgutil's JSON is { Output: { <ECID>: { <property>: value } } }.
function firstDeviceOutput(out: unknown): [string, Record<string, unknown>] | null {
  const output = (out as { Output?: Record<string, Record<string, unknown>> }).Output ?? {};
  const ecid = Object.keys(output).find(k => k !== 'Errors');
  return ecid ? [ecid, output[ecid]] : null;
}

// The UI asks for the phone often (polling, every icon, every action), so one
// lookup serves everyone for a few seconds.
let deviceLookup: { at: number; result: Promise<Device | null> } | null = null;

export function getDevice(): Promise<Device | null> {
  if (deviceLookup && Date.now() - deviceLookup.at < 4000) return deviceLookup.result;
  const result = lookUpDevice();
  deviceLookup = { at: Date.now(), result };
  result.catch(() => { deviceLookup = null; });
  return result;
}

async function lookUpDevice(): Promise<Device | null> {
  let out: unknown;
  try {
    out = await cfgutil(['get', 'ECID', 'name', 'isSupervised', 'firmwareVersion']);
  } catch (err) {
    if (err instanceof Error && /no devices found/i.test(err.message)) return null;
    throw err;
  }
  const dev = firstDeviceOutput(out);
  if (!dev) return null;
  const [ecid, p] = dev;
  return {
    ecid: String(p.ECID ?? ecid),
    name: String(p.name ?? 'iPhone'),
    supervised: p.isSupervised === true || p.isSupervised === 'true' || p.isSupervised === 1,
    iosVersion: String(p.firmwareVersion ?? ''),
  };
}

type RawApp = Record<string, unknown>;
const pick = (a: RawApp, ...keys: string[]) => keys.map(k => a[k]).find(v => typeof v === 'string' && v) as string | undefined;

export async function getInstalledApps(ecid: string): Promise<AllowedApp[]> {
  const out = await cfgutil(['get', 'installedApps'], { ecid });
  const dev = firstDeviceOutput(out);
  const raw = (dev?.[1].installedApps ?? []) as RawApp[];
  const apps = raw
    .map(a => ({
      bundleId: pick(a, 'bundleIdentifier', 'CFBundleIdentifier', 'bundleID', 'BundleIdentifier') ?? '',
      name: pick(a, 'displayName', 'CFBundleDisplayName', 'itunesName', 'name', 'CFBundleName') ?? '',
    }))
    .filter(a => a.bundleId)
    .map(a => ({ ...a, name: a.name || a.bundleId }));
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

// cfgutil writes icons into the working directory, so run it in a temp one.
// Icons rarely change, so they're kept in ~/Library/Caches after the first fetch.
const ICON_CACHE = path.join(homedir(), 'Library', 'Caches', 'Baseline', 'icons');

export async function getAppIcon(ecid: string, bundleId: string): Promise<Buffer | null> {
  const cached = path.join(ICON_CACHE, `${bundleId.replace(/[^\w.-]/g, '_')}.png`);
  const hit = await readFile(cached).catch(() => null);
  if (hit) return hit;
  const dir = await mkdtemp(path.join(tmpdir(), 'baseline-icon-'));
  try {
    await cfgutil(['get-app-icon', bundleId], { cwd: dir, ecid, priority: 'low', timeout: 20_000 });
    const png = (await readdir(dir)).find(f => f.endsWith('.png'));
    if (!png) return null;
    const data = await readFile(path.join(dir, png));
    await mkdir(ICON_CACHE, { recursive: true });
    await writeFile(cached, data);
    return data;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function installedProfileIds(ecid: string): Promise<string[]> {
  const out = await cfgutil(['get', 'configurationProfiles'], { ecid, priority: 'high' });
  const raw = (firstDeviceOutput(out)?.[1].configurationProfiles ?? []) as RawApp[];
  return raw.map(p => pick(p, 'identifier', 'PayloadIdentifier') ?? '').filter(Boolean);
}

// cfgutil only installs from a file. The profile may hold the removal
// password, so it lives in a private temp dir for the length of the call and
// is overwritten before it's deleted.
export async function installProfile(ecid: string, xml: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'baseline-'));
  const file = path.join(dir, 'baseline.mobileconfig');
  try {
    await writeFile(file, xml, { mode: 0o600 });
    await cfgutil(['install-profile', file], { ecid, priority: 'high' });
  } finally {
    await writeFile(file, Buffer.alloc(Buffer.byteLength(xml))).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

export async function removeProfile(ecid: string, identifier: string): Promise<void> {
  await cfgutil(['remove-profile', identifier], { ecid, priority: 'high' });
}
