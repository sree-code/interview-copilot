import { Suspense, lazy, useEffect, useState } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport, useToast } from '@astryxdesign/core/Toast';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

import { useSessionState, useStore } from './useStore.js';
import { TopBar } from './components/TopBar.jsx';
import { Conversation } from './components/Conversation.jsx';
import { CompactView } from './components/CompactView.jsx';
import { ResizeHandles } from './components/ResizeHandles.jsx';
import { BetaGate } from './components/BetaGate.jsx';
import { MiniIcon } from './components/MiniIcon.jsx';
import { useLocalShortcuts } from './components/useLocalShortcuts.js';

// Settings is the biggest part of the UI and isn't needed at startup.
const SettingsDrawer = lazy(() => import('./components/SettingsDrawer.jsx').then((m) => ({ default: m.SettingsDrawer })));

// One notice at a time, most important first: a call just started, an
// update is ready, the one-time question about sharing usage stats.
function Notices({ onOpenSettings }) {
  const { actions } = useStore();
  const state = useSessionState();
  if (state.meeting) {
    return (
      <div className="notice-row">
        <Banner
          status="info"
          title={`${state.meeting.label} is using your microphone. Start listening?`}
          endContent={<>
            <Button label="Listen" size="sm" onClick={actions.startFromMeeting} />
            <Button label="Not now" size="sm" variant="ghost" onClick={actions.dismissMeeting} />
          </>}
        />
      </div>
    );
  }
  if (state.compact) return null;
  if (state.update?.state === 'ready') {
    return (
      <div className="notice-row">
        <Banner
          status="success"
          title={`Version ${state.update.version || 'update'} is ready.`}
          description="Restart to install it, or it installs when you close the app."
          endContent={<Button label="Restart now" size="sm" variant="secondary" onClick={actions.installUpdate} />}
        />
      </div>
    );
  }
  if (state.telemetry?.askUser && !state.telemetry.required) {
    return (
      <div className="notice-row">
        <Banner
          status="info"
          title="Share anonymous usage and speed stats with the app's author?"
          description="Helps make it faster. Sends timings, errors and which features are used, plus your country (from your IP). Never your transcripts, answers, profile, files or keys. Change it any time in Settings."
          endContent={<>
            <Button label="Share" size="sm" onClick={() => actions.setTelemetryConsent(true)} />
            <Button label="No thanks" size="sm" variant="ghost" onClick={() => actions.setTelemetryConsent(false)} />
          </>}
        />
      </div>
    );
  }
  return null;
}

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

  const gated = Boolean(state.telemetry?.required && state.telemetry?.askUser);
  const missing = [];
  if (state.ready && !state.hasAssemblyKey) missing.push('AssemblyAI key (transcription)');
  if (state.ready && !state.hasModelKey) missing.push('AI model key (answers)');

  if (state.minimized && !gated) {
    return (
      <Theme theme={neutralTheme} mode={state.theme === 'dark' ? 'dark' : 'light'}>
        <MiniIcon />
      </Theme>
    );
  }

  return (
    <Theme theme={neutralTheme} mode={state.theme === 'dark' ? 'dark' : 'light'}>
      <ToastViewport position="bottomEnd" maxVisible={2}>
        <ToastBridge />
        <div
          className={`shell${state.compact ? ' is-compact' : ''}${state.backgroundLevel < 100 ? ' see-through' : ''}`}
          style={{ '--panel-alpha': `${state.backgroundLevel}%` }}
        >
          <ResizeHandles />
          {gated && <BetaGate />}
          {!gated && state.compact && <Notices onOpenSettings={openSettings} />}
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
          <Notices onOpenSettings={openSettings} />
          <Conversation onOpenSettings={openSettings} />
          </>)}
        </div>
        {settingsOpen && !gated && (
          <Suspense fallback={null}>
            <SettingsDrawer isOpen={settingsOpen} onOpenChange={setSettingsOpen} tab={settingsTab} onTabChange={setSettingsTab} />
          </Suspense>
        )}
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
