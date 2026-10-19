import { useEffect, useRef, type ReactNode } from 'react';

export default function Modal({ children, title, onClose, onBackdropClick, className = '' }: { children: ReactNode; title?: string; onClose?: () => void; onBackdropClick?: () => void; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current; if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
    (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (onClose) { event.preventDefault(); onClose(); } return; }
      if (event.key !== 'Tab') return;
      const items = focusable(); if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={(event) => { if (event.target === event.currentTarget) onBackdropClick?.(); }}>
      <section ref={dialogRef} tabIndex={-1} onClick={(event) => { if (!(event.target as HTMLElement).closest('.gcard')) onBackdropClick?.(); }} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title || 'حالة خاصة'}>
        <div className="modal-card__topline"><span className="modal-card__diamond">✦</span>{title && <h2>{title}</h2>}{onClose && <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="إغلاق">×</button>}</div>
        {children}
      </section>
    </div>
  );
}
