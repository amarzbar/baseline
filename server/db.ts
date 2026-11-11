// A single JSON file on the data volume. One person's data, a few hundred
// records a year: a database would be more moving parts than it's worth.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HealthDay, JournalEntry, Lock, ScreenTimeEntry } from '../shared/types.ts';

export interface Data {
  locks: Lock[];
  journal: JournalEntry[];
  screenTime: ScreenTimeEntry[];
  health: HealthDay[];
}

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const FILE = path.join(DATA_DIR, 'baseline.json');

mkdirSync(PHOTO_DIR, { recursive: true });

function load(): Data {
  try {
    return { locks: [], journal: [], screenTime: [], health: [], ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { locks: [], journal: [], screenTime: [], health: [] };
    throw err;
  }
}

export const db: Data = load();

// Write to a temp file and rename, so a crash mid-write can't lose a sealed
// lock's ciphertext.
export function save(): void {
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, FILE);
}
