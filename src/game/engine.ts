import {
  CARD_TOTAL_WARNING,
  Card,
  CardCatalog,
  CardEffect,
  RandomSource,
} from "./cards";

export const TURN_DURATION_SECONDS = 30;
export const SCREW_UNLOCK_AFTER_ROUNDS = 4;
export const MAX_PLAYERS = 8;

export type GamePhase =
  | "setup" | "handoff" | "initial_peek" | "private_reveal" | "turn"
  | "resolve_draw" | "effect_choice" | "effect_select_hand" | "effect_select_target"
  | "look_swap_decision" | "heavy_choice" | "khshaf_choice" | "result";

export type PendingAction =
  | "" | "initial_peek_confirm" | "peek_finish" | "heavy_reveal_finish"
  | "kaab_more" | "kaab_all_more" | "kaab_finish" | "kaab_own" | "kaab_all_slot" | "kaab_mode"
  | "take_give_target" | "take_give_own" | "take_give_other" | "take_only_target" | "take_only_card"
  | "look_swap_target" | "look_swap_peek" | "look_swap_decision" | "look_take_own" | "look_exchange_second_target" | "look_exchange_second_slot"
  | "peek_self" | "peek_other_target" | "peek_other_slot" | "power_basra"
  | "mesaharati_choice" | "mesaharati_keep" | "king_choice" | "cannon_target" | "engineer_target" | "khshaf_choose";

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  revealed_ids: string[];
}

export interface ResultRow {
  id: string;
  name: string;
  base: number;
  score: number;
  doubled: boolean;
  hand: Card[];
}

export interface RoundResult {
  rows: ResultRow[];
  winners: string[];
  screw_caller_id: string;
  lowest_base: number;
  early_end: boolean;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Rules-only local model. It deliberately has no UI or timer dependency: the UI
 * starts a 15-second opening-peek timer or 30-second turn timer after handoff confirmation.
 */
export class GameModel {
  static readonly TURN_DURATION_SECONDS = TURN_DURATION_SECONDS;
  static readonly SCREW_UNLOCK_AFTER_ROUNDS = SCREW_UNLOCK_AFTER_ROUNDS;
  static readonly CARD_TOTAL_WARNING = CARD_TOTAL_WARNING;

  readonly rng: RandomSource;
  readonly turn_duration_seconds = TURN_DURATION_SECONDS;
  readonly card_total_warning = CARD_TOTAL_WARNING;

  players: Player[] = [];
  stock: Card[] = [];
  discard_pile: Card[] = [];
  phase: GamePhase = "setup";
  message = "";
  turn_index = 0;
  completed_table_rounds = 0;
  round_number = 1;
  initial_peek_index = 0;
  initial_peek_count = 0;
  initial_peeked_ids: string[] = [];
  handoff_kind = "";
  current_drawn: Card | null = null;
  draw_source: "stock" | "discard" | "" = "";
  pending_action: PendingAction = "";
  pending_target = -1;
  selected_hand_slot = -1;
  private_reveals: Card[] = [];
  private_reveal_owner_index = -1;
  temporary_reveal_ids: string[] = [];
  public_reveals_by_player: Record<string, string[]> = {};
  skip_next_by_player: Record<string, boolean> = {};
  round_closing = false;
  screw_caller_id = "";
  final_turn_queue: number[] = [];
  heavy_pending_ids: string[] = [];
  heavy_drawn_ids: string[] = [];
  return_to_heavy = false;
  khshaf_options: Card[] = [];
  pending_mesaharati_card: Card | null = null;
  look_swap_seen_card: Card | null = null;
  look_swap_first_target = -1;
  look_swap_first_slot = -1;
  kaab_player_index = 0;
  kaab_reveal_count = 0;
  kaab_revealed_ids: string[] = [];
  result: RoundResult | null = null;
  series_totals: Record<string, number> = {};

  /** الحد الأدنى للاعبين: ٤ في النسخة المحلية الأصلية، ويمكن للأونلاين خفضه. */
  readonly min_players: number;

  constructor(rng: RandomSource = Math.random, min_players = 4) {
    this.rng = rng;
    this.min_players = min_players;
  }

