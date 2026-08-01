import { useEffect, useMemo, useState } from 'react';
import {
  LogOut,
  Timer as TimerIcon,
  Trophy,
  Crown,
  Medal,
  Volume2,
  VolumeX,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { socket } from '../socket';
import { startMusic, stopMusic, sfxTick, isMuted, setMuted } from '../audio';
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
  const { state, you, myWord, wordOptions, roundEnd, gameOver, messages, reactions } = api;
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(0.015);
  const [tool, setTool] = useState<DrawTool>('pen');

  const [muted, setMutedState] = useState(isMuted());
  const secondsLeft = useCountdown(state?.roundEndsAt ?? null);
  const phase = state?.phase;

  // Background music plays while the game screen is mounted.
  useEffect(() => {
    startMusic();
    return () => stopMusic();
  }, []);

  // Tick in the final seconds of a drawing turn.
  useEffect(() => {
    if (phase === 'drawing' && secondsLeft > 0 && secondsLeft <= 5) sfxTick();
  }, [secondsLeft, phase]);

  if (!state) return null;
  const isDrawer = state.drawerId === you?.id;
  const me = state.players.find((p) => p.id === you?.id);
  const youGuessed = !!me?.hasGuessedThisRound;
  const isGuessing = state.phase === 'drawing' && !isDrawer && !youGuessed;

  const onSend = (text: string) => (isGuessing ? api.sendGuess(text) : api.sendChat(text));
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  return (
    <div className="game">
      <header className="game-top">
        <button className="ghost leave-btn" onClick={api.leaveRoom} title="Leave room">
          <LogOut size={16} strokeWidth={2.5} /> Leave
        </button>
        <div className="round">
          Round <strong>{state.round}</strong>/{state.totalRounds}
        </div>
        <div className="timer" data-low={secondsLeft <= 10}>
          <TimerIcon size={17} strokeWidth={2.5} />
          {state.phase === 'drawing' ? secondsLeft : '--'}
        </div>
        <div className="word-display">
          {isDrawer && myWord ? (
            <span className="word">{myWord}</span>
          ) : (
            <span className="mask">{state.mask ?? ''}</span>
          )}
          {state.wordLength ? <span className="len">{state.wordLength}</span> : null}
        </div>
        <button
          className="ghost icon-btn"
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={18} strokeWidth={2.5} /> : <Volume2 size={18} strokeWidth={2.5} />}
        </button>
      </header>

      <div className="game-body">
        <aside className="left card">
          <PlayerList
            players={state.players}
            drawerId={state.drawerId}
            youId={you?.id}
            onVotekick={api.votekick}
          />
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
                onLeave={api.leaveRoom}
              />
            )}
          </div>

          {state.phase === 'drawing' && (
            <div className="reactions-bar">
              <button
                className="react-btn like"
                disabled={isDrawer}
                onClick={() => api.react('like')}
                title="Like the drawing"
              >
                <ThumbsUp size={17} strokeWidth={2.5} /> {reactions.likes}
              </button>
              <button
                className="react-btn dislike"
                disabled={isDrawer}
                onClick={() => api.react('dislike')}
                title="Dislike the drawing"
              >
                <ThumbsDown size={17} strokeWidth={2.5} /> {reactions.dislikes}
              </button>
            </div>
          )}

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
  onLeave,
}: {
  winner: PlayerView | null;
  leaderboard: PlayerView[];
  isHost: boolean;
  onPlayAgain: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="overlay">
      <div className="game-over card">
        <h2>
          <Trophy size={30} strokeWidth={2.5} className="trophy" />
          {winner ? `${winner.name} wins!` : 'Game over'}
        </h2>
        <ol className="leaderboard">
          {leaderboard.map((p, i) => (
            <li key={p.id}>
              <span className="place">
                <RankMark index={i} />
                {p.name}
              </span>
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
        <div className="game-over-actions">
          {isHost ? (
            <button className="primary" onClick={onPlayAgain}>
              Play again
            </button>
          ) : (
            <p className="muted">Waiting for the host…</p>
          )}
          <button className="ghost" onClick={onLeave}>
            Leave room
          </button>
        </div>
      </div>
    </div>
  );
}

/** Podium marker: crown for 1st, medals for 2nd/3rd, a numbered chip otherwise. */
function RankMark({ index }: { index: number }) {
  if (index === 0) return <Crown size={20} strokeWidth={2.5} className="mark gold" />;
  if (index === 1) return <Medal size={19} strokeWidth={2.5} className="mark silver" />;
  if (index === 2) return <Medal size={19} strokeWidth={2.5} className="mark bronze" />;
  return <span className="mark num">{index + 1}</span>;
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
