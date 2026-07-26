import { useEffect, useRef, useState } from 'react';
import { useChat, useSocial, useWorld } from '../state/stores';
import { hot } from '../state/hot';
import { connection } from '../net/connection';
import { CHAT_MAX_LEN } from '@nexuspark/shared';

export default function ChatPanel() {
  const allMessages = useChat((s) => s.messages);
  const blocked = useSocial((s) => s.blocked);
  const roster = useWorld((s) => s.roster);
  // 屏蔽者的发言不显示(按 userId;发言者已离场则无法映射,照常显示)
  const messages = allMessages.filter((m) => {
    if (m.system) return true;
    const uid = roster.find((p) => p.id === m.fromId)?.userId;
    return uid === undefined || !blocked.includes(uid);
  });
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !hot.chatFocused && !hot.uiOpen) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = () => {
    const t = text.trim();
    if (t) connection.send('chat', { text: t });
    setText('');
    inputRef.current?.blur();
  };

  return (
    <div className={`chat ${focused ? '' : 'faded'}`}>
      <div ref={logRef} className="chat-log panel">
        {messages.map((m, i) => (
          <div key={i} className={`chat-line ${m.system ? 'sys' : ''}`}>
            {m.system ? (
              <span>· {m.text}</span>
            ) : (
              <>
                <span className="who">{m.from}: </span>
                <span>{m.text}</span>
              </>
            )}
          </div>
        ))}
        {messages.length === 0 && <div className="chat-line sys">按回车打个招呼吧~</div>}
      </div>
      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="input"
          placeholder="按回车聊天…"
          value={text}
          maxLength={CHAT_MAX_LEN}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => { setFocused(true); hot.chatFocused = true; }}
          onBlur={() => { setFocused(false); hot.chatFocused = false; }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') send();
            if (e.key === 'Escape') inputRef.current?.blur();
          }}
        />
      </div>
    </div>
  );
}