  start_round(player_names: string[], round_number = 1): boolean {
    if (player_names.length < this.min_players) {
      this.message = `اللعبة تحتاج ${this.min_players} لاعبين على الأقل.`;
      return false;
    }
    if (player_names.length > MAX_PLAYERS) {
      this.message = `الحد الأقصى ${MAX_PLAYERS} لاعبين حتى تظل كومة السحب كافية.`;
      return false;
    }
    if (player_names.length * 4 + 1 > CardCatalog.totalCardCount()) {
      this.message = "عدد اللاعبين أكبر من قدرة مجموعة الكروت الحالية.";
      return false;
    }
    this.round_number = Math.max(1, Math.min(4, round_number));
    this.players = player_names.map((raw, index) => ({
      id: `player_${String(index + 1).padStart(2, "0")}`,
      name: raw.trim() || `لاعب ${index + 1}`,
      hand: [],
      revealed_ids: [],
    }));
    this.stock = CardCatalog.createDeck(this.rng);
    this.discard_pile = [];
    for (const player of this.players) {
      for (let count = 0; count < 4; count += 1) {
        const dealt = this.draw_stock_card();
        if (dealt) player.hand.push(dealt);
      }
    }
    const opening_discard = this.draw_stock_card();
    if (opening_discard) this.discard_pile.push(opening_discard);
    this.phase = "handoff";
    this.handoff_kind = this.round_number === 3 ? "turn" : "initial_peek";
    this.initial_peek_index = 0;
    this.initial_peek_count = 0;
    this.initial_peeked_ids = [];
    this.turn_index = 0;
    this.completed_table_rounds = 0;
    this.current_drawn = null;
    this.draw_source = "";
    this.pending_action = "";
    this.pending_target = -1;
    this.selected_hand_slot = -1;
    this.private_reveals = [];
    this.private_reveal_owner_index = -1;
    this.temporary_reveal_ids = [];
    this.public_reveals_by_player = {};
    this.skip_next_by_player = {};
    this.round_closing = false;
    this.screw_caller_id = "";
    this.final_turn_queue = [];
    this.heavy_pending_ids = [];
    this.heavy_drawn_ids = [];
    this.return_to_heavy = false;
    this.khshaf_options = [];
    this.pending_mesaharati_card = null;
    this.look_swap_seen_card = null;
    this.look_swap_first_target = -1;
    this.look_swap_first_slot = -1;
    this.result = null;
    if (this.round_number === 1) this.series_totals = {};
    this.message = this.round_number === 3 ? "الجولة الثالثة: جولة العمياني؛ ممنوع معاينة أي كارت من اليد." : `الجولة ${this.round_number} من 4. مرّر الجهاز للاعب الأول؛ كل لاعب هيعاين كارتين لوحده.`;
    return true;
  }

  confirm_handoff(): void {
    if (this.phase !== "handoff") return;
    if (this.handoff_kind === "initial_peek" && this.round_number !== 3) {
      this.phase = "initial_peek";
      this.initial_peek_count = 0;
      this.initial_peeked_ids = [];
      this.private_reveals = [];
      this.message = "اختار كارتين من أوراقك الأربعة، واحد في كل مرة، واحفظ مكانهم.";
    } else {
      this.phase = "turn";
      this.message = `دور ${this.current_player_name()}. اسحب من الكومة أو خد المكشوف، أو جرّب بصرة مطابقة.`;
    }
  }

  choose_initial_peek(slot: number): void {
    if (this.round_number === 3 || this.phase !== "initial_peek" || !this.valid_slot(this.initial_peek_index, slot)) return;
    const card = this.hand(this.initial_peek_index)[slot];
    if (this.initial_peeked_ids.includes(card.id)) {
      this.message = "اختار ورقة مختلفة عن الورقة اللي عاينتها أولاً.";
      return;
    }
    this.initial_peeked_ids.push(card.id);
    this.private_reveals = [copy(card)];
    this.private_reveal_owner_index = this.initial_peek_index;
    this.pending_action = "initial_peek_confirm";
    this.phase = "private_reveal";
    this.message = `معاينة خاصة للاعب ${this.player_name(this.initial_peek_index)}: احفظ الكارت ومكانه.`;
  }

  hide_private_reveal(): void {
    if (this.phase !== "private_reveal") return;
    this.private_reveals = [];
    this.private_reveal_owner_index = -1;
    switch (this.pending_action) {
      case "initial_peek_confirm":
        this.pending_action = "";
        this.initial_peek_count += 1;
        if (this.initial_peek_count < 2) {
          this.phase = "initial_peek";
          this.message = "اختار الكارت الثاني للمعاينة.";
        } else {
          this.initial_peek_index += 1;
          if (this.initial_peek_index < this.players.length) {
            this.initial_peeked_ids = [];
            this.phase = "handoff";
            this.handoff_kind = "initial_peek";
            this.message = `مرّر الجهاز إلى ${this.player_name(this.initial_peek_index)}، وخليه يضغط «أنا جاهز» قبل ما يشوف أوراقه.`;
          } else {
            this.turn_index = 0;
            this.begin_turn_handoff("بدأت الجولة. مرّر الجهاز للاعب الأول.");
          }
        }
        break;
      case "peek_finish": this.pending_action = ""; this.complete_effect(); break;
      case "heavy_reveal_finish":
        this.pending_action = "";
        this.heavy_drawn_ids = [];
        if (this.heavy_pending_ids.length) {
          this.phase = "heavy_choice";
          this.message = "النقل التقيل: تقدر تستخدم أي باور ظهر في الكارتين، أو تنهي دورك.";
        } else {
          this.message = "النقل التقيل: مافيش باور في الكروت المسحوبة؛ انتهى دورك.";
          this.finish_turn();
        }
        break;
      case "kaab_more": this.pending_action = "kaab_own"; this.phase = "effect_select_hand"; this.message = "اختار الكارت الثاني لمعاينته."; break;
      case "kaab_all_more": this.kaab_player_index = this.next_player_with_cards(this.kaab_player_index + 1); if (this.kaab_player_index < 0) { this.pending_action = ""; this.complete_effect(); } else { this.pending_action = "kaab_all_slot"; this.phase = "effect_select_hand"; this.message = `اختار كارتاً من إيد ${this.player_name(this.kaab_player_index)} لمعاينته.`; } break;
      case "kaab_finish": this.pending_action = ""; this.complete_effect(); break;
      default: this.pending_action = ""; this.complete_effect();
    }
  }

