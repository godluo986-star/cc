import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { useSession } from './state/stores';
import { connection } from './net/connection';
import AuthScreen from './ui/AuthScreen';

const WorldApp = lazy(() => import('./WorldApp'));

class CanvasErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="auth-screen">
          <div className="panel auth-card">
            <div className="auth-logo">Something broke 😵</div>
            <div className="auth-sub">{String(this.state.error.message ?? this.state.error)}</div>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function KickedModal() {
  const kicked = useSession((s) => s.kickedReason);
  const session = useSession.getState();
  if (!kicked) return null;
  return (
    <div className="modal-scrim" style={{ zIndex: 100 }}>
      <div className="panel modal">
        <div className="modal-head"><span className="title">Disconnected</span></div>
        <p className="dim">{kicked}</p>
        <div className="row">
          <button
            className="btn primary"
            onClick={() => {
              session.setKicked(null);
              if (session.token) {
                session.setPhase('connecting');
                connection.start();
              } else {
                session.setPhase('auth');
              }
            }}
          >
            Rejoin
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              session.setKicked(null);
              session.setToken(null);
              session.setPhase('auth');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const phase = useSession((s) => s.phase);

  useEffect(() => {
    const { token } = useSession.getState();
    if (token) {
      useSession.getState().setPhase('connecting');
      connection.start();
    }
    return () => connection.stop();
  }, []);

  return (
    <div className="app-root">
      <CanvasErrorBoundary>
        {phase === 'auth' ? (
          <AuthScreen />
        ) : (
          <Suspense
            fallback={
              <div className="loading-overlay">
                <div className="spinner" />
                <div className="dim">Loading the world…</div>
              </div>
            }
          >
            <WorldApp />
          </Suspense>
        )}
      </CanvasErrorBoundary>
      <KickedModal />
    </div>
  );
}
