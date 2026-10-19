const pools = new Map<string, HTMLAudioElement[]>();
const busy = new Set<HTMLAudioElement>();
let enabled = true;

function resolveAudioUrl(src: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  const path = src.replace(/^\/+/, '').replace(/^\.\//, '');
  return `${import.meta.env.BASE_URL}${path}`;
}

function getPool(url: string, voices = 2): HTMLAudioElement[] {
  let pool = pools.get(url);
  if (!pool) {
    pool = [];
    for (let index = 0; index < voices; index += 1) {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.load();
      pool.push(audio);
    }
    pools.set(url, pool);
  }
  return pool;
}

export function preloadAudio(src: string, voices = 2): void {
  if (typeof window === 'undefined') return;
  getPool(resolveAudioUrl(src), voices);
}

export function setAudioEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) {
    for (const audio of busy) {
      audio.pause();
      audio.currentTime = 0;
    }
    busy.clear();
  }
}

export function playAudio(src: string, volume = 0.48): void {
  if (!enabled || typeof window === 'undefined') return;
  const url = resolveAudioUrl(src);
  const pool = getPool(url);
  let audio = pool.find((candidate) => !busy.has(candidate));
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    pool.push(audio);
  }
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.currentTime = 0;
  busy.add(audio);
  const release = () => busy.delete(audio!);
  audio.onended = release;
  audio.onerror = release;
  void audio.play().then(() => {
    if (audio!.paused) release();
  }).catch(release);
}
