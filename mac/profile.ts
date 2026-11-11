// Builds the Baseline configuration profile. Every key here is checked against
// Apple's schema (github.com/apple/device-management, mdm/profiles/*.yaml), and
// all of them need a supervised iPhone to take effect.
import { randomUUID } from 'node:crypto';
import plist from 'plist';
import { WEB_APP_BUNDLE_ID } from '../shared/apps.ts';

export interface ProfileOptions {
  identifier: string;
  bundleIds: string[];
  allowWebApps: boolean;
  domains: string[];
  dnsServerUrl: string | null;
  // Present only when sealing. Without it the profile is a freely removable trial.
  removalPassword?: string;
}

const uuid = () => randomUUID().toUpperCase();

function payload(type: string, name: string, body: Record<string, unknown>) {
  const id = uuid();
  return {
    PayloadType: type,
    PayloadIdentifier: `${type}.${id}`,
    PayloadUUID: id,
    PayloadVersion: 1,
    PayloadDisplayName: name,
    ...body,
  };
}

export function buildProfile(o: ProfileOptions): Record<string, unknown> {
  const bundleIds = [...new Set([...o.bundleIds, ...(o.allowWebApps ? [WEB_APP_BUNDLE_ID] : [])])];

  const content: Record<string, unknown>[] = [
    payload('com.apple.applicationaccess', 'Restrictions', {
      // Only these apps show or launch. New installs land hidden, while kept
      // apps (and the App Store) still update.
      allowListedAppBundleIDs: bundleIds,
      // The obvious ways around the lock.
      allowEraseContentAndSettings: false,
      allowVPNCreation: false,
      allowUIConfigurationProfileInstallation: false,
      allowAppClips: false,
      allowEnterpriseAppTrust: false,
      allowMarketplaceAppInstallation: false,
      allowWebDistributionAppInstallation: false,
    }),
    payload('com.apple.webcontent-filter', 'Web allowlist', {
      FilterType: 'BuiltIn',
      // Allowlist mode: WebKit everywhere (Safari, web apps, in-app browsers)
      // can only load these sites.
      AllowListBookmarks: o.domains.map(d => ({ URL: `https://${d}/`, Title: d })),
    }),
  ];

  if (o.dnsServerUrl) {
    content.push(payload('com.apple.dnsSettings.managed', 'Filtered DNS', {
      DNSSettings: { DNSProtocol: 'HTTPS', ServerURL: o.dnsServerUrl },
      // Top-level, a sibling of DNSSettings (nesting it is silently ignored).
      ProhibitDisablement: true,
    }));
  }

  if (o.removalPassword) {
    content.push(payload('com.apple.profileRemovalPassword', 'Removal password', {
      RemovalPassword: o.removalPassword,
    }));
  }

  return {
    PayloadType: 'Configuration',
    PayloadVersion: 1,
    PayloadIdentifier: o.identifier,
    PayloadUUID: uuid(),
    PayloadDisplayName: o.removalPassword ? 'Baseline (locked)' : 'Baseline (trial)',
    PayloadDescription: o.removalPassword
      ? 'Locked by Baseline. The removal password unlocks on the date shown in the Baseline app.'
      : 'Baseline trial. Remove it any time during the trial.',
    PayloadOrganization: 'Baseline',
    PayloadScope: 'System',
    // With a removal password present, this means "only with the password".
    PayloadRemovalDisallowed: Boolean(o.removalPassword),
    PayloadContent: content,
  };
}

export function serializeProfile(o: ProfileOptions): string {
  return plist.build(buildProfile(o) as plist.PlistValue);
}
