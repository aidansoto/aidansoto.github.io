import { useEffect, useRef } from 'react';
import { engine } from '@/state/engine';
import { useCampus } from '@/state/store';
import { TopBar } from './TopBar';
import { Roster } from './Roster';
import { Inspector } from './Inspector';
import { ActivityLog } from './ActivityLog';
import { SettingsPanel } from './SettingsPanel';
import { OwnerConsole } from './OwnerConsole';
import { CameraControls } from './CameraControls';
import { Dashboard } from './Dashboard';
import { NewMission } from './NewMission';
import { Results } from './Results';
import { KnowledgeVaultScreen } from './KnowledgeVault';
import { WorkflowBuilder } from './WorkflowBuilder';
import { ManagerChat } from './ManagerChat';
import './styles.css';

export function App(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ready = useCampus((s) => s.ready);
  const loadError = useCampus((s) => s.loadError);
  const openPanel = useCampus((s) => s.openPanel);
  const selectedAgentId = useCampus((s) => s.selectedAgentId);
  const selectedBuildingId = useCampus((s) => s.selectedBuildingId);
  const screen = useCampus((s) => s.screen);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    void engine.boot(host);

    // Persist before the window goes away — an autosave in flight would
    // otherwise be lost on quit.
    const onBeforeUnload = (): void => {
      void engine.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Escape returns to the campus from any full-screen surface, so the owner
    // can never get stranded on a panel.
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (typing) return;
      if (e.key === 'Escape') {
        const state = useCampus.getState();
        if (state.newMissionOpen) state.setNewMissionOpen(false);
        else if (state.screen !== 'campus') state.setScreen('campus');
      }
      if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey) {
        const state = useCampus.getState();
        state.setScreen(state.screen === 'dashboard' ? 'campus' : 'dashboard');
      }
    };
    window.addEventListener('keydown', onKey);

    // The engine deliberately outlives this effect. React's StrictMode mounts
    // the root twice in development, and tearing down a half-initialised
    // PixiJS application between those mounts is a reliable way to lose the
    // canvas. The engine is torn down on page unload instead.
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKey);
      void engine.flush();
    };
  }, []);

  const hasInspector = Boolean(selectedAgentId || selectedBuildingId);

  return (
    <div className="shell">
      <div className="canvas-host" ref={hostRef} />
      <div className="vignette" />

      {screen === 'campus' && (
      <div className="hud">
        <TopBar />

        {/* Left column ------------------------------------------------ */}
        <div style={{ gridColumn: 1, gridRow: 2, display: 'flex', minHeight: 0 }}>
          {openPanel === 'roster' && <Roster />}
          {openPanel === 'log' && <ActivityLog />}
          {openPanel === 'settings' && <SettingsPanel />}
        </div>

        {/* Centre is intentionally empty: the campus is the interface. */}
        <div style={{ gridColumn: 2, gridRow: 2, pointerEvents: 'none' }} />

        {/* Right column ----------------------------------------------- */}
        <div
          style={{
            gridColumn: 3,
            gridRow: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minHeight: 0,
          }}
        >
          {hasInspector ? <Inspector /> : <ActivityLog />}
        </div>
      </div>
      )}

      {screen === 'campus' && <CameraControls />}
      {screen === 'dashboard' && <Dashboard />}
      {screen === 'results' && <Results />}
      {screen === 'vault' && <KnowledgeVaultScreen />}
      {screen === 'workflows' && <WorkflowBuilder />}

      <OwnerConsole />
      <NewMission />
      <ManagerChat />

      <div className={`boot${ready ? ' is-done' : ''}`}>
        <div className="boot-mark" />
        <div className="boot-text">Initialising Campus</div>
      </div>

      {loadError && (
        <div className="boot-error" role="alert">
          <strong>The campus map could not start.</strong>
          <p>{loadError}</p>
          <p className="boot-error-hint">
            The roster, activity log, settings and owner console still work. Quitting and
            reopening the app resolves most graphics-context failures.
          </p>
        </div>
      )}
    </div>
  );
}
