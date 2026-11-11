import type React from 'react';

export type TabId = 'today' | 'journal' | 'lock';

export function Ring({ value, max, size = 200, children }: { value: number; max: number; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(Math.max(value / max, 0), 1));
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-[28px] bg-background px-6 pt-3 pb-safe shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <h3 className="mb-4 text-[20px] font-normal">{title}</h3>
        <div className="pb-6">{children}</div>
      </div>
    </div>
  );
}

const icon = (d: React.ReactNode) => (active: boolean) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6}
    strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

const TABS: { id: TabId; label: string; icon: (active: boolean) => React.ReactElement }[] = [
  { id: 'today', label: 'Today', icon: icon(<><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 8 8" strokeWidth="3" /></>) },
  { id: 'journal', label: 'Journal', icon: icon(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>) },
  { id: 'lock', label: 'Lock', icon: icon(<><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>) },
];

export function BottomNav({ active, onSelect }: { active: TabId; onSelect: (t: TabId) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around bg-background/80 pt-2.5 pb-safe backdrop-blur-xl">
      {TABS.map(t => (
        <button key={t.id} onClick={() => onSelect(t.id)}
          className={`flex w-20 flex-col items-center gap-1 pb-2 text-[11px] ${active === t.id ? 'font-medium text-primary' : 'text-muted-fg'}`}>
          {t.icon(active === t.id)}
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Add a moment"
      className="fixed right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-[28px] font-extralight text-primary-fg shadow-[0_8px_22px_rgba(28,122,82,0.35)] active:scale-95"
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}>
      +
    </button>
  );
}

export const inputClass = 'w-full rounded-2xl bg-muted px-4 py-3 text-[16px] font-light outline-none placeholder:text-muted-fg focus:ring-2 focus:ring-primary/30';
export const primaryButton = 'w-full rounded-2xl bg-primary py-3.5 text-[16px] font-medium text-primary-fg active:scale-[0.99] disabled:opacity-50';
