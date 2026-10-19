import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { assetUrl } from '../game/assets';

export type CardProps = {
  id?: string;
  definitionId?: string;
  name?: string;
  hidden?: boolean;
  selected?: boolean;
  selectable?: boolean;
  interactive?: boolean;
  draggable?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDragStart?: () => void;
  onDrop?: (x: number, y: number) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

const DRAG_THRESHOLD = 7;

/** كارت بقلب ثلاثي الأبعاد وسحب بالإصبع/الماوس (بدون أي مكتبات). */
export default function Card({
  id, definitionId, name = '', hidden = true, selected = false, selectable = false, interactive = false, draggable = false,
  className = '', style, onClick, onDragStart, onDrop, onPointerDown, onPointerUp, onPointerCancel,
}: CardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; active: boolean; pointer: number } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [definitionId]);

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (!draggable || event.button > 0) return;
    drag.current = { x: event.clientX, y: event.clientY, active: false, pointer: event.pointerId };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current; const element = ref.current;
    if (!state || !element) return;
    const dx = event.clientX - state.x; const dy = event.clientY - state.y;
    if (!state.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      state.active = true;
      try { element.setPointerCapture(state.pointer); } catch { /* ignore */ }
      setDragging(true); onDragStart?.();
    }
    element.style.transition = 'none';
    element.style.transform = `translate(${dx}px, ${dy}px) scale(1.08) rotate(${Math.max(-8, Math.min(8, dx / 14))}deg)`;
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const state = drag.current; const element = ref.current;
    drag.current = null;
    if (!state?.active || !element) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 60);
    element.style.transition = 'transform 280ms cubic-bezier(0.22, 0.9, 0.28, 1)';
    element.style.transform = '';
    setDragging(false);
    if (!cancelled) onDrop?.(event.clientX, event.clientY);
  };

  const imagePath = definitionId ? assetUrl(`assets/cards/${definitionId}.webp`) : undefined;
  const classes = ['gcard', hidden ? '' : 'is-face', selected ? 'is-selected' : '', selectable ? 'is-selectable' : '', draggable ? 'is-draggable' : '', dragging ? 'is-dragging' : '', className].filter(Boolean).join(' ');

  return (
    <button
      ref={ref} type="button" className={classes} style={style} data-card-id={id}
      aria-label={hidden ? 'كارت مقلوب' : name || 'كارت'} aria-pressed={selected}
      disabled={!selectable && !draggable && !interactive}
      onClick={(event) => { if (suppressClick.current) return; onClick?.(event); }}
      onPointerDown={down} onPointerMove={move}
      onPointerUp={(event) => { onPointerUp?.(event); finish(event, false); }}
      onPointerCancel={(event) => { onPointerCancel?.(event); finish(event, true); }}
    >
      <span className="gcard__inner">
        <span className="gcard__back" aria-hidden="true"><i /></span>
        <span className="gcard__face" aria-hidden={hidden}>
          {imagePath && !imageFailed ? <img src={imagePath} alt="" draggable={false} onError={() => setImageFailed(true)} /> : <b>{name}</b>}
        </span>
      </span>
    </button>
  );
}
