import { useEffect } from 'react';
import { useStore } from '../useStore.js';

// Shortcuts that work while the window has focus. Transcription, Ask AI,
// screenshot, hide and window movement are global (registered in main).
const LOCAL = { screenAi: 'screenAi', suggest: 'suggest', notes: 'notes', insights: 'insights', clearChat: 'clearAll' };

function matches(event, accelerator) {
  const parts = String(accelerator || '').toLowerCase().split('+');
  const key = parts.pop();
  const want = { alt: parts.includes('alt'), shift: parts.includes('shift'), ctrl: parts.includes('ctrl') || parts.includes('control'), meta: parts.includes('cmd') || parts.includes('command') || parts.includes('super') };
  if (event.altKey !== want.alt || event.shiftKey !== want.shift || event.ctrlKey !== want.ctrl || event.metaKey !== want.meta) return false;
  const code = event.code || '';
  if (/^[a-z]$/.test(key)) return code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return code === `Digit${key}`;
  return event.key.toLowerCase() === key;
}

export function useLocalShortcuts() {
  const store = useStore();
  useEffect(() => {
    const onKeyDown = (event) => {
      const shortcuts = store.getState().settings?.keyboardShortcuts || [];
      for (const shortcut of shortcuts) {
        const action = LOCAL[shortcut.id];
        if (action && matches(event, shortcut.accelerator)) {
          event.preventDefault();
          store.actions[action]?.();
          return;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);
}
