import { useEffect, useRef, useState } from 'react';
import type { ChatEntry } from '../hooks/useGame';

interface Props {
  messages: ChatEntry[];
  canGuess: boolean; // false for the drawer / already-guessed
  placeholder: string;
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, canGuess, placeholder, onSend }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.kind}`}>
            {m.name ? <b>{m.name}: </b> : null}
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          maxLength={120}
          disabled={!canGuess}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!canGuess}>
          Send
        </button>
      </form>
    </div>
  );
}
