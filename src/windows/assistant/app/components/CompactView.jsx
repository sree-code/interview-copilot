import { useEffect, useRef } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { ArrowUpToLine, ChevronLeft, ChevronRight, Copy, Maximize2, Mic, Sparkles } from 'lucide-react';

import { useSessionState, useStore } from '../useStore.js';
import { listeningStatus } from './TopBar.jsx';

// Answer-only strip for use during the interview: the interviewer's latest
// line on top, one answer below in larger text (the latest, or an earlier
// one picked with the pager: Alt+Shift+Left/Right). Nothing else.
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

// Parts of the strip that take the mouse when click-through is on.
const HIT_SELECTOR = '.compact-bar, .compact-pager, .resize-handle, [role="dialog"], [role="menu"], [role="tooltip"], [data-hit]';

// Click-through: the window ignores the mouse (it goes to the meeting app
// underneath) except while the pointer is over the bar and its buttons.
// Electron keeps sending mousemove while ignoring, so we can switch back.
function useClickThrough(enabled, setPassthrough) {
  useEffect(() => {
    if (!enabled) return undefined;
    let ignoring = null;
    let last = 0;
    let pending = null;
    const apply = (ignore) => {
      if (ignore === ignoring) return;
      ignoring = ignore;
      setPassthrough(ignore);
    };
    const onMove = (event) => {
      const decide = () => apply(!event.target?.closest?.(HIT_SELECTOR));
      const now = Date.now();
      clearTimeout(pending);
      if (now - last >= 40) { last = now; decide(); } else { pending = setTimeout(decide, 40); }
    };
    const onLeave = () => apply(true);
    apply(true);
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      clearTimeout(pending);
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      setPassthrough(false);
    };
  }, [enabled, setPassthrough]);
}

export function CompactView() {
  const { actions } = useStore();
  const state = useSessionState();
  const { sources, messages, hasAssemblyKey, hasModelKey, inFlight, pagerIndex, scrollRequest, prefs } = state;
  const status = listeningStatus(sources);
  const listening = sources.system.active || sources.mic.active || status.variant === 'warning';
  const answerRef = useRef(null);

  useClickThrough(prefs.clickThrough, actions.setMousePassthrough);

  const answers = messages.filter((m) => m.type === 'ai-response');
  const index = pagerIndex == null ? answers.length - 1 : Math.min(pagerIndex, answers.length - 1);
  const answer = index >= 0 ? answers[index] : null;
  const isLatest = pagerIndex == null || index === answers.length - 1;
  const question = isLatest
    ? (sources.system.partial || latest(messages, 'voice-system')?.content || '')
    : (() => {
      const position = messages.indexOf(answer);
      for (let i = position - 1; i >= 0; i -= 1) if (messages[i].type === 'voice-system') return messages[i].content;
      return '';
    })();

  // Scroll shortcuts (Alt+Shift+Up/Down).
  useEffect(() => {
    if (!scrollRequest.dir || !answerRef.current) return;
    const el = answerRef.current;
    el.scrollBy({ top: (scrollRequest.dir === 'up' ? -1 : 1) * Math.max(60, el.clientHeight * 0.6), behavior: 'smooth' });
  }, [scrollRequest.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different answer starts at the top.
  useEffect(() => {
    if (answerRef.current) answerRef.current.scrollTop = 0;
  }, [answer?.id]);

  return (
    <div className="compact">
      <div className="compact-bar drag">
        <StatusDot variant={status.variant} label={status.label} tooltip={status.label} isPulsing={status.pulsing} />
        <div className="compact-question" title={question}>
          <Text size="sm" color="secondary">{question || (listening ? 'Listening for a question…' : 'Not listening')}</Text>
        </div>
        <div className="compact-buttons no-drag">
          {answer && answerLabel(answer.label)}
          {answers.length > 1 && (
            <div className="compact-pager">
              <IconButton label="Previous answer" tooltip="Previous answer (Alt+Shift+Left)" icon={<Icon icon={ChevronLeft} />} variant="ghost" size="sm" isDisabled={index <= 0} onClick={() => actions.answerNav('previous')} />
              <Text size="xs" color="secondary">{`${index + 1}/${answers.length}`}</Text>
              <IconButton label="Next answer" tooltip="Next answer (Alt+Shift+Right)" icon={<Icon icon={ChevronRight} />} variant="ghost" size="sm" isDisabled={isLatest} onClick={() => actions.answerNav('next')} />
            </div>
          )}
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
      <div className="compact-answer" ref={answerRef}>
        {answer?.content
          ? <Markdown density="compact" isStreaming={answer.streaming}>{answer.content}</Markdown>
          : <Text color="secondary">{answer?.streaming ? 'Writing…' : 'Answers will appear here.'}</Text>}
        {answer?.note && <Text size="sm" color="secondary"><em>{answer.note}</em></Text>}
      </div>
    </div>
  );
}
