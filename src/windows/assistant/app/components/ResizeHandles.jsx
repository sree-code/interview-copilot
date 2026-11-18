import { useEffect } from 'react';
import { createWindowAdjustmentManager } from '../../renderer/features/layout/window-adjustments.js';

const EDGES = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

// Invisible edges for resizing the frameless window (same logic as before).
export function ResizeHandles() {
  useEffect(() => {
    const manager = createWindowAdjustmentManager({
      windowResizeHandles: document.querySelectorAll('[data-resize-handle]'),
      chatContainer: null,
      minWindowWidth: 600,
      minWindowHeight: 380,
      onViewportResize: () => {}
    });
    manager.setupWindowAdjustments();
  }, []);
  return EDGES.map((edge) => (
    <div key={edge} className={`resize-handle resize-${edge}`} data-resize-handle={edge} aria-hidden="true" />
  ));
}
