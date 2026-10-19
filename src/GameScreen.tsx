import { useEffect, useMemo, useRef, useState } from 'react';
import Card from './ui/Card';
import Modal from './ui/Modal';
import { useFlip } from './ui/flip';
import { type Card as CardData, CardCatalog } from './game/cards';
import { assetUrl } from './game/assets';
import { CARD_EFFECT_SOUNDS, CARD_LAND_SOUNDS, GAME_SOUNDS } from './game/soundConfig';
import { playAudio, preloadAudio, setAudioEnabled } from './game/audio';
import { HIDDEN_DEFINITION, type PlayerView, type RoomSnapshot } from './online/protocol';
import type { RemoteGame } from './online/RemoteGame';

type ConfirmationKind = 'end-round' | 'end-session' | 'new-series' | 'leave';

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('');
}

function cardInfo(card: CardData) {
  return {
    name: CardCatalog.cardName(card),
    definitionId: card.definition_id === HIDDEN_DEFINITION ? undefined : card.definition_id,
  };
}

function safeGameMessage(round: number, phase: string, message: string): string {
  if (round !== 3 || phase === 'result' || phase === 'setup') return message;
  const messages: Record<string, string> = {
    turn: 'جولة العمياني: كل كروتك مخفية. المس كومة السحب أو الرمي للعب.',
    resolve_draw: 'الكارت المسحوب مخفي في العمياني؛ بدّله بكارت من يدك أو المسه لرميه.',
    private_reveal: 'العمياني بيمنع معاينة كروتك أنت.',
    effect_choice: 'اختار أحد خيارات الحركة.',
    effect_select_target: 'اختار لاعباً من المقاعد المضيئة.',
    effect_select_hand: 'اختار خانة من اليد من غير ما تشوف الكارت.',
    heavy_choice: 'جرّب كارت مقفول من الجداد، أو المس الطاولة الفاضية لإنهاء الدور.',
    look_swap_decision: 'الكارت المعاين مخفي لحد ما تضغط مطولاً عليه.',
    khshaf_choice: 'اختار واحد من الأربعة المقفولين.',
  };
  return messages[phase] ?? 'جولة العمياني: أيديك مخفية طوال الجولة.';
}

function vibrate(pattern: number | number[] = 35) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function SwipeToReady({ onReady }: { onReady: () => void }) {
  const [progress, setProgress] = useState(0);
  const startX = useRef(0);
  const width = useRef(1);
  const drag = useRef(false);
  const progressRef = useRef(0);
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = true; startX.current = event.clientX; width.current = Math.max(1, event.currentTarget.clientWidth - 54);
    event.currentTarget.setPointerCapture(event.pointerId); progressRef.current = 0; setProgress(0);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.max(0, Math.min(1, (event.clientX - startX.current) / width.current));
    progressRef.current = next; setProgress(next);
  };
  const finish = () => {
    if (!drag.current) return;
    drag.current = false;
    if (progressRef.current >= 0.7) { vibrate(25); onReady(); }
    progressRef.current = 0; setProgress(0);
  };
  const keyAction = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); vibrate(25); onReady(); }
  };
  return <div className="swipe-ready-wrap">
    <div className="swipe-ready" role="button" tabIndex={0} aria-label="اسحب الشريط للتأكيد أنك جاهز" onKeyDown={keyAction} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <span className="swipe-ready__label">اسحب السهم للتأكيد</span>
      <span className="swipe-ready__fill" style={{ width: `${progress * 100}%` }} />
      <span className="swipe-ready__thumb" style={{ left: 6, transform: `translateX(${progress * width.current}px)` }}>←</span>
    </div>
    <button className="swipe-ready__fallback" type="button" onClick={onReady}>أو اضغط «أنا جاهز»</button>
  </div>;
}

function ScrewHoldButton({ disabled, onHold, hint }: { disabled: boolean; onHold: () => void; hint: string }) {
  const [progress, setProgress] = useState(0);
  const press = useRef<{ started: number; interval: number; fired: boolean } | null>(null);
  const stop = () => {
    const active = press.current;
    if (active) window.clearInterval(active.interval);
    if (!active?.fired) setProgress(0);
    press.current = null;
  };
  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || press.current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const active = { started: performance.now(), interval: 0, fired: false };
    active.interval = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - active.started) / 850);
      setProgress(next);
      if (next >= 1 && !active.fired) { active.fired = true; window.clearInterval(active.interval); vibrate([35, 40, 60]); onHold(); }
    }, 24);
    press.current = active;
  };
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    if (!event.repeat) { event.preventDefault(); vibrate([35, 40, 60]); onHold(); }
  };
  useEffect(() => () => { if (press.current) window.clearInterval(press.current.interval); }, []);
  useEffect(() => { if (disabled) setProgress(0); }, [disabled]);
  return <button type="button" className={`g-screw ${disabled ? 'is-locked' : 'is-ready'}`} disabled={disabled} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={keyDown} style={{ '--hold': `${progress * 360}deg` } as React.CSSProperties} aria-label={disabled ? 'سكرو غير متاح بعد' : 'اضغط مطولاً لإعلان سكرو'}>
    <span className="g-screw__ring"><i /></span><b>سكرو</b><small>{hint}</small>
  </button>;
}

function MiniCard({ card, face, flipFrom, delay }: { card: CardData; face: boolean; flipFrom?: string; delay: number }) {
  const info = cardInfo(card);
  return <span className="g-mini-slot" data-flip={card.id} data-flip-from={flipFrom} data-flip-delay={delay}>
    <span className={`g-mini ${face && info.definitionId ? 'is-face' : ''}`}>{face && info.definitionId ? <img src={assetUrl(`assets/cards/${info.definitionId}.webp`)} alt="" draggable={false} /> : <i />}</span>
  </span>;
}

