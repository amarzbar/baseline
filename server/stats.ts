// Turns stored records into what the PWA shows. Pure functions of (data, now).
import type { Lock, LockView, Milestone, Summary } from '../shared/types.ts';
import type { Data } from './db.ts';

const DAY = 86_400_000;

export function lockView(lock: Lock, now: Date): LockView {
  const { ciphertext: _ciphertext, accounts, ...rest } = lock;
  let phase: LockView['phase'];
  switch (lock.status) {
    case 'trial': phase = now > new Date(lock.trialEndsAt) ? 'trial-expired' : 'trial'; break;
    case 'sealing': phase = 'sealing'; break;
    case 'sealed': phase = lock.unlockAt && now >= new Date(lock.unlockAt) ? 'unlockable' : 'locked'; break;
    default: phase = lock.status;
  }
  return {
    ...rest,
    // Locks from before these settings existed used an allowlist.
    webFilter: lock.webFilter ?? 'allow',
    accounts: (accounts ?? []).map(a => a.label),
    phase,
  };
}

export function currentLock(data: Data): Lock | null {
  const live = data.locks.filter(l => l.status !== 'cancelled');
  return live.length ? live[live.length - 1] : null;
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function mondayOf(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return localDate(m);
}

function parseLocal(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function milestones(durationDays: number, day: number): Milestone[] {
  const marks = new Map<number, string>([[7, '1 wk'], [30, '30 d'], [60, '60 d']]);
  marks.set(durationDays, `${durationDays} d`);
  return [...marks]
    .filter(([d]) => d <= durationDays)
    .sort((a, b) => a[0] - b[0])
    .map(([d, label]) => ({ day: d, label, reached: day >= d }));
}

export function summarize(data: Data, now: Date): Summary {
  const lock = currentLock(data);
  const view = lock ? lockView(lock, now) : null;
  const since = lock ? new Date(lock.sealedAt ?? lock.createdAt) : now;
  const counting = view?.phase === 'locked' || view?.phase === 'unlockable';

  const day = counting && lock
    ? Math.min(lock.durationDays, Math.floor((now.getTime() - since.getTime()) / DAY) + 1)
    : null;
  const daysLeft = counting && lock?.unlockAt
    ? Math.max(0, Math.ceil((new Date(lock.unlockAt).getTime() - now.getTime()) / DAY))
    : null;

  // Hours saved: for each logged week, (baseline − that week's average) for
  // the days of that week the lock was on. Unlogged weeks count as nothing.
  let hoursSaved: number | null = null;
  const baseline = lock?.baselineDailyMinutes ?? null;
  const weeks = [...data.screenTime].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (counting && baseline != null && weeks.length) {
    let minutes = 0;
    for (const w of weeks) {
      const start = Math.max(parseLocal(w.weekStart).getTime(), since.getTime());
      const end = Math.min(parseLocal(w.weekStart).getTime() + 7 * DAY, now.getTime());
      if (end > start) minutes += Math.max(0, baseline - w.avgDailyMinutes) * ((end - start) / DAY);
    }
    hoursSaved = Math.round(minutes / 60);
  }

  const sinceDate = localDate(since);
  const health = data.health.filter(h => h.date >= sinceDate);
  const journal = data.journal.filter(j => new Date(j.createdAt) >= since);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const weekHealth = data.health.filter(h => h.date > localDate(weekAgo));

  const thisMonday = mondayOf(now);
  const lastMonday = mondayOf(new Date(now.getTime() - 7 * DAY));
  const logged = new Set(weeks.map(w => w.weekStart));
  const screenTimeDue = counting && (
    (now.getDay() === 0 && !logged.has(thisMonday)) ||
    (!logged.has(lastMonday) && lastMonday >= mondayOf(since))
  );

  return {
    lock: view,
    day,
    daysLeft,
    hoursSaved,
    latestDailyMinutes: weeks.length ? weeks[weeks.length - 1].avgDailyMinutes : null,
    steps: health.reduce((n, h) => n + h.steps, 0),
    workouts: health.reduce((n, h) => n + h.workouts, 0),
    moments: journal.length,
    week: {
      steps: weekHealth.reduce((n, h) => n + h.steps, 0),
      workouts: weekHealth.reduce((n, h) => n + h.workouts, 0),
      moments: data.journal.filter(j => new Date(j.createdAt) >= weekAgo).length,
    },
    milestones: lock ? milestones(lock.durationDays, day ?? 0) : [],
    screenTimeDue,
  };
}