  timeout_initial_peek(): void {
    if (this.round_number === 3) return;
    if (this.phase === "private_reveal" && this.pending_action === "initial_peek_confirm") this.hide_private_reveal();
    if (this.phase !== "initial_peek") return;
    this.initial_peek_count = 0;
    this.initial_peeked_ids = [];
    this.initial_peek_index += 1;
    if (this.initial_peek_index < this.players.length) {
      this.phase = "handoff";
      this.handoff_kind = "initial_peek";
      this.message = `انتهى وقت معاينة ${this.player_name(this.initial_peek_index - 1)}؛ مرّر الجهاز للاعب التالي.`;
    } else {
      this.turn_index = 0;
      this.begin_turn_handoff("انتهى وقت المعاينة الافتتاحية. بدأت الجولة؛ مرّر الجهاز للاعب الأول.");
    }
  }

  draw_from_stock(): void {
    if (this.phase !== "turn") return;
    const card = this.draw_stock_card();
    if (!card) { this.message = "مافيش كروت متاحة للسحب حالياً."; return; }
    this.current_drawn = card;
    this.selected_hand_slot = -1;
    this.draw_source = "stock";
    this.phase = "resolve_draw";
    this.message = "سحبت كارتاً من كومة السحب. اختار تبدّله بكارت من إيدك أو ترميه.";
  }

  take_top_discard(): void {
    if (this.phase !== "turn" || this.discard_pile.length === 0) return;
    this.current_drawn = this.discard_pile.pop() ?? null;
    this.selected_hand_slot = -1;
    this.draw_source = "discard";
    this.phase = "resolve_draw";
    this.message = `أخذت ${CardCatalog.cardName(this.current_drawn)} من كومة الرمي. اختار كارتاً من إيدك تبدّله به؛ الخاصية مش هتتفعّل.`;
  }

  replace_drawn_with(slot: number): void {
    if (this.phase !== "resolve_draw" || !this.current_drawn || !this.valid_slot(this.turn_index, slot)) return;
    const old = this.hand(this.turn_index)[slot];
    this.remove_public_reveal(this.turn_index, old);
    this.hand(this.turn_index)[slot] = copy(this.current_drawn);
    this.discard_pile.push(old);
    this.current_drawn = null;
    this.draw_source = "";
    this.finish_turn();
  }

  discard_drawn_and_resolve(): void {
    if (this.phase !== "resolve_draw" || !this.current_drawn || this.draw_source !== "stock") return;
    const card = copy(this.current_drawn);
    this.current_drawn = null;
    this.draw_source = "";
    const effect = CardCatalog.cardEffect(card);
    if (effect === "mesaharati") {
      this.pending_mesaharati_card = card;
      this.pending_action = "mesaharati_choice";
      this.phase = "effect_choice";
      this.message = "المسحراتي: انهي الجولة فوراً، أو احتفظ به وارمِ كارتاً آخر مكانه.";
      return;
    }
    this.discard_pile.push(card);
    if (CardCatalog.isPower(card)) this.begin_power(effect, false);
    else if (effect === "peek_self") {
      if (!this.hand(this.turn_index).length) { this.message = "لا توجد كروت في يدك لمعاينتها؛ انتهى الدور."; this.finish_turn(); }
      else { this.pending_action = "peek_self"; this.phase = "effect_select_hand"; this.message = `خاصية ${CardCatalog.cardName(card)}: اختار كارتاً من إيدك لمعاينته.`; }
    } else if (effect === "peek_other") {
      this.pending_action = "peek_other_target"; this.phase = "effect_select_target"; this.message = `خاصية ${CardCatalog.cardName(card)}: اختار لاعباً لمعاينة كارت من إيده.`; if (!this.player_ids_except_current().length) { this.message = "لا يوجد لاعب آخر لديه كارت للمعاينة؛ انتهى الدور."; this.complete_effect(); }
    } else this.finish_turn();
  }

