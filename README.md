# Baseline

Lock a supervised iPhone down to the apps and sites you choose for 90 days or more, with a
removal password that's time-locked: nobody can read it before the date, you included. A small
PWA on your home screen shows how it's going and what you did with the time.

- **Mac companion** (`mac/`): reads the phone's apps over USB with Apple Configurator's
  `cfgutil`, builds the profile, runs the trial, and seals it.
- **Server** (`server/`): runs on Mavis in Docker, tailnet only. It stores the lock (only the
  [tlock](https://github.com/drand/tlock) ciphertext of the password), the journal and the
  progress numbers, and serves the PWA.
- **Status PWA** (`pwa/`): Today, Journal and Lock tabs.

See [docs/design.md](docs/design.md) for how it works and what it can't stop.

## Run the server on Mavis

```bash
docker compose up -d --build
tailscale serve --bg 3020          # https://mavis.<tailnet>.ts.net → the container
```

Open that URL on the iPhone in Safari and Add to Home Screen *before* sealing (Safari is
hidden once the lock is on).

## Run the Mac companion

Needs Apple Configurator installed, the phone supervised, and Node 24.

```bash
pnpm install && pnpm build
BASELINE_SERVER=https://mavis.<tailnet>.ts.net pnpm mac
# open http://127.0.0.1:8770
```

If installing a profile stops to ask on the phone, export the supervision identity from Apple
Configurator (Settings → Organizations → Export Supervision Identity), convert it to DER, and add:

```bash
BASELINE_SUPERVISION_CERT=/path/cert.der BASELINE_SUPERVISION_KEY=/path/key.der
```

## Using it

1. Plug in the phone. Tick the apps that stay (suggestions are pre-ticked), add anything not
   installed yet by searching the App Store, list the sites that should load (each subdomain your
   PWAs use, plus the server's tailnet name), optionally add a NextDNS profile ID, and enter your
   current daily screen time.
2. **Start the trial.** The real profile goes on, removable. Live with it for up to 7 days and
   fix anything that breaks with "Update the trial profile".
3. **Seal.** Type SEAL. The password is generated, time-locked to the drand round at the unlock
   date, stored on Mavis, and installed in the profile. It's never shown or saved.
4. On the unlock date, the PWA's Lock tab opens the time-lock and shows the password. Or plug in
   and remove the profile from the Mac.

Steps and workouts: the Lock tab in the PWA explains the iOS Shortcut that posts them daily.

## Develop

```bash
pnpm server        # API + built PWA on :3020 (DATA_DIR=./data)
pnpm dev:pwa       # PWA with hot reload on :5180, proxied to :3020
pnpm mac           # Mac companion on :8770
pnpm dev:mac       # Mac UI with hot reload on :5181
pnpm test && pnpm typecheck
```
