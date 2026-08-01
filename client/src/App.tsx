import { useGame } from './hooks/useGame';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';

export default function App() {
  const api = useGame();
  const prefillRoom = new URLSearchParams(window.location.search).get('room') ?? undefined;

  const inRoom = api.roomId && api.state;

  return (
    <div className="app">
      {!api.connected && <div className="conn-banner">Connecting…</div>}
      {api.error && <div className="toast error">{api.error}</div>}

      {!inRoom && (
        <Home onCreate={api.createRoom} onJoin={api.joinRoom} prefillRoom={prefillRoom} />
      )}

      {inRoom && api.state!.phase === 'lobby' && (
        <Lobby
          roomId={api.roomId!}
          state={api.state!}
          you={api.you}
          onStart={api.startGame}
          onLeave={api.leaveRoom}
        />
      )}

      {inRoom && api.state!.phase !== 'lobby' && <GameScreen api={api} />}
    </div>
  );
}