  select_hand_card(slot: number): void {
    const displayPlayer = this.hand_display_player_index();
    if (!this.valid_slot(displayPlayer, slot)) return;
    if (this.phase === "initial_peek") { this.choose_initial_peek(slot); return; }
    if (this.phase === "resolve_draw") { this.replace_drawn_with(slot); return; }
    switch (this.pending_action) {
      case "power_basra": this.discard_hand_card(this.turn_index, slot); this.message = "استخدمت بصرة الخاصية ورميت كارتاً من إيدك."; this.complete_effect(); break;
      case "take_give_own": this.selected_hand_slot = slot; this.pending_action = "take_give_other"; this.phase = "effect_select_hand"; this.message = `اختار كارتاً مقلوباً من إيد ${this.player_name(this.pending_target)} للتبديل السري.`; break;
      case "take_give_other": this.swap_cards(this.turn_index, this.selected_hand_slot, this.pending_target, slot); this.message = `تم التبديل بينك وبين ${this.player_name(this.pending_target)} من غير كشف الكارتين.`; this.complete_effect(); break;
      case "take_only_card": {
        const moved = this.hand(this.turn_index).splice(slot, 1)[0];
        this.remove_public_reveal(this.turn_index, moved);
        this.hand(this.pending_target).push(moved);
        this.message = `أديت كارتاً من إيدك إلى ${this.player_name(this.pending_target)}.`;
        this.complete_effect(); break;
      }
      case "look_swap_peek":
        this.look_swap_first_target = this.pending_target;
        this.look_swap_first_slot = slot;
        this.look_swap_seen_card = copy(this.hand(this.pending_target)[slot]);
        this.private_reveals = [copy(this.look_swap_seen_card)];
        this.private_reveal_owner_index = this.pending_target;
        this.pending_action = "look_swap_decision"; this.phase = "look_swap_decision";
        this.message = "عاينت الكارت. قرر هتاخده ولا تبدّله بين لاعبين."; break;
      case "look_take_own": this.swap_cards(this.turn_index, slot, this.look_swap_first_target, this.look_swap_first_slot); this.message = `أخذت الكارت اللي عاينته وأديت ${this.player_name(this.look_swap_first_target)} كارتاً من إيدك.`; this.complete_effect(); break;
      case "look_exchange_second_slot": this.swap_cards(this.look_swap_first_target, this.look_swap_first_slot, this.pending_target, slot); this.message = `بدّلت الكارتين بين ${this.player_name(this.look_swap_first_target)} و${this.player_name(this.pending_target)} من غير ما تاخدهم في إيدك.`; this.complete_effect(); break;
      case "peek_self":
      case "peek_other_slot":
        this.private_reveals.push(copy(this.hand(displayPlayer)[slot]));
        this.private_reveal_owner_index = displayPlayer; this.pending_action = "peek_finish"; this.phase = "private_reveal"; this.message = "معاينة خاصة: احفظ الكارت، وبعدها اضغط إخفاء."; break;
      case "kaab_own": {
        const id = this.hand(this.turn_index)[slot].id;
        if (this.kaab_revealed_ids.includes(id)) { this.message = "اختار كارتين مختلفين من إيدك."; return; }
        this.kaab_revealed_ids.push(id); this.private_reveals.push(copy(this.hand(this.turn_index)[slot])); this.private_reveal_owner_index = this.turn_index; this.kaab_reveal_count += 1;
        const needed = Math.min(2, this.hand(this.turn_index).length);
        this.pending_action = this.kaab_reveal_count >= needed ? "kaab_finish" : "kaab_more"; this.phase = "private_reveal";
        this.message = this.kaab_reveal_count >= needed ? "انتهت المعاينة. احفظ الكارت واضغط إخفاء." : "احفظ الكارت الأول واضغط إخفاء قبل معاينة الثاني."; break;
      }
      case "kaab_all_slot":
        this.private_reveals.push(copy(this.hand(this.kaab_player_index)[slot]));
        this.private_reveal_owner_index = this.kaab_player_index;
        this.pending_action = "kaab_all_more"; this.phase = "private_reveal"; break;
      case "mesaharati_keep": {
        if (!this.pending_mesaharati_card) return;
        const old = this.hand(this.turn_index).splice(slot, 1)[0]; this.remove_public_reveal(this.turn_index, old); this.discard_pile.push(old);
        this.hand(this.turn_index).push(copy(this.pending_mesaharati_card)); this.pending_mesaharati_card = null; this.message = "احتفظت بالمسحراتي ورميت كارتاً مكانه."; this.finish_turn(); break;
      }
      default:
        if (this.phase === "turn") {
          this.selected_hand_slot = this.selected_hand_slot === slot ? -1 : slot;
          this.message = this.selected_hand_slot < 0 ? "ألغيت تحديد الكارت." : `حددت كارتك رقم ${slot + 1}. اسحبه إلى كومة الرمي أو المسها لعمل بصرة.`;
        }
    }
  }

