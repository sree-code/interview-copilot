import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './app.css';

import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { createSessionStore } from './engine/session-store.js';
import { StoreContext } from './useStore.js';

const store = createSessionStore(window.electronAPI);

createRoot(document.getElementById('app')).render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>
);

store.init();
