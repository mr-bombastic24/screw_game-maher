/**
 * محاكاة: n لاعبين آليين يلعبون لعبة كاملة (٤ جولات) عبر HTTP/SSE الحقيقي،
 * مع فحص أن اللقطة المرسلة لكل لاعب لا تحتوي على أي كارت لا يحق له رؤيته.
 * التشغيل:  npm run simulate -- [عدد_اللاعبين] [المنفذ]
 */
import type { RoomSnapshot } from '../src/online/protocol';

const N = Number(process.argv[2] ?? 4);
const PORT = Number(process.argv[3] ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;

async function post(path: string, body: unknown) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json()) as any;
}

const violations: string[] = [];
let snapshotsChecked = 0;

function checkLeaks(s: RoomSnapshot, who: string) {
  const g = s.game; if (!g) return;
  snapshotsChecked += 1;
  const fail = (m: string) => { if (violations.length < 20) violations.push(`${who} @${g.phase}/${g.pending_action}: ${m}`); };
  const raw = JSON.stringify(s);
  if (/card_\d{3}/.test(raw)) fail('رقم كارت متسلسل ظاهر');
  if ('stock' in (g as any)) fail('كومة السحب مرسلة');
  const isActor = g.actor === s.me;
  g.players.forEach((p, i) => {
    p.hand.forEach((c) => {
      if (c.definition_id === 'hidden') return;
      const pub = (g.public_reveals_by_player[p.id] ?? []).includes(c.id);
      const heavy = isActor && i === g.actor && g.phase === 'heavy_choice' && g.heavy_pending_ids.includes(c.id);
      if (!(g.phase === 'result' || pub || heavy)) fail(`كارت مكشوف في يد ${p.name}: ${c.definition_id}`);
    });
  });
  g.discard_pile.slice(0, -1).forEach((c) => { if (c.definition_id !== 'hidden') fail('كارت من وسط كومة الرمي مكشوف'); });
  if (!isActor && g.private_reveals.length) fail('معاينة خاصة وصلت لغير صاحبها');
  if (!isActor && g.look_swap_seen_card) fail('كارت شوف وبدّل وصل لغير صاحبه');
  if (!isActor && g.khshaf_options.length) fail('خيارات الخشاف وصلت لغير صاحبها');
  if (!isActor && g.current_drawn && g.draw_source === 'stock' && g.current_drawn.definition_id !== 'hidden') fail('الكارت المسحوب ظاهر لغير صاحبه');
  if (!isActor && g.message && g.phase !== 'result') fail('رسالة خاصة وصلت لغير صاحبها');
  if (g.round_number === 3 && isActor) {
    if (g.current_drawn && g.draw_source === 'stock' && g.current_drawn.definition_id !== 'hidden') fail('العمياني: المسحوب ظاهر');
    for (const c of g.private_reveals) if (g.private_reveal_owner_index === g.turn_index && c.definition_id !== 'hidden') fail('العمياني: كارتك ظاهر في المعاينة');
  }
}