  select_target(index: number): void {
    if (!this.player_ids_except_current().includes(index)) { this.message = "لا يمكن اختيار لاعب ليس لديه كروت متاحة لهذه الحركة."; return; }
    if (["take_give_target", "take_only_target", "look_swap_target"].includes(this.pending_action) && !this.hand(this.turn_index).length) { this.message = "لا توجد كروت في يدك لإكمال الحركة؛ تم تجاوزها."; this.complete_effect(); return; }
    switch (this.pending_action) {
      case "take_give_target": this.pending_target = index; this.pending_action = "take_give_own"; this.phase = "effect_select_hand"; break;
      case "take_only_target": this.pending_target = index; this.pending_action = "take_only_card"; this.phase = "effect_select_hand"; break;
      case "look_swap_target": this.pending_target = index; this.pending_action = "look_swap_peek"; this.phase = "effect_select_hand"; break;
      case "look_exchange_second_target":
        if (index === this.look_swap_first_target) { this.message = "اختار لاعباً مختلفاً عن صاحب الكارت الأول."; return; }
        this.pending_target = index; this.pending_action = "look_exchange_second_slot"; this.phase = "effect_select_hand"; break;
      case "peek_other_target": this.pending_target = index; this.pending_action = "peek_other_slot"; this.phase = "effect_select_hand"; break;
      case "cannon_target":
        this.public_reveals_by_player[this.players[index].id] = this.hand(index).map((card) => card.id);
        this.message = `المدفع كشف أوراق ${this.player_name(index)}؛ تفضل مكشوفة حتى نهاية دوره القادم.`; this.complete_effect(); break;
      case "engineer_target": {
        const old = this.players[this.turn_index].hand; this.players[this.turn_index].hand = this.players[index].hand; this.players[index].hand = old;
        delete this.public_reveals_by_player[this.players[this.turn_index].id]; delete this.public_reveals_by_player[this.players[index].id];
        this.message = `بدّلت كل أوراقك مع ${this.player_name(index)}، حتى لو اختلف عدد الأوراق.`; this.complete_effect(); break;
      }
    }
  }

  choose_effect_option(option: string): void {
    if (this.pending_action === "king_choice") {
      if (!["take_give", "basra", "take_only", "khshaf"].includes(option)) return;
      this.begin_power(option as CardEffect, this.return_to_heavy); return;
    }
    if (this.pending_action === "mesaharati_choice") {
      if (option === "end_round") {
        if (this.pending_mesaharati_card) this.discard_pile.push(copy(this.pending_mesaharati_card));
        this.pending_mesaharati_card = null; this.finish_round(false);
      } else if (option === "keep") { if (!this.hand(this.turn_index).length && this.pending_mesaharati_card) { this.hand(this.turn_index).push(copy(this.pending_mesaharati_card)); this.pending_mesaharati_card = null; this.message = "احتفظت بالمسحراتي في يدك؛ لم يكن لديك كارت آخر للرمي."; this.finish_turn(); } else { this.pending_action = "mesaharati_keep"; this.phase = "effect_select_hand"; } }
      return;
    }
    if (this.pending_action === "look_swap_decision") {
      this.private_reveals = []; this.private_reveal_owner_index = -1;
      if (option === "take" && this.hand(this.turn_index).length) { this.pending_action = "look_take_own"; this.phase = "effect_select_hand"; }
      else if (option === "take") { this.message = "لا توجد كروت في يدك للمبادلة؛ انتهى الدور."; this.complete_effect(); }
      else if (option === "exchange") { this.pending_action = "look_exchange_second_target"; this.phase = "effect_select_target"; if (!this.player_ids_except_current().length) { this.message = "لا يوجد لاعب ثالث لديه كارت؛ انتهى الدور من غير تبديل."; this.complete_effect(); } }
      return;
    }
    if (this.pending_action === "kaab_mode") {
      this.private_reveals = []; this.private_reveal_owner_index = -1;
      if (option === "own_two") { if (!this.hand(this.turn_index).length) { this.message = "لا توجد كروت في يدك لمعاينتها؛ انتهى الدور."; this.complete_effect(); } else { this.kaab_reveal_count = 0; this.kaab_revealed_ids = []; this.pending_action = "kaab_own"; this.phase = "effect_select_hand"; } }
      else if (option === "one_each") { this.kaab_player_index = this.next_player_with_cards(0); if (this.kaab_player_index < 0) { this.message = "لا توجد أيدي بها كروت للمعاينة."; this.complete_effect(); } else { this.pending_action = "kaab_all_slot"; this.phase = "effect_select_hand"; } }
    }
  }

  use_heavy_power(card_id: string): void {
    if (this.phase !== "heavy_choice" || !this.heavy_pending_ids.includes(card_id)) return;
    const slot = this.find_card_slot(this.turn_index, card_id); if (slot < 0) return;
    const card = this.hand(this.turn_index)[slot];
    if (!CardCatalog.isPower(card)) { this.message = "الكارت ده مش باور كارت."; return; }
    this.remove_public_reveal(this.turn_index, card); this.hand(this.turn_index).splice(slot, 1); this.heavy_pending_ids = this.heavy_pending_ids.filter((id) => id !== card_id);
    if (CardCatalog.cardEffect(card) === "mesaharati") { this.pending_mesaharati_card = copy(card); this.pending_action = "mesaharati_choice"; this.phase = "effect_choice"; this.return_to_heavy = true; return; }
    this.discard_pile.push(card); this.begin_power(CardCatalog.cardEffect(card), true);
  }

