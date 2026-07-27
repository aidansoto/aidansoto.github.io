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
import './styles.css';

export function App(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ready = useCampus((s) => s.ready);
  const openPanel = useCampus((s) => s.openPanel);
  const selectedAgentId = useCampus((s) => s.selectedAgentId);
  const selectedBuildingId = useCampus((s) => s.selectedBuildingId);

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

    // The engine deliberately outlives this effect. React's StrictMode mounts
    // the root twice in development, and tearing down a half-initialised
    // PixiJS application between those mounts is a reliable way to lose the
    // canvas. The engine is torn down on page unload instead.
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void engine.flush();
    };
  }, []);

  const hasInspector = Boolean(selectedAgentId || selectedBuildingId);

  return (
    <div className="shell">
      <div className="canvas-host" ref={hostRef} />
      <div className="vignette" />

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

      <CameraControls />
      <OwnerConsole />

      <div className={`boot${ready ? ' is-done' : ''}`}>
        <div className="boot-mark" />
        <div className="boot-text">Initialising Campus</div>
      </div>
    </div>
  );
}
