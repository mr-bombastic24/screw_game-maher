import { useLayoutEffect, useRef } from 'react';

/**
 * FLIP: أي عنصر عليه data-flip="<id>" يتحرك بسلاسة من مكانه القديم لمكانه الجديد
 * لما يتغير ترتيب الصفحة (كارت يطير من الكومة لليد، من اليد للرمي، بين اللاعبين...).
 * data-flip-from="<id>" : لو العنصر جديد يبدأ طيرانه من مكان عنصر آخر (مثلاً كومة السحب).
 * data-flip-delay="ms"  : تأخير بداية الحركة (للتوزيع المتتابع).
 */
export function useFlip(startReady: boolean) {
  const previous = useRef(new Map<string, DOMRect>());
  const ready = useRef(startReady);
  const running = useRef(new Set<Animation>());
  const lastKey = useRef('');

  useLayoutEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-flip]'));
    // لا نعيد الحساب إلا لو ترتيب الكروت في الصفحة تغيّر (وإلا نقطع الحركة الجارية بلا داعٍ)
    const key = elements.map((element) => element.dataset.flip).join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;
    running.current.forEach((animation) => animation.cancel());
    running.current.clear();
    const next = new Map<string, DOMRect>();
    for (const element of elements) next.set(element.dataset.flip!, element.getBoundingClientRect());

    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (ready.current && !reduce) {
      for (const element of elements) {
        const id = element.dataset.flip!;
        const to = next.get(id)!;
        let from = previous.current.get(id);
        let delay = 0;
        if (!from && element.dataset.flipFrom) {
          from = previous.current.get(element.dataset.flipFrom) ?? next.get(element.dataset.flipFrom);
          delay = Number(element.dataset.flipDelay ?? 0);
        }
        if (!from || !to.width || !to.height) continue;
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        const sx = from.width / to.width;
        const sy = from.height / to.height;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(sx - 1) < 0.02) continue;
        const animation = element.animate(
          [{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: 'top left', transform: 'none' }],
          { duration: 440, delay, easing: 'cubic-bezier(0.22, 0.9, 0.28, 1)', fill: 'backwards' },
        );
        running.current.add(animation);
        animation.onfinish = () => running.current.delete(animation);
      }
    }
    ready.current = true;
    previous.current = next;
  });
}