  choose_heavy_power(card_id: string): void { this.use_heavy_power(card_id); }

  finish_heavy_choices(): void {
    if (this.phase !== "heavy_choice") return;
    this.heavy_pending_ids = []; this.finish_turn();
  }

  choose_khshaf_card(option_index: number): void {
    if (this.phase !== "khshaf_choice" || option_index < 0 || option_index >= this.khshaf_options.length) return;
    const chosen = this.khshaf_options[option_index]; this.hand(this.turn_index).push(chosen);
    this.khshaf_options.forEach((card, index) => { if (index !== option_index) this.stock.push(card); });
    this.khshaf_options = []; this.shuffle_stock(); this.complete_effect();
  }

  declare_screw(): void {
    if (this.phase !== "turn" || this.round_closing) return;
    if (this.completed_table_rounds < SCREW_UNLOCK_AFTER_ROUNDS) { this.message = `إعلان سكرو متاح بعد أربع دورات كاملة للطاولة (${this.completed_table_rounds}/4).`; return; }
    this.round_closing = true; this.screw_caller_id = this.players[this.turn_index].id;
    this.final_turn_queue = Array.from({ length: this.players.length - 1 }, (_, offset) => (this.turn_index + offset + 1) % this.players.length);
    this.message = `${this.current_player_name()} أعلن سكرو! لكل لاعب غيره دور أخير.`; this.advance_after_turn();
  }

  can_declare_screw(): boolean { return this.phase === "turn" && !this.round_closing && this.completed_table_rounds >= SCREW_UNLOCK_AFTER_ROUNDS; }

  attempt_basra(slot: number): void {
    if (this.phase !== "turn" || !this.valid_slot(this.turn_index, slot) || this.discard_pile.length === 0) return;
    const thrown = this.hand(this.turn_index)[slot]; const top = this.discard_pile.pop()!; this.hand(this.turn_index).splice(slot, 1);
    if (CardCatalog.matchesForBasra(thrown, top)) { this.remove_public_reveal(this.turn_index, thrown); this.discard_pile.push(thrown); this.message = `بصرة صحيحة! تخلّصت من ${CardCatalog.cardName(thrown)}.`; }
    else { this.hand(this.turn_index).push(thrown, top); this.message = "بصرة غلط؛ أخدت الكارت اللي رميته والكارت المكشوف إلى إيدك."; }
    this.finish_turn();
  }

  finish_turn(): void {
    if (this.phase === "result" || this.phase === "setup") return;
    this.pending_action = ""; this.pending_target = -1; this.selected_hand_slot = -1; this.current_drawn = null; this.draw_source = ""; this.private_reveals = []; this.heavy_drawn_ids = [];
    if (this.return_to_heavy) { this.return_to_heavy = false; this.phase = "heavy_choice"; return; }
    this.advance_after_turn();
  }

  timeout_turn(): void {
    if (["setup", "result", "handoff", "initial_peek"].includes(this.phase) || this.players.length === 0) return;
    if (this.phase === "resolve_draw" && this.current_drawn) {
      if (this.draw_source === "stock") this.stock.push(copy(this.current_drawn));
      else if (this.draw_source === "discard") this.discard_pile.push(copy(this.current_drawn));
    }
    if (this.pending_mesaharati_card) { this.stock.push(copy(this.pending_mesaharati_card)); this.pending_mesaharati_card = null; }
    if (this.khshaf_options.length) { this.stock.push(...this.khshaf_options.map(copy)); this.khshaf_options = []; }
    this.shuffle_stock(); this.return_to_heavy = false; this.heavy_pending_ids = []; this.heavy_drawn_ids = []; this.look_swap_seen_card = null; this.look_swap_first_target = -1; this.look_swap_first_slot = -1; this.kaab_reveal_count = 0; this.kaab_revealed_ids = []; this.temporary_reveal_ids = []; this.private_reveals = [];
    this.message = `انتهى وقت ${this.current_player_name()}؛ أُلغي الاختيار غير المكتمل وانتقل الدور.`; this.finish_turn();
  }

  private begin_turn_handoff(next_message: string): void { this.phase = "handoff"; this.handoff_kind = "turn"; this.message = next_message; }

