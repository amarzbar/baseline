import { useCallback, useEffect, useState } from 'react';
import type { JournalEntry, Summary } from '../../shared/types.ts';
import { api } from './api.ts';
import { BottomNav, Fab, type TabId } from './components.tsx';
import { AddMomentSheet, LogScreenTimeSheet } from './sheets.tsx';
import SignIn from './screens/SignIn.tsx';
import JournalScreen from './screens/JournalScreen.tsx';
import LockScreen from './screens/LockScreen.tsx';
import TodayScreen from './screens/TodayScreen.tsx';

export default function App() {
  const [tab, setTab] = useState<TabId>('today');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [loggingScreenTime, setLoggingScreenTime] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([api.summary(), api.journal()]);
      setSummary(s);
      setJournal(j);
      setError(null);
      setSignedOut(false);
    } catch (err) {
      if ((err as { status?: number }).status === 401) setSignedOut(true);
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  if (signedOut) return <SignIn onSignedIn={refresh} />;

  return (
    <div className="mx-auto min-h-full max-w-md pt-safe">
      <main className="px-6 pt-6" style={{ paddingBottom: 'calc(150px + env(safe-area-inset-bottom, 0px))' }}>
        {error && (
          <div className="glass mb-4 px-4 py-3 text-[14px] text-destructive">
            Can't reach Baseline: {error}
          </div>
        )}
        {!summary ? (
          !error && <p className="label pt-24 text-center">Loading…</p>
        ) : tab === 'today' ? (
          <TodayScreen summary={summary} onLogScreenTime={() => setLoggingScreenTime(true)} />
        ) : tab === 'journal' ? (
          <JournalScreen entries={journal} summary={summary} onChange={refresh} />
        ) : (
          <LockScreen summary={summary} />
        )}
      </main>

      {tab !== 'lock' && <Fab onClick={() => setAdding(true)} />}
      <BottomNav active={tab} onSelect={t => { setTab(t); window.scrollTo(0, 0); }} />

      <AddMomentSheet open={adding} onClose={() => setAdding(false)} onSaved={refresh} />
      <LogScreenTimeSheet open={loggingScreenTime} onClose={() => setLoggingScreenTime(false)} onSaved={refresh} />
    </div>
  );
}
