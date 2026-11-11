# Baseline

Lock a supervised iPhone down to the apps and sites you choose for 90 days or more, with a
removal password that's time-locked: nobody can read it before the date, you included. A small
PWA on your home screen shows how it's going and what you did with the time.

- **Mac companion** (`mac/`, on npm as [`baseline-lock`](https://www.npmjs.com/package/baseline-lock)):
  reads the phone's apps over USB with Apple Configurator's `cfgutil`, builds the profile, runs
  the trial, and seals it.
- **Server** (`server/`): runs on Mavis in Docker behind Cloudflare. It stores the lock (only the
  [tlock](https://github.com/drand/tlock) ciphertext of the password), the journal and the
  progress numbers, and serves the PWA. Everything but the PWA shell needs `BASELINE_TOKEN`.
- **Status PWA** (`pwa/`): Today, Journal and Lock tabs.

See [docs/design.md](docs/design.md) for how it works and what it can't stop.

## Deploy the server (Mavis)

Every push to `main` builds `ghcr.io/amarzbar/baseline:latest` (`.github/workflows/docker.yml`).

```bash
git clone https://github.com/amarzbar/baseline.git && cd baseline
cp .env.example .env && sed -i "s|^BASELINE_TOKEN=.*|BASELINE_TOKEN=$(openssl rand -base64 32)|" .env
docker compose up -d
# keep it current: pull the new image whenever main changes
(crontab -l; echo "*/5 * * * * $PWD/scripts/auto-update.sh >> $PWD/auto-update.log 2>&1") | crontab -
```

The container listens on `127.0.0.1:3020`. Point the Cloudflare Tunnel's public hostname
(e.g. `baseline.amarzbar.xyz`) at `http://localhost:3020`. If `cloudflared` runs in a container,
set `BASELINE_BIND=0.0.0.0` in `.env` or put both on one Docker network.

If the GHCR package is private, run `docker login ghcr.io` on Mavis once, or make the package
public in GitHub → Packages → baseline → Settings.

On the iPhone, open the site in Safari, paste the token once, and Add to Home Screen **before**
sealing (Safari is hidden once the lock is on).

## Run the Mac companion

Needs macOS, Apple Configurator, a supervised iPhone, and Node 20.11 or later.

```bash
npx baseline-lock --server https://baseline.amarzbar.xyz --token <BASELINE_TOKEN> --save
# later runs: npx baseline-lock
```

It opens http://127.0.0.1:8770. `--save` keeps the settings in `~/.config/baseline/config.json`
(mode 600). `npx baseline-lock --help` lists every option.

If installing a profile stops to ask on the phone, export the supervision identity from Apple
Configurator (Settings → Organizations → Export Supervision Identity), convert it to DER, and add
`--cert /path/cert.der --key /path/key.der --save`.

## Using it

1. Plug in the phone. Tick the apps that stay (suggestions are pre-ticked), add anything not
   installed yet by searching the App Store, list the sites that should load (each subdomain your
   PWAs use; the server's own hostname is added for you), optionally add a NextDNS profile ID,
   and enter your current daily screen time.
2. **Start the trial.** The real profile goes on, removable. Live with it for up to 7 days and
   fix anything that breaks with "Update the trial profile".
3. **Seal.** Type SEAL. The password is generated, time-locked to the drand round at the unlock
   date, stored on the server, and installed in the profile. It's never shown or saved.
4. On the unlock date, the PWA's Lock tab opens the time-lock and shows the password. Or plug in
   and remove the profile from the Mac.

Steps and workouts: the PWA's Lock tab explains the iOS Shortcut that posts them daily (with
`Authorization: Bearer <token>`).

## Release to npm

Bump `version` in `package.json`, commit, then `git tag v<version> && git push --tags`.
`.github/workflows/release.yml` checks the tag matches, runs the checks, publishes with
provenance and creates the GitHub release. It needs the `NPM_TOKEN` repository secret.

## Develop

```bash
BASELINE_TOKEN=dev-token-0123456789 pnpm server   # API + built PWA on :3020 (DATA_DIR=./data)
pnpm dev:pwa                                      # PWA with hot reload on :5180, proxied to :3020
pnpm mac --token dev-token-0123456789 --no-open   # Mac companion on :8770 (from source)
pnpm dev:mac                                      # Mac UI with hot reload on :5181
pnpm test && pnpm typecheck && pnpm build
```
