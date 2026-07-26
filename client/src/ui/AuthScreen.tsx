import { useState } from 'react';
import { api } from '../net/api';
import { useSession } from '../state/stores';
import { connection } from '../net/connection';
import { audio } from '../audio/engine';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = (token: string) => {
    audio.ensure(); // unlock audio inside the click gesture
    const s = useSession.getState();
    s.setToken(token);
    s.setPhase('connecting');
    connection.start();
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const res = await fn(username.trim(), password);
      enter(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : '出了点小问题。');
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.guest();
      enter(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : '出了点小问题。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="panel auth-card">
        <div className="auth-logo">团子<em>广场</em></div>
        <div className="auth-sub">
          一个持久存在的多人 3D 小世界:逛广场、在电影院一起看片、装扮自己的小屋、
          打麻将下象棋,和朋友们一起蹦蹦跳跳。
        </div>
        <div className="auth-tabs">
          <button className={`btn ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>登录</button>
          <button className={`btn ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>注册</button>
        </div>
        <input
          className="input"
          placeholder="用户名"
          value={username}
          autoFocus
          maxLength={20}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          className="input"
          placeholder={mode === 'register' ? '密码(至少 8 位)' : '密码'}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <div className="auth-error">{error}</div>
        <button className="btn primary" disabled={busy || !username || !password} onClick={submit}>
          {busy ? '…' : mode === 'login' ? '进入世界' : '注册并进入'}
        </button>
        <button className="btn ghost" disabled={busy} onClick={guest}>
          游客进入
        </button>
        <div className="dim" style={{ fontSize: 11 }}>
          游客也是真实账号(随机名字),数据同样会保存。
        </div>
      </div>
    </div>
  );
}