function Opponent({ player, index, order, active, targetable, timerAngle, timerSeconds, timerLabel, revealed, dealFrom, onPick, cols }: {
  player: PlayerView; index: number; order: number; active: boolean; targetable: boolean; timerAngle: number; timerSeconds: number; timerLabel: string;
  revealed: (card: CardData) => boolean; dealFrom: boolean; onPick: () => void; cols: number;
}) {
  return (
    <button type="button" className={`g-opp ${active ? 'is-active' : ''} ${targetable ? 'is-target' : ''} ${player.connected ? '' : 'is-offline'}`}
      disabled={!targetable} onClick={targetable ? onPick : undefined} style={{ '--ring': `${timerAngle}deg`, '--cols': cols } as React.CSSProperties}
      aria-label={`${player.name}، ${player.hand.length} كروت${targetable ? '، اختره' : ''}`}>
      <span className="g-opp__top">
        <span className="g-opp__avatar" style={{ '--ring': `${timerAngle}deg` } as React.CSSProperties}><b>{initials(player.name)}</b></span>
        <span className="g-opp__id">
          <strong>{player.name}</strong>
          <small>{player.connected ? `${player.hand.length} كروت` : 'غير متصل'}</small>
        </span>
        {active && timerSeconds > 0 && <span className={`g-opp__timer ${timerSeconds <= 5 ? 'is-urgent' : ''}`} title={timerLabel}>{timerSeconds}</span>}
      </span>
      <span className="g-opp__cards" aria-hidden="true">
        {player.hand.map((card, slot) => <MiniCard key={card.id} card={card} face={revealed(card)} flipFrom={dealFrom ? 'stock' : undefined} delay={(order * 4 + slot) * 70} />)}
      </span>
    </button>
  );
}

type Props = {
  game: RemoteGame;
  snapshot: RoomSnapshot;
  clockOffset: number;
  connected: boolean;
  onNextRound: () => void;
  onToLobby: () => void;
  onLeave: () => void;
};

