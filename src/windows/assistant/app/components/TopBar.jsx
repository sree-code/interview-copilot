import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Timer } from '@astryxdesign/core/Timer';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import {
  ArrowUpToLine, Camera, ChartBar, Minimize2, EyeOff, Headphones, Lightbulb, Mic, Moon, NotebookPen, ScanText,
  Settings, Smartphone, Sparkles, Sun, Trash2, X, Zap
} from 'lucide-react';

import { useSessionState, useStore } from '../useStore.js';

export function listeningStatus(sources) {
  const all = [sources.system, sources.mic];
  if (all.some((s) => s.active && s.status === 'listening')) return { variant: 'success', label: 'Listening', pulsing: true };
  if (all.some((s) => s.status === 'connecting')) return { variant: 'warning', label: 'Connecting', pulsing: true };
  if (all.some((s) => s.status === 'error')) return { variant: 'error', label: 'Transcription error', pulsing: false };
  if (all.some((s) => s.active)) return { variant: 'success', label: 'Listening', pulsing: true };
  return { variant: 'neutral', label: 'Not listening', pulsing: false };
}

export function TopBar({ onOpenSettings, onClose }) {
  const { actions } = useStore();
  const state = useSessionState();
  const { sources, inFlight, hasModelKey, hasAssemblyKey, screenshots, theme, mobile } = state;
  const status = listeningStatus(sources);
  const listening = sources.system.active || sources.mic.active || status.variant === 'warning';
  const fastMode = Boolean(state.interview?.profile?.fastMode);
  const phoneUrl = mobile.urls?.find((u) => !u.virtual)?.url || mobile.urls?.[0]?.url;

  const moreItems = [
    { label: 'Notes', icon: NotebookPen, isDisabled: !hasModelKey || inFlight.notes, onClick: actions.notes },
    { label: 'Insights', icon: ChartBar, isDisabled: !hasModelKey || inFlight.insights, onClick: actions.insights },
    { label: 'Answer the last question now', icon: Zap, isDisabled: !hasModelKey, onClick: actions.answerLastQuestion },
    { type: 'divider' },
    { label: 'Move under webcam (Alt+Shift+W)', icon: ArrowUpToLine, onClick: actions.moveTopCenter },
    { label: `Take screenshot${screenshots ? ` (${screenshots} taken)` : ''}`, icon: Camera, onClick: actions.screenshot },
    {
      label: phoneUrl ? 'Copy phone companion link' : 'Phone companion: off',
      description: phoneUrl ? phoneUrl.replace(/^https?:\/\//, '') : mobile.error || undefined,
      icon: Smartphone,
      isDisabled: !phoneUrl,
      onClick: () => actions.copyText(phoneUrl).then(() => actions.toast('Link copied'))
    },
    { type: 'divider' },
    { label: 'Clear conversation', icon: Trash2, variant: 'destructive', onClick: actions.clearAll }
  ];

  return (
    <header className="topbar">
      <div className="topbar-status drag">
        <StatusDot variant={status.variant} label={status.label} tooltip={status.label} isPulsing={status.pulsing} />
        <Timer startTime={state.startedAt} format="elapsed" size="sm" color="secondary" />
        {fastMode && <Badge variant="purple" label="Fast" icon={<Icon icon={Zap} size="xsm" />} />}
      </div>

      <div className="topbar-actions no-drag">
        <div className="listen-group">
          <ToggleButton
            label={listening ? 'Stop' : 'Listen'}
            icon={<Icon icon={Mic} />}
            size="sm"
            isPressed={listening}
            isDisabled={!hasAssemblyKey}
            tooltip="Start or stop transcription (Alt+Shift+T)"
            onPressedChange={() => actions.toggleTranscription()}
          />
          <ToggleButton
            label="Interviewer audio"
            icon={<Icon icon={Headphones} />}
            isIconOnly
            size="sm"
            isPressed={sources.system.selected}
            isDisabled={!hasAssemblyKey}
            tooltip="Capture the interviewer (system audio)"
            onPressedChange={(pressed) => actions.setSourceSelected('system', pressed)}
          />
          <ToggleButton
            label="Your mic"
            icon={<Icon icon={Mic} />}
            isIconOnly
            size="sm"
            isPressed={sources.mic.selected}
            isDisabled={!hasAssemblyKey}
            tooltip="Capture your microphone (used to learn how you speak)"
            onPressedChange={(pressed) => actions.setSourceSelected('mic', pressed)}
          />
        </div>

        <Button
          label="Ask AI"
          variant="primary"
          size="sm"
          icon={<Icon icon={Sparkles} />}
          isLoading={inFlight.askAi}
          isDisabled={!hasModelKey}
          tooltip="Best next answer from the whole conversation (Alt+Shift+A)"
          onClick={actions.askAi}
        />
        <Button
          label="Screen"
          size="sm"
          icon={<Icon icon={ScanText} />}
          isLoading={inFlight.screenAi}
          isDisabled={!hasModelKey}
          tooltip="Answer from your screenshots (Alt+Shift+E)"
          onClick={actions.screenAi}
        />
        <Button
          label="Suggest"
          size="sm"
          icon={<Icon icon={Lightbulb} />}
          isLoading={inFlight.suggest}
          isDisabled={!hasModelKey}
          tooltip="What to say next (Alt+Shift+G)"
          onClick={actions.suggest}
        />
        <MoreMenu label="More actions" size="sm" variant="ghost" items={moreItems} />
      </div>

      <div className="topbar-window no-drag">
        <IconButton
          label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          icon={<Icon icon={theme === 'dark' ? Sun : Moon} />}
          variant="ghost"
          size="sm"
          onClick={() => actions.setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <IconButton label="Compact mode" tooltip="Compact: latest answer only (Alt+Shift+M)" icon={<Icon icon={Minimize2} />} variant="ghost" size="sm" onClick={() => actions.setCompact(true)} />
        <IconButton label="Settings" tooltip="Settings" icon={<Icon icon={Settings} />} variant="ghost" size="sm" onClick={() => onOpenSettings('ai')} />
        <IconButton label="Hide window" tooltip="Hide to a small icon (Alt+Shift+H)" icon={<Icon icon={EyeOff} />} variant="ghost" size="sm" onClick={actions.hideNow} />
        <IconButton label="Close app" tooltip="Close" icon={<Icon icon={X} />} variant="ghost" size="sm" onClick={onClose} />
      </div>
    </header>
  );
}
