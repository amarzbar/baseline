import assert from 'node:assert/strict';
import { test } from 'node:test';
import plist from 'plist';
import { buildProfile, serializeProfile } from '../mac/profile.ts';

const base = {
  identifier: 'xyz.amarzbar.baseline.lock',
  bundleIds: ['com.apple.mobilephone', 'com.rbc.mobile'],
  allowWebApps: true,
  webFilter: 'allow' as const,
  domains: ['amarzbar.xyz', 'baseline.amarzbar.xyz'],
  dnsServerUrl: 'https://dns.nextdns.io/abc123',
};

const byType = (p: Record<string, unknown>, type: string) =>
  (p.PayloadContent as Record<string, unknown>[]).find(x => x.PayloadType === type);

test('a trial profile is removable and has no password', () => {
  const p = buildProfile(base);
  assert.equal(p.PayloadRemovalDisallowed, false);
  assert.equal(byType(p, 'com.apple.profileRemovalPassword'), undefined);
});

test('a sealed profile needs its password to come off', () => {
  const p = buildProfile({ ...base, removalPassword: 's3cret' });
  assert.equal(p.PayloadRemovalDisallowed, true);
  assert.equal(byType(p, 'com.apple.profileRemovalPassword')?.RemovalPassword, 's3cret');
});

test('only kept apps launch, web apps included, escape hatches closed', () => {
  const r = byType(buildProfile(base), 'com.apple.applicationaccess')!;
  assert.deepEqual(r.allowListedAppBundleIDs, ['com.apple.mobilephone', 'com.rbc.mobile', 'com.apple.webapp']);
  assert.equal(r.allowEraseContentAndSettings, false);
  assert.equal(r.allowVPNCreation, false);
  assert.equal(r.allowUIConfigurationProfileInstallation, false);
  const noWeb = byType(buildProfile({ ...base, allowWebApps: false }), 'com.apple.applicationaccess')!;
  assert.ok(!(noWeb.allowListedAppBundleIDs as string[]).includes('com.apple.webapp'));
});

test('the web filter is an allowlist of the chosen sites', () => {
  const f = byType(buildProfile(base), 'com.apple.webcontent-filter')!;
  assert.equal(f.FilterType, 'BuiltIn');
  assert.deepEqual(f.AllowListBookmarks, [
    { URL: 'https://amarzbar.xyz/', Title: 'amarzbar.xyz' },
    { URL: 'https://baseline.amarzbar.xyz/', Title: 'baseline.amarzbar.xyz' },
  ]);
});

test('with the web filter off there is no filter payload at all', () => {
  const p = buildProfile({ ...base, webFilter: 'off' });
  assert.equal(byType(p, 'com.apple.webcontent-filter'), undefined);
  // An empty allowlist would block every site, so "allow" with no sites must never be built silently.
  assert.equal(byType(buildProfile({ ...base, webFilter: 'block', domains: [] }), 'com.apple.webcontent-filter'), undefined);
});

test('block mode denies the bare and www forms of each site', () => {
  const f = byType(buildProfile({ ...base, webFilter: 'block', domains: ['instagram.com', 'www.reddit.com'] }), 'com.apple.webcontent-filter')!;
  assert.deepEqual(f.DenyListURLs, ['https://instagram.com', 'https://www.instagram.com', 'https://www.reddit.com']);
  assert.equal(f.AllowListBookmarks, undefined);
});

test('DNS lock sits at the top level of its payload', () => {
  const d = byType(buildProfile(base), 'com.apple.dnsSettings.managed')!;
  assert.equal(d.ProhibitDisablement, true);
  assert.deepEqual(d.DNSSettings, { DNSProtocol: 'HTTPS', ServerURL: 'https://dns.nextdns.io/abc123' });
  assert.equal(byType(buildProfile({ ...base, dnsServerUrl: null }), 'com.apple.dnsSettings.managed'), undefined);
});

test('serializes to a plist that parses back', () => {
  const parsed = plist.parse(serializeProfile(base)) as Record<string, unknown>;
  assert.equal(parsed.PayloadIdentifier, 'xyz.amarzbar.baseline.lock');
  assert.equal((parsed.PayloadContent as unknown[]).length, 3);
});
