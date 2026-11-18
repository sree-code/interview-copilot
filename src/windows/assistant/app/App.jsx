import { useEffect, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport, useToast } from '@astryxdesign/core/Toast';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

import { useSessionState, useStore } from './useStore.js';
import { TopBar } from './components/TopBar.jsx';
import { Conversation } from './components/Conversation.jsx';
import { SettingsDrawer } from './components/SettingsDrawer.jsx';
import { CompactView } from './components/CompactView.jsx';
import { ResizeHandles } from './components/ResizeHandles.jsx';
import { useLocalShortcuts } from './components/useLocalShortcuts.js';

function ToastBridge() {
  const store = useStore();
  const showToast = useToast();
  useEffect(() => store.onToast(({ message, type }) => {
    showToast({ body: message, type: type === 'error' ? 'error' : 'info', autoHideDuration: type === 'error' ? 6000 : 2500, uniqueID: message });
  }), [store, showToast]);
  return null;
}

export function App() {
  const store = useStore();
  const state = useSessionState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('ai');
  const [confirmClose, setConfirmClose] = useState(false);

  useLocalShortcuts({ onClose: () => setConfirmClose(true) });

  const openSettings = (tab = 'ai') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const missing = [];
  if (state.ready && !state.hasAssemblyKey) missing.push('AssemblyAI key (transcription)');
  if (state.ready && !state.hasModelKey) missing.push('AI model key (answers)');

  return (
    <Theme theme={neutralTheme} mode={state.theme === 'dark' ? 'dark' : 'light'}>
      <ToastViewport position="bottomEnd" maxVisible={2}>
        <ToastBridge />
        <div
          className={`shell${state.compact ? ' is-compact' : ''}${state.backgroundLevel < 100 ? ' see-through' : ''}`}
          style={{ '--panel-alpha': `${state.backgroundLevel}%` }}
        >
          <ResizeHandles />
          {state.compact ? <CompactView /> : (<>
          <TopBar onOpenSettings={openSettings} onClose={() => setConfirmClose(true)} />
          {missing.length > 0 && (
            <div className="banner-row">
              <Banner
                status="warning"
                title={`Add your ${missing.join(' and ')} to get started.`}
                endContent={<Button label="Open settings" size="sm" variant="secondary" onClick={() => openSettings('ai')} />}
              />
            </div>
          )}
          <Conversation onOpenSettings={openSettings} />
          </>)}
        </div>
        <SettingsDrawer isOpen={settingsOpen} onOpenChange={setSettingsOpen} tab={settingsTab} onTabChange={setSettingsTab} />
        <AlertDialog
          isOpen={confirmClose}
          onOpenChange={setConfirmClose}
          title="Close the app?"
          description="This stops listening and closes the assistant. Your session and profile are kept."
          actionLabel="Close app"
          actionVariant="destructive"
          cancelLabel="Cancel"
          onAction={() => store.actions.closeApp()}
        />
      </ToastViewport>
    </Theme>
  );
}
