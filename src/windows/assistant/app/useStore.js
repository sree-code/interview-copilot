import { createContext, useContext, useSyncExternalStore } from 'react';

export const StoreContext = createContext(null);

export function useStore() {
  return useContext(StoreContext);
}

// Subscribe to the whole state (cheap: one window, small state).
export function useSessionState() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
