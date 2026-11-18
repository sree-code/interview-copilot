import { memo, useEffect, useRef, useState } from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage
} from '@astryxdesign/core/Chat';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Badge } from '@astryxdesign/core/Badge';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Camera, Copy, CornerDownLeft, Eye, EyeOff } from 'lucide-react';

import { useSessionState, useStore } from '../useStore.js';

const time = (date) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function answerBadge(label) {
  const text = label || 'Answer';
  if (/prepared/i.test(text)) return <Badge variant="green" label="Your prepared answer" />;
  if (/suggested/i.test(text)) return <Badge variant="purple" label="Suggested answer" />;
  return <Badge variant="blue" label={text} />;
}

const ContextToggle = ({ message, onToggle }) => (
  <IconButton
    label={message.includeInAi ? 'Exclude from AI context' : 'Include in AI context'}
    tooltip={message.includeInAi ? 'Used as AI context (click to exclude)' : 'Not used as AI context (click to include)'}
    icon={<Icon icon={message.includeInAi ? Eye : EyeOff} />}
    variant="ghost"
    size="sm"
    onClick={() => onToggle(message.id)}
  />
);

const MessageRow = memo(function MessageRow({ message, actions }) {
  const meta = (extra) => (
    <HStack gap={1} vAlign="center">
      <Text size="xs" color="secondary">{time(message.timestamp)}</Text>
      {message.canToggleAi && <ContextToggle message={message} onToggle={actions.toggleInclusion} />}
      {extra}
    </HStack>
  );

  switch (message.type) {
    case 'system':
      return <ChatSystemMessage>{message.content}</ChatSystemMessage>;
    case 'screenshot':
      return (
        <ChatSystemMessage icon={<Icon icon={Camera} size="sm" />}>
          {`Screenshot captured at ${time(message.timestamp)}${message.includeInAi ? '' : ' (excluded from AI)'}`}
        </ChatSystemMessage>
      );
    case 'voice-system':
      return (
        <ChatMessage sender="assistant" name="Interviewer" density="compact" metadata={meta()}>
          <ChatMessageBubble>{message.content}</ChatMessageBubble>
        </ChatMessage>
      );
    case 'voice-mic':
    case 'voice':
      return (
        <ChatMessage sender="user" name="You" density="compact" metadata={meta()}>
          <ChatMessageBubble>{message.content}</ChatMessageBubble>
        </ChatMessage>
      );
    case 'ai-response':
      return (
        <ChatMessage
          sender="assistant"
          name={answerBadge(message.label)}
          density="compact"
          metadata={meta(
            message.content && (
              <IconButton
                label="Copy answer"
                tooltip="Copy"
                icon={<Icon icon={Copy} />}
                variant="ghost"
                size="sm"
                onClick={() => actions.copyText(message.content).then(() => actions.toast('Copied'))}
              />
            )
          )}
        >
          <Card padding={3} width="100%">
            <VStack gap={1}>
              {message.content
                ? <Markdown density="compact" isStreaming={message.streaming}>{message.content}</Markdown>
                : <Text color="secondary">{message.streaming ? 'Writing…' : ''}</Text>}
              {message.note && <Text size="sm" color="secondary"><em>{message.note}</em></Text>}
            </VStack>
          </Card>
        </ChatMessage>
      );
    default:
      return null;
  }
});

function LiveLine({ who, text, sender }) {
  if (!text) return null;
  return (
    <ChatMessage sender={sender} name={<HStack gap={1} vAlign="center"><span>{who}</span><Badge variant="red" label="Live" /></HStack>} density="compact">
      <ChatMessageBubble variant="ghost"><Text color="secondary">{text}</Text></ChatMessageBubble>
    </ChatMessage>
  );
}

// One-line input for adding context as "You" (keeps vertical space for answers).
function ContextInput({ onAdd }) {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim()) return;
    onAdd(value);
    setValue('');
  };
  return (
    <HStack gap={2} vAlign="center" width="100%">
      <TextInput
        label="Add context"
        isLabelHidden
        size="sm"
        width="100%"
        value={value}
        onChange={setValue}
        onEnter={submit}
        placeholder="Add context as You… (Enter)"
      />
      <IconButton label="Add" tooltip="Add as You" icon={<Icon icon={CornerDownLeft} />} size="sm" onClick={submit} />
    </HStack>
  );
}

function EmptyConversation({ onOpenSettings, hasProfile }) {
  return (
    <VStack gap={3} hAlign="center" padding={6}>
      <Text type="large" weight="medium">Ready when you are</Text>
      <Text color="secondary" justify="center">
        Press Listen (Alt+Shift+T) to transcribe the interviewer. In fast mode answers appear as soon as they finish a question,
        using your prepared answers first.
      </Text>
      {!hasProfile && <Button label="Set up your interview profile" size="sm" onClick={() => onOpenSettings('profile')} />}
    </VStack>
  );
}

export function Conversation({ onOpenSettings }) {
  const { actions } = useStore();
  const state = useSessionState();
  const streaming = state.messages.some((m) => m.streaming);
  const hasProfile = Boolean(state.interview?.profile?.resumeText || state.interview?.bank?.count);
  const empty = state.messages.length === 0 && !state.sources.system.partial && !state.sources.mic.partial;
  const mainRef = useRef(null);

  // Scroll shortcuts (Alt+Shift+Up/Down) scroll the conversation; the
  // answer shortcuts (Alt+Shift+Left/Right) jump a screen at a time.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || !state.scrollRequest.dir) return;
    const scroller = [root, ...root.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
    if (scroller) scroller.scrollBy({ top: (state.scrollRequest.dir === 'up' ? -1 : 1) * scroller.clientHeight * 0.6, behavior: 'smooth' });
  }, [state.scrollRequest.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="conversation" ref={mainRef}>
      {state.busyText && <div className="busy-line"><Text size="sm" color="secondary">{state.busyText}</Text></div>}
      <ChatLayout
        density="compact"
        emptyState={empty ? <EmptyConversation onOpenSettings={onOpenSettings} hasProfile={hasProfile} /> : undefined}
        composer={<ContextInput onAdd={actions.addManualContext} />}
      >
        {!empty && (
          <ChatMessageList density="compact" isStreaming={streaming}>
            {state.messages.map((message) => <MessageRow key={message.id} message={message} actions={actions} />)}
            <LiveLine who="Interviewer" sender="assistant" text={state.sources.system.partial} />
            <LiveLine who="You" sender="user" text={state.sources.mic.partial} />
          </ChatMessageList>
        )}
      </ChatLayout>
    </main>
  );
}
