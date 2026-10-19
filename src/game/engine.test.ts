import { describe, expect, it } from "vitest";
import { CardCatalog, Card, LISTED_CARD_TOTAL } from "./cards";
import { GameModel } from "./engine";

const card = (id: string, definition_id: string): Card => ({ id, definition_id });
const names = ["آدم", "ليلى", "نور", "مروان"];

function readyGame(): GameModel {
  const game = new GameModel(() => 0.42);
  expect(game.start_round(names)).toBe(true);
  for (let player = 0; player < game.players.length; player += 1) {
    game.confirm_handoff();
    game.choose_initial_peek(0);
    game.hide_private_reveal();
    game.choose_initial_peek(1);
    game.hide_private_reveal();
    if (player < game.players.length - 1) game.confirm_handoff();
  }
  game.confirm_handoff();
  return game;
}

describe("CardCatalog", () => {
  it("keeps the documented 26 designs and 67 physical cards", () => {
    expect(CardCatalog.definitions()).toHaveLength(26);
    expect(CardCatalog.totalCardCount()).toBe(LISTED_CARD_TOTAL);
    expect(CardCatalog.createDeck(() => 0.5)).toHaveLength(67);
    expect(CardCatalog.cardValue(card("a", "number_7"))).toBe(7);
    expect(CardCatalog.cardValue(card("b", "plus_20"))).toBe(20);
    expect(CardCatalog.cardValue(card("c", "minus_1"))).toBe(-1);
    expect(CardCatalog.cardValue(card("d", "screw_red"))).toBe(25);
    expect(CardCatalog.cardValue(card("e", "take_give"))).toBe(10);
    expect(CardCatalog.definitionFor(card("f", "number_7")).image).toBe("assets/cards/number_7.webp");
    expect(CardCatalog.definitionFor(card("f", "number_7")).image).toBe("assets/cards/number_7.webp");
    expect(CardCatalog.definitionFor(card("f", "number_7"))).toBe(CardCatalog.definitionFor(card("g", "number_7")));
    expect(CardCatalog.matchesForBasra(card("a", "number_4"), card("b", "number_4"))).toBe(true);
    expect(CardCatalog.matchesForBasra(card("a", "screw_green"), card("b", "screw_red"))).toBe(true);
    expect(CardCatalog.matchesForBasra(card("a", "take_give"), card("b", "take_only"))).toBe(false);
  });

  it("creates unique physical ids and supports an injectable random source", () => {
    const deck = CardCatalog.createDeck(() => 0.1);
    expect(new Set(deck.map((item) => item.id)).size).toBe(deck.length);
  });
});