export default function GameScreen({ game, snapshot, clockOffset, connected, onNextRound, onToLobby, onLeave }: Props) {
  const me = snapshot.me;
  const roundNumber = game.round_number;
  const phase = game.phase;
  const actorIndex = game.actor;
  const isActor = actorIndex === me;
  const players = game.players;
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [powerBanner, setPowerBanner] = useState('');
  const [powerKey, setPowerKey] = useState(0);
  const [draggingHand, setDraggingHand] = useState(false);
  const [draggingDrawn, setDraggingDrawn] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationKind | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [privateCardHeldId, setPrivateCardHeldId] = useState<string | null>(null);
  const [seenPrivateRevealIds, setSeenPrivateRevealIds] = useState<string[]>([]);
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem('screwcard.soundOn') !== 'false'; } catch { return true; } });
  const [dealing, setDealing] = useState(() => !!game.dealt_at && Date.now() + snapshot.serverNow - Date.now() - game.dealt_at < 3000);
  const [shuffling, setShuffling] = useState(false);
  const privateRevealStartedAtRef = useRef(0);
  const privateRevealTimeoutRef = useRef<number | undefined>(undefined);
  const victoryPlayedRef = useRef(false);
  const toastTimeoutRef = useRef<number | undefined>(undefined);
  const powerTimeoutRef = useRef<number | undefined>(undefined);
  const lastTurnHapticRef = useRef('');
  const lastEventSeqRef = useRef<number>(Math.max(0, ...snapshot.events.map((event) => event.seq)));
  const lastDrawnIdRef = useRef<string | null>(null);
  const preloadedRef = useRef<Set<string>>(new Set());

  const freshDeal = !!game.dealt_at && Date.now() + clockOffset - game.dealt_at < 3000;
  useFlip(freshDeal);

  const playGameSound = (src: string, volume = 0.48) => { if (soundOn) playAudio(src, volume); };
  useEffect(() => {
    setAudioEnabled(soundOn);
    try { localStorage.setItem('screwcard.soundOn', String(soundOn)); } catch { /* التخزين المحلي قد يكون محظورًا */ }
  }, [soundOn]);
  useEffect(() => {
    [...Object.values(GAME_SOUNDS), ...Object.values(CARD_EFFECT_SOUNDS), ...Object.values(CARD_LAND_SOUNDS)].forEach((src) => preloadAudio(src, 2));
  }, []);

  // المؤقت يأتي من السيرفر كموعد نهائي؛ هنا عد تنازلي فقط
  const timer = snapshot.timer;
  const timerActive = (timer.kind === 'peek' || timer.kind === 'turn') && timer.deadline > 0;
  useEffect(() => {
    if (!timerActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timerActive]);
  const timeLeft = timerActive ? Math.max(0, Math.ceil((timer.deadline - (now + clockOffset)) / 1000)) : 0;
  const timerDuration = timer.duration || 30;
  const timerAngle = timerActive ? Math.max(0, Math.min(360, ((timerDuration - timeLeft) / timerDuration) * 360)) : 0;

  const showToast = (text: string, ms = 3200) => {
    setToastMessage(text);
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToastMessage(''), ms);
  };
  useEffect(() => () => {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    if (powerTimeoutRef.current) window.clearTimeout(powerTimeoutRef.current);
    if (privateRevealTimeoutRef.current) window.clearTimeout(privateRevealTimeoutRef.current);
  }, []);
  useEffect(() => { if (notice) showToast(notice, 2600); }, [notice]);

  // أحداث عامة: تفعيل باور، نزول كارت، رسالة للجميع
  useEffect(() => {
    const fresh = snapshot.events.filter((event) => event.seq > lastEventSeqRef.current);
    if (!fresh.length) return;
    lastEventSeqRef.current = Math.max(...fresh.map((event) => event.seq));
    for (const event of fresh) {
      if (event.kind === 'power' && event.definition_id) {
        const name = game.round_number === 3 ? 'خاصية خاصة' : CardCatalog.cardName({ id: '', definition_id: event.definition_id });
        setPowerBanner(`تفعيل ${name}`); setPowerKey((value) => value + 1);
        if (powerTimeoutRef.current) window.clearTimeout(powerTimeoutRef.current);
        powerTimeoutRef.current = window.setTimeout(() => setPowerBanner(''), 2100);
        const effectSound = CARD_EFFECT_SOUNDS[event.definition_id];
        playGameSound(effectSound ?? CARD_LAND_SOUNDS[event.definition_id] ?? GAME_SOUNDS.land, effectSound ? 0.66 : 0.58);
      } else if (event.kind === 'land' && event.definition_id) {
        playGameSound(CARD_LAND_SOUNDS[event.definition_id] ?? GAME_SOUNDS.land, 0.58);
      } else if (event.kind === 'toast' && event.text) showToast(event.text);
    }
  }, [snapshot.events]);

  useEffect(() => {
    const id = game.current_drawn?.id ?? null;
    if (id && id !== lastDrawnIdRef.current) playGameSound(GAME_SOUNDS.draw, 0.48);
    lastDrawnIdRef.current = id;
  }, [game.current_drawn?.id]);

  useEffect(() => {
    const turnKey = `${game.round_number}:${game.turn_index}:${game.phase}:${game.completed_table_rounds}`;
    if (game.phase === 'turn' && isActor && lastTurnHapticRef.current !== turnKey) { vibrate(24); lastTurnHapticRef.current = turnKey; }
  }, [game.phase, game.round_number, game.turn_index, game.completed_table_rounds, isActor]);

  useEffect(() => {
    if (game.phase === 'result' && game.round_number === 4 && !victoryPlayedRef.current) { victoryPlayedRef.current = true; playGameSound(GAME_SOUNDS.victory, 0.75); }
    if (game.phase !== 'result') victoryPlayedRef.current = false;
  }, [game.phase, game.round_number, soundOn]);

  useEffect(() => {
    if (game.phase === 'private_reveal') return;
    if (privateRevealTimeoutRef.current) { window.clearTimeout(privateRevealTimeoutRef.current); privateRevealTimeoutRef.current = undefined; }
    if (game.phase === 'look_swap_decision' && game.look_swap_seen_card) setPrivateCardHeldId(game.look_swap_seen_card.id);
    else setPrivateCardHeldId(null);
  }, [game.phase, game.look_swap_seen_card?.id]);
  useEffect(() => { if (game.phase === 'private_reveal') setSeenPrivateRevealIds([]); }, [game.phase, game.pending_action]);

  // خلط وتوزيع عند بداية كل جولة
  useEffect(() => {
    if (!game.dealt_at || Date.now() + clockOffset - game.dealt_at > 3500) return;
    const timeouts: number[] = [];
    setDealing(true); setShuffling(true);
    playGameSound(GAME_SOUNDS.shuffle, 0.55);
    timeouts.push(window.setTimeout(() => setShuffling(false), 800));
    const cues = Math.min(12, game.players.length * 2);
    for (let i = 0; i < cues; i += 1) timeouts.push(window.setTimeout(() => playGameSound(GAME_SOUNDS.deal, 0.48), 600 + i * 150));
    timeouts.push(window.setTimeout(() => setDealing(false), 700 + game.players.length * 4 * 70 + 600));
    return () => { timeouts.forEach((id) => window.clearTimeout(id)); setShuffling(false); setDealing(false); };
  }, [game.dealt_at]);

  const act = (action: () => void) => { action(); setDraggingHand(false); setDraggingDrawn(false); };

  // ---------- قيم مشتقة ----------
  const isOpeningPeekStage = phase === 'initial_peek' || (phase === 'private_reveal' && game.pending_action === 'initial_peek_confirm');
  const peekHandoff = phase === 'handoff' && game.handoff_kind === 'initial_peek';
  const activePlayer = players[actorIndex];
  const timerLabel = isOpeningPeekStage ? 'معاينة' : 'دورك';
  const displayPlayerIndex = isActor ? game.hand_display_player_index : me;
  const displayPlayer = players[displayPlayerIndex];
  const viewingOther = isActor && displayPlayerIndex !== me;
  const hand = displayPlayer?.hand ?? [];
  const myHand = players[me]?.hand ?? [];
  const topDiscard = game.discard_pile.length ? game.discard_pile[game.discard_pile.length - 1] : undefined;
  const drawnCard = game.current_drawn ?? undefined;
  const revealCards = isActor ? game.private_reveals : [];
  const roundProgress = Math.min(4, game.completed_table_rounds);
  const opponents = players.map((_, i) => (me + 1 + i) % players.length).filter((i) => i !== me);
  const cols = opponents.length <= 3 ? Math.max(1, opponents.length) : opponents.length <= 6 ? 3 : 4;
  const targetable = useMemo(() => (phase === 'effect_select_target' && isActor ? game.player_ids_except_current : []), [phase, isActor, game.player_ids_except_current]);
  const cardSelectable = isActor && (phase === 'initial_peek' || phase === 'turn' || phase === 'resolve_draw' || phase === 'effect_select_hand');
  const privateRevealBlind = roundNumber === 3 && game.private_reveal_owner_index === game.turn_index;
  const isHeavyReveal = phase === 'private_reveal' && game.pending_action === 'heavy_reveal_finish';

  useEffect(() => {
    for (const card of players.flatMap((player) => player.hand)) {
      if (card.definition_id === HIDDEN_DEFINITION || preloadedRef.current.has(card.definition_id)) continue;
      preloadedRef.current.add(card.definition_id);
      const image = new Image(); image.src = assetUrl(`assets/cards/${card.definition_id}.webp`);
    }
  }, [game]);

  const visibleHandCard = (playerIndex: number, card: CardData) => {
    if (phase === 'result') return true;
    if (roundNumber === 3 && playerIndex === game.turn_index) return false;
    return game.is_publicly_revealed(playerIndex, card);
  };

  // ---------- رسالة الحالة (سطر واحد ثابت، ما بيغطيش أي حاجة) ----------
  const handTitle = phase === 'initial_peek' ? 'اختار كارتين تحفظ مكانهم' :
    phase === 'resolve_draw' ? 'اختار كارتاً تستبدله' :
    phase === 'effect_select_hand' ? `اختار من كروت ${displayPlayer?.name ?? 'اللاعب'}` : 'كروتك';
  const guidance = isActor || phase === 'result' ? safeGameMessage(roundNumber, phase, game.message) : '';
  const waitingText = phase === 'result' ? 'انتهت الجولة' : `${activePlayer?.name ?? 'اللاعب'} ${isOpeningPeekStage || peekHandoff ? 'بيعاين كروته' : 'بيلعب'}…`;
  const statusText = toastMessage || (isActor ? (phase === 'turn' ? 'دورك! اسحب كارت أو جرّب بصرة' : guidance) : waitingText);
  const statusTone = toastMessage ? 'toast' : isActor && phase !== 'result' ? 'mine' : 'wait';

  // ---------- الأوامر ----------
  const drawStock = () => { if (isActor && phase === 'turn') act(() => game.draw_from_stock()); };
  const takeDiscard = () => {
    if (!isActor || phase !== 'turn') return;
    const selectedSlot = Number(game.selected_hand_slot ?? -1);
    if (selectedSlot >= 0) { act(() => game.attempt_basra(selectedSlot)); return; }
    act(() => game.take_top_discard());
  };
  const discardDrawn = () => { if (isActor) act(() => game.discard_drawn_and_resolve()); };
  const hitElement = (selector: string, x: number, y: number, tolerance = 14) => Array.from(document.querySelectorAll<HTMLElement>(selector)).some((target) => {
    const rect = target.getBoundingClientRect();
    return x >= rect.left - tolerance && x <= rect.right + tolerance && y >= rect.top - tolerance && y <= rect.bottom + tolerance;
  });
  const handleDrawDrop = (x: number, y: number) => {
    const handCards = Array.from(document.querySelectorAll<HTMLElement>('.g-hand [data-card-id]'));
    let slot = -1; let nearest = Number.POSITIVE_INFINITY;
    myHand.forEach((card, index) => {
      const element = handCards.find((item) => item.dataset.cardId === card.id);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (x < rect.left - 10 || x > rect.right + 10 || y < rect.top - 10 || y > rect.bottom + 10) return;
      const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
      if (distance < nearest) { nearest = distance; slot = index; }
    });
    if (slot >= 0) act(() => game.replace_drawn_with(slot));
    else if (game.draw_source === 'stock' && hitElement('.g-pile--discard', x, y, 22)) discardDrawn();
    else setDraggingDrawn(false);
  };
  const handleHandCardDrop = (slot: number, x: number, y: number) => {
    if (phase === 'turn' && hitElement('.g-pile--discard', x, y, 22)) act(() => game.attempt_basra(slot));
    else setDraggingHand(false);
  };
  const onHandCard = (slot: number) => act(() => { if (phase === 'initial_peek') game.choose_initial_peek(slot); else game.select_hand_card(slot); });

  const acceptConfirmation = () => {
    const action = pendingConfirmation;
    setPendingConfirmation(null);
    if (action === 'end-round') { act(() => game.choose_effect_option('end_round')); return; }
    if (action === 'end-session' || action === 'new-series') onToLobby();
    if (action === 'leave') onLeave();
  };
  const confirmationText = pendingConfirmation === 'end-round' ? 'هتتكشف الأيدي وتتحسب النقاط فوراً. مفيش رجوع في القرار ده.'
    : pendingConfirmation === 'leave' ? 'هتخرج من الغرفة ومش هتقدر ترجع لنفس اللعبة. الباقيين هيكملوا من غيرك.'
    : pendingConfirmation === 'new-series' ? 'الكل هيرجع لغرفة الانتظار، وتقدروا تبدأوا لعبة جديدة بنفس الغرفة.'
    : 'هترجعوا كلكم لغرفة الانتظار؛ اللعبة الحالية مش هتتكمل.';
  const copyInvite = async () => {
    const url = new URL(window.location.href); url.search = `?room=${snapshot.code}`; url.hash = '';
    const text = `تعالى نلعب سكرو! كود الغرفة: ${snapshot.code}`;
    try { if (navigator.share) { await navigator.share({ title: 'سكرو', text, url: url.toString() }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(`${text}\n${url.toString()}`); setNotice('اتنسخ رابط الدعوة'); } catch { setNotice(`كود الغرفة: ${snapshot.code}`); }
  };

  const finishHeavyByTableTap = (event: React.MouseEvent<HTMLElement>) => {
    if (phase !== 'heavy_choice' || !isActor) return;
    if ((event.target as HTMLElement).closest('.g-pile, .gcard, button')) return;
    act(() => game.finish_heavy_choices());
  };

  // معاينة خاصة بالضغط المطول
  const revealOnPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    if (privateRevealTimeoutRef.current) window.clearTimeout(privateRevealTimeoutRef.current);
    privateRevealTimeoutRef.current = undefined;
    privateRevealStartedAtRef.current = Date.now();
    setPrivateCardHeldId(event.currentTarget.dataset.cardId ?? null);
  };
  const hidePrivateReveal = (cardId?: string) => {
    if (privateRevealTimeoutRef.current) window.clearTimeout(privateRevealTimeoutRef.current);
    privateRevealTimeoutRef.current = undefined;
    privateRevealStartedAtRef.current = 0;
    setPrivateCardHeldId(null);
    if (game.phase !== 'private_reveal') return;
    if (roundNumber !== 3 && cardId && game.pending_action === 'heavy_reveal_finish' && revealCards.length > 1) {
      const viewed = Array.from(new Set([...seenPrivateRevealIds, cardId]));
      setSeenPrivateRevealIds(viewed);
      if (!revealCards.every((card) => viewed.includes(card.id))) return;
    }
    act(() => game.hide_private_reveal());
  };
  const releasePrivateReveal = (cardId: string) => {
    if (game.phase !== 'private_reveal') { setPrivateCardHeldId(null); return; }
    const remaining = Math.max(0, 1800 - (Date.now() - privateRevealStartedAtRef.current));
    if (!remaining) { hidePrivateReveal(cardId); return; }
    if (privateRevealTimeoutRef.current) window.clearTimeout(privateRevealTimeoutRef.current);
    privateRevealTimeoutRef.current = window.setTimeout(() => { privateRevealTimeoutRef.current = undefined; hidePrivateReveal(cardId); }, remaining);
  };
  const revealPrivateCardByKeyboard = (cardId: string) => {
    if (privateRevealTimeoutRef.current) return;
    privateRevealStartedAtRef.current = Date.now();
    setPrivateCardHeldId(cardId);
    privateRevealTimeoutRef.current = window.setTimeout(() => { privateRevealTimeoutRef.current = undefined; hidePrivateReveal(cardId); }, 1800);
  };

  const handActionLabel = game.pending_action === 'power_basra' ? 'ارمِ أي كارت لاستخدام البصرة' :
    game.pending_action === 'take_give_own' ? `اختار كارتاً من عندك للتبديل مع ${game.player_name(game.pending_target)}` :
    game.pending_action === 'take_give_other' ? `اختار كارتاً من إيد ${game.player_name(game.pending_target)}` :
    game.pending_action === 'take_only_card' ? `اختار كارتاً تديه إلى ${game.player_name(game.pending_target)}` :
    game.pending_action === 'look_swap_peek' || game.pending_action === 'peek_other_slot' ? `اختار كارتاً من إيد ${game.player_name(game.pending_target)} لمعاينته` :
    game.pending_action === 'peek_self' ? 'اختار كارتاً من يدك لمعاينته' :
    game.pending_action === 'mesaharati_keep' ? 'اختار كارتاً ترميه واحتفظ بالمسحراتي' :
    game.pending_action === 'kaab_own' ? 'اختار كارتاً مختلفاً من يدك لمعاينته' :
    game.pending_action === 'kaab_all_slot' ? `اختار كارتاً من إيد ${game.player_name(game.kaab_player_index)}` :
    game.pending_action === 'look_take_own' ? `اختار كارتاً من عندك تعطيه إلى ${game.player_name(game.look_swap_first_target)}` :
    game.pending_action === 'look_exchange_second_slot' ? `اختار كارتاً من إيد ${game.player_name(game.pending_target)}` : '';

  const stockDims = isActor && phase === 'turn';
  const canControl = snapshot.hostCanBeReplaced;

  return (
    <div className="app-root g-root" onContextMenu={(event) => event.preventDefault()}>
      <div className={`g-shell ${opponents.length > 3 ? 'g-shell--tall-opps' : ''}`}>
        <header className="g-top">
          <button className="g-icon" type="button" aria-label="القائمة" onClick={() => setMenuOpen(true)}>☰</button>
          <div className="g-top__title">
            <strong>الجولة {roundNumber} من 4{roundNumber === 3 ? ' · العمياني' : roundNumber === 4 ? ' · الدابل' : ''}</strong>
            <span>غرفة <b dir="ltr">{snapshot.code}</b></span>
          </div>
          <button className={`g-icon ${soundOn ? 'is-on' : ''}`} type="button" aria-label="الصوت" aria-pressed={soundOn} onClick={() => setSoundOn((value) => !value)}>{soundOn ? '♪' : '✕'}</button>
        </header>

        <div className={`g-status g-status--${statusTone}`} role="status" aria-live="polite">
          <span className="g-status__dot" />
          <span className="g-status__text" key={statusText}>{statusText}</span>
          {timerActive && <span className={`g-status__timer ${timeLeft <= 5 ? 'is-urgent' : ''}`} aria-label={`${timeLeft} ثانية`} style={{ '--ring': `${timerAngle}deg` } as React.CSSProperties}><b>{timeLeft}</b></span>}
        </div>

        <section className={`g-opps g-opps--${opponents.length} ${cols === 4 ? 'g-opps--dense' : ''}`} aria-label="اللاعبين" style={{ '--cols': cols } as React.CSSProperties}>
          {opponents.map((index, order) => (
            <Opponent key={players[index].id} player={players[index]} index={index} order={order + 1} cols={cols}
              active={index === actorIndex && phase !== 'result'} targetable={targetable.includes(index)} timerAngle={index === actorIndex ? timerAngle : 0}
              timerSeconds={timerActive && index === actorIndex ? timeLeft : 0} timerLabel={timerLabel}
              revealed={(card) => visibleHandCard(index, card)} dealFrom={dealing} onPick={() => act(() => game.select_target(index))} />
          ))}
        </section>

        <section className={`g-table ${draggingHand ? 'is-dragging-hand' : ''} ${draggingDrawn ? 'is-dragging-drawn' : ''}`} aria-label="الطاولة" onClick={finishHeavyByTableTap}>
          <div className="g-table__felt" />
          {powerBanner && <div className="g-power" key={powerKey} role="status"><span aria-hidden="true">✦</span> {powerBanner}</div>}

          <div className="g-piles">
            <div className={`g-pile g-pile--stock ${shuffling ? 'is-shuffling' : ''} ${stockDims ? 'is-actionable' : ''}`} data-flip="stock">
              <div className="g-pile__stack">
                <span /><span /><Card name="كومة السحب" hidden selectable={stockDims} onClick={drawStock} className="g-pile__card" />
              </div>
              <span className="g-pile__badge">{game.stock_count}</span>
              <span className="g-pile__label">{stockDims ? 'المس واسحب' : 'كومة السحب'}</span>
            </div>
            <div className={`g-pile g-pile--discard ${stockDims ? 'is-actionable' : ''}`}>
              <div className="g-pile__stack">
                {topDiscard && topDiscard.definition_id !== HIDDEN_DEFINITION
                  ? <div className="g-slot g-slot--pile" data-flip={topDiscard.id}><Card id={topDiscard.id} definitionId={cardInfo(topDiscard).definitionId} name={cardInfo(topDiscard).name} hidden={false} selectable={stockDims} onClick={takeDiscard} className="g-pile__card" /></div>
                  : <div className="g-pile__empty">—</div>}
              </div>
              <span className="g-pile__badge">{game.discard_pile.length}</span>
              <span className="g-pile__label">{stockDims ? 'خدها أو ارمي عليها' : 'كومة الرمي'}</span>
            </div>
          </div>

          <div className={`g-drawn ${drawnCard && phase === 'resolve_draw' ? 'has-card' : ''}`}>
            {phase === 'resolve_draw' && drawnCard ? (
              <>
                <div className="g-slot g-slot--drawn" data-flip={drawnCard.id} data-flip-from={game.draw_source === 'discard' ? undefined : 'stock'}>
                  <Card id={drawnCard.id} definitionId={cardInfo(drawnCard).definitionId} name={cardInfo(drawnCard).name}
                    hidden={roundNumber === 3 || drawnCard.definition_id === HIDDEN_DEFINITION}
                    selectable={isActor && game.draw_source === 'stock'} draggable={isActor && game.draw_source === 'stock'} className="g-drawn__card"
                    onClick={isActor && game.draw_source === 'stock' ? discardDrawn : undefined}
                    onDragStart={isActor && game.draw_source === 'stock' ? () => setDraggingDrawn(true) : undefined} onDrop={handleDrawDrop} />
                </div>
                <span className="g-drawn__hint">{!isActor ? `${activePlayer?.name ?? 'اللاعب'} ${game.draw_source === 'stock' ? 'سحب كارت' : 'أخد الكارت المكشوف'}`
                  : game.draw_source === 'stock' ? 'اسحبه على كارت من إيدك للتبديل · أو المسه لرميه' : 'المس كارتاً من إيدك لتبديله'}</span>
              </>
            ) : (
              <div className="g-progress" aria-label={`دورات الطاولة ${roundProgress} من 4`}>
                <div className="g-progress__dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i < roundProgress ? 'is-done' : ''} />)}</div>
                <span>{roundProgress >= 4 ? 'سكرو مفتوح ✦' : `سكرو يتفتح بعد ${4 - roundProgress} ${4 - roundProgress === 1 ? 'دورة' : 'دورات'}`}</span>
              </div>
            )}
          </div>
        </section>

        <section className={`g-hand ${viewingOther ? 'is-other' : ''} ${draggingDrawn ? 'is-drop-target' : ''}`} aria-label="كروتك">
          <header className="g-hand__title">
            <strong>{viewingOther ? `كروت ${displayPlayer?.name}` : isActor ? handTitle : 'كروتك'}</strong>
            <small>{isActor && handActionLabel && phase !== 'turn' && phase !== 'resolve_draw' ? handActionLabel : `${hand.length} كروت`}</small>
          </header>
          <div className="g-hand__grid" style={{ '--n': Math.min(hand.length, 4) } as React.CSSProperties}>
            {hand.map((card, slot) => {
              const heavyPlayable = phase === 'heavy_choice' && game.heavy_pending_ids.includes(card.id);
              const blindHeavyTry = phase === 'heavy_choice' && roundNumber === 3 && game.heavy_drawn_ids.includes(card.id);
              const face = visibleHandCard(displayPlayerIndex, card) || (heavyPlayable && roundNumber !== 3);
              const info = cardInfo(card);
              const selectedNow = isActor && (phase === 'initial_peek' ? game.initial_peeked_ids.includes(card.id) : Number(game.selected_hand_slot) === slot);
              return (
                <div className="g-slot" key={card.id} data-flip={card.id} data-flip-from={dealing ? 'stock' : undefined} data-flip-delay={slot * 70}>
                  <Card id={card.id} definitionId={info.definitionId} name={info.name} hidden={!face} selected={selectedNow}
                    selectable={cardSelectable || (isActor && (heavyPlayable || blindHeavyTry))}
                    draggable={isActor && phase === 'turn' && !viewingOther}
                    onClick={() => (heavyPlayable || blindHeavyTry) ? act(() => game.use_heavy_power(card.id)) : onHandCard(slot)}
                    onDragStart={() => setDraggingHand(true)} onDrop={(x, y) => handleHandCardDrop(slot, x, y)} />
                </div>
              );
            })}
          </div>
        </section>

        <footer className="g-dock">
          <button className="g-basra" type="button" disabled={!(isActor && phase === 'turn' && Number(game.selected_hand_slot ?? -1) >= 0)}
            aria-label="نفّذ بصرة بالكارت المحدد" onClick={() => { const slot = Number(game.selected_hand_slot ?? -1); if (slot >= 0) act(() => game.attempt_basra(slot)); }}>
            <span aria-hidden="true">♠</span><b>بصرة</b><small>حدّد كارت</small>
          </button>
          <ScrewHoldButton disabled={!(isActor && phase === 'turn' && game.can_declare_screw)} onHold={() => act(() => game.declare_screw())}
            hint={game.can_declare_screw ? 'اضغط مطولاً' : roundProgress < 4 ? `${roundProgress}/4 دورات` : 'مش دورك'} />
        </footer>
      </div>

      {!connected && <div className="conn-banner" role="status">انقطع الاتصال… بنحاول نرجع</div>}

      {peekHandoff && isActor && !dealing && (
        <Modal title="استعد لمعاينة كروتك">
          <p className="modal-lead">اسحب الشريط أو اضغط جاهز؛ هتعاين كارتين من كروتك لمدة 15 ثانية.</p>
          <div className="handoff-avatar">{initials(players[me]?.name ?? '')}</div>
          <h3>{players[me]?.name}</h3>
          <SwipeToReady onReady={() => act(() => game.confirm_handoff())} />
          <p className="privacy-note">تأكد إن محدش جنبك شايف شاشتك قبل ما تكمل.</p>
        </Modal>
      )}

      {isActor && phase === 'private_reveal' && (
        <Modal title={isHeavyReveal ? 'معاينة النقل التقيل' : 'معاينة خاصة'} onBackdropClick={hidePrivateReveal}>
          <p className="modal-lead">{privateRevealBlind ? 'العمياني بيمنع عرض كروتك أنت. المس الكارت أو مساحة النافذة لإكمال الحركة.' : 'اضغط مطولاً على الكارت لمعاينته؛ هيفضل ظاهر 1.8 ثانية على الأقل بعد ما ترفع إصبعك.'}</p>
          <div className="reveal-card-stage">
            {revealCards.map((card) => {
              const info = cardInfo(card); const held = privateCardHeldId === card.id;
              return <Card key={card.id} id={card.id} definitionId={info.definitionId} name={info.name} hidden={privateRevealBlind || !held} interactive selectable={held && !privateRevealBlind} className="reveal-card"
                onPointerDown={revealOnPress} onPointerUp={() => releasePrivateReveal(card.id)} onPointerCancel={() => releasePrivateReveal(card.id)}
                onClick={(event) => { if (event.detail === 0) revealPrivateCardByKeyboard(card.id); }} />;
            })}
          </div>
          {isHeavyReveal && revealCards.length > 1 && roundNumber !== 3 && <button className="swipe-ready__fallback" type="button" onClick={() => hidePrivateReveal()}>كمّل من غير معاينة الباقي</button>}
          <p className="privacy-note">تأكد إن محدش جنبك شايف شاشتك.</p>
        </Modal>
      )}

      {isActor && phase === 'effect_choice' && !pendingConfirmation && (
        <Modal title="اختيار خاصية" className="modal-card--wide">
          <p className="modal-lead">{safeGameMessage(roundNumber, phase, game.message)}</p>
          <div className="choice-grid">
            {game.pending_action === 'king_choice' && [['take_give', 'خد وهات'], ['basra', 'بصرة'], ['take_only', 'خد بس'], ['khshaf', 'الخشاف']].map(([id, label]) => <button className="choice-tile" type="button" key={id} onClick={() => act(() => game.choose_effect_option(id))}><span>✦</span><b>{label}</b></button>)}
            {game.pending_action === 'mesaharati_choice' && <>
              <button className="choice-tile choice-tile--danger" type="button" onClick={() => setPendingConfirmation('end-round')}><span>◈</span><b>أنهِ الجولة الآن</b><small>تكشف الأيدي وتُحسب النقاط</small></button>
              <button className="choice-tile" type="button" onClick={() => act(() => game.choose_effect_option('keep'))}><span>◇</span><b>احتفظ بالمسحراتي</b><small>ارمِ كارتاً من يدك مكانه</small></button>
            </>}
            {game.pending_action === 'kaab_mode' && <>
              <button className="choice-tile" type="button" onClick={() => act(() => game.choose_effect_option('own_two'))}><span>◉</span><b>عاين كارتين من عندك</b></button>
              <button className="choice-tile" type="button" onClick={() => act(() => game.choose_effect_option('one_each'))}><span>◎</span><b>كارت من كل لاعب</b></button>
            </>}
          </div>
        </Modal>
      )}

      {isActor && phase === 'look_swap_decision' && game.look_swap_seen_card && (
        <Modal title="شوف وبدّل">
          <p className="modal-lead">{roundNumber === 3 ? 'الكارت المختار من الخصم ظاهر لك لحد ما تختار؛ كروتك أنت تفضل مخفية.' : 'الكارت اللي عاينته هيفضل ظاهر لحد ما تختار تاخده أو تبدّله.'}</p>
          <div className="reveal-card-stage"><Card id={game.look_swap_seen_card.id} definitionId={cardInfo(game.look_swap_seen_card).definitionId} name={cardInfo(game.look_swap_seen_card).name} hidden={roundNumber === 3 && game.look_swap_first_target === game.turn_index} interactive className="reveal-card" /></div>
          <div className="choice-grid choice-grid--two">
            <button className="choice-tile" type="button" onClick={() => act(() => game.choose_effect_option('take'))}><span>⇄</span><b>خده بكارت من عندك</b></button>
            <button className="choice-tile" type="button" onClick={() => act(() => game.choose_effect_option('exchange'))}><span>⇆</span><b>بدّله مع لاعب تاني</b></button>
          </div>
        </Modal>
      )}

      {isActor && phase === 'khshaf_choice' && (
        <Modal title="الخَشّاف" className="modal-card--wide">
          <p className="modal-lead">{roundNumber === 3 ? 'اختار كارتاً مقفولاً عشوائياً. الباقي بيرجع كومة السحب.' : 'اختار أحسن كارت ليك. التلاتة الباقيين هيرجعوا كومة السحب.'}</p>
          <div className="khshaf-options">
            {game.khshaf_options.map((card, index) => { const info = cardInfo(card); return <Card key={card.id} id={card.id} definitionId={info.definitionId} name={info.name} hidden={roundNumber === 3} selectable onClick={() => act(() => game.choose_khshaf_card(index))} className="reveal-card" />; })}
          </div>
        </Modal>
      )}

      {phase === 'result' && roundNumber === 4 && <div className="confetti" aria-hidden="true">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 0.13}s`, backgroundColor: ['#e8c078', '#a94648', '#f5e6c5', '#74966b'][i % 4] }} />)}</div>}
      {phase === 'result' && !pendingConfirmation && (
        <Modal title="نتيجة الجولة" className="modal-card--wide result-modal">
          <p className="modal-lead">{game.message}</p>
          <div className="score-list">
            {(game.result?.rows ?? []).map((row) => (
              <div className={`score-row ${(game.result?.winners ?? []).includes(row.name) ? 'score-row--winner' : ''}`} key={row.id} style={{ animationDelay: `${(game.result?.rows ?? []).indexOf(row) * 70}ms` }}>
                <div className="score-row__identity"><span className="score-row__medal">{(game.result?.winners ?? []).includes(row.name) ? '✦' : initials(row.name)}</span><div><b>{row.name}</b><small>{row.base === game.result?.lowest_base ? 'أقل مجموع · صفر نقطة' : row.doubled ? (roundNumber === 4 ? 'جولة الدابل' : 'عقوبة سكرو ×4') : 'إجمالي الكروت'}</small></div></div>
                <div className="score-row__hand">{row.hand.map((card) => <span className="score-mini" key={card.id}><img src={assetUrl(`assets/cards/${card.definition_id}.webp`)} alt="" /></span>)}</div>
                <strong className="score-row__score">{row.score}<small>نقطة</small></strong>
              </div>
            ))}
          </div>
          {roundNumber === 4 && <section className="series-result" aria-label="النتيجة النهائية بعد أربع جولات"><h3>الترتيب النهائي · مجموع الأربع جولات</h3>{Object.entries(game.series_totals).sort((a, b) => a[1] - b[1]).map(([id, total]) => { const player = players.find((entry) => entry.id === id); const minimum = Math.min(...Object.values(game.series_totals)); return <div className={`series-result__row ${total === minimum ? 'series-result__row--winner' : ''}`} key={id}><b>{player?.name ?? id}{total === minimum ? ' · الفائز' : ''}</b><strong>{total} نقطة</strong></div>; })}</section>}
          {canControl
            ? (roundNumber < 4 ? <button className="button button--gold button--wide" type="button" onClick={onNextRound}>ابدأ الجولة {roundNumber + 1} من 4 <span className="button-arrow">←</span></button> : <button className="button button--gold button--wide" type="button" onClick={() => setPendingConfirmation('new-series')}>ابدأ لعبة جديدة</button>)
            : <p className="result-wait"><span className="pulse-dot" /> مستنيين المضيف يبدأ {roundNumber < 4 ? 'الجولة الجاية' : 'لعبة جديدة'}…</p>}
        </Modal>
      )}

      {menuOpen && !pendingConfirmation && (
        <Modal title="القائمة" onClose={() => setMenuOpen(false)}>
          <p className="modal-lead">غرفة <b dir="ltr">{snapshot.code}</b> · {players.length} لاعبين</p>
          <div className="choice-grid choice-grid--two">
            <button className="choice-tile" type="button" onClick={() => { void copyInvite(); setMenuOpen(false); }}><span>✦</span><b>ابعت الدعوة</b></button>
            <button className="choice-tile choice-tile--danger" type="button" onClick={() => setPendingConfirmation('leave')}><span>←</span><b>اخرج من الغرفة</b></button>
            {canControl && <button className="choice-tile choice-tile--danger" type="button" onClick={() => setPendingConfirmation('end-session')}><span>◈</span><b>ارجعوا لغرفة الانتظار</b></button>}
          </div>
        </Modal>
      )}

      {pendingConfirmation && (
        <Modal title={pendingConfirmation === 'end-round' ? 'تأكيد إنهاء الجولة' : pendingConfirmation === 'new-series' ? 'تأكيد بدء لعبة جديدة' : pendingConfirmation === 'leave' ? 'تأكيد الخروج من الغرفة' : 'تأكيد إنهاء الجلسة'} onClose={() => setPendingConfirmation(null)}>
          <p className="modal-lead">{confirmationText}</p>
          <div className="choice-grid choice-grid--two">
            <button className="choice-tile choice-tile--danger" type="button" onClick={acceptConfirmation}><span>!</span><b>نعم، أكّد</b></button>
            <button className="choice-tile" type="button" onClick={() => setPendingConfirmation(null)}><span>←</span><b>رجوع للعب</b></button>
          </div>
        </Modal>
      )}
    </div>
  );
}
