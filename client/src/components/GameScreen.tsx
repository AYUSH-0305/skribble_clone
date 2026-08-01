import { useEffect, useMemo, useState } from 'react';
import { socket } from '../socket';
import type { DrawTool, PlayerView } from '../types/events';
import type { GameApi } from '../hooks/useGame';
import { CanvasBoard } from './CanvasBoard';
import { Toolbar } from './Toolbar';
import { PlayerList } from './PlayerList';
import { ChatPanel } from './ChatPanel';
import { WordPicker } from './WordPicker';

interface Props {
  api: GameApi;
}

export function GameScreen({ api }: Props) {
  const { state, you, myWord, wordOptions, roundEnd, gameOver, messages } = api;
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(0.015);
  const [tool, setTool] = useState<DrawTool>('pen');

  const secondsLeft = useCountdown(state?.roundEndsAt ?? null);

  if (!state) return null;
  const isDrawer = state.drawerId === you?.id;
  const me = state.players.find((p) => p.id === you?.id);
  const youGuessed = !!me?.hasGuessedThisRound;
  const isGuessing = state.phase === 'drawing' && !isDrawer && !youGuessed;

  const onSend = (text: string) => (isGuessing ? api.sendGuess(text) : api.sendChat(text));

  return (
    <div className="game">
      <header className="game-top">
        <div className="round">
          Round <strong>{state.round}</strong>/{state.totalRounds}
        </div>
        <div className="timer" data-low={secondsLeft <= 10}>
          ⏱ {state.phase === 'drawing' ? secondsLeft : '--'}
        </div>
        <div className="word-display">
          {isDrawer && myWord ? (
            <span className="word">{myWord}</span>
          ) : (
            <span className="mask">{state.mask ?? ''}</span>
          )}
          {state.wordLength ? <span className="len">{state.wordLength}</span> : null}
        </div>
      </header>

      <div className="game-body">
        <aside className="left card">
          <PlayerList players={state.players} drawerId={state.drawerId} youId={you?.id} />
        </aside>

        <main className="center">
          <div className="board-area">
            <CanvasBoard isDrawer={isDrawer && state.phase === 'drawing'} color={color} size={size} tool={tool} />

            {state.phase === 'choosing' && !isDrawer && (
              <div className="overlay soft">
                <p>
                  <strong>{state.drawerName}</strong> is choosing a word…
                </p>
              </div>
            )}
            {state.phase === 'choosing' && isDrawer && wordOptions && (
              <WordPicker options={wordOptions} onPick={api.chooseWord} />
            )}
            {roundEnd && <RoundEndCard word={roundEnd.word} scores={roundEnd.scores} />}
            {gameOver && (
              <GameOverCard
                winner={gameOver.winner}
                leaderboard={gameOver.leaderboard}
                isHost={!!you?.isHost}
                onPlayAgain={api.startGame}
              />
            )}
          </div>

          {isDrawer && state.phase === 'drawing' && (
            <Toolbar
              color={color}
              size={size}
              tool={tool}
              onColor={setColor}
              onSize={setSize}
              onTool={setTool}
              onUndo={() => socket.emit('draw_undo')}
              onClear={() => socket.emit('canvas_clear')}
            />
          )}
        </main>

        <aside className="right card">
          <ChatPanel
            messages={messages}
            canGuess={true}
            placeholder={isGuessing ? 'Type your guess…' : 'Chat…'}
            onSend={onSend}
          />
        </aside>
      </div>
    </div>
  );
}

function RoundEndCard({ word, scores }: { word: string; scores: { playerName: string; roundPoints: number }[] }) {
  return (
    <div className="overlay">
      <div className="round-end card">
        <h3>
          The word was <span className="reveal">{word}</span>
        </h3>
        <ul className="deltas">
          {scores.map((s, i) => (
            <li key={i}>
              <span>{s.playerName}</span>
              <span className={s.roundPoints > 0 ? 'plus' : 'zero'}>
                {s.roundPoints > 0 ? `+${s.roundPoints}` : '+0'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GameOverCard({
  winner,
  leaderboard,
  isHost,
  onPlayAgain,
}: {
  winner: PlayerView | null;
  leaderboard: PlayerView[];
  isHost: boolean;
  onPlayAgain: () => void;
}) {
  return (
    <div className="overlay">
      <div className="game-over card">
        <h2>🏆 {winner ? `${winner.name} wins!` : 'Game over'}</h2>
        <ol className="leaderboard">
          {leaderboard.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
        {isHost ? (
          <button className="primary" onClick={onPlayAgain}>
            Play again
          </button>
        ) : (
          <p className="muted">Waiting for the host…</p>
        )}
      </div>
    </div>
  );
}

/** Live seconds-remaining derived from the server's authoritative roundEndsAt. */
function useCountdown(endsAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (endsAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return useMemo(() => {
    if (endsAt == null) return 0;
    return Math.max(0, Math.ceil((endsAt - now) / 1000));
  }, [endsAt, now]);
}
