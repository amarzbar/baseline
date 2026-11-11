import type { JournalEntry, Summary } from '../../shared/types.ts';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Error ${res.status}`), { status: res.status, data });
  return data as T;
}

export const api = {
  login: (token: string) => call('POST', '/api/login', { token }),
  summary: () => call<Summary>('GET', '/api/summary'),
  journal: () => call<JournalEntry[]>('GET', '/api/journal'),
  addMoment: (m: { title: string; body: string; tags: string[]; photo: string | null }) =>
    call<JournalEntry>('POST', '/api/journal', m),
  deleteMoment: (id: string) => call('DELETE', `/api/journal/${id}`),
  logScreenTime: (avgDailyMinutes: number, weekStart?: string) =>
    call('POST', '/api/screentime', { avgDailyMinutes, weekStart }),
  reveal: (id: string) => call<{ password: string }>('POST', `/api/locks/${id}/reveal`),
};

// Shrink a photo on the phone before upload: 1600px on the long side, JPEG.
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
export const fmtNumber = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());
export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Date(iso).toLocaleDateString('en-CA', opts);
