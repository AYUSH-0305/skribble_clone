import { Crown, Pencil, Check } from 'lucide-react';
import type { PlayerView } from '../types/events';

interface Props {
  players: PlayerView[];
  drawerId?: string | null;
  youId?: string | null;
}

export function PlayerList({ players, drawerId, youId }: Props) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
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
            {p.name}
            {p.id === youId && ' (you)'}
            {!p.connected && <span className="badge off">reconnecting…</span>}
            {p.isHost && (
              <span className="badge host" title="Host">
                <Crown size={13} strokeWidth={2.5} />
              </span>
            )}
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
        </li>
      ))}
    </ul>
  );
}
