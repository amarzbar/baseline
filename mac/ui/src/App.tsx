import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { BUILT_IN_APPS, DEFAULT_BLOCKED_SITES, normalizeDomain } from '../../../shared/apps.ts';
import type { AllowedApp, LockView, WebFilter } from '../../../shared/types.ts';

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
const primary = `${button} bg-primary text-primary-fg`;
const secondary = `${button} bg-secondary text-secondary-fg`;

// One question per screen, so setting up a lock never feels like a form.
const STEPS = ['Phone', 'Apps', 'Blocking', 'Time', 'Review'] as const;

// A NextDNS profile ID, or any DNS-over-HTTPS address. Null if it's neither.
function dnsUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https:\/\/[^\s]+$/.test(v)) return v;
  return /^[a-z0-9]{4,12}$/i.test(v) ? `https://dns.nextdns.io/${v}` : null;
}

export default function App() {
  const [server, setServer] = useState('');
  const [device, setDevice] = useState<Device | null>(null);
  const [lock, setLock] = useState<LockView | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [phoneApps, setPhoneApps] = useState<PhoneApp[]>([]);
  const [storeApps, setStoreApps] = useState<AllowedApp[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [webFilter, setWebFilter] = useState<WebFilter>('off');
  const [blockSites, setBlockSites] = useState<string[]>(DEFAULT_BLOCKED_SITES);
  const [allowSites, setAllowSites] = useState<string[]>(['amarzbar.xyz']);
  const [allowWebApps, setAllowWebApps] = useState(true);
  const [dns, setDns] = useState('');
  const [durationDays, setDurationDays] = useState(90);
  const [trialDays, setTrialDays] = useState(7);
  const [baseH, setBaseH] = useState('');
  const [baseM, setBaseM] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);

  // Fill the steps from a running trial, so changing it starts from what's on the phone.
  const loadFromLock = useCallback((l: LockView) => {
    setSelected(new Set(l.apps.map(a => a.bundleId)));
    setStoreApps(l.apps);
    setWebFilter(l.webFilter);
    if (l.webFilter === 'block') setBlockSites(l.domains);
    if (l.webFilter === 'allow') setAllowSites(l.domains);
    setAllowWebApps(l.allowWebApps);
    setDns(l.dnsServerUrl?.replace('https://dns.nextdns.io/', '') ?? '');
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
      if (normalizeDomain(host)) setAllowSites(ds => ds.includes(host) ? ds : [...ds, host]);
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

  // On the first step, notice the phone being plugged in without a Refresh.
  const waitingForPhone = step === 0 && !device;
  useEffect(() => {
    if (!waitingForPhone) return;
    const t = setInterval(async () => {
      const { device: d } = await call<{ device: Device | null }>('GET', '/api/device').catch(() => ({ device: null }));
      if (d) refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [waitingForPhone, refresh]);

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

  const phase = lock?.phase;
  const hasLock = Boolean(phase && phase !== 'cancelled' && phase !== 'removed');
  const inTrial = phase === 'trial';
  const showWizard = !hasLock || (inTrial && editing);

  const settings = () => ({
    lockId: inTrial ? lock!.id : undefined,
    durationDays,
    trialDays,
    apps: [...selected].map(id => allApps.get(id)!).filter(Boolean),
    webFilter,
    domains: webFilter === 'block' ? blockSites : webFilter === 'allow' ? allowSites : [],
    allowWebApps,
    dnsServerUrl: dnsUrl(dns),
    baselineDailyMinutes: baseH || baseM ? (Number(baseH) || 0) * 60 + (Number(baseM) || 0) : null,
  });

  const canContinue = [
    Boolean(device?.supervised),
    selected.size > 0,
    (webFilter !== 'allow' || allowSites.length > 0) && (!dns.trim() || dnsUrl(dns) !== null),
    durationDays >= 90,
    true,
  ][step];

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-light tracking-tight">Baseline</h1>
          <p className="text-[13px] text-muted-fg">{server || '…'}</p>
        </div>
        <button className={secondary} onClick={() => act('refresh', async () => {})}>
          {busy === 'refresh' ? 'Checking…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="glass mb-4 px-5 py-3 text-[14px] text-destructive">{error}</div>}
      {notice && <div className="glass mb-4 px-5 py-3 text-[14px] text-primary">{notice}</div>}

      {!showWizard && lock ? (
        <LockStatus lock={lock} installed={installed} device={device} busy={busy}
          onSeal={() => setSealing(true)}
          onEdit={() => { loadFromLock(lock); setEditing(true); setStep(1); }}
          onRemove={msg => act('remove', async () => { await call('POST', '/api/remove', { lockId: lock.id }); setNotice(msg); })} />
      ) : (
        <>
          <Stepper step={step} onGo={i => i < step && setStep(i)} />

          <div className="flex-1">
            {step === 0 && <PhoneStep device={device} />}
            {step === 1 && (
              <AppsStep phoneApps={phoneApps} selected={selected} toggle={toggle} storeApps={storeApps}
                addStoreApp={a => { setStoreApps(s => [...s, a]); setSelected(s => new Set(s).add(a.bundleId)); }} />
            )}
            {step === 2 && (
              <BlockingStep dns={dns} setDns={setDns} webFilter={webFilter} setWebFilter={setWebFilter}
                blockSites={blockSites} setBlockSites={setBlockSites} allowSites={allowSites} setAllowSites={setAllowSites}
                allowWebApps={allowWebApps} setAllowWebApps={setAllowWebApps} />
            )}
            {step === 3 && (
              <TimeStep durationDays={durationDays} setDurationDays={setDurationDays} trialDays={trialDays}
                setTrialDays={setTrialDays} trialLocked={inTrial} baseH={baseH} setBaseH={setBaseH} baseM={baseM} setBaseM={setBaseM} />
            )}
            {step === 4 && (
              <ReviewStep apps={selected.size} allowWebApps={allowWebApps} dns={dnsUrl(dns)}
                webFilter={webFilter} sites={webFilter === 'block' ? blockSites : allowSites}
                durationDays={durationDays} trialDays={trialDays} baseline={baseH || baseM ? `${baseH || 0}h ${baseM || 0}m` : null}
                updating={inTrial} onGo={setStep} />
            )}
          </div>

          <footer className="mt-8 flex items-center justify-between">
            {step > 0 || editing ? (
              <button className={secondary} onClick={() => (step > 0 ? setStep(step - 1) : setEditing(false))}>Back</button>
            ) : <span />}
            {step < STEPS.length - 1 ? (
              <button className={`${primary} px-6`} disabled={!canContinue} onClick={() => setStep(step + 1)}>Continue</button>
            ) : (
              <button className={`${primary} px-6`} disabled={!device?.supervised || !!busy || !selected.size}
                onClick={() => act('trial', async () => {
                  await call('POST', '/api/trial', settings());
                  setNotice(inTrial ? 'Trial profile updated on the phone.' : 'Trial started. Live with it for a few days, then seal.');
                  setEditing(false);
                  setStep(0);
                })}>
                {busy === 'trial' ? 'Installing…' : inTrial ? 'Update the trial' : 'Start the trial'}
              </button>
            )}
          </footer>
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

function Stepper({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <nav className="mb-8">
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-border'}`} />)}
      </div>
      <div className="mt-2 flex justify-between">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => onGo(i)} disabled={i >= step}
            className={`text-[12px] ${i === step ? 'font-medium text-primary' : i < step ? 'text-foreground hover:underline' : 'text-muted-fg'}`}>
            {s}
          </button>
        ))}
      </div>
    </nav>
  );
}

function StepTitle({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-6">
      <p className="label">Step {n} of {STEPS.length}</p>
      <h2 className="mt-1 text-[26px] font-light leading-tight tracking-tight">{title}</h2>
      <p className="mt-1 text-[15px] text-muted-fg">{sub}</p>
    </div>
  );
}

function PhoneStep({ device }: { device: Device | null }) {
  return (
    <>
      <StepTitle n={1} title="Connect your iPhone" sub="Plug it into this Mac with a cable, unlock it, and tap Trust if it asks. Then press Refresh." />
      <div className="glass flex items-center justify-between px-5 py-5">
        <div>
          <p className="text-[18px]">{device ? device.name : 'Waiting for a phone…'}</p>
          {device && <p className="text-[13px] text-muted-fg">iOS {device.iosVersion}</p>}
        </div>
        {device && (
          <span className={`rounded-full px-3 py-1 text-[12px] font-medium ${device.supervised ? 'bg-secondary text-secondary-fg' : 'bg-red-100 text-destructive'}`}>
            {device.supervised ? 'Supervised ✓' : 'Not supervised'}
          </span>
        )}
      </div>
      {device && !device.supervised && (
        <p className="mt-3 text-[14px] text-destructive">The lock only works on a supervised phone. Supervise it with Apple Configurator first.</p>
      )}
    </>
  );
}

function AppsStep({ phoneApps, selected, toggle, storeApps, addStoreApp }: {
  phoneApps: PhoneApp[]; selected: Set<string>; toggle: (id: string) => void;
  storeApps: AllowedApp[]; addStoreApp: (a: AllowedApp) => void;
}) {
  const [filter, setFilter] = useState('');
  const [showApple, setShowApple] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoreApp[]>([]);
  const known = new Set([...phoneApps, ...BUILT_IN_APPS].map(a => a.bundleId));
  const extra = storeApps.filter(a => !known.has(a.bundleId));
  const match = (a: AllowedApp) => !filter || `${a.name} ${a.bundleId}`.toLowerCase().includes(filter.toLowerCase());
  const appleKept = BUILT_IN_APPS.filter(a => selected.has(a.bundleId)).length;

  async function search() {
    if (!query.trim()) return;
    setResults(await call<StoreApp[]>('GET', `/api/appstore?q=${encodeURIComponent(query)}`));
  }

  return (
    <>
      <StepTitle n={2} title="Which apps stay?" sub="Ticked apps keep working and updating. Everything else won't open until the lock ends. We've ticked the ones that look important." />

      <div className="glass px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="label">Your apps · {phoneApps.filter(a => selected.has(a.bundleId)).length} of {phoneApps.length} kept</p>
          <input className={`${input} w-48`} placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="grid max-h-[46vh] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {phoneApps.filter(match).map(a => (
            <AppRow key={a.bundleId} app={a} icon={`/api/icon/${encodeURIComponent(a.bundleId)}`} checked={selected.has(a.bundleId)}
              onToggle={() => toggle(a.bundleId)} hint={a.suggested ? 'suggested' : undefined} />
          ))}
          {extra.map(a => <AppRow key={a.bundleId} app={a} checked={selected.has(a.bundleId)} onToggle={() => toggle(a.bundleId)} hint="not installed" />)}
        </div>
      </div>

      <Expander open={showApple} onToggle={() => setShowApple(s => !s)} title={`Apple's apps · ${appleKept} of ${BUILT_IN_APPS.length} kept`}>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {BUILT_IN_APPS.filter(match).map(a => (
            <AppRow key={a.bundleId} app={a} checked={selected.has(a.bundleId)} onToggle={() => toggle(a.bundleId)}
              hint={a.bundleId === 'com.apple.mobilesafari' ? 'open web' : undefined} />
          ))}
        </div>
      </Expander>

      <Expander open={showSearch} onToggle={() => setShowSearch(s => !s)} title="Add an app you haven't installed yet">
        <div className="flex gap-2">
          <input className={`${input} flex-1`} placeholder="Search the App Store by name" value={query}
            onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
          <button className={secondary} onClick={search}>Search</button>
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
      </Expander>
    </>
  );
}

function BlockingStep(p: {
  dns: string; setDns: (s: string) => void;
  webFilter: WebFilter; setWebFilter: (f: WebFilter) => void;
  blockSites: string[]; setBlockSites: (d: string[]) => void;
  allowSites: string[]; setAllowSites: (d: string[]) => void;
  allowWebApps: boolean; setAllowWebApps: (b: boolean) => void;
}) {
  const [test, setTest] = useState<{ name: string; result: string }[] | null>(null);
  const [testing, setTesting] = useState(false);
  const url = dnsUrl(p.dns);

  async function runTest() {
    if (!url) return;
    setTesting(true);
    try {
      setTest(await call('POST', '/api/dns-test', { url }));
    } finally {
      setTesting(false);
    }
  }

  const modes: { id: WebFilter; title: string; sub: string }[] = [
    { id: 'off', title: 'Off', sub: 'DNS does the blocking. Sign-in and payment pages in apps keep working. (Recommended)' },
    { id: 'block', title: 'Block these sites', sub: 'A second net under DNS, in every app that shows web pages.' },
    { id: 'allow', title: 'Only allow these sites', sub: 'Strictest. Breaks any sign-in or payment page not on the list.' },
  ];

  return (
    <>
      <StepTitle n={3} title="How is the internet filtered?" sub="Your DNS filter (NextDNS) blocks sites for every app. It's locked on and can't be switched off from the phone." />

      <div className="glass px-5 py-5">
        <label className="block text-[15px]">NextDNS profile ID, or any DNS-over-HTTPS address
          <input className={`${input} mt-1 w-full`} placeholder="e.g. abc123" value={p.dns}
            onChange={e => { p.setDns(e.target.value); setTest(null); }} />
        </label>
        {p.dns.trim() && !url && <p className="mt-2 text-[13px] text-destructive">That isn't a NextDNS ID or an https:// address.</p>}
        {!p.dns.trim() && <p className="mt-2 text-[13px] text-muted-fg">Leave empty for no DNS filter.</p>}
        {url && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className={secondary} onClick={runTest} disabled={testing}>{testing ? 'Testing…' : 'Test it'}</button>
            {test?.map(t => (
              <span key={t.name} className={`rounded-full px-2.5 py-1 text-[12px] ${t.result === 'blocked' ? 'bg-secondary text-secondary-fg' : t.result === 'error' ? 'bg-red-100 text-destructive' : 'bg-muted text-muted-fg'}`}>
                {t.name} {t.result === 'blocked' ? 'blocked' : t.result === 'error' ? 'error' : 'loads'}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="glass mt-4 px-5 py-5">
        <p className="label mb-3">Web filter</p>
        <div className="space-y-2">
          {modes.map(m => (
            <label key={m.id} className={`flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 ${p.webFilter === m.id ? 'bg-secondary' : 'hover:bg-muted'}`}>
              <input type="radio" name="webFilter" checked={p.webFilter === m.id} onChange={() => p.setWebFilter(m.id)} className="mt-1 accent-[var(--primary)]" />
              <span><span className="block text-[15px]">{m.title}</span><span className="block text-[13px] text-muted-fg">{m.sub}</span></span>
            </label>
          ))}
        </div>
        {p.webFilter === 'block' && <SiteList sites={p.blockSites} setSites={p.setBlockSites} placeholder="Block another site, e.g. twitch.tv" />}
        {p.webFilter === 'allow' && (
          <>
            <SiteList sites={p.allowSites} setSites={p.setAllowSites} placeholder="Allow a site, e.g. rbcroyalbank.com" />
            <label className="mt-4 flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={p.allowWebApps} onChange={e => p.setAllowWebApps(e.target.checked)} className="accent-[var(--primary)]" />
              Home-screen web apps can open (they still only load the sites above)
            </label>
          </>
        )}
      </div>
    </>
  );
}

function SiteList({ sites, setSites, placeholder }: { sites: string[]; setSites: (d: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const d = normalizeDomain(draft);
    if (d && !sites.includes(d)) setSites([...sites, d]);
    if (d) setDraft('');
  };
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {sites.map(d => (
          <span key={d} className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-[14px]">
            {d}
            <button onClick={() => setSites(sites.filter(x => x !== d))} aria-label={`Remove ${d}`}>×</button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input className={`${input} flex-1`} placeholder={placeholder} value={draft}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className={secondary} onClick={add}>Add</button>
      </div>
    </div>
  );
}

function TimeStep(p: {
  durationDays: number; setDurationDays: (n: number) => void; trialDays: number; setTrialDays: (n: number) => void;
  trialLocked: boolean; baseH: string; setBaseH: (s: string) => void; baseM: string; setBaseM: (s: string) => void;
}) {
  return (
    <>
      <StepTitle n={4} title="How long?" sub="You'll try it first, then seal it. Once sealed, nothing changes until the end." />
      <div className="glass space-y-6 px-5 py-5">
        <label className="block text-[15px]">Lock for
          <div className="mt-1 flex items-center gap-3">
            <input className={`${input} w-28`} type="number" min={90} value={p.durationDays}
              onChange={e => p.setDurationDays(Math.max(90, Number(e.target.value) || 90))} />
            <span className="text-muted-fg">days (90 at least)</span>
          </div>
        </label>
        <label className="block text-[15px]">Try it first for
          <div className="mt-1 flex items-center gap-3">
            <input className={`${input} w-28`} type="number" min={1} max={7} disabled={p.trialLocked} value={p.trialDays}
              onChange={e => p.setTrialDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} />
            <span className="text-muted-fg">days (up to 7){p.trialLocked ? ' · already running' : ''}</span>
          </div>
        </label>
        <div className="text-[15px]">Your screen time now, per day
          <div className="mt-1 flex items-center gap-2">
            <input className={`${input} w-20`} placeholder="h" inputMode="numeric" value={p.baseH} onChange={e => p.setBaseH(e.target.value)} />
            <span className="text-muted-fg">h</span>
            <input className={`${input} w-20`} placeholder="m" inputMode="numeric" value={p.baseM} onChange={e => p.setBaseM(e.target.value)} />
            <span className="text-muted-fg">m</span>
          </div>
          <p className="mt-2 text-[13px] text-muted-fg">From Settings → Screen Time. "Hours given back" is measured against this.</p>
        </div>
      </div>
    </>
  );
}

function ReviewStep(p: {
  apps: number; allowWebApps: boolean; dns: string | null; webFilter: WebFilter; sites: string[];
  durationDays: number; trialDays: number;
  baseline: string | null; updating: boolean; onGo: (step: number) => void;
}) {
  const rows: [string, string, number][] = [
    ['Apps that stay', `${p.apps} apps${p.allowWebApps ? ' + home-screen web apps' : ''}`, 1],
    ['DNS filter', p.dns ? (p.dns.startsWith('https://dns.nextdns.io/') ? 'NextDNS' : p.dns) : 'None', 2],
    ['Web filter', p.webFilter === 'off' ? 'Off' : `${p.webFilter === 'block' ? 'Blocks' : 'Only allows'} ${p.sites.length} sites`, 2],
    ['Lock', `${p.durationDays} days`, 3],
    ['Trial', p.updating ? 'Already running' : `${p.trialDays} days, removable`, 3],
    ['Screen time now', p.baseline ?? 'Not set', 3],
  ];
  return (
    <>
      <StepTitle n={5} title={p.updating ? 'Update the trial?' : 'Ready to try it?'}
        sub={p.updating ? 'The trial profile on your phone will be replaced with these settings.' : 'This puts the real profile on your phone, but you can remove it any time during the trial. Nothing is sealed yet.'} />
      <div className="glass divide-y divide-border px-5">
        {rows.map(([label, value, s]) => (
          <div key={label} className="flex items-baseline justify-between gap-6 py-3">
            <span className="text-[14px] text-muted-fg">{label}</span>
            <span className="flex-1 text-right text-[15px]">{value}</span>
            <button className="text-[13px] text-primary hover:underline" onClick={() => p.onGo(s)}>Edit</button>
          </div>
        ))}
      </div>
    </>
  );
}

function LockStatus({ lock, installed, device, busy, onSeal, onEdit, onRemove }: {
  lock: LockView; installed: boolean | null; device: Device | null; busy: string | null;
  onSeal: () => void; onEdit: () => void; onRemove: (notice: string) => void;
}) {
  const phase = lock.phase;
  const onPhone = installed === null ? 'Plug the phone in to check it.' : installed ? 'The profile is on the phone.' : 'The profile is NOT on the phone.';
  return (
    <section className="glass px-6 py-6">
      {phase === 'trial' && (
        <>
          <p className="label">Trial</p>
          <h2 className="mt-1 text-[26px] font-light">Trying it until {fmt(lock.trialEndsAt)}</h2>
          <p className="mt-2 text-[15px] text-muted-fg">{onPhone} Use your phone as normal. When it feels right, seal it to start {lock.durationDays} days.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className={primary} disabled={!device || !!busy} onClick={onSeal}>Seal for {lock.durationDays} days…</button>
            <button className={secondary} disabled={!!busy} onClick={onEdit}>Change the trial</button>
            <button className={secondary} disabled={!device || !!busy} onClick={() => onRemove('Trial ended and profile removed.')}>End the trial</button>
          </div>
        </>
      )}
      {phase === 'trial-expired' && (
        <>
          <p className="label">Trial ended</p>
          <h2 className="mt-1 text-[26px] font-light">The trial ended {fmt(lock.trialEndsAt)}</h2>
          <p className="mt-2 text-[15px] text-muted-fg">It can't be sealed now. Remove the trial profile, then start again.</p>
          <button className={`${primary} mt-6`} disabled={!device || !!busy} onClick={() => onRemove('Trial profile removed.')}>Remove the trial profile</button>
        </>
      )}
      {phase === 'sealing' && <h2 className="text-[26px] font-light">Sealing…</h2>}
      {phase === 'locked' && (
        <>
          <p className="label">Locked</p>
          <h2 className="mt-1 text-[26px] font-light">Until {fmt(lock.unlockAt!)}</h2>
          <p className="mt-2 text-[15px] text-muted-fg">Time-locked to drand round #{lock.round}. {onPhone} There's nothing to change until then.</p>
        </>
      )}
      {phase === 'unlockable' && (
        <>
          <p className="label">Open</p>
          <h2 className="mt-1 text-[26px] font-light">The lock has opened</h2>
          <p className="mt-2 text-[15px] text-muted-fg">Remove the profile here, or with the password in the Baseline app on your phone.</p>
          <button className={`${primary} mt-6`} disabled={!device || !!busy} onClick={() => onRemove('Profile removed. Well done.')}>Remove the profile</button>
        </>
      )}
    </section>
  );
}

function Expander({ open, onToggle, title, children }: { open: boolean; onToggle: () => void; title: string; children: ReactNode }) {
  return (
    <div className="glass mt-4 px-5 py-4">
      <button className="flex w-full items-center justify-between text-left" onClick={onToggle}>
        <span className="text-[14px]">{title}</span>
        <span className="text-muted-fg">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
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

interface PendingAccount { label: string; confirmed: boolean }

// Sealing, in two parts: first lock the accounts that could undo the lock (the
// DNS provider and its mailbox), then confirm. Passwords never reach this
// page: the Mac app makes them and puts them on the clipboard.
function SealDialog({ lock, busy, onCancel, onSeal }: { lock: LockView; busy: boolean; onCancel: () => void; onSeal: () => void }) {
  const [part, setPart] = useState<'accounts' | 'confirm'>('accounts');
  const [accounts, setAccounts] = useState<PendingAccount[]>([]);
  const [label, setLabel] = useState(lock.dnsServerUrl?.includes('nextdns') ? 'NextDNS' : '');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [handedBack, setHandedBack] = useState<{ label: string; password: string }[] | null>(null);
  const unlock = new Date(Date.now() + lock.durationDays * 86_400_000);
  const base = `/api/accounts/${lock.id}`;

  useEffect(() => { call<PendingAccount[]>('GET', base).then(setAccounts).catch(() => {}); }, [base]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  const waiting = accounts.find(a => !a.confirmed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/30 px-6 py-10">
      <div className="w-full max-w-lg rounded-[28px] bg-background px-7 py-7 shadow-2xl">
        {handedBack ? (
          <>
            <h2 className="text-[24px] font-light">Not sealed</h2>
            <p className="mt-2 text-[14px] text-muted-fg">These passwords may already be set on the sites. Save them somewhere before closing.</p>
            <ul className="mt-4 space-y-2">
              {handedBack.map(a => <li key={a.label} className="rounded-xl bg-muted px-3 py-2 text-[14px]"><b>{a.label}</b>: <span className="select-all font-mono">{a.password}</span></li>)}
            </ul>
            <div className="mt-5 flex justify-end"><button className={secondary} onClick={onCancel}>Close</button></div>
          </>
        ) : part === 'accounts' ? (
          <>
            <p className="label">Seal · 1 of 2</p>
            <h2 className="mt-1 text-[24px] font-light">Lock the accounts that could undo this</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-fg">
              Anyone who can sign in to your NextDNS account can switch the filter off. For each account, Baseline makes a new password and copies it.
              Paste it into the site's change-password page and save. You never see it, and it unlocks with the profile.
              Lock the account's email too, or "forgot password" gets you back in.
            </p>

            <ul className="mt-4 space-y-2">
              {accounts.map((a, i) => (
                <li key={i} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-[14px]">
                  <span>{a.label}</span>
                  {a.confirmed ? <span className="text-primary">Locked ✓</span> : (
                    <span className="flex gap-2">
                      <button className="text-primary hover:underline" onClick={() => run(() => call('POST', `${base}/${i}/copy`))}>Copy again</button>
                      <button className="font-medium text-primary hover:underline" onClick={() => run(async () => setAccounts(await call('POST', `${base}/${i}/confirm`)))}>It's changed</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {waiting && <p className="mt-2 text-[13px] text-primary">Password for {waiting.label} is on the clipboard. Paste it into the site, save, then press "It's changed".</p>}

            {!waiting && (
              <div className="mt-4 flex gap-2">
                <input className={`${input} flex-1`} placeholder='Account, e.g. "NextDNS" or "NextDNS email"' value={label} onChange={e => setLabel(e.target.value)} />
                <button className={secondary} disabled={!label.trim()}
                  onClick={() => run(async () => { setAccounts(await call('POST', base, { label })); setLabel(''); })}>
                  Make &amp; copy password
                </button>
              </div>
            )}
            {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

            <div className="mt-6 flex justify-between gap-3">
              <button className={secondary} onClick={() => run(async () => {
                const back = await call<{ label: string; password: string }[]>('POST', `${base}/discard`);
                if (back.length) setHandedBack(back); else onCancel();
              })}>Not yet</button>
              <button className={primary} disabled={Boolean(waiting)} onClick={() => setPart('confirm')}>
                {accounts.length ? 'Continue' : 'Skip, no accounts'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="label">Seal · 2 of 2</p>
            <h2 className="mt-1 text-[24px] font-light">Seal for {lock.durationDays} days?</h2>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted-fg">
              <li>Opens {fmt(unlock.toISOString())}. No exceptions and no early unlock.</li>
              <li>{lock.apps.length} apps, exactly as in the trial.</li>
              <li>The removal password{accounts.length ? ` and ${accounts.length} account password${accounts.length > 1 ? 's' : ''}` : ''} are time-locked with drand. You will never see them before then.</li>
            </ul>
            <label className="mt-5 block text-[14px]">Type <b>SEAL</b> to confirm
              <input className={`${input} mt-1 w-full`} value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button className={secondary} onClick={() => setPart('accounts')} disabled={busy}>Back</button>
              <button className={primary} disabled={typed !== 'SEAL' || busy} onClick={onSeal}>
                {busy ? 'Sealing…' : 'Seal it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
