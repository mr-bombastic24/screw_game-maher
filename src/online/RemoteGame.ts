import type { Card } from '../game/cards';
import type { GameActionType, GameView } from './protocol';

export type SendAction = (type: GameActionType, args?: Record<string, unknown>) => void;

// يدمج حقول اللقطة (القراءة فقط) مع دوال تُرسل الأوامر للسيرفر بدل تنفيذها محلياً.
export interface RemoteGame extends GameView {}
export class RemoteGame {
  constructor(view: GameView, private readonly send: SendAction) {
    Object.assign(this, view);
  }

  confirm_handoff() { this.send('confirm_handoff'); }
  choose_initial_peek(slot: number) { this.send('choose_initial_peek', { slot }); }
  hide_private_reveal() { this.send('hide_private_reveal'); }
  draw_from_stock() { this.send('draw_from_stock'); }
  take_top_discard() { this.send('take_top_discard'); }
  replace_drawn_with(slot: number) { this.send('replace_drawn_with', { slot }); }
  discard_drawn_and_resolve() { this.send('discard_drawn_and_resolve'); }
  select_hand_card(slot: number) { this.send('select_hand_card', { slot }); }
  select_target(index: number) { this.send('select_target', { index }); }
  choose_effect_option(option: string) { this.send('choose_effect_option', { option }); }
  use_heavy_power(id: string) { this.send('use_heavy_power', { id }); }
  finish_heavy_choices() { this.send('finish_heavy_choices'); }
  choose_khshaf_card(index: number) { this.send('choose_khshaf_card', { index }); }
  declare_screw() { this.send('declare_screw'); }
  attempt_basra(slot: number) { this.send('attempt_basra', { slot }); }

  player_name(index: number): string { return this.players[index]?.name ?? 'لاعب'; }
  is_publicly_revealed(index: number, card: Card): boolean {
    const id = this.players[index]?.id;
    return !!id && (this.public_reveals_by_player[id] ?? []).includes(card.id);
  }
}