class Bot {
  token = ''; room = ''; last: RoomSnapshot | null = null; busy = false; actions = 0; rng = Math.random;
  constructor(public name: string) {}
  async connect(room: string, token: string) {
    this.room = room; this.token = token;
    const res = await fetch(`${BASE}/api/events?room=${room}&token=${token}`);
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const m = /^data: (.*)$/m.exec(block); if (!m) continue;
          this.last = JSON.parse(m[1]); checkLeaks(this.last!, this.name); void this.think();
        }
      }
    })();
  }
  async send(type: string, args: Record<string, unknown> = {}) { this.actions += 1; return post('/api/action', { room: this.room, token: this.token, type, args }); }
  pick<T>(a: T[]): T { return a[Math.floor(this.rng() * a.length)]; }
  async think() {
    if (this.busy) return; const s = this.last; if (!s?.game) return; const g = s.game;
    this.busy = true; await new Promise((r) => setTimeout(r, 5));
    try {
      if (g.phase === 'result') {
        if (s.isHost && g.round_number < 4) await this.send('next_round');
        return;
      }
      if (g.actor !== s.me) return;
      const myHand = g.players[g.hand_display_player_index].hand;
      switch (g.phase) {
        case 'handoff': await this.send('confirm_handoff'); break;
        case 'initial_peek': { const free = myHand.map((c, i) => i).filter((i) => !g.initial_peeked_ids.includes(myHand[i].id)); await this.send('choose_initial_peek', { slot: this.pick(free) }); break; }
        case 'private_reveal': await this.send('hide_private_reveal'); break;
        case 'turn': {
          const r = this.rng();
          if (g.can_declare_screw && r < 0.35) await this.send('declare_screw');
          else if (r < 0.5 && g.players[g.turn_index].hand.length) await this.send('attempt_basra', { slot: Math.floor(this.rng() * g.players[g.turn_index].hand.length) });
          else if (r < 0.62) await this.send('take_top_discard');
          else await this.send('draw_from_stock');
          break;
        }
        case 'resolve_draw':
          if (g.draw_source === 'stock' && this.rng() < 0.5) await this.send('discard_drawn_and_resolve');
          else await this.send('replace_drawn_with', { slot: Math.floor(this.rng() * g.players[g.turn_index].hand.length) });
          break;
        case 'effect_choice':
          if (g.pending_action === 'king_choice') await this.send('choose_effect_option', { option: this.pick(['take_give', 'basra', 'take_only', 'khshaf']) });
          else if (g.pending_action === 'mesaharati_choice') await this.send('choose_effect_option', { option: this.pick(['keep', 'keep', 'end_round']) });
          else await this.send('choose_effect_option', { option: this.pick(['own_two', 'one_each']) });
          break;
        case 'effect_select_hand': await this.send('select_hand_card', { slot: Math.floor(this.rng() * Math.max(1, myHand.length)) }); break;
        case 'effect_select_target': await this.send('select_target', { index: this.pick(g.player_ids_except_current) }); break;
        case 'look_swap_decision': await this.send('choose_effect_option', { option: this.pick(['take', 'exchange']) }); break;
        case 'heavy_choice': await this.send('finish_heavy_choices'); break;
        case 'khshaf_choice': await this.send('choose_khshaf_card', { index: 0 }); break;
      }
    } finally { this.busy = false; }
  }
}

async function main() {
  // الاختبارات السلبية
  let r = await post('/api/join', { room: 'ZZZZ', name: 'x' }); if (r.ok) throw new Error('انضمام لغرفة غير موجودة نجح');
  const bots = Array.from({ length: N }, (_, i) => new Bot(`لاعب${i + 1}`));
  const created = await post('/api/create', { name: bots[0].name });
  await bots[0].connect(created.room, created.token);
  for (const b of bots.slice(1)) { const j = await post('/api/join', { room: created.room, name: b.name }); await b.connect(j.room, j.token); }
  await new Promise((r) => setTimeout(r, 100));
  r = await post('/api/action', { room: created.room, token: bots[1].token, type: 'start' }); if (r.ok) throw new Error('غير المضيف بدأ اللعبة');
  r = await bots[0].send('start'); if (!r.ok) throw new Error('فشل البدء: ' + r.error);
  r = await post('/api/join', { room: created.room, name: 'متأخر' }); if (r.ok) throw new Error('انضمام بعد البدء نجح');
  // غير اللاعب صاحب الدور لا يستطيع التحرك
  await new Promise((r) => setTimeout(r, 30));
  const g0 = bots[0].last!.game!; const stranger = bots.find((_, i) => i !== g0.actor)!;
  r = await stranger.send('confirm_handoff'); if (r.ok) throw new Error('لاعب غريب تحرك في دور غيره');

  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const s = bots[0].last; if (s?.game && s.game.round_number === 4 && s.game.phase === 'result') break;
    // حارس: لو توقف اللعب بسبب اختيار مرفوض كرر التفكير
    bots.forEach((b) => void b.think());
    await new Promise((r) => setTimeout(r, 50));
  }
  const fin = bots[0].last!.game!;
  console.log(`انتهت اللعبة: الجولة ${fin.round_number} / ${fin.phase} — ${Date.now() - t0}ms — أوامر: ${bots.reduce((a, b) => a + b.actions, 0)} — لقطات مفحوصة: ${snapshotsChecked}`);
  console.log('المجاميع:', JSON.stringify(fin.series_totals));
  if (!(fin.round_number === 4 && fin.phase === 'result')) throw new Error('اللعبة لم تكتمل');
  if (violations.length) { console.log('تسريبات:\n' + violations.join('\n')); process.exit(1); }
  console.log('لا توجد تسريبات ✔');
  process.exit(0);
}
main().catch((e) => { console.error('فشل:', e); process.exit(1); });
