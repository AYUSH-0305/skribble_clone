import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { sfxCorrect, sfxGameOver, sfxRoundStart } from '../audio';
import type { GameStateView, PlayerView, RoomSettings, ScoreDelta } from '../types/events';

export interface ChatEntry {
  id: number;
  kind: 'chat' | 'system' | 'correct' | 'info' | 'join' | 'leave';
  name?: string;
  text: string;
}

export interface RoundEndInfo {
  word: string;
  scores: ScoreDelta[];
  reason: string;
}

export interface GameApi {
  connected: boolean;
  you: PlayerView | null;
  roomId: string | null;
  state: GameStateView | null;
  messages: ChatEntry[];
  // Drawer-only:
  wordOptions: string[] | null;
  myWord: string | null; // the plaintext word, only ever set for the drawer
  roundEnd: RoundEndInfo | null;
  gameOver: { winner: PlayerView | null; leaderboard: PlayerView[] } | null;
  reactions: { likes: number; dislikes: number };
  error: string | null;

  createRoom: (name: string, settings: Partial<RoomSettings>, isPrivate: boolean) => void;
  joinRoom: (roomId: string, name: string) => void;
  leaveRoom: () => void;
  startGame: () => void;
  chooseWord: (word: string) => void;
  sendGuess: (text: string) => void;
  sendChat: (text: string) => void;
  react: (type: 'like' | 'dislike') => void;
  votekick: (targetId: string) => void;
}

let msgSeq = 0;

