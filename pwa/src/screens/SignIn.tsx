import { type FormEvent, useState } from 'react';
import { api } from '../api.ts';
import { inputClass, primaryButton } from '../components.tsx';

// Shown once per device: paste BASELINE_TOKEN, get a year-long cookie.
export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.login(token.trim());
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 pt-safe">
      <p className="label">Baseline</p>
      <h1 className="mt-1 mb-2 text-[30px] font-light leading-tight tracking-tight">Welcome back</h1>
      <p className="mb-8 text-[14px] text-muted-fg">Paste your Baseline token once. This phone stays signed in.</p>
      <input className={inputClass} type="password" autoComplete="current-password" placeholder="Token"
        value={token} onChange={e => setToken(e.target.value)} autoFocus />
      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
      <button className={`${primaryButton} mt-4`} disabled={busy || !token.trim()}>{busy ? 'Checking…' : 'Sign in'}</button>
    </form>
  );
}
