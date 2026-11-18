import { IconButton } from '@astryxdesign/core/IconButton';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { ArrowUpToLine, Copy, Maximize2, Mic, Sparkles } from 'lucide-react';

import { useSessionState, useStore } from '../useStore.js';
import { listeningStatus } from './TopBar.jsx';

// Answer-only strip for use during the interview: the interviewer's latest
// line on top, the latest answer below in larger text. Nothing else.
function latest(messages, type) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].type === type) return messages[i];
  }
  return null;
}

function answerLabel(label) {
  if (/prepared/i.test(label || '')) return <Badge variant="green" label="Prepared" />;
  if (/suggested/i.test(label || '')) return <Badge variant="purple" label="Suggested" />;
  return label ? <Badge variant="blue" label={label} /> : null;
}

export function CompactView() {
  const { actions } = useStore();
  const state = useSessionState();
  const { sources, messages, hasAssemblyKey, hasModelKey, inFlight } = state;
  const status = listeningStatus(sources);
  const listening = sources.system.active || sources.mic.active || status.variant === 'warning';

  const answer = latest(messages, 'ai-response');
  const question = sources.system.partial || latest(messages, 'voice-system')?.content || '';

  return (
    <div className="compact">
      <div className="compact-bar drag">
        <StatusDot variant={status.variant} label={status.label} tooltip={status.label} isPulsing={status.pulsing} />
        <div className="compact-question" title={question}>
          <Text size="sm" color="secondary">{question || (listening ? 'Listening for a question…' : 'Not listening')}</Text>
        </div>
        <div className="compact-buttons no-drag">
          {answer && answerLabel(answer.label)}
          <ToggleButton
            label={listening ? 'Stop listening' : 'Listen'}
            icon={<Icon icon={Mic} />}
            isIconOnly
            size="sm"
            isPressed={listening}
            isDisabled={!hasAssemblyKey}
            tooltip="Start or stop transcription (Alt+Shift+T)"
            onPressedChange={() => actions.toggleTranscription()}
          />
          <IconButton
            label="Ask AI"
            tooltip="Ask AI (Alt+Shift+A)"
            icon={<Icon icon={Sparkles} />}
            variant="ghost"
            size="sm"
            isDisabled={!hasModelKey || inFlight.askAi}
            onClick={actions.askAi}
          />
          {answer?.content && (
            <IconButton
              label="Copy answer"
              tooltip="Copy"
              icon={<Icon icon={Copy} />}
              variant="ghost"
              size="sm"
              onClick={() => actions.copyText(answer.content).then(() => actions.toast('Copied'))}
            />
          )}
          <IconButton label="Move under webcam" tooltip="Move under webcam (Alt+Shift+W)" icon={<Icon icon={ArrowUpToLine} />} variant="ghost" size="sm" onClick={actions.moveTopCenter} />
          <IconButton label="Full view" tooltip="Full view (Alt+Shift+M)" icon={<Icon icon={Maximize2} />} variant="ghost" size="sm" onClick={() => actions.setCompact(false)} />
        </div>
      </div>
      <div className="compact-answer">
        {answer?.content
          ? <Markdown density="compact" isStreaming={answer.streaming}>{answer.content}</Markdown>
          : <Text color="secondary">{answer?.streaming ? 'Writing…' : 'Answers will appear here.'}</Text>}
        {answer?.note && <Text size="sm" color="secondary"><em>{answer.note}</em></Text>}
      </div>
    </div>
  );
}