export function useGame(): GameApi {
  const [connected, setConnected] = useState(socket.connected);
  const [you, setYou] = useState<PlayerView | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [state, setState] = useState<GameStateView | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [wordOptions, setWordOptions] = useState<string[] | null>(null);
  const [myWord, setMyWord] = useState<string | null>(null);
  const [roundEnd, setRoundEnd] = useState<RoundEndInfo | null>(null);
  const [gameOver, setGameOver] =
    useState<{ winner: PlayerView | null; leaderboard: PlayerView[] } | null>(null);
  const [reactions, setReactions] = useState<{ likes: number; dislikes: number }>({
    likes: 0,
    dislikes: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const youIdRef = useRef<string | null>(null);

  const pushMsg = useCallback((entry: Omit<ChatEntry, 'id'>) => {
    setMessages((prev) => [...prev.slice(-199), { ...entry, id: msgSeq++ }]);
  }, []);

  const resetToHome = useCallback(() => {
    youIdRef.current = null;
    setYou(null);
    setRoomId(null);
    setState(null);
    setMessages([]);
    setWordOptions(null);
    setMyWord(null);
    setRoundEnd(null);
    setGameOver(null);
    // Drop any ?room= so a stale invite code doesn't linger in the URL.
    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onPlayerJoined = ({ player, players }: { player: PlayerView; players: PlayerView[] }) => {
      setState((s) => (s ? { ...s, players } : s));
      if (player.id !== youIdRef.current) {
        pushMsg({ kind: 'join', text: `${player.name} joined` });
      }
    };

    const onPlayerLeft = ({ players }: { players: PlayerView[] }) => {
      setState((s) => (s ? { ...s, players } : s));
    };

    const onGameState = (next: GameStateView) => {
      setState(next);
      // Leaving the drawing phase clears any drawer-only word info.
      if (next.phase !== 'drawing' && next.phase !== 'choosing') {
        setWordOptions(null);
      }
      if (next.phase === 'choosing' || next.phase === 'lobby') {
        setMyWord(null);
      }
      if (next.phase !== 'roundEnd') setRoundEnd(null);
      if (next.phase !== 'gameOver') setGameOver(null);
    };

    const onWordOptions = ({ options }: { options: string[] }) => setWordOptions(options);
    const onWordReveal = ({ word }: { word: string }) => {
      setMyWord(word);
      setWordOptions(null);
    };

    const onRoundStart = ({ drawerName }: { drawerName: string }) => {
      pushMsg({ kind: 'system', text: `${drawerName} is choosing a word...` });
      sfxRoundStart();
    };

    const onRoundEnd = (d: RoundEndInfo & { drawerId: string }) => {
      setRoundEnd({ word: d.word, scores: d.scores, reason: d.reason });
      pushMsg({ kind: 'system', text: `The word was "${d.word}"` });
    };

    const onGameOver = (d: { winner: PlayerView | null; leaderboard: PlayerView[] }) => {
      setGameOver(d);
      sfxGameOver();
    };

    const onGuessResult = (d: {
      playerName: string;
      correct: boolean;
      points?: number;
    }) => {
      if (d.correct) {
        pushMsg({ kind: 'correct', text: `${d.playerName} guessed the word! (+${d.points})` });
        sfxCorrect();
      }
    };

    const onChatMessage = (d: { playerName: string; text: string }) => {
      pushMsg({ kind: 'chat', name: d.playerName, text: d.text });
    };

    const onSystemMessage = (d: { text: string; kind?: ChatEntry['kind'] }) => {
      pushMsg({ kind: d.kind ?? 'system', text: d.text });
    };

    const onError = (d: { message: string }) => {
      setError(d.message);
      setTimeout(() => setError(null), 4000);
    };

    // Reconnection: the server re-attached this socket to its previous room.
    const onResumed = (d: { you: PlayerView; roomId: string; state: GameStateView }) => {
      youIdRef.current = d.you.id;
      setYou(d.you);
      setRoomId(d.roomId);
      setState(d.state);
    };

    // Reconnection: nothing to restore. Only act if we *thought* we were in a
    // room (e.g. reloaded after the grace window lapsed) — drop back to Home.
    const onResumeFailed = () => {
      if (youIdRef.current) {
        resetToHome();
        setError('Your session expired — please rejoin.');
        setTimeout(() => setError(null), 4000);
      }
    };

    const onRoomClosed = () => {
      resetToHome();
      setError('The host closed the room.');
      setTimeout(() => setError(null), 4000);
    };

    const onKicked = () => {
      resetToHome();
      setError('You were kicked from the room.');
      setTimeout(() => setError(null), 4000);
    };

    const onReactions = (d: { likes: number; dislikes: number }) => setReactions(d);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('player_joined', onPlayerJoined);
    socket.on('player_left', onPlayerLeft);
    socket.on('game_state', onGameState);
    socket.on('word_options', onWordOptions);
    socket.on('word_reveal', onWordReveal);
    socket.on('round_start', onRoundStart);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);
    socket.on('guess_result', onGuessResult);
    socket.on('chat_message', onChatMessage);
    socket.on('system_message', onSystemMessage);
    socket.on('error_message', onError);
    socket.on('resumed', onResumed);
    socket.on('resume_failed', onResumeFailed);
    socket.on('room_closed', onRoomClosed);
    socket.on('kicked', onKicked);
    socket.on('reactions', onReactions);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('player_joined', onPlayerJoined);
      socket.off('player_left', onPlayerLeft);
      socket.off('game_state', onGameState);
      socket.off('word_options', onWordOptions);
      socket.off('word_reveal', onWordReveal);
      socket.off('round_start', onRoundStart);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
      socket.off('guess_result', onGuessResult);
      socket.off('chat_message', onChatMessage);
      socket.off('system_message', onSystemMessage);
      socket.off('error_message', onError);
      socket.off('resumed', onResumed);
      socket.off('resume_failed', onResumeFailed);
      socket.off('room_closed', onRoomClosed);
      socket.off('kicked', onKicked);
      socket.off('reactions', onReactions);
    };
  }, [pushMsg, resetToHome]);

  const createRoom = useCallback(
    (name: string, settings: Partial<RoomSettings>, isPrivate: boolean) => {
      socket.emit('create_room', { hostName: name, settings, isPrivate }, (res) => {
        if (res.ok && res.roomId && res.you) {
          youIdRef.current = res.you.id;
          setYou(res.you);
          setRoomId(res.roomId);
        } else {
          setError(res.error ?? 'Could not create room');
        }
      });
    },
    []
  );

  const joinRoom = useCallback((room: string, name: string) => {
    socket.emit('join_room', { roomId: room, playerName: name }, (res) => {
      if (res.ok && res.you) {
        youIdRef.current = res.you.id;
        setYou(res.you);
        setRoomId(room.toUpperCase());
        if (res.state) setState(res.state);
      } else {
        setError(res.error ?? 'Could not join room');
      }
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socket.emit('leave_room');
    resetToHome();
  }, [resetToHome]);

  const startGame = useCallback(() => socket.emit('start_game'), []);
  const chooseWord = useCallback((word: string) => socket.emit('word_chosen', { word }), []);
  const sendGuess = useCallback((text: string) => socket.emit('guess', { text }), []);
  const sendChat = useCallback((text: string) => socket.emit('chat', { text }), []);
  const react = useCallback((type: 'like' | 'dislike') => socket.emit('react', { type }), []);
  const votekick = useCallback((targetId: string) => socket.emit('votekick', { targetId }), []);

  return {
    connected,
    you,
    roomId,
    state,
    messages,
    wordOptions,
    myWord,
    roundEnd,
    gameOver,
    reactions,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    chooseWord,
    sendGuess,
    sendChat,
    react,
    votekick,
  };
}
