import type { AllowedApp } from './types.ts';

// Apple's own apps. cfgutil's installedApps only lists apps from the App
// Store, so these are offered separately with plain names. Everything is
// kept by default except Safari: home-screen web apps still open through
// `com.apple.webapp`, and the web filter limits what they can load.
export const BUILT_IN_APPS: (AllowedApp & { keep: boolean })[] = [
  { bundleId: 'com.apple.mobilephone', name: 'Phone', keep: true },
  { bundleId: 'com.apple.MobileSMS', name: 'Messages', keep: true },
  { bundleId: 'com.apple.facetime', name: 'FaceTime', keep: true },
  { bundleId: 'com.apple.Preferences', name: 'Settings', keep: true },
  { bundleId: 'com.apple.Passbook', name: 'Wallet', keep: true },
  { bundleId: 'com.apple.camera', name: 'Camera', keep: true },
  { bundleId: 'com.apple.mobileslideshow', name: 'Photos', keep: true },
  { bundleId: 'com.apple.mobilemail', name: 'Mail', keep: true },
  { bundleId: 'com.apple.mobilecal', name: 'Calendar', keep: true },
  { bundleId: 'com.apple.MobileAddressBook', name: 'Contacts', keep: true },
  { bundleId: 'com.apple.Maps', name: 'Maps', keep: true },
  { bundleId: 'com.apple.Health', name: 'Health', keep: true },
  { bundleId: 'com.apple.Fitness', name: 'Fitness', keep: true },
  { bundleId: 'com.apple.mobiletimer', name: 'Clock', keep: true },
  { bundleId: 'com.apple.reminders', name: 'Reminders', keep: true },
  { bundleId: 'com.apple.mobilenotes', name: 'Notes', keep: true },
  { bundleId: 'com.apple.calculator', name: 'Calculator', keep: true },
  { bundleId: 'com.apple.weather', name: 'Weather', keep: true },
  { bundleId: 'com.apple.findmy', name: 'Find My', keep: true },
  { bundleId: 'com.apple.shortcuts', name: 'Shortcuts', keep: true },
  { bundleId: 'com.apple.DocumentsApp', name: 'Files', keep: true },
  { bundleId: 'com.apple.VoiceMemos', name: 'Voice Memos', keep: true },
  { bundleId: 'com.apple.Music', name: 'Music', keep: true },
  { bundleId: 'com.apple.Home', name: 'Home', keep: true },
  { bundleId: 'com.apple.AppStore', name: 'App Store (updates)', keep: true },
  { bundleId: 'com.apple.mobilesafari', name: 'Safari', keep: false },
  { bundleId: 'com.apple.tv', name: 'TV', keep: false },
  { bundleId: 'com.apple.podcasts', name: 'Podcasts', keep: false },
  { bundleId: 'com.apple.news', name: 'News', keep: false },
];

// Lets every home-screen web app launch (Apple's allowlist value for web clips).
export const WEB_APP_BUNDLE_ID = 'com.apple.webapp';

// A first guess at what to keep: money, health, work, sign-in and the tailnet.
// The user confirms; this only pre-ticks boxes.
const SUGGEST = [
  'bank', 'rbc', 'td', 'scotia', 'cibc', 'bmo', 'desjardins', 'tangerine', 'simplii',
  'wealthsimple', 'questrade', 'koho', 'interac', 'paypal', 'wallet', 'pay',
  'health', 'fit', 'strava', 'garmin', 'whoop', 'oura', 'pharm', 'clinic',
  'authenticator', 'okta', 'duo', '1password', 'bitwarden', 'authy',
  'outlook', 'teams', 'slack', 'office', 'workday', 'hid', 'access', 'tailscale',
];

const AVOID = ['instagram', 'twitter', 'tiktok', 'facebook', 'snapchat', 'reddit', 'youtube',
  'threads', 'chrome', 'firefox', 'brave', 'opera', 'duckduckgo', 'browser', 'netflix', 'x.com'];

export function suggestKeep(app: AllowedApp): boolean {
  const hay = `${app.bundleId} ${app.name}`.toLowerCase();
  if (AVOID.some(w => hay.includes(w))) return false;
  return SUGGEST.some(w => new RegExp(`(^|[^a-z])${w}`).test(hay));
}

export function normalizeDomain(input: string): string | null {
  const host = input.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) ? host : null;
}
