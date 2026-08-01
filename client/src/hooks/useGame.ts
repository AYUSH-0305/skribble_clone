import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
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
  error: string | null;

  createRoom: (name: string, settings: Partial<RoomSettings>, isPrivate: boolean) => void;
  joinRoom: (roomId: string, name: string) => void;
  leaveRoom: () => void;
  startGame: () => void;
  chooseWord: (word: string) => void;
  sendGuess: (text: string) => void;
  sendChat: (text: string) => void;
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
  const [error, setError] = useState<string | null>(null);

  const youIdRef = useRef<string | null>(null);

  const pushMsg = useCallback((entry: Omit<ChatEntry, 'id'>) => {
    setMessages((prev) => [...prev.slice(-199), { ...entry, id: msgSeq++ }]);
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
    };

    const onRoundEnd = (d: RoundEndInfo & { drawerId: string }) => {
      setRoundEnd({ word: d.word, scores: d.scores, reason: d.reason });
      pushMsg({ kind: 'system', text: `The word was "${d.word}"` });
    };

    const onGameOver = (d: { winner: PlayerView | null; leaderboard: PlayerView[] }) => {
      setGameOver(d);
    };

    const onGuessResult = (d: {
      playerName: string;
      correct: boolean;
      points?: number;
    }) => {
      if (d.correct) {
        pushMsg({ kind: 'correct', text: `${d.playerName} guessed the word! (+${d.points})` });
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
    };
  }, [pushMsg]);

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
    youIdRef.current = null;
    setYou(null);
    setRoomId(null);
    setState(null);
    setMessages([]);
    setWordOptions(null);
    setMyWord(null);
    setRoundEnd(null);
    setGameOver(null);
    // Clear ?room= so a leave doesn't leave a stale invite code in the URL.
    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const startGame = useCallback(() => socket.emit('start_game'), []);
  const chooseWord = useCallback((word: string) => socket.emit('word_chosen', { word }), []);
  const sendGuess = useCallback((text: string) => socket.emit('guess', { text }), []);
  const sendChat = useCallback((text: string) => socket.emit('chat', { text }), []);

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
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    chooseWord,
    sendGuess,
    sendChat,
  };
}
