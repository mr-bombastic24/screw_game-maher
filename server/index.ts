import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { Room, type Member } from './room';
import type { ActionType } from '../src/online/protocol';

const portArg = process.argv.indexOf('--port');
const PORT = Number((portArg > 0 ? process.argv[portArg + 1] : undefined) ?? process.env.PORT ?? 3000);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? path.join(HERE, '..', 'dist'));
const MAX_ROOMS = 300;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const rooms = new Map<string, Room>();

function newCode(): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    if (!rooms.has(code)) return code;
  }
  throw new Error('no free room code');
}

const normalizeCode = (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase().slice(0, 8) : '');

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

function memberFor(room: Room, token: unknown): Member | undefined {
  return room.byToken(token);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  if (url.pathname === '/api/health') { sendJson(res, 200, { ok: true, rooms: rooms.size }); return; }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    const room = rooms.get(normalizeCode(url.searchParams.get('room')));
    const member = room && memberFor(room, url.searchParams.get('token'));
    if (!room || !member) { sendJson(res, 404, { ok: false, error: 'الغرفة أو الجلسة غير موجودة' }); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS,
    });
    res.write('retry: 1500\n\n');
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* سيُغلق */ } }, 15000);
    req.on('close', () => { clearInterval(heartbeat); room.disconnect(member, res); });
    room.connect(member, res);
    return;
  }

  if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return; }
  let body: Record<string, unknown>;
  try { body = await readBody(req); } catch { sendJson(res, 400, { ok: false, error: 'طلب غير صالح' }); return; }

  if (url.pathname === '/api/create') {
    if (rooms.size >= MAX_ROOMS) { sendJson(res, 503, { ok: false, error: 'السيرفر مشغول، جرّب بعد شوية' }); return; }
    const room = new Room(newCode());
    rooms.set(room.code, room);
    const member = room.addMember(String(body.name ?? ''));
    sendJson(res, 200, { ok: true, room: room.code, token: member.token });
    return;
  }

  if (url.pathname === '/api/join') {
    const room = rooms.get(normalizeCode(body.room));
    if (!room) { sendJson(res, 404, { ok: false, error: 'مفيش غرفة بالكود ده' }); return; }
    const existing = memberFor(room, body.token);
    if (existing) { sendJson(res, 200, { ok: true, room: room.code, token: existing.token }); return; }
    if (room.status !== 'lobby') { sendJson(res, 409, { ok: false, error: 'اللعبة بدأت بالفعل في الغرفة دي' }); return; }
    if (room.members.length >= 8) { sendJson(res, 409, { ok: false, error: 'الغرفة مكتملة (٨ لاعبين)' }); return; }
    const member = room.addMember(String(body.name ?? ''));
    room.broadcast();
    sendJson(res, 200, { ok: true, room: room.code, token: member.token });
    return;
  }

  if (url.pathname === '/api/action') {
    const room = rooms.get(normalizeCode(body.room));
    const member = room && memberFor(room, body.token);
    if (!room || !member) { sendJson(res, 404, { ok: false, error: 'الجلسة انتهت' }); return; }
    const type = String(body.type ?? '') as ActionType;
    const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};
    sendJson(res, 200, room.handle(member, type, args));
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  let file = path.join(STATIC_DIR, path.normalize(decoded));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(STATIC_DIR, 'index.html'); // الرجوع للصفحة الرئيسية
  }
  try {
    const data = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const hashed = file.includes(`${path.sep}assets${path.sep}`) && /-[A-Za-z0-9_-]{8,}\./.test(path.basename(file));
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : (ext === '.html' || path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=3600'),
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('الواجهة لم تُبنَ بعد. شغّل: npm run build');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'خطأ في السيرفر' });
      else res.end();
    });
    return;
  }
  void serveStatic(res, url.pathname);
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.anyConnected() && now - room.lastActivity > ROOM_IDLE_MS) { room.dispose(); rooms.delete(code); }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`سكرو أونلاين شغال على http://localhost:${PORT}`);
});
