// Talks to the iPhone through cfgutil, Apple Configurator's command-line tool.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

async function cfgutil(args: string[], opts: { cwd?: string; ecid?: string } = {}): Promise<unknown> {
  const ecid = opts.ecid ? ['-e', opts.ecid] : [];
  try {
    const { stdout } = await run(CFGUTIL, ['--format', 'JSON', ...identity, ...ecid, ...args], {
      cwd: opts.cwd,
      // cfgutil saves files relative to $PWD, not the process's working directory.
      env: opts.cwd ? { ...process.env, PWD: opts.cwd } : process.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
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
    const e = err as { code?: string; stderr?: string; message: string };
    if (e.code === 'ENOENT') throw new Error('Apple Configurator is not installed (cfgutil not found)');
    throw new Error((e.stderr || e.message).trim());
  }
}

// cfgutil's JSON is { Output: { <ECID>: { <property>: value } } }.
function firstDeviceOutput(out: unknown): [string, Record<string, unknown>] | null {
  const output = (out as { Output?: Record<string, Record<string, unknown>> }).Output ?? {};
  const ecid = Object.keys(output).find(k => k !== 'Errors');
  return ecid ? [ecid, output[ecid]] : null;
}

export async function getDevice(): Promise<Device | null> {
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
export async function getAppIcon(ecid: string, bundleId: string): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'baseline-icon-'));
  try {
    await cfgutil(['get-app-icon', bundleId], { cwd: dir, ecid });
    const png = (await readdir(dir)).find(f => f.endsWith('.png'));
    return png ? await readFile(path.join(dir, png)) : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function installedProfileIds(ecid: string): Promise<string[]> {
  const out = await cfgutil(['get', 'configurationProfiles'], { ecid });
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
    await cfgutil(['install-profile', file], { ecid });
  } finally {
    await writeFile(file, Buffer.alloc(Buffer.byteLength(xml))).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

export async function removeProfile(ecid: string, identifier: string): Promise<void> {
  await cfgutil(['remove-profile', identifier], { ecid });
}
