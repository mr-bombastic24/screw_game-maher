/** مسارات ملفات الصوت تحت public/sounds. */
export const GAME_SOUNDS = {
  shuffle: '/sounds/shuffle.mp3',
  deal: '/sounds/deal.mp3',
  draw: '/sounds/deal.mp3',
  land: '/sounds/land.mp3',
  victory: '/sounds/victory.mp3',
} as const;

/** أصوات تفعيل القوى عند لعبها من السحب (وليست مجرد رمي أي كارت من نفس النوع). */
export const CARD_EFFECT_SOUNDS: Record<string, string> = {
  king: '/sounds/cards/king.mp3',
  cannon: '/sounds/cards/cannon.mp3',
  engineer: '/sounds/cards/engineer.mp3',
  heavy_transfer: '/sounds/cards/heavy_transfer.mp3',
  mesaharati: '/sounds/cards/mesaharati.mp3',
  block: '/sounds/block.mp3',
};

/** صوت مخصص اختياري لنزول أي تعريف بطاقة على كومة الرمي. */
export const CARD_LAND_SOUNDS: Record<string, string> = {};
