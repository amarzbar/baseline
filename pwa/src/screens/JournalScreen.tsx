import { useState } from 'react';
import type { JournalEntry, Summary } from '../../../shared/types.ts';
import { api, fmtDate } from '../api.ts';
import { TAGS } from '../sheets.tsx';

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export default function JournalScreen({ entries, summary, onChange }: { entries: JournalEntry[]; summary: Summary; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const sealedAt = summary.lock?.sealedAt ? startOfDay(new Date(summary.lock.sealedAt)) : null;
  const dayOf = (iso: string) => sealedAt == null ? null : Math.floor((startOfDay(new Date(iso)) - sealedAt) / DAY) + 1;
  const milestoneDays = new Set(summary.milestones.filter(m => m.reached).map(m => m.day));

  // Group newest first by calendar day.
  const groups: { key: string; label: string; day: number | null; items: JournalEntry[] }[] = [];
  for (const e of entries) {
    const key = new Date(e.createdAt).toDateString();
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const today = new Date().toDateString() === key;
      g = { key, label: today ? 'Today' : fmtDate(e.createdAt, { weekday: 'long', day: 'numeric', month: 'short' }), day: dayOf(e.createdAt), items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  async function remove(id: string) {
    await api.deleteMoment(id);
    setOpen(null);
    onChange();
  }

  return (
    <div className="pt-2">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-[17px] font-medium tracking-wide">Journal</span>
        <span className="text-[13px] text-muted-fg">{entries.length} {entries.length === 1 ? 'moment' : 'moments'}</span>
      </div>

      {!entries.length && (
        <div className="glass mt-10 px-6 py-8 text-center">
          <p className="text-[20px] font-light">Nothing here yet</p>
          <p className="mt-2 text-[14px] text-muted-fg">The time you take back goes somewhere. Tap + when it goes somewhere good.</p>
        </div>
      )}

      {groups.map(g => {
        const milestone = g.day != null && [...milestoneDays].find(d => d === g.day);
        return (
          <section key={g.key} className="mb-8">
            {milestone ? (
              <div className="glass mb-4 px-5 py-4 text-center">
                <p className="text-[22px] font-light">{milestone} days</p>
                <p className="text-[13px] text-muted-fg">a milestone</p>
              </div>
            ) : null}
            <p className="label">{g.label}{g.day != null && g.day > 0 ? ` · Day ${g.day}` : ''}</p>
            {g.items.map(e => (
              <article key={e.id} className="mt-4 flex gap-3" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <div className="flex w-2 justify-center pt-2"><span className="h-[7px] w-[7px] rounded-full bg-primary/70" /></div>
                <div className="min-w-0 flex-1">
                  {e.title && <p className="text-[16px] font-normal">{e.title}</p>}
                  <p className="text-[12px] text-muted-fg">
                    {new Date(e.createdAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}
                    {e.body ? ` · ${e.body}` : ''}
                  </p>
                  {e.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.tags.map(t => (
                        <span key={t} className="rounded-full bg-secondary px-2.5 py-1 text-[12px] text-secondary-fg">
                          {TAGS.find(x => x.id === t)?.label ?? t}
                        </span>
                      ))}
                    </div>
                  )}
                  {e.photo && <img src={`/photos/${e.photo}`} alt="" loading="lazy" className="mt-2 max-h-72 w-full rounded-[18px] object-cover" />}
                  {open === e.id && (
                    <button onClick={ev => { ev.stopPropagation(); remove(e.id); }} className="mt-2 text-[13px] text-destructive">
                      Delete this moment
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
