import type { ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { CardCatalog, type Card } from '../src/game/cards';
import { GameModel, MAX_PLAYERS } from '../src/game/engine';
import {
  HIDDEN_DEFINITION,
  type ActionType,
  type GameActionType,
  type GameEvent,
  type GameView,
  type LobbyPlayer,
  type RoomSnapshot,
} from '../src/online/protocol';

export const MIN_PLAYERS_ONLINE = 2;
const PEEK_SECONDS = 15;
const READY_SECONDS = 20;
const AWAY_SECONDS = 4;
const MAX_EVENTS = 8;

export interface Member {
  id: string;
  token: string;
  name: string;
  conns: Set<ServerResponse>;
  away: boolean;
}

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

const GAME_ACTIONS: ReadonlySet<string> = new Set<GameActionType>([
  'confirm_handoff', 'choose_initial_peek', 'hide_private_reveal', 'draw_from_stock',
  'take_top_discard', 'replace_drawn_with', 'discard_drawn_and_resolve', 'select_hand_card',
  'select_target', 'choose_effect_option', 'use_heavy_power', 'finish_heavy_choices',
  'choose_khshaf_card', 'declare_screw', 'attempt_basra',
]);

const hide = (card: Card): Card => ({ id: card.id, definition_id: HIDDEN_DEFINITION });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= -1 && value < 1000;

/** اللاعب الوحيد المسموح له بالتحرك الآن. */
export function actorIndex(game: GameModel): number {
  if (game.phase === 'handoff') return game.handoff_kind === 'initial_peek' ? game.initial_peek_index : game.turn_index;
  if (game.phase === 'initial_peek' || (game.phase === 'private_reveal' && game.pending_action === 'initial_peek_confirm')) return game.initial_peek_index;
  return game.turn_index;
}

function randomId(): string {
  return randomBytes(5).toString('hex');
}

/** يستبدل أرقام الكروت المتسلسلة (التي تكشف نوعها) بأرقام عشوائية. */
function scrambleCardIds(game: GameModel): void {
  const used = new Set<string>();
  const fresh = () => { let id = `c${randomId()}`; while (used.has(id)) id = `c${randomId()}`; used.add(id); return id; };
  for (const player of game.players) for (const card of player.hand) card.id = fresh();
  for (const card of game.stock) card.id = fresh();
  for (const card of game.discard_pile) card.id = fresh();
}

export class Room {
  readonly code: string;
  members: Member[] = [];
  hostId = '';
  status: 'lobby' | 'playing' = 'lobby';
  game: GameModel | null = null;
  lastActivity = Date.now();

  private events: GameEvent[] = [];
  private seq = 0;
  private dealtAt = 0;
  private turnSeq = 0;
  private timer: { kind: 'peek' | 'turn' | 'ready' | ''; key: string; deadline: number; duration: number; handle: NodeJS.Timeout | null } =
    { kind: '', key: '', deadline: 0, duration: 0, handle: null };

  constructor(code: string) { this.code = code; }

  // ---------- الأعضاء والاتصال ----------
  addMember(rawName: string): Member {
    let name = rawName.trim().replace(/\s+/g, ' ').slice(0, 20) || `لاعب ${this.members.length + 1}`;
    const base = name;
    for (let n = 2; this.members.some((m) => m.name === name); n += 1) name = `${base} ${n}`;
    const member: Member = { id: `m_${randomId()}`, token: randomBytes(16).toString('hex'), name, conns: new Set(), away: false };
    this.members.push(member);
    if (!this.hostId) this.hostId = member.id;
    this.touch();
    return member;
  }

  byToken(token: unknown): Member | undefined {
    if (typeof token !== 'string' || token.length < 8) return undefined;
    return this.members.find((m) => m.token === token);
  }

  isConnected(member: Member | undefined): boolean { return !!member && !member.away && member.conns.size > 0; }
  anyConnected(): boolean { return this.members.some((m) => this.isConnected(m)); }

  connect(member: Member, res: ServerResponse): void {
    member.conns.add(res);
    member.away = false;
    this.touch();
    this.rearmIfPaused();
    this.broadcast();
  }

  disconnect(member: Member, res: ServerResponse): void {
    member.conns.delete(res);
    this.touch();
    this.broadcast();
  }

  private touch(): void { this.lastActivity = Date.now(); }

  dispose(): void { this.clearTimer(); }

  // ---------- استقبال الأوامر ----------
  handle(member: Member, type: ActionType, args: Record<string, unknown>): Result {
    this.touch();
    const result = this.dispatch(member, type, args);
    this.broadcast();
    return result;
  }

  private dispatch(member: Member, type: ActionType, args: Record<string, unknown>): Result {
    if (type === 'leave') return this.leave(member);
    if (type === 'start' || type === 'next_round' || type === 'to_lobby') return this.roomAction(member, type);
    if (!GAME_ACTIONS.has(type)) return fail('أمر غير معروف');
    if (this.status !== 'playing' || !this.game) return fail('اللعبة لم تبدأ');
    return this.gameAction(member, type as GameActionType, args);
  }

  private leave(member: Member): Result {
    for (const res of member.conns) { try { res.end(); } catch { /* مغلق بالفعل */ } }
    member.conns.clear();
    if (this.status === 'lobby') {
      this.members = this.members.filter((m) => m !== member);
      if (this.hostId === member.id) this.hostId = this.members[0]?.id ?? '';
    } else {
      member.away = true;
      this.rearmIfPaused();
    }
    return OK;
  }

  private canControlRoom(member: Member): boolean {
    if (member.id === this.hostId) return true;
    const host = this.members.find((m) => m.id === this.hostId);
    return !this.isConnected(host); // المضيف غائب: أي لاعب يكمل
  }

  private roomAction(member: Member, type: 'start' | 'next_round' | 'to_lobby'): Result {
    if (!this.canControlRoom(member)) return fail('هذا الأمر للمضيف فقط');
    if (type === 'start') {
      if (this.status !== 'lobby') return fail('اللعبة بدأت بالفعل');
      if (this.members.length < MIN_PLAYERS_ONLINE) return fail(`محتاجين ${MIN_PLAYERS_ONLINE} لاعبين على الأقل`);
      if (this.members.length > MAX_PLAYERS) return fail(`الحد الأقصى ${MAX_PLAYERS} لاعبين`);
      for (const m of this.members) m.away = false;
      const game = new GameModel(Math.random, MIN_PLAYERS_ONLINE);
      if (!game.start_round(this.members.map((m) => m.name), 1)) return fail(game.message);
      this.game = game;
      this.status = 'playing';
      this.events = [];
      this.afterDeal();
      return OK;
    }
    if (type === 'next_round') {
      const game = this.game;
      if (this.status !== 'playing' || !game || game.phase !== 'result' || game.round_number >= 4) return fail('لا توجد جولة تالية الآن');
      if (!game.start_round(game.players.map((p) => p.name), game.round_number + 1)) return fail(game.message);
      this.afterDeal();
      return OK;
    }
    this.clearTimer();
    this.game = null;
    this.status = 'lobby';
    this.events = [];
    return OK;
  }

  private afterDeal(): void {
    scrambleCardIds(this.game!);
    this.dealtAt = Date.now();
    this.clearTimer();
    this.settle();
  }

  private gameAction(member: Member, type: GameActionType, args: Record<string, unknown>): Result {
    const game = this.game!;
    const idx = this.members.indexOf(member);
    if (idx < 0 || idx !== actorIndex(game)) return fail('مش دورك');
    const { slot, index, option, id } = args as { slot?: unknown; index?: unknown; option?: unknown; id?: unknown };
    const name = member.name;

    // التحقق من المدخلات
    switch (type) {
      case 'choose_initial_peek': case 'replace_drawn_with': case 'select_hand_card': case 'attempt_basra':
        if (!isInt(slot)) return fail('بيانات غير صالحة'); break;
      case 'select_target': case 'choose_khshaf_card':
        if (!isInt(index)) return fail('بيانات غير صالحة'); break;
      case 'choose_effect_option':
        if (typeof option !== 'string' || option.length > 30) return fail('بيانات غير صالحة'); break;
      case 'use_heavy_power':
        if (typeof id !== 'string' || id.length > 30) return fail('بيانات غير صالحة'); break;
      default: break;
    }

    const discardBefore = game.discard_pile.length;
    const pendingBefore = game.pending_action;
    const targetBefore = game.pending_target;
    const firstBefore = game.look_swap_first_target;
    let activation: Card | null = null;
    if (type === 'discard_drawn_and_resolve' && game.phase === 'resolve_draw' && game.draw_source === 'stock' && game.current_drawn && CardCatalog.isPower(game.current_drawn)) activation = clone(game.current_drawn);
    if (type === 'use_heavy_power' && game.phase === 'heavy_choice' && game.heavy_pending_ids.includes(id as string)) {
      const found = game.players[game.turn_index].hand.find((c) => c.id === id);
      if (found && CardCatalog.isPower(found)) activation = clone(found);
    }

    switch (type) {
      case 'confirm_handoff': game.confirm_handoff(); break;
      case 'choose_initial_peek': game.choose_initial_peek(slot as number); break;
      case 'hide_private_reveal': game.hide_private_reveal(); break;
      case 'draw_from_stock': game.draw_from_stock(); break;
      case 'take_top_discard': game.take_top_discard(); break;
      case 'replace_drawn_with': game.replace_drawn_with(slot as number); break;
      case 'discard_drawn_and_resolve': game.discard_drawn_and_resolve(); break;
      case 'select_hand_card': game.select_hand_card(slot as number); break;
      case 'select_target': game.select_target(index as number); break;
      case 'choose_effect_option': game.choose_effect_option(option as string); break;
      case 'use_heavy_power': game.use_heavy_power(id as string); break;
      case 'finish_heavy_choices': game.finish_heavy_choices(); break;
      case 'choose_khshaf_card': game.choose_khshaf_card(index as number); break;
      case 'declare_screw': game.declare_screw(); break;
      case 'attempt_basra': game.attempt_basra(slot as number); break;
    }

    // أحداث عامة (يراها الجميع) — تُقرأ قبل أن تُستبدل الرسالة ببداية الدور التالي
    if (activation && game.phase !== 'resolve_draw') this.pushEvent({ kind: 'power', definition_id: activation.definition_id });
    else if (game.discard_pile.length > discardBefore) this.pushEvent({ kind: 'land', definition_id: game.discard_pile[game.discard_pile.length - 1].definition_id });

    const targetName = game.players[targetBefore]?.name ?? '';
    const firstName = game.players[firstBefore]?.name ?? '';
    if (type === 'attempt_basra' && (game.message.startsWith('بصرة'))) this.pushEvent({ kind: 'toast', text: `${name}: ${game.message}` });
    else if (type === 'declare_screw' && game.round_closing) this.pushEvent({ kind: 'toast', text: game.message });
    else if (type === 'select_target' && game.message.startsWith('المدفع')) this.pushEvent({ kind: 'toast', text: game.message });
    else if (type === 'select_target' && game.message.startsWith('بدّلت كل أوراقك')) this.pushEvent({ kind: 'toast', text: `${name}: ${game.message}` });
    else if (type === 'select_hand_card' && game.pending_action !== pendingBefore) {
      if (pendingBefore === 'take_give_other') this.pushEvent({ kind: 'toast', text: `${name} بدّل كارتاً مع ${targetName}` });
      else if (pendingBefore === 'take_only_card') this.pushEvent({ kind: 'toast', text: `${name} أعطى كارتاً إلى ${targetName}` });
      else if (pendingBefore === 'look_take_own') this.pushEvent({ kind: 'toast', text: `${name} بدّل كارتاً مع ${firstName}` });
      else if (pendingBefore === 'look_exchange_second_slot') this.pushEvent({ kind: 'toast', text: `${name} بدّل كارتين بين ${firstName} و${targetName}` });
    }

    this.settle();
    return OK;
  }

  // ---------- المؤقتات ----------
  private clearTimer(): void {
    if (this.timer.handle) clearTimeout(this.timer.handle);
    this.timer = { kind: '', key: '', deadline: 0, duration: 0, handle: null };
  }

  private startTimer(kind: 'peek' | 'turn' | 'ready', seconds: number, key: string, actor: number): void {
    if (this.timer.handle) clearTimeout(this.timer.handle);
    const away = !this.isConnected(this.members[actor]);
    const duration = away ? Math.min(seconds, AWAY_SECONDS) : seconds;
    this.timer = { kind, key, duration, deadline: Date.now() + duration * 1000, handle: null };
    this.arm();
  }

  private arm(): void {
    if (this.timer.handle) clearTimeout(this.timer.handle);
    const key = this.timer.key;
    const delay = Math.max(0, this.timer.deadline - Date.now());
    this.timer.handle = setTimeout(() => this.onTimer(key), delay);
  }

  /** لو كل اللاعبين غائبين نوقف الدوران؛ وعند عودة أي واحد نكمل. */
  private rearmIfPaused(): void {
    if (this.status === 'playing' && this.timer.kind && this.anyConnected()) {
      if (this.timer.deadline < Date.now()) this.timer.deadline = Date.now() + 5000;
      this.arm();
    }
  }

  private onTimer(key: string): void {
    const game = this.game;
    if (!game || this.timer.key !== key) return;
    if (!this.anyConnected()) { this.timer.deadline = Date.now() + 30000; this.arm(); return; }
    const kind = this.timer.kind;
    if (kind === 'ready') game.confirm_handoff();
    else if (kind === 'peek') game.timeout_initial_peek();
    else if (kind === 'turn') {
      game.timeout_turn();
      if (game.phase !== 'result') this.pushEvent({ kind: 'toast', text: game.message });
    }
    this.settle();
    this.broadcast();
  }

  /** يمرّر المراحل الآلية (تسليم الجهاز) ويضبط المؤقت الصحيح للمرحلة الحالية. */
  private settle(): void {
    const game = this.game;
    if (!game) return;
    for (let guard = 0; guard < 12 && game.phase === 'handoff' && game.handoff_kind === 'turn'; guard += 1) {
      game.confirm_handoff();
      this.turnSeq += 1;
      this.startTimer('turn', game.turn_duration_seconds, `turn:${this.turnSeq}`, game.turn_index);
    }
    if (game.phase === 'handoff') {
      const key = `ready:${game.round_number}:${game.initial_peek_index}`;
      if (this.timer.key !== key) this.startTimer('ready', READY_SECONDS, key, game.initial_peek_index);
    } else if (game.phase === 'initial_peek' || (game.phase === 'private_reveal' && game.pending_action === 'initial_peek_confirm')) {
      const key = `peek:${game.round_number}:${game.initial_peek_index}`;
      if (this.timer.key !== key) this.startTimer('peek', PEEK_SECONDS, key, game.initial_peek_index);
    } else if (game.phase === 'result' || game.phase === 'setup') {
      this.clearTimer();
    }
  }

  // ---------- الأحداث والبث ----------
  private pushEvent(event: Omit<GameEvent, 'seq'>): void {
    this.seq += 1;
    this.events.push({ ...event, seq: this.seq });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  broadcast(): void {
    for (const member of this.members) {
      if (!member.conns.size) continue;
      const payload = `event: state\ndata: ${JSON.stringify(this.snapshotFor(member))}\n\n`;
      for (const res of member.conns) { try { res.write(payload); } catch { member.conns.delete(res); } }
    }
  }

  snapshotFor(member: Member): RoomSnapshot {
    const me = this.members.indexOf(member);
    const lobby: LobbyPlayer[] = this.members.map((m) => ({ name: m.name, connected: this.isConnected(m), isHost: m.id === this.hostId, isMe: m === member }));
    return {
      code: this.code,
      serverNow: Date.now(),
      status: this.status,
      me,
      isHost: member.id === this.hostId,
      hostCanBeReplaced: this.canControlRoom(member),
      minPlayers: MIN_PLAYERS_ONLINE,
      maxPlayers: MAX_PLAYERS,
      lobby,
      game: this.game ? this.viewFor(me) : null,
      timer: { kind: this.timer.kind, deadline: this.timer.deadline, duration: this.timer.duration },
      events: this.events,
    };
  }

  /** كل ما في اللقطة مفلتر: لا يخرج من السيرفر أي كارت لا يحق للاعب رؤيته. */
  private viewFor(viewer: number): GameView {
    const g = this.game!;
    const actor = actorIndex(g);
    const isActor = viewer === actor;
    const blind = g.round_number === 3;
    const result = g.phase === 'result';

    const handCard = (ownerIndex: number, card: Card): Card => {
      const owner = g.players[ownerIndex];
      if (result) return clone(card);
      if ((g.public_reveals_by_player[owner.id] ?? []).includes(card.id)) return clone(card);
      if (isActor && ownerIndex === actor && !blind && g.phase === 'heavy_choice' && g.heavy_pending_ids.includes(card.id)) return clone(card);
      return hide(card);
    };

    let drawn: Card | null = null;
    if (g.current_drawn) {
      if (g.draw_source === 'discard') drawn = clone(g.current_drawn);
      else drawn = isActor && !blind ? clone(g.current_drawn) : hide(g.current_drawn);
    }
    const blindOwn = blind && g.private_reveal_owner_index === g.turn_index;
    const privateReveals = isActor ? g.private_reveals.map((c) => (blindOwn ? hide(c) : clone(c))) : [];
    const seen = isActor && g.look_swap_seen_card
      ? (blind && g.look_swap_first_target === g.turn_index ? hide(g.look_swap_seen_card) : clone(g.look_swap_seen_card)) : null;
    const khshaf = isActor ? g.khshaf_options.map((c) => (blind ? hide(c) : clone(c))) : [];
    const last = g.discard_pile.length - 1;

    return {
      players: g.players.map((p, i) => ({ id: p.id, name: p.name, hand: p.hand.map((c) => handCard(i, c)), connected: this.isConnected(this.members[i]) })),
      discard_pile: g.discard_pile.map((c, i) => (i === last ? clone(c) : hide(c))),
      stock_count: g.stock.length,
      phase: g.phase,
      message: isActor || result ? g.message : '',
      turn_index: g.turn_index,
      actor,
      completed_table_rounds: g.completed_table_rounds,
      round_number: g.round_number,
      initial_peek_index: g.initial_peek_index,
      initial_peek_count: g.initial_peek_count,
      initial_peeked_ids: isActor ? [...g.initial_peeked_ids] : [],
      handoff_kind: g.handoff_kind,
      current_drawn: drawn,
      draw_source: g.draw_source,
      pending_action: g.pending_action,
      pending_target: g.pending_target,
      selected_hand_slot: g.selected_hand_slot,
      private_reveals: privateReveals,
      private_reveal_owner_index: isActor ? g.private_reveal_owner_index : -1,
      public_reveals_by_player: clone(g.public_reveals_by_player),
      heavy_pending_ids: isActor ? [...g.heavy_pending_ids] : [],
      heavy_drawn_ids: isActor ? [...g.heavy_drawn_ids] : [],
      khshaf_options: khshaf,
      look_swap_seen_card: seen,
      look_swap_first_target: g.look_swap_first_target,
      kaab_player_index: g.kaab_player_index,
      round_closing: g.round_closing,
      result: result ? clone(g.result) : null,
      series_totals: { ...g.series_totals },
      hand_display_player_index: g.hand_display_player_index(),
      can_declare_screw: g.can_declare_screw(),
      player_ids_except_current: g.player_ids_except_current(),
      turn_duration_seconds: g.turn_duration_seconds,
      dealt_at: this.dealtAt,
    };
  }
}
