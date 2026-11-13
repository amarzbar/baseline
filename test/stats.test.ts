import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Lock } from '../shared/types.ts';
import { lockView, mondayOf, summarize } from '../server/stats.ts';
import type { Data } from '../server/db.ts';

const DAY = 86_400_000;
const sealedAt = new Date(2026, 10, 2, 9); // Mon 2 Nov 2026, local
const lock = (over: Partial<Lock> = {}): Lock => ({
  id: 'l1', createdAt: new Date(sealedAt.getTime() - 3 * DAY).toISOString(), status: 'sealed',
  trialEndsAt: new Date(sealedAt.getTime() + 4 * DAY).toISOString(), durationDays: 90,
  apps: [], webFilter: 'off', domains: [], allowWebApps: true, dnsServerUrl: null, baselineDailyMinutes: 200,
  profileIdentifier: 'x', device: null, sealedAt: sealedAt.toISOString(),
  unlockAt: new Date(sealedAt.getTime() + 90 * DAY).toISOString(), round: 1, ciphertext: 'secret', accounts: [{ label: 'NextDNS', ciphertext: 'acct-secret' }], profileSeenAt: null,
  ...over,
});
const data = (l: Lock, extra: Partial<Data> = {}): Data => ({ locks: [l], journal: [], screenTime: [], health: [], ...extra });

test('phases come from the dates, not the stored status', () => {
  const l = lock();
  assert.equal(lockView(l, new Date(sealedAt.getTime() + DAY)).phase, 'locked');
  assert.equal(lockView(l, new Date(sealedAt.getTime() + 90 * DAY)).phase, 'unlockable');
  const t = lock({ status: 'trial', sealedAt: null, unlockAt: null });
  assert.equal(lockView(t, new Date(sealedAt.getTime())).phase, 'trial');
  assert.equal(lockView(t, new Date(sealedAt.getTime() + 5 * DAY)).phase, 'trial-expired');
});

test('the API view never carries a ciphertext', () => {
  const v = lockView(lock(), new Date());
  assert.ok(!('ciphertext' in v));
  assert.deepEqual(v.accounts, ['NextDNS']);
  assert.ok(!JSON.stringify(v).includes('secret'));
});

test('day count, days left and milestones', () => {
  const s = summarize(data(lock()), new Date(sealedAt.getTime() + 39.5 * DAY));
  assert.equal(s.day, 40);
  assert.equal(s.daysLeft, 51);
  assert.deepEqual(s.milestones.map(m => [m.day, m.reached]), [[7, true], [30, true], [60, false], [90, false]]);
});

test('hours saved only counts logged weeks while locked', () => {
  const now = new Date(sealedAt.getTime() + 14 * DAY);
  const s = summarize(data(lock(), { screenTime: [
    { weekStart: mondayOf(sealedAt), avgDailyMinutes: 140 },                         // 60 min/day × 7
    { weekStart: mondayOf(new Date(sealedAt.getTime() + 7 * DAY)), avgDailyMinutes: 80 }, // 120 min/day × 7
  ] }), now);
  assert.equal(s.hoursSaved, Math.round((60 * 7 - 60 * 9 / 24 + 120 * 7) / 60));
});

test('no lock, nothing counted', () => {
  const s = summarize({ locks: [], journal: [], screenTime: [], health: [] }, new Date());
  assert.equal(s.lock, null);
  assert.equal(s.day, null);
  assert.equal(s.hoursSaved, null);
});
