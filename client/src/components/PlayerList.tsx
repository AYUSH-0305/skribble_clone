import { Crown, Pencil, Check, UserX } from 'lucide-react';
import type { PlayerView } from '../types/events';

interface Props {
  players: PlayerView[];
  drawerId?: string | null;
  youId?: string | null;
  onVotekick?: (targetId: string) => void;
}

export function PlayerList({ players, drawerId, youId, onVotekick }: Props) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  // The leader is the top scorer — but only once someone is actually ahead.
  const leaderId = ranked.length && ranked[0].score > 0 && ranked[0].score > (ranked[1]?.score ?? 0)
    ? ranked[0].id
    : null;
  return (
    <ul className="player-list">
      {ranked.map((p, i) => (
        <li
          key={p.id}
          className={[
            p.id === drawerId ? 'drawing' : p.hasGuessedThisRound ? 'guessed' : '',
            p.connected ? '' : 'offline',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="rank">#{i + 1}</span>
          <span className="pname">
            {p.id === leaderId && (
              <Crown size={15} strokeWidth={2.5} className="leader-crown" aria-label="Leader" />
            )}
            <span className="pname-text">
              {p.name}
              {p.id === youId && ' (you)'}
            </span>
            {!p.connected && <span className="badge off">reconnecting…</span>}
            {p.isHost && <span className="badge host">HOST</span>}
            {p.id === drawerId && (
              <span className="badge pen" title="Drawing">
                <Pencil size={13} strokeWidth={2.5} />
              </span>
            )}
            {p.hasGuessedThisRound && p.id !== drawerId && (
              <span className="badge ok" title="Guessed it">
                <Check size={13} strokeWidth={3} />
              </span>
            )}
          </span>
          <span className="score">{p.score}</span>
          {onVotekick && p.id !== youId && !p.isHost && (
            <button
              className="kick-btn"
              onClick={() => onVotekick(p.id)}
              title={`Vote to kick ${p.name}`}
              aria-label={`Vote to kick ${p.name}`}
            >
              <UserX size={14} strokeWidth={2.5} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
