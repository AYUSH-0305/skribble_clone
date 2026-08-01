import { useState } from 'react';
import type { RoomSettings } from '../types/events';
import { DEFAULT_SETTINGS } from '../types/events';

interface Props {
  onCreate: (name: string, settings: Partial<RoomSettings>, isPrivate: boolean) => void;
  onJoin: (roomId: string, name: string) => void;
  prefillRoom?: string;
}

export function Home({ onCreate, onJoin, prefillRoom }: Props) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(prefillRoom ?? '');
  const [settings, setSettings] = useState<RoomSettings>({ ...DEFAULT_SETTINGS });
  const [mode, setMode] = useState<'home' | 'create'>('home');

  const set = <K extends keyof RoomSettings>(k: K, v: RoomSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  const logo = (
    <h1 className="logo">
      <span>skribbl</span>
      <em>clone</em>
    </h1>
  );

  // ---- Create-room configuration (separate card) ----
  if (mode === 'create') {
    return (
      <div className="home">
        {logo}
        <div className="card create-card">
          <div className="card-head">
            <h2>Create private room</h2>
            <button className="ghost" onClick={() => setMode('home')}>
              ← Back
            </button>
          </div>

          <label className="field">
            <span>Your name</span>
            <input
              autoFocus
              value={name}
              maxLength={20}
              placeholder="Enter a nickname"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className="settings">
            <Range label="Rounds" min={2} max={10} value={settings.rounds} onChange={(v) => set('rounds', v)} />
            <Range label="Draw time (s)" min={15} max={240} step={5} value={settings.drawTime} onChange={(v) => set('drawTime', v)} />
            <Range label="Max players" min={2} max={20} value={settings.maxPlayers} onChange={(v) => set('maxPlayers', v)} />
            <Range label="Word choices" min={1} max={5} value={settings.wordCount} onChange={(v) => set('wordCount', v)} />
            <Range label="Hints" min={0} max={5} value={settings.hints} onChange={(v) => set('hints', v)} />
          </div>

          <button className="primary" onClick={() => onCreate(name, settings, true)}>
            Create room
          </button>
        </div>
      </div>
    );
  }

  // ---- Landing: join an existing room, or start the create flow ----
  const canJoin = name.trim().length > 0 && roomId.trim().length >= 4;
  return (
    <div className="home">
      {logo}
      <div className="card">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={20}
            placeholder="Enter a nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="join-row">
          <input
            value={roomId}
            placeholder="Room code"
            maxLength={4}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
          />
          <button disabled={!canJoin} onClick={() => onJoin(roomId, name)}>
            Join
          </button>
        </div>

        <div className="or">or</div>

        <button className="primary" onClick={() => setMode('create')}>
          Create private room
        </button>
      </div>
    </div>
  );
}

function Range({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="range">
      <span>
        {label}: <strong>{value}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
