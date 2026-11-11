import { useState } from 'react';
import { api, shrinkPhoto } from './api.ts';
import { inputClass, primaryButton, Sheet } from './components.tsx';

export const TAGS = [
  { id: 'outside', label: '🌿 outside' },
  { id: 'read', label: '📖 read' },
  { id: 'family', label: '🤍 family' },
  { id: 'moved', label: '🏃 moved' },
  { id: 'worship', label: '🕌 worship' },
  { id: 'made', label: '🛠 made something' },
];

export function AddMomentSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setTitle(''); setBody(''); setTags([]); setPhoto(null); setError(null); };

  async function save() {
    setBusy(true);
    try {
      await api.addMoment({ title, body, tags, photo });
      reset();
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="A moment worth keeping">
      <div className="space-y-3">
        <input className={inputClass} placeholder="What did you do?" value={title} onChange={e => setTitle(e.target.value)} />
        <textarea className={`${inputClass} min-h-[84px] resize-none`} placeholder="How was it? (optional)" value={body} onChange={e => setBody(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {TAGS.map(t => (
            <button key={t.id} type="button"
              onClick={() => setTags(ts => ts.includes(t.id) ? ts.filter(x => x !== t.id) : [...ts, t.id])}
              className={`rounded-full px-3 py-1.5 text-[13px] ${tags.includes(t.id) ? 'bg-primary text-primary-fg' : 'bg-secondary text-secondary-fg'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="block cursor-pointer">
          {photo
            ? <img src={photo} alt="" className="h-40 w-full rounded-2xl object-cover" />
            : <div className="rounded-2xl border-[1.5px] border-dashed border-border py-5 text-center text-[14px] text-muted-fg">Add a photo</div>}
          <input type="file" accept="image/*" className="hidden"
            onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await shrinkPhoto(f)); }} />
        </label>
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        <button className={primaryButton} disabled={busy || (!title.trim() && !photo)} onClick={save}>
          {busy ? 'Saving…' : 'Keep it'}
        </button>
      </div>
    </Sheet>
  );
}

export function LogScreenTimeSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [week, setWeek] = useState<'this' | 'last'>(new Date().getDay() === 1 ? 'last' : 'this');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
      const d = new Date();
      if (week === 'last') d.setDate(d.getDate() - 7);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await api.logScreenTime(total, date);
      setHours(''); setMinutes(''); setError(null);
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="This week's screen time">
      <p className="mb-4 text-[14px] text-muted-fg">
        Settings → Screen Time → See All Activity. Type in the <span className="text-foreground">daily average</span>.
      </p>
      <div className="mb-3 flex gap-2">
        {(['this', 'last'] as const).map(w => (
          <button key={w} onClick={() => setWeek(w)}
            className={`flex-1 rounded-full py-2 text-[14px] ${week === w ? 'bg-primary text-primary-fg' : 'bg-secondary text-secondary-fg'}`}>
            {w === 'this' ? 'This week' : 'Last week'}
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-3">
        <input className={inputClass} inputMode="numeric" placeholder="Hours" value={hours} onChange={e => setHours(e.target.value)} />
        <input className={inputClass} inputMode="numeric" placeholder="Minutes" value={minutes} onChange={e => setMinutes(e.target.value)} />
      </div>
      {error && <p className="mb-3 text-[13px] text-destructive">{error}</p>}
      <button className={primaryButton} disabled={busy || (!hours && !minutes)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </Sheet>
  );
}
