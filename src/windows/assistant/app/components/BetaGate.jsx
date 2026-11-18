import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';

import { useStore } from '../useStore.js';

// Beta builds: sharing usage and speed stats is a condition of using the
// app. Shown instead of the app until the person accepts; the other choice
// is to quit. Global shortcuts stay off in main until they accept.
export function BetaGate() {
  const { actions } = useStore();
  return (
    <div className="beta-gate" role="dialog" aria-modal="true" aria-labelledby="beta-gate-title">
      <div className="beta-gate-drag drag" />
      <div className="beta-gate-body">
        <VStack gap={3}>
          <Heading level={2} id="beta-gate-title">Welcome to the Interview Copilot beta</Heading>
          <Text>
            This beta sends anonymous usage and speed stats to the app's author, so it can be fixed and made faster.
            You need to accept this to use the beta.
          </Text>
          <div>
            <Text display="block" weight="semibold">What is sent</Text>
            <Text display="block" color="secondary">
              Timings (start-up, transcription delay, time to the first words of an answer), errors and crashes, which features are used,
              app version, operating system and a random install ID. PostHog, the stats service, estimates your country and city from your IP address.
            </Text>
          </div>
          <div>
            <Text display="block" weight="semibold">What is never sent</Text>
            <Text display="block" color="secondary">
              What anyone says, your transcripts, answers, profile, resume, files, screenshots or API keys.
            </Text>
          </div>
          <HStack gap={2}>
            <Button label="Accept and continue" variant="primary" onClick={() => actions.setTelemetryConsent(true)} />
            <Button label="Quit" variant="ghost" onClick={() => actions.closeApp()} />
          </HStack>
        </VStack>
      </div>
    </div>
  );
}