  private begin_power(effect: CardEffect, from_heavy: boolean): void {
    this.return_to_heavy = from_heavy; this.pending_target = -1; this.pending_action = ""; this.private_reveals = [];
    switch (effect) {
      case "basra": this.pending_action = "power_basra"; this.phase = "effect_select_hand"; break;
      case "take_give": this.pending_action = "take_give_target"; this.phase = "effect_select_target"; break;
      case "take_only": this.pending_action = "take_only_target"; this.phase = "effect_select_target"; break;
      case "look_swap": this.pending_action = "look_swap_target"; this.phase = "effect_select_target"; break;
      case "kaab_diyar": this.pending_action = "kaab_mode"; this.phase = "effect_choice"; break;
      case "heavy_transfer": {
        this.heavy_pending_ids = [];
        this.heavy_drawn_ids = [];
        const drawn: Card[] = [];
        for (let index = 0; index < 2; index += 1) {
          const card = this.draw_stock_card();
          if (!card) break;
          this.hand(this.turn_index).push(card);
          this.heavy_drawn_ids.push(card.id);
          drawn.push(copy(card));
          if (CardCatalog.isPower(card)) this.heavy_pending_ids.push(card.id);
        }
        this.return_to_heavy = false;
        if (!drawn.length) { this.message = "النقل التقيل: لا توجد كروت متاحة للسحب؛ انتهى دورك."; this.finish_turn(); break; }
        this.private_reveals = drawn;
        this.private_reveal_owner_index = this.turn_index;
        this.pending_action = "heavy_reveal_finish";
        this.phase = "private_reveal";
        this.message = `النقل التقيل: عاين ${drawn.length === 2 ? "الكارتين" : "الكارت المسحوب"}؛ سيبقيا في يدك.`;
        break;
      }
      case "block": { const next = (this.turn_index + 1) % this.players.length; this.skip_next_by_player[this.players[next].id] = true; this.complete_effect(); break; }
      case "king": this.pending_action = "king_choice"; this.phase = "effect_choice"; break;
      case "cannon": this.pending_action = "cannon_target"; this.phase = "effect_select_target"; break;
      case "khshaf":
        this.khshaf_options = []; for (let index = 0; index < 4; index += 1) { const card = this.draw_stock_card(); if (!card) break; this.khshaf_options.push(card); }
        this.pending_action = "khshaf_choose"; this.phase = "khshaf_choice"; break;
      case "engineer": this.pending_action = "engineer_target"; this.phase = "effect_select_target"; break;
      default: this.complete_effect();
    }
    if (this.phase === "effect_select_target" && !this.player_ids_except_current().length) { this.message = "لا يوجد لاعب لديه كروت متاحة لهذه الحركة؛ تم تجاوزها."; this.complete_effect(); }
    if (this.phase === "effect_select_hand" && ["power_basra", "take_give_own", "take_only_card", "look_swap_peek", "peek_self", "look_take_own"].includes(this.pending_action) && !this.hand(this.turn_index).length) { this.message = "لا توجد كروت في يدك لإكمال الحركة؛ تم تجاوزها."; this.complete_effect(); }
  }

  /** Kept public for parity with the Godot test suite and for deterministic UI integration. */
  _begin_power(effect: CardEffect, from_heavy = false): void { this.begin_power(effect, from_heavy); }

  private complete_effect(): void {
    this.pending_action = ""; this.pending_target = -1; this.private_reveals = [];
    if (this.return_to_heavy) { this.return_to_heavy = false; this.phase = "heavy_choice"; }
    else this.finish_turn();
  }

  private advance_after_turn(): void {
    this.pending_action = ""; this.pending_target = -1; this.current_drawn = null; this.draw_source = ""; this.private_reveals = [];
    if (this.round_closing) {
      while (this.final_turn_queue.length) {
        const next = this.final_turn_queue.shift()!;
        if (this.skip_next_by_player[this.players[next].id]) { this.skip_next_by_player[this.players[next].id] = false; continue; }
        this.turn_index = next; this.begin_turn_handoff(this.message); return;
      }
      this.finish_round(true); return;
    }
    let next = this.turn_index;
    for (let attempts = 0; attempts < this.players.length; attempts += 1) {
      next = (next + 1) % this.players.length;
      if (next === 0) this.completed_table_rounds += 1;
      if (this.skip_next_by_player[this.players[next].id]) { this.skip_next_by_player[this.players[next].id] = false; continue; }
      this.turn_index = next; this.begin_turn_handoff(this.message); return;
    }
    this.finish_round(false);
  }

  private finish_round(apply_screw_penalty: boolean): void {
    if (this.phase === "result") return;
    this.phase = "result"; this.current_drawn = null; this.draw_source = ""; this.pending_action = ""; this.private_reveals = []; this.return_to_heavy = false;
    const bases = this.players.map((player) => player.hand.reduce((sum, card) => sum + CardCatalog.cardValue(card), 0));
    const lowest_base = Math.min(...bases);
    const rows = this.players.map((player, index) => {
      const is_lowest = bases[index] === lowest_base;
      const screw_failed = apply_screw_penalty && player.id === this.screw_caller_id && !is_lowest;
      const multiplier = screw_failed ? 4 : (this.round_number === 4 ? 2 : 1);
      return { id: player.id, name: player.name, base: bases[index], score: is_lowest ? 0 : bases[index] * multiplier, doubled: this.round_number === 4 || screw_failed, hand: copy(player.hand) };
    });
    for (const row of rows) this.series_totals[row.id] = (this.series_totals[row.id] ?? 0) + row.score;
    const lowest_final = Math.min(...rows.map((row) => row.score));
    const winners = rows.filter((row) => row.base === lowest_base).map((row) => row.name);
    this.result = { rows, winners, screw_caller_id: this.screw_caller_id, lowest_base, early_end: !apply_screw_penalty };
    this.message = winners.length === 1 ? `انتهت الجولة ${this.round_number} من 4. الفائز: ${winners[0]}؛ أقل مجموع يحصل على صفر نقطة.` : `انتهت الجولة ${this.round_number} من 4 بالتعادل بين ${winners.join(" و")}؛ أقل مجموع يحصل على صفر نقطة.`;
  }

