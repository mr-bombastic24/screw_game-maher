import type { Card } from '../game/cards';
import type { GamePhase, PendingAction, RoundResult } from '../game/engine';

/** كارت لا يحق للمشاهد معرفة هويته. يُرسل منه الـ id فقط (id عشوائي لا يكشف النوع). */
export const HIDDEN_DEFINITION = 'hidden';

export interface LobbyPlayer {
  name: string;
  connected: boolean;
  isHost: boolean;
  isMe: boolean;
}

export interface GameEvent {
  seq: number;
  kind: 'power' | 'land' | 'toast';
  definition_id?: string;
  text?: string;
}

export interface PlayerView {
  id: string;
  name: string;
  hand: Card[];
  connected: boolean;
}

/** الحالة كما يراها لاعب واحد بعد إخفاء كل ما لا يحق له رؤيته. */
export interface GameView {
  players: PlayerView[];
  discard_pile: Card[];
  stock_count: number;
  phase: GamePhase;
  message: string;
  turn_index: number;
  actor: number;
  completed_table_rounds: number;
  round_number: number;
  initial_peek_index: number;
  initial_peek_count: number;
  initial_peeked_ids: string[];
  handoff_kind: string;
  current_drawn: Card | null;
  draw_source: 'stock' | 'discard' | '';
  pending_action: PendingAction;
  pending_target: number;
  selected_hand_slot: number;
  private_reveals: Card[];
  private_reveal_owner_index: number;
  public_reveals_by_player: Record<string, string[]>;
  heavy_pending_ids: string[];
  heavy_drawn_ids: string[];
  khshaf_options: Card[];
  look_swap_seen_card: Card | null;
  look_swap_first_target: number;
  kaab_player_index: number;
  round_closing: boolean;
  result: RoundResult | null;
  series_totals: Record<string, number>;
  hand_display_player_index: number;
  can_declare_screw: boolean;
  player_ids_except_current: number[];
  turn_duration_seconds: number;
  dealt_at: number;
}

export interface RoomSnapshot {
  code: string;
  serverNow: number;
  status: 'lobby' | 'playing';
  me: number;
  isHost: boolean;
  hostCanBeReplaced: boolean;
  minPlayers: number;
  maxPlayers: number;
  lobby: LobbyPlayer[];
  game: GameView | null;
  timer: { kind: 'peek' | 'turn' | 'ready' | ''; deadline: number; duration: number };
  events: GameEvent[];
}

export type GameActionType =
  | 'confirm_handoff' | 'choose_initial_peek' | 'hide_private_reveal' | 'draw_from_stock'
  | 'take_top_discard' | 'replace_drawn_with' | 'discard_drawn_and_resolve' | 'select_hand_card'
  | 'select_target' | 'choose_effect_option' | 'use_heavy_power' | 'finish_heavy_choices'
  | 'choose_khshaf_card' | 'declare_screw' | 'attempt_basra';

export type RoomActionType = 'start' | 'next_round' | 'to_lobby';

export type ActionType = GameActionType | RoomActionType | 'leave';
