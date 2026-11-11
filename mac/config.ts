// Settings for the Mac companion, from (highest first) command-line flags,
// environment variables, then ~/.config/baseline/config.json. `--save`
// writes the flags given to that file so the next run needs none.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

export interface Config {
  server: string;
  token: string;
  cert: string | null;
  key: string | null;
  port: number;
  open: boolean;
}

const FILE = path.join(homedir(), '.config', 'baseline', 'config.json');

const HELP = `baseline: lock a supervised iPhone to the apps and sites you choose.

Usage: pnpm mac [options]

  --server <url>   Baseline server, e.g. https://baseline.amarzbar.xyz  (BASELINE_SERVER)
  --token <token>  The server's BASELINE_TOKEN                         (BASELINE_TOKEN)
  --cert <path>    Supervision identity certificate, DER   (BASELINE_SUPERVISION_CERT)
  --key <path>     Supervision identity private key, DER   (BASELINE_SUPERVISION_KEY)
  --port <n>       Local port (default 8770)
  --no-open        Don't open the browser
  --save           Remember these options in ${FILE}
  -h, --help       Show this help
`;

export function loadConfig(argv = process.argv.slice(2)): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      server: { type: 'string' },
      token: { type: 'string' },
      cert: { type: 'string' },
      key: { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      save: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const file: Partial<Config> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  const env = process.env;
  const config: Config = {
    server: (values.server ?? env.BASELINE_SERVER ?? file.server ?? 'http://localhost:3020').replace(/\/$/, ''),
    token: values.token ?? env.BASELINE_TOKEN ?? file.token ?? '',
    cert: values.cert ?? env.BASELINE_SUPERVISION_CERT ?? file.cert ?? null,
    key: values.key ?? env.BASELINE_SUPERVISION_KEY ?? file.key ?? null,
    port: Number(values.port ?? env.PORT ?? file.port ?? 8770),
    open: !values['no-open'],
  };

  if (values.save) {
    mkdirSync(path.dirname(FILE), { recursive: true });
    const { open: _open, ...keep } = config;
    writeFileSync(FILE, JSON.stringify(keep, null, 2), { mode: 0o600 });
    console.log(`Saved settings to ${FILE}`);
  }
  if (!config.token) {
    console.error('No token. Pass --token (and --save to remember it), or set BASELINE_TOKEN.');
    process.exit(1);
  }
  return config;
}
