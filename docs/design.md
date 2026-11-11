# Baseline: design

Date: 2026-11-11. Owner: amarzbar. Replaces `~/Coding/pandora-lockout`, which stays as a reference.

## Why

Open internet access on the phone leads to social media and endless scrolling. Baseline locks a
supervised iPhone into a chosen set of apps and sites for at least 90 days, to build better
habits. Everything the phone is needed for keeps working: banking, health, Wallet (the work
access card), and the self-hosted PWAs on `amarzbar.xyz`. The lock can't be opened early, not
even by its owner.

## Goals

- Pick the apps that stay from a list of real names and icons. Never type a bundle ID.
- Apps not on the list can't open. New installs land hidden. Kept apps and the App Store keep
  updating.
- Only allowlisted sites load, in every app that shows web pages. DNS filtering (NextDNS) is an
  optional second layer.
- A trial of up to 7 days with the real profile, removable freely, before anything is sealed.
- Sealing: the profile's removal password is time-locked with tlock (drand quicknet). Nobody,
  including the server's owner, can read it before the unlock date.
- A status PWA, airy and Salik-styled: lock progress, hours given back, steps, and a journal
  of notes and photos.

## Non-goals and anti-goals

- No exceptions mid-term. No early unlock. (A paid early unlock is a "later, maybe" product
  idea, deliberately not built.)
- The PWA must not become one more app to check: no notifications, no feed, nothing that
  rewards screen time.
- No MDM server. Profiles go on over USB with Apple Configurator's `cfgutil`.

## How it works

```
Mac (127.0.0.1:8770)                 Mavis (Docker, behind Cloudflare)       drand quicknet
  reads apps via cfgutil   ──trial──▶  stores lock settings
  builds + installs profile
  seal: random password ──tlock──────────────────────────────────────────▶  (public key)
        ciphertext ──────────────────▶  stores ciphertext (status: sealing)
        installs locked profile
        confirms ────────────────────▶  status: sealed
                                       PWA reads /api/summary
  unlock day                           /reveal: tlock decrypt ◀── round N published
```

- **Password lifetime:** generated on the Mac in memory, time-locked, then written into the
  profile. cfgutil installs only from a file, so the profile sits in a private `0600` temp file
  for that one call and is overwritten and deleted. The ciphertext reaches the server *before*
  the profile reaches the phone. That way a locked profile never exists without a stored way to
  open it.
- **Self-check:** before sealing, the Mac tries to decrypt the fresh ciphertext and refuses to
  continue if it opens.
- **Access:** the server sits behind a Cloudflare Tunnel at `baseline.amarzbar.xyz`. One
  shared secret, `BASELINE_TOKEN`, guards everything but the PWA shell: the Mac and the Health
  Shortcut send it as a Bearer header, and the PWA trades it once for a year-long HttpOnly
  cookie (journal photos load through `<img>`). Logins are limited to five tries a minute per
  address. The token protects privacy and the trial; it can't open a sealed lock, which only
  drand can.
- **Phases** are derived from dates, never stored: `trial`, `trial-expired`, `sealing`,
  `locked`, `unlockable`, `removed`, `cancelled`.

## The profile (all keys need supervision; checked against apple/device-management)

| Payload | Keys |
|---|---|
| `com.apple.applicationaccess` | `allowListedAppBundleIDs` (kept apps, the App Store, `com.apple.webapp` for home-screen web apps), `allowEraseContentAndSettings`, `allowVPNCreation`, `allowUIConfigurationProfileInstallation`, `allowAppClips`, `allowEnterpriseAppTrust`, `allowMarketplaceAppInstallation`, `allowWebDistributionAppInstallation`, all `false` |
| `com.apple.webcontent-filter` | `FilterType: BuiltIn`, `AllowListBookmarks` (one `https://host/` per allowed site) |
| `com.apple.dnsSettings.managed` | DoH to NextDNS, `ProhibitDisablement` at the top level (optional) |
| `com.apple.profileRemovalPassword` | sealed only |
| top level | `PayloadRemovalDisallowed: true` when sealed (removable only with the password) |

## Progress numbers

- **Hours given back** = (baseline daily screen time − logged weekly average) × days locked in
  that week, over the weeks logged. The phone doesn't expose Screen Time to a web app, so the
  baseline is entered at setup and the weekly average is typed in on Sundays (about 10 seconds).
  Automatic tracking would need a native app with Apple's Family Controls entitlement: later,
  if ever.
- **Steps and workouts** come from a daily iOS Shortcut automation that POSTs to `/api/health`.
- **Journal**: notes, tags and photos (shrunk to 1600px on the phone), stored on Mavis.

## Delivery

- CI (`ci.yml`): typecheck, tests, build, and a smoke run of the bundled CLI on every push and PR.
- Image (`docker.yml`): `ghcr.io/amarzbar/baseline:latest` on every push to `main`. Mavis runs
  `scripts/auto-update.sh` from cron, as Salik does.
- npm (`release.yml`): a `v*` tag publishes the Mac companion as `baseline-lock`, a single
  esbuild bundle with no runtime dependencies, plus the built Mac UI.

## Known gaps (accepted)

- A full restore through recovery mode with a computer removes everything.
- The supervision identity on the Mac can remove the profile through Apple Configurator
  without the password. The owner chose to leave it there.
- NextDNS settings can be changed from another device.
- If drand shut down for good before the unlock date, the password could not be recovered.
  The ciphertext opens any time *after* the date, so a late unlock still works.
- `allowListedAppBundleIDs` is deprecated in iOS 27 in favour of declarative management.
  It still works there, but will need replacing eventually.

## To verify during the first trial

- `cfgutil get installedApps` JSON field names (the parser accepts several variants).
- That the token sign-in cookie survives in the home-screen PWA (iOS keeps its storage separate
  from Safari's, so sign in from inside the installed app).
- Whether `cfgutil install-profile` needs the exported supervision identity (`-C`/`-K`) to
  install silently on this phone.
- Banking and work apps work under the web allowlist (some use embedded web views).
- Home-screen PWAs open with Safari hidden, through `com.apple.webapp`.
- `baseline.amarzbar.xyz` is in the web allowlist, so the PWA loads once sealed.
