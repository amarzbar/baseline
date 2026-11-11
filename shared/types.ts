// Types shared by the Mavis server, the Mac companion and the status PWA.

// What the server stores. "Trial expired" and "unlockable" are derived from
// the dates, never stored, so a stale status can't unlock anything.
export type LockStatus = 'trial' | 'sealing' | 'sealed' | 'removed' | 'cancelled';

export interface AllowedApp {
  bundleId: string;
  name: string;
}

export interface Lock {
  id: string;
  createdAt: string;
  status: LockStatus;
  trialEndsAt: string;
  durationDays: number;
  apps: AllowedApp[];
  domains: string[];
  allowWebApps: boolean;
  dnsServerUrl: string | null;
  baselineDailyMinutes: number | null;
  profileIdentifier: string;
  device: { name: string; ecid: string } | null;
  sealedAt: string | null;
  unlockAt: string | null;
  // drand quicknet round the removal password is time-locked to, and the
  // tlock (age-armored) ciphertext. Nobody can open it before that round.
  round: number | null;
  ciphertext: string | null;
  // Last time the Mac saw this lock's profile installed on the phone.
  profileSeenAt: string | null;
}

// A lock as the API returns it: no ciphertext, plus the derived state.
export interface LockView extends Omit<Lock, 'ciphertext'> {
  phase: 'trial' | 'trial-expired' | 'sealing' | 'locked' | 'unlockable' | 'removed' | 'cancelled';
}

export interface JournalEntry {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  tags: string[];
  photo: string | null;
}

export interface ScreenTimeEntry {
  weekStart: string; // YYYY-MM-DD, the Monday
  avgDailyMinutes: number;
}

export interface HealthDay {
  date: string; // YYYY-MM-DD
  steps: number;
  workouts: number;
}

export interface Milestone {
  day: number;
  label: string;
  reached: boolean;
}

export interface Summary {
  lock: LockView | null;
  day: number | null;
  daysLeft: number | null;
  hoursSaved: number | null;
  latestDailyMinutes: number | null;
  steps: number;
  workouts: number;
  moments: number;
  week: { steps: number; workouts: number; moments: number };
  milestones: Milestone[];
  screenTimeDue: boolean;
}
