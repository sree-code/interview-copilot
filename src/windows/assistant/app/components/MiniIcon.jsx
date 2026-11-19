import { useRef } from 'react';
import { Sparkles } from 'lucide-react';

import { useSessionState, useStore } from '../useStore.js';

// The hidden state: a small, faint round icon. Click to bring the window
// back (or press Alt+Shift+H); drag to move it. A dot means a new answer
// arrived while hidden.
export function MiniIcon() {
  const { actions } = useStore();
  const { messages, answersAtHide } = useSessionState();
  const drag = useRef(null);
  const hasNew = messages.filter((m) => m.type === 'ai-response').length > answersAtHide;

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.screenX, y: event.screenY, moved: 0, frame: 0, dx: 0, dy: 0 };
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.screenX - d.x;
    const dy = event.screenY - d.y;
    d.x = event.screenX;
    d.y = event.screenY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.moved < 4) return;
    d.dx += dx;
    d.dy += dy;
    if (!d.frame) {
      d.frame = requestAnimationFrame(() => {
        actions.moveIconBy(d.dx, d.dy);
        d.dx = 0;
        d.dy = 0;
        d.frame = 0;
      });
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.moved < 4) actions.restoreWindow();
  };

  return (
    <div className="mini-icon-wrap">
      <button
        type="button"
        className="mini-icon"
        aria-label="Show the assistant (Alt+Shift+H)"
        title="Show (Alt+Shift+H) · drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') actions.restoreWindow(); }}
      >
        <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
        {hasNew && <span className="mini-icon-dot" />}
      </button>
    </div>
  );
}
