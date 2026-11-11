import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILT_IN_APPS, normalizeDomain } from '../../../shared/apps.ts';
import type { AllowedApp, LockView } from '../../../shared/types.ts';

interface Device { ecid: string; name: string; supervised: boolean; iosVersion: string }
interface PhoneApp extends AllowedApp { suggested: boolean }
interface StoreApp extends AllowedApp { seller: string; icon: string }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const input = 'rounded-xl bg-muted px-3 py-2 text-[15px] outline-none placeholder:text-muted-fg focus:ring-2 focus:ring-primary/30';
const button = 'rounded-xl px-4 py-2.5 text-[15px] font-medium active:scale-[0.99] disabled:opacity-40';

export default function App() {
  const [server, setServer] = useState('');
  const [device, setDevice] = useState<Device | null>(null);
  const [lock, setLock] = useState<LockView | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [phoneApps, setPhoneApps] = useState<PhoneApp[]>([]);
  const [storeApps, setStoreApps] = useState<AllowedApp[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [domains, setDomains] = useState<string[]>(['amarzbar.xyz']);
  const [allowWebApps, setAllowWebApps] = useState(true);
  const [nextdns, setNextdns] = useState('');
  const [durationDays, setDurationDays] = useState(90);
  const [trialDays, setTrialDays] = useState(7);
  const [baseH, setBaseH] = useState('');
  const [baseM, setBaseM] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);

  // Fill the form from a running trial, so changing it starts from what's on the phone.
  const loadFromLock = useCallback((l: LockView) => {
    setSelected(new Set(l.apps.map(a => a.bundleId)));
    setStoreApps(l.apps);
    setDomains(l.domains);
    setAllowWebApps(l.allowWebApps);
    setNextdns(l.dnsServerUrl?.replace('https://dns.nextdns.io/', '') ?? '');
    setDurationDays(l.durationDays);
    if (l.baselineDailyMinutes != null) {
      setBaseH(String(Math.floor(l.baselineDailyMinutes / 60)));
      setBaseM(String(l.baselineDailyMinutes % 60));
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const cfg = await call<{ server: string }>('GET', '/api/config');
      setServer(cfg.server);
      const host = new URL(cfg.server).hostname;
      if (normalizeDomain(host)) setDomains(ds => ds.includes(host) ? ds : [...ds, host]);
      const state = await call<{ lock: LockView | null; installed: boolean | null; device: Device | null }>('GET', '/api/lock');
      setDevice(state.device);
      setLock(state.lock);
      setInstalled(state.installed);
      if (state.lock?.phase === 'trial') loadFromLock(state.lock);
      if (state.device?.supervised) {
        const apps = await call<PhoneApp[]>('GET', '/api/apps');
        setPhoneApps(apps);
        if (state.lock?.phase !== 'trial') {
          setSelected(new Set([
            ...BUILT_IN_APPS.filter(a => a.keep).map(a => a.bundleId),
            ...apps.filter(a => a.suggested).map(a => a.bundleId),
          ]));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadFromLock]);

  useEffect(() => { refresh(); }, [refresh]);

  const allApps = useMemo(() => {
    const map = new Map<string, AllowedApp>();
    for (const a of [...BUILT_IN_APPS, ...phoneApps, ...storeApps]) if (!map.has(a.bundleId)) map.set(a.bundleId, { bundleId: a.bundleId, name: a.name });
    return map;
  }, [phoneApps, storeApps]);

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const settings = () => ({
    lockId: lock?.phase === 'trial' ? lock.id : undefined,
    durationDays,
    trialDays,
    apps: [...selected].map(id => allApps.get(id)!).filter(Boolean),
    domains,
    allowWebApps,
    dnsServerUrl: nextdns.trim() ? `https://dns.nextdns.io/${nextdns.trim()}` : null,
    baselineDailyMinutes: baseH || baseM ? (Number(baseH) || 0) * 60 + (Number(baseM) || 0) : null,
  });

  const phase = lock?.phase;
  const editable = !phase || ['trial', 'trial-expired', 'removed', 'cancelled'].includes(phase);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-light tracking-tight">Baseline</h1>
          <p className="text-[13px] text-muted-fg">Server {server || '…'}</p>
        </div>
        <button className={`${button} bg-secondary text-secondary-fg`} onClick={() => act('refresh', async () => {})}>
          {busy === 'refresh' ? 'Checking…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="glass mb-4 px-5 py-3 text-[14px] text-destructive">{error}</div>}
      {notice && <div className="glass mb-4 px-5 py-3 text-[14px] text-primary">{notice}</div>}

      <section className="glass mb-6 flex items-center justify-between px-5 py-4">
        <div>
          <p className="label">iPhone</p>
          <p className="mt-1 text-[17px]">{device ? `${device.name} · iOS ${device.iosVersion}` : 'Not connected: plug it in and unlock it'}</p>
        </div>
        {device && (
          <span className={`rounded-full px-3 py-1 text-[12px] font-medium ${device.supervised ? 'bg-secondary text-secondary-fg' : 'bg-red-100 text-destructive'}`}>
            {device.supervised ? 'Supervised' : 'Not supervised'}
          </span>
        )}
      </section>

      {lock && phase !== 'cancelled' && phase !== 'removed' && (
        <section className="glass mb-6 px-5 py-5">
          <p className="label">Current lock</p>
          {phase === 'trial' && (
            <>
              <p className="mt-1 text-[20px] font-light">Trial until {fmt(lock.trialEndsAt)}</p>
              <p className="mt-1 text-[14px] text-muted-fg">
                The trial profile is {installed === false ? <b className="text-destructive">not on the phone</b> : installed ? 'on the phone' : 'not checked (no phone)'}. Change anything below, then seal to start {lock.durationDays} days.
              </p>
              <div className="mt-4 flex gap-3">
                <button className={`${button} bg-primary text-primary-fg`} disabled={!device || !!busy} onClick={() => setSealing(true)}>Seal for {lock.durationDays} days…</button>
                <button className={`${button} bg-secondary text-secondary-fg`} disabled={!device || !!busy}
                  onClick={() => act('remove', async () => { await call('POST', '/api/remove', { lockId: lock.id }); setNotice('Trial ended and profile removed.'); })}>
                  End trial &amp; remove profile
                </button>
              </div>
            </>
          )}
          {phase === 'trial-expired' && (
            <>
              <p className="mt-1 text-[20px] font-light">The trial ended {fmt(lock.trialEndsAt)}</p>
              <p className="mt-1 text-[14px] text-muted-fg">It can't be sealed now. Remove the trial profile, then start a new trial.</p>
              <button className={`${button} mt-4 bg-primary text-primary-fg`} disabled={!device || !!busy}
                onClick={() => act('remove', async () => { await call('POST', '/api/remove', { lockId: lock.id }); })}>Remove trial profile</button>
            </>
          )}
          {phase === 'sealing' && <p className="mt-1 text-[20px] font-light">Sealing…</p>}
          {phase === 'locked' && (
            <>
              <p className="mt-1 text-[20px] font-light">Locked until {fmt(lock.unlockAt!)}</p>
              <p className="mt-1 text-[14px] text-muted-fg">
                Time-locked to drand round #{lock.round}. {installed ? 'The profile is on the phone.' : installed === false ? 'The profile is NOT on the phone.' : ''} There's nothing to change until then.
              </p>
            </>
          )}
          {phase === 'unlockable' && (
            <>
              <p className="mt-1 text-[20px] font-light">The lock has opened</p>
              <p className="mt-1 text-[14px] text-muted-fg">Remove the profile here, or with the password shown in the Baseline app on your phone.</p>
              <button className={`${button} mt-4 bg-primary text-primary-fg`} disabled={!device || !!busy}
                onClick={() => act('remove', async () => { await call('POST', '/api/remove', { lockId: lock.id }); setNotice('Profile removed. Well done.'); })}>Remove the profile</button>
            </>
          )}
        </section>
      )}

      {editable && phase !== 'trial-expired' && (
        <>
          <AppsSection phoneApps={phoneApps} selected={selected} toggle={toggle} device={device}
            storeApps={storeApps} addStoreApp={a => { setStoreApps(s => [...s, a]); setSelected(s => new Set(s).add(a.bundleId)); }} />
          <WebSection domains={domains} setDomains={setDomains} allowWebApps={allowWebApps} setAllowWebApps={setAllowWebApps} nextdns={nextdns} setNextdns={setNextdns} />

          <section className="glass mb-6 px-5 py-5">
            <p className="label">The term</p>
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-3">
              <label className="text-[14px]">Lock for (days)
                <input className={`${input} mt-1 w-full`} type="number" min={90} value={durationDays} onChange={e => setDurationDays(Math.max(90, Number(e.target.value) || 90))} />
              </label>
              <label className="text-[14px]">Trial first (days)
                <input className={`${input} mt-1 w-full`} type="number" min={1} max={7} disabled={phase === 'trial'} value={trialDays} onChange={e => setTrialDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
              <div className="text-[14px]">Screen time now (a day)
                <div className="mt-1 flex gap-2">
                  <input className={`${input} w-full`} placeholder="h" inputMode="numeric" value={baseH} onChange={e => setBaseH(e.target.value)} />
                  <input className={`${input} w-full`} placeholder="m" inputMode="numeric" value={baseM} onChange={e => setBaseM(e.target.value)} />
                </div>
              </div>
            </div>
            <p className="mt-3 text-[13px] text-muted-fg">Screen time is your current daily average from Settings → Screen Time. It's what "hours given back" is measured against.</p>
          </section>

          <div className="flex items-center justify-between">
            <p className="text-[14px] text-muted-fg">{selected.size} apps · {domains.length} sites</p>
            <button className={`${button} bg-primary px-6 text-primary-fg`} disabled={!device?.supervised || !!busy || !selected.size}
              onClick={() => act('trial', async () => {
                await call('POST', '/api/trial', settings());
                setNotice(phase === 'trial' ? 'Trial profile updated on the phone.' : 'Trial started. Live with it for a few days, then seal.');
              })}>
              {busy === 'trial' ? 'Installing…' : phase === 'trial' ? 'Update the trial profile' : 'Start the trial'}
            </button>
          </div>
        </>
      )}

      {sealing && lock && (
        <SealDialog lock={lock} busy={busy === 'seal'} onCancel={() => setSealing(false)}
          onSeal={() => act('seal', async () => {
            await call('POST', '/api/seal', { lockId: lock.id });
            setSealing(false);
            setNotice('Sealed. See you on the other side.');
          })} />
      )}
    </div>
  );
}

function AppsSection({ phoneApps, selected, toggle, device, storeApps, addStoreApp }: {
  phoneApps: PhoneApp[]; selected: Set<string>; toggle: (id: string) => void; device: Device | null;
  storeApps: AllowedApp[]; addStoreApp: (a: AllowedApp) => void;
}) {
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoreApp[]>([]);
  const known = new Set([...phoneApps, ...BUILT_IN_APPS].map(a => a.bundleId));
  const extra = storeApps.filter(a => !known.has(a.bundleId));
  const match = (a: AllowedApp) => !filter || `${a.name} ${a.bundleId}`.toLowerCase().includes(filter.toLowerCase());

  async function search() {
    if (!query.trim()) return;
    setResults(await call<StoreApp[]>('GET', `/api/appstore?q=${encodeURIComponent(query)}`));
  }

  return (
    <section className="glass mb-6 px-5 py-5">
      <div className="flex items-center justify-between gap-4">
        <p className="label">Apps that stay</p>
        <input className={`${input} w-56`} placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
      <p className="mt-2 text-[13px] text-muted-fg">Anything not ticked won't open while the lock runs. Ticked apps keep updating.</p>

      <p className="label mt-5 mb-2">On your iPhone</p>
      {!device ? <p className="text-[14px] text-muted-fg">Connect the phone to see its apps.</p> : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {phoneApps.filter(match).map(a => (
            <AppRow key={a.bundleId} app={a} icon={`/api/icon/${encodeURIComponent(a.bundleId)}`} checked={selected.has(a.bundleId)} onToggle={() => toggle(a.bundleId)} hint={a.suggested ? 'suggested' : undefined} />
          ))}
        </div>
      )}

      <p className="label mt-6 mb-2">Apple apps</p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {BUILT_IN_APPS.filter(match).map(a => (
          <AppRow key={a.bundleId} app={a} checked={selected.has(a.bundleId)} onToggle={() => toggle(a.bundleId)}
            hint={a.bundleId === 'com.apple.mobilesafari' ? 'open web' : undefined} />
        ))}
      </div>

      <p className="label mt-6 mb-2">Not installed yet</p>
      {extra.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {extra.map(a => <AppRow key={a.bundleId} app={a} checked={selected.has(a.bundleId)} onToggle={() => toggle(a.bundleId)} />)}
        </div>
      )}
      <div className="flex gap-2">
        <input className={`${input} flex-1`} placeholder="Search the App Store by name" value={query}
          onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
        <button className={`${button} bg-secondary text-secondary-fg`} onClick={search}>Search</button>
      </div>
      {results.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {results.map(r => (
            <button key={r.bundleId} className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted"
              onClick={() => { addStoreApp({ bundleId: r.bundleId, name: r.name }); setResults([]); setQuery(''); }}>
              <img src={r.icon} alt="" className="h-8 w-8 rounded-lg" />
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{r.name}</span><span className="block truncate text-[12px] text-muted-fg">{r.seller}</span></span>
              <span className="text-primary">+</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AppRow({ app, icon, checked, onToggle, hint }: { app: AllowedApp; icon?: string; checked: boolean; onToggle: () => void; hint?: string }) {
  const [iconOk, setIconOk] = useState(true);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 accent-[var(--primary)]" />
      {icon && iconOk
        ? <img src={icon} alt="" className="h-7 w-7 rounded-lg" onError={() => setIconOk(false)} />
        : <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-[12px] text-secondary-fg">{app.name[0]}</span>}
      <span className="min-w-0 flex-1 truncate text-[14px]">{app.name}</span>
      {hint && <span className="text-[11px] text-muted-fg">{hint}</span>}
    </label>
  );
}

function WebSection({ domains, setDomains, allowWebApps, setAllowWebApps, nextdns, setNextdns }: {
  domains: string[]; setDomains: (d: string[]) => void; allowWebApps: boolean; setAllowWebApps: (b: boolean) => void;
  nextdns: string; setNextdns: (s: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const d = normalizeDomain(draft);
    if (d && !domains.includes(d)) setDomains([...domains, d]);
    if (d) setDraft('');
  };
  return (
    <section className="glass mb-6 px-5 py-5">
      <p className="label">Sites that load</p>
      <p className="mt-2 text-[13px] text-muted-fg">
        Everything else is blocked in every app that shows web pages. List each subdomain your web apps use (e.g. salik.amarzbar.xyz).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {domains.map(d => (
          <span key={d} className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-[13px] text-secondary-fg">
            {d}
            <button onClick={() => setDomains(domains.filter(x => x !== d))} aria-label={`Remove ${d}`}>×</button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input className={`${input} flex-1`} placeholder="Add a site, e.g. rbcroyalbank.com" value={draft}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className={`${button} bg-secondary text-secondary-fg`} onClick={add}>Add</button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={allowWebApps} onChange={e => setAllowWebApps(e.target.checked)} className="accent-[var(--primary)]" />
        Home-screen web apps can open (they can still only load the sites above)
      </label>
      <label className="mt-4 block text-[14px]">NextDNS profile ID (optional DNS filter)
        <input className={`${input} mt-1 w-full`} placeholder="e.g. abc123" value={nextdns} onChange={e => setNextdns(e.target.value)} />
      </label>
    </section>
  );
}

function SealDialog({ lock, busy, onCancel, onSeal }: { lock: LockView; busy: boolean; onCancel: () => void; onSeal: () => void }) {
  const [typed, setTyped] = useState('');
  const unlock = new Date(Date.now() + lock.durationDays * 86_400_000);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6">
      <div className="w-full max-w-md rounded-[28px] bg-background px-7 py-7 shadow-2xl">
        <h2 className="text-[24px] font-light">Seal for {lock.durationDays} days?</h2>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted-fg">
          <li>Opens {fmt(unlock.toISOString())}. No exceptions and no early unlock.</li>
          <li>{lock.apps.length} apps and {lock.domains.length} sites, exactly as in the trial.</li>
          <li>The removal password is time-locked with drand. You will never see it before then.</li>
        </ul>
        <label className="mt-5 block text-[14px]">Type <b>SEAL</b> to confirm
          <input className={`${input} mt-1 w-full`} value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <button className={`${button} bg-secondary text-secondary-fg`} onClick={onCancel} disabled={busy}>Not yet</button>
          <button className={`${button} bg-primary text-primary-fg`} disabled={typed !== 'SEAL' || busy} onClick={onSeal}>
            {busy ? 'Sealing…' : 'Seal it'}
          </button>
        </div>
      </div>
    </div>
  );
}
