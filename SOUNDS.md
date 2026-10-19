# أصوات لعبة سكرو

## الأصوات العامة
ضع الملفات في `public/sounds/` وعدّل المسارات في `src/game/soundConfig.ts` ضمن `GAME_SOUNDS`:

- `shuffle.mp3`: خلط بداية الجولة.
- `deal.mp3`: طقات التوزيع وصوت سحب البطاقة.
- `land.mp3`: نزول البطاقة الافتراضي.
- `victory.mp3`: يُشغّل مرة واحدة عند ظهور نتيجة الجولة الرابعة.

## أصوات تفعيل البطاقات الخاصة
أصوات التفعيل مربوطة بالفعل عند استخدام القوة (بعد رمي البطاقة المسحوبة من كومة السحب)، لا بمجرد وجود البطاقة على كومة الرمي:

| البطاقة | الملف الافتراضي |
|---|---|
| الملك | `public/sounds/cards/king.mp3` |
| المدفع | `public/sounds/cards/cannon.mp3` |
| المهندس | `public/sounds/cards/engineer.mp3` |
| النقل التقيل | `public/sounds/cards/heavy_transfer.mp3` |
| المسحراتي | `public/sounds/cards/mesaharati.mp3` |
| بلوك | `public/sounds/block.mp3` |

لتغيير مسار أي صوت، عدّل `CARD_EFFECT_SOUNDS` في `src/game/soundConfig.ts`. بطاقة البلوك موجودة في مجلد الأصوات الرئيسي، بينما البطاقات الأخرى داخل `cards/`.

## أصوات نزول عامة مخصصة
يمكن ربط صوت اختياري بنوع بطاقة عند نزولها على كومة الرمي، عبر `CARD_LAND_SOUNDS` في `src/game/soundConfig.ts`:

```ts
export const CARD_LAND_SOUNDS: Record<string, string> = {
  screw_red: '/sounds/cards/screw-red.mp3',
};
```

تأثير التفعيل الخاص له الأولوية عند استخدام واحدة من القوى أعلاه. معرّفات البطاقات موضحة في `src/game/cards.ts`.

## الكتم والتحضير
يتم تحميل الأصوات مسبقًا لتقليل تأخير أول تشغيل. زر النغمة يكتم الصوت الجاري فورًا، ويُحفظ اختيار الكتم محليًا على الجهاز في المتصفح. صيغ MP3 وWAV وOGG تعمل عادةً في المتصفحات.