describe("GameModel opening and draws", () => {
  it("rejects fewer than four players and gives four cards plus a discard", () => {
    const game = new GameModel();
    expect(game.start_round(["أ", "ب", "ج"])).toBe(false);
    expect(game.start_round(names)).toBe(true);
    expect(game.phase).toBe("handoff");
    expect(game.players.every((player) => player.hand.length === 4)).toBe(true);
    expect(game.stock.length + game.discard_pile.length + 16).toBe(67);
  });

  it("requires two different private opening peeks for every player", () => {
    const game = new GameModel(() => 0.25);
    game.start_round(names);
    game.confirm_handoff();
    game.choose_initial_peek(0);
    expect(game.private_reveal_owner_index).toBe(0);
    game.hide_private_reveal();
    expect(game.private_reveal_owner_index).toBe(-1);
    game.choose_initial_peek(0);
    expect(game.initial_peek_count).toBe(1);
    expect(game.phase).toBe("initial_peek");
    game.choose_initial_peek(1);
    game.hide_private_reveal();
    expect(game.initial_peek_count).toBe(2);
    expect(game.initial_peek_index).toBe(1);
  });

  it("expires opening peeks safely and moves to the next player, then the first turn", () => {
    const game = new GameModel(() => 0.25);
    game.start_round(names);
    game.confirm_handoff();
    game.choose_initial_peek(0);
    game.timeout_initial_peek();
    expect(game.initial_peek_index).toBe(1);
    expect(game.phase).toBe("handoff");
    expect(game.handoff_kind).toBe("initial_peek");
    for (let player = 1; player < names.length; player += 1) {
      game.confirm_handoff();
      game.timeout_initial_peek();
    }
    expect(game.phase).toBe("handoff");
    expect(game.handoff_kind).toBe("turn");
    expect(game.turn_index).toBe(0);
  });

  it("activates a power only when a stock draw is discarded, not when discard is taken", () => {
    const stock = readyGame();
    stock.stock = [card("stock_power", "take_give")];
    stock.draw_from_stock();
    stock.discard_drawn_and_resolve();
    expect(stock.pending_action).toBe("take_give_target");
    expect(stock.top_discard()?.id).toBe("stock_power");

    const fromDiscard = readyGame();
    fromDiscard.discard_pile = [card("discard_power", "take_give")];
    fromDiscard.take_top_discard();
    fromDiscard.replace_drawn_with(0);
    expect(fromDiscard.pending_action).toBe("");
    expect(fromDiscard.players[0].hand.some((item) => item.id === "discard_power")).toBe(true);
    expect(fromDiscard.phase).toBe("handoff");
  });

  it("supports the self-peek 7/8 and other-player peek 9/10 families, including empty hands", () => {
    for (const id of ["number_7", "number_8"]) {
      const self = readyGame();
      self.stock = [card(id, id)];
      self.draw_from_stock(); self.discard_drawn_and_resolve(); self.select_hand_card(0);
      expect(self.phase).toBe("private_reveal");
      expect(self.private_reveals).toHaveLength(1);
      expect(self.private_reveal_owner_index).toBe(0);
    }
    for (const id of ["number_9", "number_10"]) {
      const other = readyGame();
      other.stock = [card(id, id)];
      other.draw_from_stock(); other.discard_drawn_and_resolve();
      expect(other.pending_action).toBe("peek_other_target");
      other.select_target(1); other.select_hand_card(0);
      expect(other.private_reveals).toHaveLength(1);
      expect(other.private_reveal_owner_index).toBe(1);
    }
    const noCards = readyGame();
    noCards.players[0].hand = [];
    noCards.stock = [card("eight", "number_8")];
    noCards.draw_from_stock(); noCards.discard_drawn_and_resolve();
    expect(noCards.phase).toBe("handoff");
  });
});

describe("Empty hands and player limits", () => {
  it("caps the table at eight players and omits empty hands from target choices", () => {
    const game = new GameModel();
    expect(game.start_round(Array.from({ length: 9 }, (_, i) => `P${i}`))).toBe(false);
    expect(game.start_round(names)).toBe(true);
    game.players[1].hand = [];
    for (const effect of ["take_give", "take_only", "look_swap"] as const) {
      game._begin_power(effect);
      expect(game.player_ids_except_current()).not.toContain(1);
      game.select_target(1);
      expect(game.phase).toBe("effect_select_target");
    }
    game.players.slice(2).forEach((player) => { player.hand = []; });
    game._begin_power("take_only");
    expect(game.phase).toBe("handoff");
  });

  it("skips empty hands in Kaab Diyar one-card-per-player mode", () => {
    const game = readyGame();
    game.players[0].hand = [card("a", "number_1")];
    game.players[1].hand = [];
    game.players[2].hand = [card("b", "number_2")];
    game.players[3].hand = [];
    game._begin_power("kaab_diyar");
    game.choose_effect_option("one_each");
    expect(game.hand_display_player_index()).toBe(0);
    game.select_hand_card(0); game.hide_private_reveal();
    expect(game.hand_display_player_index()).toBe(2);
    game.select_hand_card(0); game.hide_private_reveal();
    expect(game.phase).toBe("handoff");
    const none = readyGame();
    none.players.forEach((player) => { player.hand = []; });
    none._begin_power("kaab_diyar");
    none.choose_effect_option("one_each");
    expect(none.phase).toBe("handoff");
  });

  it("auto-skips a target-requiring effect if no other player has cards", () => {
    const game = readyGame();
    game.players.slice(1).forEach((player) => { player.hand = []; });
    game._begin_power("take_only");
    expect(game.phase).toBe("handoff");
    expect(game.pending_action).toBe("");
  });
});

