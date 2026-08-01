import { useState } from 'react';
import type { GameStateView, PlayerView } from '../types/events';
import { PlayerList } from './PlayerList';

interface Props {
  roomId: string;
  state: GameStateView;
  you: PlayerView | null;
  onStart: () => void;
  onLeave: () => void;
}

export function Lobby({ roomId, state, you, onStart, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const isHost = !!you?.isHost;
  const canStart = isHost && state.players.length >= 2;
  const inviteLink = `${window.location.origin}/?room=${roomId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the code is shown anyway */
    }
  };

  const s = state.settings;

  return (
    <div className="lobby">
      <div className="lobby-main card">
        <div className="card-head">
          <h2>Waiting room</h2>
          <button className="ghost" onClick={onLeave}>
            ← Leave
          </button>
        </div>
        <div className="room-code">
          Room code: <strong>{roomId}</strong>
        </div>
        <div className="invite">
          <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy invite link'}</button>
        </div>

        <div className="settings-summary">
          <span>{s.rounds} rounds</span>
          <span>{s.drawTime}s draw time</span>
          <span>{s.wordCount} word choices</span>
          <span>{s.hints} hints</span>
          <span>up to {s.maxPlayers} players</span>
        </div>

        {isHost ? (
          <button className="primary" disabled={!canStart} onClick={onStart}>
            {canStart ? 'Start game' : 'Need at least 2 players'}
          </button>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
      </div>

      <div className="lobby-side card">
        <h3>Players ({state.players.length})</h3>
        <PlayerList players={state.players} youId={you?.id} />
      </div>
    </div>
  );
}
