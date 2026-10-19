import { useEffect, useState } from 'react';
import type { RoomSnapshot } from './protocol';
import { loadName } from './useRoom';
import { assetUrl } from '../game/assets';

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('');
}

function roomLink(code: string) {
  const url = new URL(window.location.href);
  url.search = `?room=${code}`;
  url.hash = '';
  return url.toString();
}

const FAN = ['heavy_transfer', 'cannon', 'king', 'khshaf', 'engineer'];

/** مروحة كروت من اللعبة نفسها (الكروت الخاصة) بتتوزع بأنيميشن. */
function CardFan() {
  return (
    <div className="card-fan" aria-hidden="true">
      {FAN.map((id, i) => (
        <span className={`card-fan__card card-fan__card--${i + 1}`} key={id}>
          <img src={assetUrl(`assets/cards/${id}.webp`)} alt="" draggable={false} />
          <i />
        </span>
      ))}
    </div>
  );
}

export function MenuScreen({ onCreate, onJoin, busy, error }: {
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  busy: boolean;
  error: string;
}) {
  const [name, setName] = useState(() => loadName());
  const [code, setCode] = useState(() => (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase().slice(0, 4));
  const cleanName = name.trim();
  const canCreate = cleanName.length > 0 && !busy;
  const canJoin = cleanName.length > 0 && code.length === 4 && !busy;
  const fromLink = !!new URLSearchParams(window.location.search).get('room');

  return (
    <main className="setup-page">
      <div className="setup-orbit setup-orbit--one" />
      <div className="setup-orbit setup-orbit--two" />
      <div className="setup-card">
        <CardFan />
        <span className="eyebrow">أونلاين مع الأصحاب</span>
        <h1>مين هيحفظ كروته<br /><em>ويقول سكرو الأول؟</em></h1>
        <p className="setup-intro">كل واحد يلعب من موبايله. اعمل غرفة وابعت الكود لصحابك، أو ادخل بكود صاحبك.</p>

        <label className="lobby-label" htmlFor="player-name">اسمك</label>
        <div className="name-field lobby-name">
          <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={20} placeholder="اكتب اسمك" autoComplete="nickname" />
          <span className="name-field__avatar">{initials(name || '؟')}</span>
        </div>

        {!fromLink && (
          <button className="button button--gold button--wide" type="button" disabled={!canCreate} onClick={() => onCreate(cleanName)}>
            <span>اعمل غرفة جديدة</span><span className="button-arrow">←</span>
          </button>
        )}
        {!fromLink && <div className="lobby-divider"><span>أو</span></div>}

        <label className="lobby-label" htmlFor="room-code">كود الغرفة</label>
        <div className="lobby-join-row">
          <input id="room-code" className="lobby-code-input" dir="ltr" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={4} placeholder="ABCD"
            value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            onKeyDown={(event) => { if (event.key === 'Enter' && canJoin) onJoin(code, cleanName); }} />
          <button className={`button ${fromLink ? 'button--gold' : 'button--ghost'}`} type="button" disabled={!canJoin} onClick={() => onJoin(code, cleanName)}>ادخل الغرفة</button>
        </div>
        {fromLink && <button className="swipe-ready__fallback" type="button" onClick={() => { window.history.replaceState(null, '', window.location.pathname); setCode(''); window.location.reload(); }}>أو اعمل غرفة جديدة</button>}

        {error && <p className="lobby-error" role="alert">{error}</p>}
        <div className="setup-footnote"><span className="pulse-dot" /> من ٢ إلى ٨ لاعبين · كل لاعب يشوف كروته بس</div>
      </div>
    </main>
  );
}

export function LobbyScreen({ snapshot, connected, error, onStart, onLeave }: {
  snapshot: RoomSnapshot;
  connected: boolean;
  error: string;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const id = window.setTimeout(() => setCopied(false), 1800); return () => window.clearTimeout(id); }, [copied]);
  const count = snapshot.lobby.length;
  const enough = count >= snapshot.minPlayers;
  const canStart = snapshot.hostCanBeReplaced && enough;
  const link = roomLink(snapshot.code);

  const share = async () => {
    const text = `تعالى نلعب سكرو! كود الغرفة: ${snapshot.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'سكرو', text, url: link }); return; }
    } catch { /* أغلق المستخدم نافذة المشاركة */ return; }
    try { await navigator.clipboard.writeText(`${text}\n${link}`); setCopied(true); } catch { window.prompt('انسخ الرابط وابعته لصحابك:', link); }
  };

  return (
    <main className="setup-page">
      <div className="setup-orbit setup-orbit--one" />
      <div className="setup-orbit setup-orbit--two" />
      <div className="setup-card">
        <CardFan />
        <span className="eyebrow">غرفة الانتظار</span>
        <div className="lobby-code" dir="ltr" aria-label={`كود الغرفة ${snapshot.code.split('').join(' ')}`}>{snapshot.code}</div>
        <button className="button button--ghost button--wide lobby-share" type="button" onClick={share}>{copied ? 'اتنسخ الرابط ✓' : 'ابعت الدعوة لصحابك'}</button>

        <div className="setup-section-title"><span>اللاعبين</span><b className="lobby-count">{count} / {snapshot.maxPlayers}</b></div>
        <div className="name-list name-list--single">
          {snapshot.lobby.map((player, index) => (
            <div className="name-field lobby-player" key={`${player.name}-${index}`}>
              <span className="name-field__index">{String(index + 1).padStart(2, '0')}</span>
              <span className="lobby-player__name">{player.name}{player.isMe ? ' (أنت)' : ''}{player.isHost ? ' 👑' : ''}</span>
              <span className={`lobby-dot ${player.connected ? 'lobby-dot--on' : ''}`} aria-label={player.connected ? 'متصل' : 'غير متصل'} />
              <span className="name-field__avatar">{initials(player.name)}</span>
            </div>
          ))}
        </div>

        {snapshot.isHost || snapshot.hostCanBeReplaced ? (
          <button className="button button--gold button--wide lobby-start" type="button" disabled={!canStart} onClick={onStart}>
            <span>{enough ? 'ابدأ اللعبة' : `محتاجين ${snapshot.minPlayers - count} لاعب كمان`}</span>{enough && <span className="button-arrow">←</span>}
          </button>
        ) : (
          <p className="lobby-wait"><span className="pulse-dot" /> مستنيين المضيف يبدأ اللعبة…</p>
        )}
        <button className="swipe-ready__fallback" type="button" onClick={onLeave}>خروج من الغرفة</button>
        {!connected && <p className="lobby-error" role="status">بنعيد الاتصال…</p>}
        {error && <p className="lobby-error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