describe("Basra and powers", () => {
  it("handles ordinary, wrong, and special Basra", () => {
    const good = readyGame();
    good.players[0].hand = [card("played", "number_4"), card("x", "number_2")];
    good.discard_pile = [card("top", "number_4")];
    good.attempt_basra(0);
    expect(good.hand_size(0)).toBe(1);
    expect(good.top_discard()?.id).toBe("played");

    const wrong = readyGame();
    wrong.players[0].hand = [card("thrown", "number_1"), card("x", "number_2")];
    wrong.discard_pile = [card("top", "number_9")];
    wrong.attempt_basra(0);
    expect(wrong.hand_size(0)).toBe(3);
    expect(wrong.discard_pile).toHaveLength(0);
    expect(wrong.players[0].hand.map((item) => item.id)).toEqual(expect.arrayContaining(["thrown", "top"]));

    const special = readyGame();
    special.players[0].hand = [card("a", "number_1"), card("b", "number_2")];
    special._begin_power("basra");
    special.select_hand_card(0);
    expect(special.hand_size(0)).toBe(1);
  });

  it("implements hidden exchange, engineer, persistent cannon reveal, and block", () => {
    const exchange = readyGame();
    const actor = exchange.players[0].hand[0].id;
    const target = exchange.players[1].hand[0].id;
    exchange._begin_power("take_give"); exchange.select_target(1); exchange.select_hand_card(0); exchange.select_hand_card(0);
    expect(exchange.players[0].hand[0].id).toBe(target);
    expect(exchange.players[1].hand[0].id).toBe(actor);

    const engineer = readyGame();
    engineer.players[0].hand = [card("a", "number_1")]; engineer.players[1].hand = [card("b", "number_2"), card("c", "number_3")];
    engineer._begin_power("engineer"); engineer.select_target(1);
    expect(engineer.hand_size(0)).toBe(2); expect(engineer.hand_size(1)).toBe(1);

    const cannon = readyGame();
    cannon._begin_power("cannon"); cannon.select_target(1);
    const exposed = [...cannon.players[1].hand];
    expect(exposed.every((item) => cannon.is_publicly_revealed(1, item))).toBe(true);
    cannon.confirm_handoff(); cannon.finish_turn();
    expect(exposed.every((item) => cannon.is_publicly_revealed(1, item))).toBe(true);
    cannon.turn_index = 1; cannon.phase = "turn";
    cannon.draw_from_stock(); cannon.replace_drawn_with(0);
    expect(cannon.is_publicly_revealed(1, exposed[0])).toBe(false);
    expect(exposed.slice(1).every((item) => cannon.is_publicly_revealed(1, item))).toBe(true);

    const block = readyGame();
    block._begin_power("block");
    expect(block.turn_index).toBe(2);
  });

  it("lets Heavy Transfer use a drawn power immediately and Khshaf keeps powers inert", () => {
    const heavy = readyGame();
    heavy.stock = [card("heavy_take", "take_only"), card("heavy_number", "number_5")];
    heavy._begin_power("heavy_transfer");
    expect(heavy.phase).toBe("private_reveal");
    expect(heavy.pending_action).toBe("heavy_reveal_finish");
    expect(heavy.private_reveals.map((item) => item.id)).toEqual(expect.arrayContaining(["heavy_take", "heavy_number"]));
    expect(heavy.heavy_pending_ids).toEqual(["heavy_take"]);
    heavy.hide_private_reveal();
    expect(heavy.phase).toBe("heavy_choice");
    heavy.use_heavy_power("heavy_take");
    expect(heavy.pending_action).toBe("take_only_target");
    heavy.select_target(1); heavy.select_hand_card(0);
    expect(heavy.phase).toBe("heavy_choice");
    heavy.finish_heavy_choices();
    expect(heavy.hand_size(0)).toBe(4); expect(heavy.hand_size(1)).toBe(5);

    const khshaf = readyGame();
    khshaf.stock = [card("k1", "number_1"), card("k2", "number_2"), card("k3", "number_3"), card("kp", "take_give")];
    khshaf._begin_power("khshaf"); khshaf.choose_khshaf_card(khshaf.khshaf_options.findIndex((item) => item.id === "kp"));
    expect(khshaf.hand_size(0)).toBe(5);
    expect(khshaf.pending_action).toBe("");
    expect(khshaf.phase).toBe("handoff");
    expect(khshaf.players[0].hand.some((item) => item.id === "kp")).toBe(true);

    const plain = readyGame();
    plain.stock = [card("plain_two", "number_2"), card("plain_twenty", "plus_20")];
    plain._begin_power("heavy_transfer");
    expect(plain.private_reveals.map((item) => item.id)).toEqual(expect.arrayContaining(["plain_two", "plain_twenty"]));
    expect(plain.heavy_pending_ids).toHaveLength(0);
    plain.hide_private_reveal();
    expect(plain.phase).toBe("handoff");
    expect(plain.players[0].hand.some((item) => item.id === "plain_two")).toBe(true);
    expect(plain.players[0].hand.some((item) => item.id === "plain_twenty")).toBe(true);
  });
});

