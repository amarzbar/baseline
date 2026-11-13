# Baseline

Lock a supervised iPhone down to the apps and sites you choose for 90 days or more, with a
removal password that's time-locked: nobody can read it before the date, you included. A small
PWA on your home screen shows how it's going and what you did with the time.

- **Mac companion** (`mac/`): reads the phone's apps over USB with Apple Configurator's `cfgutil`, builds the profile, runs
  the trial, and seals it.
- **Server** (`server/`): runs on Mavis in Docker behind Nginx Proxy Manager, at
  `baseline.amarzbar.xyz` on the tailnet. It stores the lock (only the
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

The container listens on port 3020. Then, like Pandora and Plane:

1. **Nginx Proxy Manager** (mavis:81): add a proxy host `baseline.amarzbar.xyz` → `http` /
   `mavis` (or Mavis's address) / `3020`, with Block Common Exploits and Websockets off, and an
   SSL certificate (Force SSL, HTTP/2).
2. **Cloudflare DNS**: an `A` record `baseline` → `100.67.68.86` (Mavis's tailnet address),
   **DNS only** (grey cloud). The site then only answers on the tailnet.

On the iPhone (with Tailscale on), open the site in Safari, Add to Home Screen, open it from the
home screen and paste the token once. Do this **before** sealing: Safari is hidden once the lock
is on. Keep Tailscale in the kept apps.

## Run the Mac companion

Needs macOS, Apple Configurator, a supervised iPhone, and Node 24.

```bash
pnpm install && pnpm build
pnpm mac --server https://baseline.amarzbar.xyz --token <BASELINE_TOKEN> --save
# later runs: pnpm mac
```

It opens http://127.0.0.1:8770. `--save` keeps the settings in `~/.config/baseline/config.json`
(mode 600). `pnpm mac --help` lists every option.

If installing a profile stops to ask on the phone, export the supervision identity from Apple
Configurator (Settings → Organizations → Export Supervision Identity), convert it to a DER
certificate and a DER **PKCS#1** key (`openssl pkey -outform DER -traditional`; cfgutil rejects
PKCS#8 with "couldn't create supervision identity"), and add
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

## Develop

```bash
BASELINE_TOKEN=dev-token-0123456789 pnpm server   # API + built PWA on :3020 (DATA_DIR=./data)
pnpm dev:pwa                                      # PWA with hot reload on :5180, proxied to :3020
pnpm mac --token dev-token-0123456789 --no-open   # Mac companion on :8770 (from source)
pnpm dev:mac                                      # Mac UI with hot reload on :5181
pnpm test && pnpm typecheck && pnpm build
```
