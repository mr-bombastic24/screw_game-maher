export type CardKind = "number" | "power" | "screw";

export type CardEffect =
  | ""
  | "peek_self"
  | "peek_other"
  | "basra"
  | "take_give"
  | "take_only"
  | "look_swap"
  | "kaab_diyar"
  | "heavy_transfer"
  | "block"
  | "king"
  | "cannon"
  | "mesaharati"
  | "khshaf"
  | "engineer";

export interface CardDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: CardKind;
  readonly value: number;
  readonly count: number;
  readonly effect: CardEffect;
  readonly image: string;
}

export interface Card {
  id: string;
  definition_id: string;
}

/** The listed local deck intentionally has 67 physical cards, not 68. */
export const LISTED_CARD_TOTAL = 67;
export const PREVIOUSLY_CONFIRMED_CARD_TOTAL = 68;
export const CARD_TOTAL_WARNING =
  "الكتالوج المحلي يحتوي 67 بطاقة محددة (لا توجد بطاقة ثامنة وستون موثقة؛ لا تُخترع نسخة).";

const UNKNOWN_DEFINITION: CardDefinition = { id: "unknown", name: "كارت غير معروف", kind: "number", value: 0, count: 0, effect: "", image: "" };

const DEFINITIONS: readonly CardDefinition[] = [
  ...Array.from({ length: 10 }, (_, index): CardDefinition => {
    const number = index + 1;
    const arabicName = ["١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩", "١٠"][index];
    return {
      id: `number_${number}`,
      name: arabicName,
      kind: "number",
      value: number,
      count: 4,
      effect: number >= 7 && number <= 8 ? "peek_self" : number >= 9 ? "peek_other" : "",
      image: `assets/cards/number_${number}.webp`,
    };
  }),
  { id: "plus_20", name: "+٢٠", kind: "number", value: 20, count: 4, effect: "", image: "assets/cards/plus_20.webp" },
  { id: "basra", name: "بصرة", kind: "power", value: 10, count: 2, effect: "basra", image: "assets/cards/basra.webp" },
  { id: "take_give", name: "خد وهات", kind: "power", value: 10, count: 4, effect: "take_give", image: "assets/cards/take_give.webp" },
  { id: "take_only", name: "خد بس", kind: "power", value: 10, count: 1, effect: "take_only", image: "assets/cards/take_only.webp" },
  { id: "look_swap", name: "شوف وبدّل", kind: "power", value: 10, count: 2, effect: "look_swap", image: "assets/cards/look_swap.webp" },
  { id: "kaab_diyar", name: "كعب ديار", kind: "power", value: 10, count: 2, effect: "kaab_diyar", image: "assets/cards/kaab_diyar.webp" },
  { id: "heavy_transfer", name: "النقل التقيل", kind: "power", value: 10, count: 1, effect: "heavy_transfer", image: "assets/cards/heavy_transfer.webp" },
  { id: "block", name: "بلوك", kind: "power", value: 10, count: 1, effect: "block", image: "assets/cards/block.webp" },
  { id: "king", name: "الملك", kind: "power", value: 10, count: 1, effect: "king", image: "assets/cards/king.webp" },
  { id: "cannon", name: "المدفع", kind: "power", value: 10, count: 1, effect: "cannon", image: "assets/cards/cannon.webp" },
  { id: "mesaharati", name: "المسحراتي", kind: "power", value: 10, count: 1, effect: "mesaharati", image: "assets/cards/mesaharati.webp" },
  { id: "minus_1", name: "-١", kind: "number", value: -1, count: 1, effect: "", image: "assets/cards/minus_1.webp" },
  { id: "screw_green", name: "سكرو أخضر", kind: "screw", value: 0, count: 2, effect: "", image: "assets/cards/screw_green.webp" },
  { id: "screw_red", name: "سكرو أحمر", kind: "screw", value: 25, count: 2, effect: "", image: "assets/cards/screw_red.webp" },
  { id: "khshaf", name: "الخشاف", kind: "power", value: 10, count: 1, effect: "khshaf", image: "assets/cards/khshaf.webp" },
  { id: "engineer", name: "المهندس", kind: "power", value: 10, count: 1, effect: "engineer", image: "assets/cards/engineer.webp" },
];

export type RandomSource = () => number;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class CardCatalog {
  static definitions(): CardDefinition[] {
    return DEFINITIONS.map(clone);
  }

  static definitionFor(card: Card | undefined | null): CardDefinition {
    const wanted = card?.definition_id ?? "";
    return DEFINITIONS.find((definition) => definition.id === wanted) ?? UNKNOWN_DEFINITION;
  }

  static cardName(card: Card | undefined | null): string {
    return this.definitionFor(card).name;
  }

  static cardValue(card: Card | undefined | null): number {
    return this.definitionFor(card).value;
  }

  static cardKind(card: Card | undefined | null): CardKind {
    return this.definitionFor(card).kind;
  }

  static cardEffect(card: Card | undefined | null): CardEffect {
    return this.definitionFor(card).effect;
  }

  static isPower(card: Card | undefined | null): boolean {
    const definition = this.definitionFor(card);
    return definition.kind === "power" && definition.effect !== "";
  }

  static totalCardCount(): number {
    return DEFINITIONS.reduce((sum, definition) => sum + definition.count, 0);
  }

  static createDeck(rng: RandomSource = Math.random): Card[] {
    const deck: Card[] = [];
    let serial = 1;
    for (const definition of DEFINITIONS) {
      for (let copy = 0; copy < definition.count; copy += 1) {
        deck.push({ id: `card_${String(serial).padStart(3, "0")}`, definition_id: definition.id });
        serial += 1;
      }
    }
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.max(0, Math.min(index, Math.floor(rng() * (index + 1))));
      [deck[index], deck[randomIndex]] = [deck[randomIndex], deck[index]];
    }
    return deck;
  }

  static matchesForBasra(cardA: Card | undefined | null, cardB: Card | undefined | null): boolean {
    const a = this.definitionFor(cardA).id;
    const b = this.definitionFor(cardB).id;
    return a === b || ((a === "screw_green" || a === "screw_red") && (b === "screw_green" || b === "screw_red"));
  }

}