describe("Mesaharati, timer, Screw and scoring", () => {
  it("ends immediately or replaces another card when Mesaharati is discarded", () => {
    const end = readyGame();
    end.stock = [card("mesaharati", "mesaharati")]; end.draw_from_stock(); end.discard_drawn_and_resolve();
    end.choose_effect_option("end_round");
    expect(end.phase).toBe("result"); expect(end.top_discard()?.id).toBe("mesaharati");

    const keep = readyGame();
    keep.stock = [card("mesaharati", "mesaharati")]; keep.draw_from_stock(); keep.discard_drawn_and_resolve(); keep.choose_effect_option("keep"); keep.select_hand_card(0);
    expect(keep.phase).toBe("handoff"); expect(keep.hand_size(0)).toBe(4); expect(keep.players[0].hand.some((item) => item.id === "mesaharati")).toBe(true);
  });

  it("restores unfinished draws on timeout and requires four complete table cycles", () => {
    const game = readyGame();
    expect(game.can_declare_screw()).toBe(false);
    game.draw_from_stock(); const drawn = game.current_drawn!.id; const stockCount = game.stock.length; game.timeout_turn();
    expect(game.stock.length).toBe(stockCount + 1); expect(game.stock.some((item) => item.id === drawn)).toBe(true); expect(game.hand_size(0)).toBe(4);

    for (let turn = 0; turn < 16; turn += 1) { game.finish_turn(); if (game.phase === "handoff") game.confirm_handoff(); }
    expect(game.completed_table_rounds).toBe(4); expect(game.can_declare_screw()).toBe(true);
    game.declare_screw(); expect(game.round_closing).toBe(true); expect(game.turn_index).toBe(2);
  });

  it("accumulates scores across four rounds and resets for a new game", () => {
    const game = new GameModel();
    game.start_round(names, 1);
    game.players.forEach((player, i) => { player.hand = [card(`r1${i}`, `number_${[10, 2, 3, 4][i]}`)]; });
    game._finish_round(false);
    expect(game.series_totals.player_02).toBe(0);
    game.start_round(names, 2);
    game.players.forEach((player, i) => { player.hand = [card(`r2${i}`, `number_${[10, 9, 2, 4][i]}`)]; });
    game._finish_round(false);
    expect(game.series_totals.player_02).toBe(9);
    expect(game.series_totals.player_03).toBe(3);
    game.start_round(names, 1);
    expect(game.series_totals).toEqual({});
  });

  it("doubles only a non-tied Screw caller and reports tied winners", () => {
    const game = new GameModel(); game.start_round(names);
    game.players[0].hand = [card("caller", "number_8")]; game.players[1].hand = [card("low", "number_5")]; game.players[2].hand = [card("third", "number_7")]; game.players[3].hand = [card("fourth", "number_9")];
    game.screw_caller_id = game.players[0].id; game._finish_round(true);
    expect(game.result?.rows[0].score).toBe(32); expect(game.result?.rows[0].doubled).toBe(true); expect(game.result?.rows[1].score).toBe(0); expect(game.result?.winners).toEqual(["ليلى"]);

    const tie = new GameModel(); tie.start_round(names);
    tie.players[0].hand = [card("a", "number_5")]; tie.players[1].hand = [card("b", "number_5")]; tie.players[2].hand = [card("c", "number_7")]; tie.players[3].hand = [card("d", "number_9")];
    tie.screw_caller_id = tie.players[0].id; tie._finish_round(true);
    expect(tie.result?.rows[0].doubled).toBe(false); expect(tie.result?.rows[0].score).toBe(0); expect(tie.result?.rows[1].score).toBe(0); expect(tie.result?.winners).toEqual(["آدم", "ليلى"]);
  });
});
