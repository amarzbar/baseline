import type { Summary } from '../../../shared/types.ts';
import { fmtDate, fmtMinutes, fmtNumber } from '../api.ts';
import { Ring } from '../components.tsx';

const DAY = 86_400_000;

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// "walked 71k steps, trained 3 times, and wrote down 4 moments worth keeping."
function weekSentence(w: Summary['week']): string | null {
  const parts = [
    w.steps ? `walked ${fmtNumber(w.steps)} steps` : null,
    w.workouts ? `trained ${w.workouts === 1 ? 'once' : `${w.workouts} times`}` : null,
    w.moments ? `wrote down ${plural(w.moments, 'moment')} worth keeping` : null,
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  return parts.length === 1 ? `${parts[0]}.` : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}

export default function TodayScreen({ summary, onLogScreenTime }: { summary: Summary; onLogScreenTime: () => void }) {
  const { lock } = summary;

  if (!lock || lock.phase === 'cancelled') {
    return (
      <Header label="No lock yet" title="Begin when you're ready" sub="Plug your iPhone into your Mac and open Baseline to choose what stays." />
    );
  }

  if (lock.phase === 'trial' || lock.phase === 'trial-expired' || lock.phase === 'sealing') {
    const started = new Date(lock.createdAt).getTime();
    const ends = new Date(lock.trialEndsAt).getTime();
    const trialDays = Math.round((ends - started) / DAY);
    const day = Math.min(trialDays, Math.floor((Date.now() - started) / DAY) + 1);
    return (
      <div>
        <Header
          label={lock.phase === 'sealing' ? 'Sealing' : lock.phase === 'trial' ? `Trial · day ${day} of ${trialDays}` : 'Trial ended'}
          title={lock.phase === 'trial-expired' ? 'The trial has ended' : 'Trying it on'}
          sub={lock.phase === 'trial'
            ? `Seal by ${fmtDate(lock.trialEndsAt, { weekday: 'long', day: 'numeric', month: 'long' })} to start your ${lock.durationDays} days.`
            : lock.phase === 'sealing' ? 'Your Mac is putting the lock in place.'
            : 'Remove the trial profile, or start a new trial from your Mac.'}
        />
        <div className="my-8">
          <Ring value={day} max={trialDays} size={190}>
            <span className="text-[46px] font-extralight leading-none tracking-tight">{day}</span>
            <span className="label mt-2">of {trialDays} trial days</span>
          </Ring>
        </div>
        <div className="glass px-5 py-4">
          <p className="label">While you try it</p>
          <p className="mt-2 text-[15px] leading-relaxed">
            Use your phone as normal. If a kept app or site breaks, change the list on your Mac now: once sealed, nothing changes for {lock.durationDays} days.
          </p>
        </div>
      </div>
    );
  }

  const day = summary.day ?? 0;
  const week = weekSentence(summary.week);

  return (
    <div>
      {lock.phase === 'unlockable' ? (
        <Header label={`Day ${lock.durationDays} of ${lock.durationDays}`} title="You made it" sub="The lock has opened. Your removal password is in the Lock tab." />
      ) : (
        <Header
          label={`Day ${day} of ${lock.durationDays}`}
          title={`Unlocks ${fmtDate(lock.unlockAt!)}`}
          sub={`${plural(summary.daysLeft ?? 0, 'day')} to go · sealed ${fmtDate(lock.sealedAt!, { day: 'numeric', month: 'short' })}`}
        />
      )}

      <div className="my-8">
        <Ring value={day} max={lock.durationDays}>
          {summary.hoursSaved != null ? (
            <>
              <span className="text-[46px] font-extralight leading-none tracking-tight">{summary.hoursSaved}h</span>
              <span className="label mt-2">given back</span>
            </>
          ) : (
            <>
              <span className="text-[46px] font-extralight leading-none tracking-tight">{day}</span>
              <span className="label mt-2">{day === 1 ? 'day' : 'days'} in</span>
            </>
          )}
        </Ring>
      </div>

      <div className="flex justify-between px-1 text-center">
        <Stat value={summary.latestDailyMinutes != null ? fmtMinutes(summary.latestDailyMinutes) : '—'}
          caption={lock.baselineDailyMinutes != null ? `a day · was ${fmtMinutes(lock.baselineDailyMinutes)}` : 'a day'} />
        <Stat value={fmtNumber(summary.steps)} caption="steps" />
        <Stat value={String(summary.moments)} caption={summary.moments === 1 ? 'moment' : 'moments'} />
      </div>

      {summary.screenTimeDue && (
        <button onClick={onLogScreenTime} className="glass mt-6 flex w-full items-center justify-between px-5 py-4 text-left active:scale-[0.99]">
          <div>
            <p className="label">Sunday check-in</p>
            <p className="mt-1 text-[15px]">Log this week's screen time</p>
          </div>
          <span className="text-[22px] font-extralight text-primary">→</span>
        </button>
      )}

      {summary.milestones.length > 0 && (
        <div className="glass mt-4 px-5 py-4">
          <p className="label">Milestones</p>
          <div className="mt-3 flex gap-1.5">
            {summary.milestones.map(m => (
              <div key={m.day} className={`h-1 flex-1 rounded-full ${m.reached ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-fg">
            {summary.milestones.map(m => <span key={m.day} className={m.reached ? 'text-primary' : ''}>{m.label}</span>)}
          </div>
        </div>
      )}

      <div className="glass mt-4 px-5 py-4">
        <p className="label">This week you</p>
        <p className="mt-2 text-[16px] leading-relaxed">
          {week ?? 'have a blank page. Go outside, call someone, make something, then tap + to keep it.'}
        </p>
      </div>

      {!summary.screenTimeDue && (
        <button onClick={onLogScreenTime} className="mt-6 w-full text-center text-[13px] text-muted-fg underline-offset-4 hover:underline">
          Log screen time
        </button>
      )}
    </div>
  );
}

function Header({ label, title, sub }: { label: string; title: string; sub: string }) {
  return (
    <div className="pt-2">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-[17px] font-medium tracking-wide">Baseline</span>
      </div>
      <p className="label">{label}</p>
      <h1 className="mt-1 mb-1 text-[30px] font-light leading-tight tracking-tight">{title}</h1>
      <p className="text-[14px] text-muted-fg">{sub}</p>
    </div>
  );
}

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="flex-1">
      <p className="text-[22px] font-normal">{value}</p>
      <p className="text-[11px] tracking-wide text-muted-fg">{caption}</p>
    </div>
  );
}
