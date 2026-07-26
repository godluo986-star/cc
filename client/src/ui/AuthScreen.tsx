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
      setError(e instanceof Error ? e.message : 'Something went wrong.');
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
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="panel auth-card">
        <div className="auth-logo">Nexus <em>Park</em></div>
        <div className="auth-sub">
          A persistent multiplayer 3D world. Explore the plaza, watch synced videos in the cinema,
          decorate your own room, and hang out.
        </div>
        <div className="auth-tabs">
          <button className={`btn ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Sign in</button>
          <button className={`btn ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>Create account</button>
        </div>
        <input
          className="input"
          placeholder="Username"
          value={username}
          autoFocus
          maxLength={20}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          className="input"
          placeholder={mode === 'register' ? 'Password (min 8 characters)' : 'Password'}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <div className="auth-error">{error}</div>
        <button className="btn primary" disabled={busy || !username || !password} onClick={submit}>
          {busy ? '…' : mode === 'login' ? 'Enter the world' : 'Create & enter'}
        </button>
        <button className="btn ghost" disabled={busy} onClick={guest}>
          Continue as guest
        </button>
        <div className="dim" style={{ fontSize: 11 }}>
          Guests get a real account with a random name — you just can't pick it.
        </div>
      </div>
    </div>
  );
}
