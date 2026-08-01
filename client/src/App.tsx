import { useEffect } from 'react';
import { initAudio } from './audio';
import { useGame } from './hooks/useGame';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';

export default function App() {
  const api = useGame();

  // Browsers block audio until a user gesture — unlock on the first interaction.
  useEffect(() => {
    const unlock = () => initAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);
  // Pull ?room=CODE from an invite link and normalize it to the room-code format.
  const rawRoom = new URLSearchParams(window.location.search).get('room');
  const prefillRoom = rawRoom
    ? rawRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || undefined
    : undefined;

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
