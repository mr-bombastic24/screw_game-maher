import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionType, RoomSnapshot } from './protocol';

const SERVER_URL: string = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\/+$/, '');
const SESSION_KEY = 'screwcard.session';
const NAME_KEY = 'screwcard.name';

interface Session { room: string; token: string }

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    return parsed?.room && parsed?.token ? parsed : null;
  } catch { return null; }
}
function saveSession(session: Session | null) {
  try { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); } catch { /* التخزين محظور */ }
}
export function loadName(): string { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } }
export function saveName(name: string) { try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ } }

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await response.json()) as T;
}

type Api = { ok: boolean; error?: string; room?: string; token?: string };

export function useRoom() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // اتصال SSE للحصول على اللقطات الحية (يعيد الاتصال تلقائياً عند انقطاع الشبكة)
  useEffect(() => {
    if (!session) { setSnapshot(null); setConnected(false); return; }
    const url = `${SERVER_URL}/api/events?room=${encodeURIComponent(session.room)}&token=${encodeURIComponent(session.token)}`;
    const source = new EventSource(url);
    source.onopen = () => setConnected(true);
    source.addEventListener('state', (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as RoomSnapshot;
      setClockOffset(next.serverNow - Date.now());
      setSnapshot(next);
      setConnected(true);
      setError('');
    });
    source.onerror = () => {
      setConnected(false);
      // لو السيرفر رفض الاتصال نهائياً (الغرفة اتمسحت) نخرج للقائمة
      if (source.readyState === EventSource.CLOSED) {
        saveSession(null); setSession(null); setSnapshot(null);
        setError('الغرفة انتهت أو السيرفر اتعمله إعادة تشغيل. اعمل غرفة جديدة.');
      }
    };
    return () => source.close();
  }, [session]);

  // نعيد الاتصال فور رجوع الصفحة للمقدمة (الموبايل يوقف الشبكة في الخلفية)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setSession((current) => (current ? { ...current } : current)); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const enter = useCallback(async (path: '/api/create' | '/api/join', payload: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      const result = await post<Api>(path, payload);
      if (!result.ok || !result.room || !result.token) { setError(result.error ?? 'حصلت مشكلة'); return false; }
      const next = { room: result.room, token: result.token };
      saveSession(next); setSession(next);
      return true;
    } catch { setError('مش قادر أوصل للسيرفر. اتأكد من الإنترنت.'); return false; }
    finally { setBusy(false); }
  }, []);

  const create = useCallback((name: string) => { saveName(name); return enter('/api/create', { name }); }, [enter]);
  const join = useCallback((room: string, name: string) => { saveName(name); return enter('/api/join', { room, name }); }, [enter]);

  const send = useCallback((type: ActionType, args: Record<string, unknown> = {}) => {
    const current = sessionRef.current;
    if (!current) return;
    void post<Api>('/api/action', { room: current.room, token: current.token, type, args })
      .then((result) => { if (!result.ok) setError(result.error ?? ''); })
      .catch(() => setError('مفيش اتصال بالسيرفر'));
  }, []);

  const leave = useCallback(() => {
    const current = sessionRef.current;
    if (current) void post('/api/action', { room: current.room, token: current.token, type: 'leave' }).catch(() => undefined);
    saveSession(null); setSession(null); setSnapshot(null); setError('');
  }, []);

  const clearError = useCallback(() => setError(''), []);
  return useMemo(() => ({ session, snapshot, connected, error, busy, clockOffset, create, join, send, leave, clearError }), [session, snapshot, connected, error, busy, clockOffset, create, join, send, leave, clearError]);
}
