import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './app.css';

import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { createSessionStore } from './engine/session-store.js';
import { StoreContext } from './useStore.js';

const store = createSessionStore(window.electronAPI);
// Handle for the smoke test's screenshot run and for debugging in DevTools.
window.__copilotStore = store;

createRoot(document.getElementById('app')).render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>
);

store.init();