  /** Public parity hook for score-focused tests. */
  _finish_round(apply_screw_penalty: boolean): void { this.finish_round(apply_screw_penalty); }

  private draw_stock_card(): Card | null {
    if (this.stock.length === 0 && this.discard_pile.length > 1) {
      const exposed = this.discard_pile.pop()!; this.stock = this.discard_pile.splice(0); this.discard_pile = [exposed]; this.shuffle_stock();
    }
    return this.stock.pop() ?? null;
  }

  private shuffle_stock(): void {
    for (let index = this.stock.length - 1; index > 0; index -= 1) { const swap = Math.floor(this.rng() * (index + 1)); [this.stock[index], this.stock[swap]] = [this.stock[swap], this.stock[index]]; }
  }

  private hand(index: number): Card[] { return this.players[index].hand; }
  private valid_slot(player: number, slot: number): boolean { return player >= 0 && player < this.players.length && slot >= 0 && slot < this.hand(player).length; }
  private find_card_slot(player: number, id: string): number { return this.hand(player).findIndex((card) => card.id === id); }

  private discard_hand_card(player: number, slot: number): void { if (!this.valid_slot(player, slot)) return; const card = this.hand(player).splice(slot, 1)[0]; this.remove_public_reveal(player, card); this.discard_pile.push(card); }

  private swap_cards(playerA: number, slotA: number, playerB: number, slotB: number): void {
    if (!this.valid_slot(playerA, slotA) || !this.valid_slot(playerB, slotB)) return;
    const a = this.hand(playerA)[slotA], b = this.hand(playerB)[slotB]; this.remove_public_reveal(playerA, a); this.remove_public_reveal(playerB, b); this.hand(playerA)[slotA] = b; this.hand(playerB)[slotB] = a;
  }

  private remove_public_reveal(player: number, card: Card): void {
    const id = this.players[player]?.id; if (!id) return;
    const remaining = (this.public_reveals_by_player[id] ?? []).filter((cardId) => cardId !== card.id);
    if (remaining.length) this.public_reveals_by_player[id] = remaining; else delete this.public_reveals_by_player[id];
  }

  hand_display_player_index(): number {
    if (this.phase === "initial_peek" || (this.phase === "private_reveal" && this.pending_action === "initial_peek_confirm")) return this.initial_peek_index;
    if (this.pending_action === "kaab_all_slot") return this.kaab_player_index;
    if (this.pending_action === "take_give_other" || this.pending_action === "look_exchange_second_slot" || this.pending_action === "look_swap_peek" || this.pending_action === "peek_other_slot") return this.pending_target;
    return this.turn_index;
  }

  can_choose_hand(): boolean { return ["initial_peek", "resolve_draw", "effect_select_hand"].includes(this.phase); }
  selectable_hand_is_private(): boolean { return this.can_choose_hand(); }
  choose_king_power(effect: CardEffect): void { this.choose_effect_option(effect); }

  current_player_name(): string { return this.player_name(this.turn_index); }
  player_name(index: number): string { return this.players[index]?.name ?? "لاعب"; }
  hand_size(index: number): number { return this.players[index]?.hand.length ?? 0; }
  card_at(index: number, slot: number): Card | null { return this.valid_slot(index, slot) ? this.hand(index)[slot] : null; }
  is_publicly_revealed(index: number, card: Card): boolean { return (this.public_reveals_by_player[this.players[index]?.id] ?? []).includes(card.id); }
  top_discard(): Card | null { return this.discard_pile[this.discard_pile.length - 1] ?? null; }
  has_matching_basra(slot: number): boolean { return this.valid_slot(this.turn_index, slot) && !!this.top_discard() && CardCatalog.matchesForBasra(this.hand(this.turn_index)[slot], this.top_discard()); }
  player_ids_except_current(): number[] { return this.players.map((_, index) => index).filter((index) => index !== this.turn_index && this.hand_size(index) > 0 && !(this.pending_action === "look_exchange_second_target" && index === this.look_swap_first_target)); }
  private next_player_with_cards(start: number): number { for (let index = start; index < this.players.length; index += 1) if (this.hand_size(index) > 0) return index; return -1; }
  reset_to_setup(): void { this.phase = "setup"; this.players = []; this.stock = []; this.discard_pile = []; this.result = null; this.round_number = 1; this.completed_table_rounds = 0; this.series_totals = {}; this.message = ""; }
  total_stock_count(): number { return this.stock.length; }
  current_player_total(): number { return this.hand(this.turn_index).reduce((sum, card) => sum + CardCatalog.cardValue(card), 0); }

}
