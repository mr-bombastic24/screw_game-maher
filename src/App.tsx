import { useMemo } from 'react';
import GameScreen from './GameScreen';
import { RemoteGame } from './online/RemoteGame';
import { useRoom } from './online/useRoom';
import { LobbyScreen, MenuScreen } from './online/Lobby';

export default function App() {
  const room = useRoom();
  const { snapshot, session } = room;
  const game = useMemo(() => (snapshot?.game ? new RemoteGame(snapshot.game, (type, args) => room.send(type, args)) : null), [snapshot?.game, room.send]);

  if (!session || !snapshot) {
    if (session && !room.error) return <div className="app-root"><main className="setup-page"><div className="setup-card"><p className="lobby-wait"><span className="pulse-dot" /> بندخل الغرفة…</p></div></main></div>;
    return <div className="app-root"><MenuScreen onCreate={(name) => void room.create(name)} onJoin={(code, name) => void room.join(code, name)} busy={room.busy} error={room.error} /></div>;
  }
  if (snapshot.status === 'lobby' || !game) {
    return <div className="app-root"><LobbyScreen snapshot={snapshot} connected={room.connected} error={room.error} onStart={() => room.send('start')} onLeave={room.leave} /></div>;
  }
  return <GameScreen game={game} snapshot={snapshot} clockOffset={room.clockOffset} connected={room.connected} onNextRound={() => room.send('next_round')} onToLobby={() => room.send('to_lobby')} onLeave={room.leave} />;
}
