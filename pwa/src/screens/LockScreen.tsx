import { useState } from 'react';
import type { Summary } from '../../../shared/types.ts';
import { api, fmtDate } from '../api.ts';
import { primaryButton } from '../components.tsx';

const PHASE_LABEL: Record<string, string> = {
  trial: 'Trial',
  'trial-expired': 'Trial ended',
  sealing: 'Sealing',
  locked: 'Locked',
  unlockable: 'Open',
  removed: 'Finished',
  cancelled: 'Cancelled',
};

export default function LockScreen({ summary }: { summary: Summary }) {
  const { lock } = summary;
  const [password, setPassword] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<{ label: string; password: string | null }[]>([]);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [showApps, setShowApps] = useState(false);

  if (!lock) {
    return <p className="pt-24 text-center text-[15px] text-muted-fg">No lock yet. Start one from Baseline on your Mac.</p>;
  }

  async function reveal() {
    try {
      const r = await api.reveal(lock!.id);
      setPassword(r.password);
      setAccounts(r.accounts ?? []);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : String(err));
    }
  }

  const healthUrl = `${location.origin}/api/health`;

  return (
    <div className="space-y-4 pt-2">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-[17px] font-medium tracking-wide">Lock</span>
        <span className="rounded-full bg-secondary px-3 py-1 text-[12px] font-medium text-secondary-fg">{PHASE_LABEL[lock.phase]}</span>
      </div>

      <div className="glass px-5 py-4">
        <Row label="Length" value={`${lock.durationDays} days`} />
        {lock.sealedAt && <Row label="Sealed" value={fmtDate(lock.sealedAt, { day: 'numeric', month: 'long', year: 'numeric' })} />}
        {lock.unlockAt && <Row label="Unlocks" value={new Date(lock.unlockAt).toLocaleString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })} />}
        {lock.phase === 'trial' && <Row label="Trial ends" value={fmtDate(lock.trialEndsAt, { weekday: 'short', day: 'numeric', month: 'long' })} />}
        {lock.device && <Row label="Phone" value={lock.device.name} />}
        {lock.profileSeenAt && <Row label="Profile seen" value={fmtDate(lock.profileSeenAt, { day: 'numeric', month: 'short' })} />}
        {lock.round && <Row label="drand round" value={`#${lock.round.toLocaleString()}`} />}
      </div>

      {(lock.phase === 'unlockable' || lock.phase === 'removed') && (
        <div className="glass px-5 py-5">
          <p className="label">Removal password</p>
          {password ? (
            <>
              <p className="mt-3 select-all break-all rounded-2xl bg-muted px-4 py-3 font-mono text-[17px]">{password}</p>
              {accounts.map(a => (
                <div key={a.label} className="mt-3">
                  <p className="text-[13px] text-muted-fg">{a.label}</p>
                  <p className="select-all break-all rounded-2xl bg-muted px-4 py-3 font-mono text-[15px]">{a.password ?? 'still locked'}</p>
                </div>
              ))}
              <p className="mt-3 text-[13px] leading-relaxed text-muted-fg">
                Settings → General → VPN &amp; Device Management → Baseline (locked) → Remove, then enter this password.
                Or plug into your Mac and remove it from Baseline there.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 mb-4 text-[14px] text-muted-fg">drand has published the round. The time-lock can open now.</p>
              <button className={primaryButton} onClick={reveal}>Open the time-lock</button>
              {revealError && <p className="mt-2 text-[13px] text-destructive">{revealError}</p>}
            </>
          )}
        </div>
      )}

      {lock.phase === 'locked' && (
        <div className="glass px-5 py-4">
          <p className="label">Removal password</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-fg">
            Sealed with tlock to drand round #{lock.round?.toLocaleString()}{lock.accounts.length ? `, along with the password${lock.accounts.length > 1 ? 's' : ''} for ${lock.accounts.join(' and ')}` : ''}. Nobody, not this server and not you, can read them before {fmtDate(lock.unlockAt!)}.
          </p>
        </div>
      )}

      <div className="glass px-5 py-4">
        <button className="flex w-full items-center justify-between" onClick={() => setShowApps(s => !s)}>
          <span className="label">Kept apps · {lock.apps.length}</span>
          <span className="text-muted-fg">{showApps ? '−' : '+'}</span>
        </button>
        {showApps && (
          <ul className="mt-3 space-y-1.5 text-[14px]">
            {lock.apps.map(a => <li key={a.bundleId}>{a.name}</li>)}
            {lock.allowWebApps && <li className="text-muted-fg">Home-screen web apps</li>}
          </ul>
        )}
      </div>

      <div className="glass px-5 py-4">
        <p className="label">Filtering</p>
        <p className="mt-2 text-[14px]">
          {lock.dnsServerUrl ? (lock.dnsServerUrl.includes('nextdns') ? 'NextDNS' : 'Encrypted DNS') + ', locked on' : 'No DNS filter'}
          {' · '}
          {lock.webFilter === 'off' ? 'web filter off' : lock.webFilter === 'block' ? `${lock.domains.length} sites blocked` : `only ${lock.domains.length} sites load`}
        </p>
        {lock.webFilter !== 'off' && lock.domains.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lock.domains.map(d => <span key={d} className="rounded-full bg-secondary px-2.5 py-1 text-[12px] text-secondary-fg">{d}</span>)}
          </div>
        )}
      </div>

      <details className="glass px-5 py-4">
        <summary className="label cursor-pointer list-none">Steps &amp; workouts from Health</summary>
        <div className="mt-3 space-y-2 text-[14px] leading-relaxed">
          <p>Make a Shortcut, then a daily Personal Automation (Run Immediately) that runs it:</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-fg">
            <li>Find Health Samples: Steps, start date is today, group by day. Then Calculate Statistics: Sum.</li>
            <li>Find Workouts: start date is today. Then Count.</li>
            <li>Get Contents of URL: POST, header <code>Authorization: Bearer &lt;your token&gt;</code>, JSON body with <code>steps</code> and <code>workouts</code>.</li>
          </ol>
          <p className="break-all rounded-xl bg-muted px-3 py-2 font-mono text-[12px]">{healthUrl}</p>
        </div>
      </details>

      <details className="glass px-5 py-4">
        <summary className="label cursor-pointer list-none">What this can't stop</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted-fg">
          <li>A full restore through recovery mode with a computer.</li>
          <li>The supervision identity on your Mac: Apple Configurator can remove the profile without the password.</li>
          <li>Changing your NextDNS settings from another device, unless that account (and its email) were locked when sealing.</li>
        </ul>
      </details>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-[13px] text-muted-fg">{label}</span>
      <span className="text-[15px]">{value}</span>
    </div>
  );
}
