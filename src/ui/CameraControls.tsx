import { engine } from '@/state/engine';
import { useCampus } from '@/state/store';

/** Zoom, framing and "return to plaza" — the four camera actions worth a button. */
export function CameraControls(): JSX.Element {
  const doc = useCampus((s) => s.doc);
  const ownerBuilding = doc?.buildings.find((b) => b.ownerOnly);

  return (
    <div className="camera-controls">
      <div className="camera-cluster">
        <button
          type="button"
          className="camera-btn"
          title="Zoom in (+)"
          onClick={() => engine.renderer?.zoomBy(1.3)}
        >
          +
        </button>
        <button
          type="button"
          className="camera-btn"
          title="Zoom out (−)"
          onClick={() => engine.renderer?.zoomBy(0.77)}
        >
          −
        </button>
      </div>
      <div className="camera-cluster">
        <button
          type="button"
          className="camera-btn"
          title="Return to the command plaza (0)"
          onClick={() => engine.renderer?.goHome()}
        >
          ◆
        </button>
        <button
          type="button"
          className="camera-btn"
          title="Frame the whole campus (F)"
          onClick={() => engine.renderer?.fitCampus()}
        >
          ⤢
        </button>
        {ownerBuilding && (
          <button
            type="button"
            className="camera-btn"
            title="Owner Command Suite"
            style={{ color: 'var(--gold)' }}
            onClick={() => engine.renderer?.focusBuilding(ownerBuilding.id)}
          >
            ◈
          </button>
        )}
      </div>
    </div>
  );
}
