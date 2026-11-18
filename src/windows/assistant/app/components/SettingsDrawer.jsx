import { useEffect, useState } from 'react';
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Slider } from '@astryxdesign/core/Slider';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Badge } from '@astryxdesign/core/Badge';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { Link2, Upload } from 'lucide-react';

import { useSessionState, useStore } from '../useStore.js';

const PROVIDERS = [
  { value: 'openai-compatible', label: 'Fast cloud model', description: 'Groq, OpenAI, Cerebras, OpenRouter…' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'ollama', label: 'Ollama (local)' }
];

function Section({ title, description, children }) {
  return (
    <VStack gap={3}>
      <VStack gap={1}>
        <Heading level={4}>{title}</Heading>
        {description && <Text size="sm" color="secondary">{description}</Text>}
      </VStack>
      {children}
    </VStack>
  );
}

function useAsync(actions) {
  return async (label, fn) => {
    try {
      const result = await fn();
      if (label) actions.toast(label);
      return result;
    } catch (error) {
      actions.toast(error.message || 'Something went wrong', 'error');
      return null;
    }
  };
}

// ── AI & keys ──
function AiTab() {
  const { actions } = useStore();
  const { settings } = useSessionState();
  const [form, setForm] = useState(null);
  const run = useAsync(actions);

  useEffect(() => {
    if (!settings) return;
    setForm({
      aiProvider: settings.aiProvider || 'openai-compatible',
      geminiApiKey: settings.geminiApiKey || '',
      geminiModel: settings.geminiModel || settings.defaultGeminiModel || '',
      ollamaBaseUrl: settings.ollamaBaseUrl || settings.defaultOllamaBaseUrl || '',
      ollamaModel: settings.ollamaModel || settings.defaultOllamaModel || '',
      fastLlm: {
        preset: settings.fastLlm?.preset || 'groq',
        apiKey: settings.fastLlm?.apiKey || '',
        model: settings.fastLlm?.model || '',
        baseUrl: settings.fastLlm?.baseUrl || ''
      },
      assemblyAiApiKey: settings.assemblyAiApiKey || '',
      assemblyAiSpeechModel: settings.assemblyAiSpeechModel || settings.defaultAssemblyAiSpeechModel || '',
      programmingLanguage: settings.programmingLanguage || settings.defaultProgrammingLanguage || ''
    });
  }, [settings]);

  if (!form || !settings) return <Text color="secondary">Loading…</Text>;
  const patch = (values) => setForm((f) => ({ ...f, ...values }));
  const patchLlm = (values) => setForm((f) => ({ ...f, fastLlm: { ...f.fastLlm, ...values } }));
  const presets = settings.fastLlmPresets || [];
  const preset = presets.find((p) => p.id === form.fastLlm.preset);
  const modelOptions = [...new Set([...(preset?.candidateModels || []), form.fastLlm.model].filter(Boolean))];

  const choosePreset = (id) => {
    const next = presets.find((p) => p.id === id);
    patchLlm({ preset: id, baseUrl: next?.baseUrl || form.fastLlm.baseUrl, model: next?.defaultModel || form.fastLlm.model });
  };

  const save = () => run('Settings saved', () => actions.saveSettings({
    ...form,
    windowOpacityLevel: settings.windowOpacityLevel
  }));

  return (
    <VStack gap={6}>
      <Section title="Answers" description="The model that writes answers. Groq's openai/gpt-oss-20b was the fastest in testing (~0.3 s to first words).">
        <Selector label="AI provider" options={PROVIDERS} value={form.aiProvider} onChange={(aiProvider) => patch({ aiProvider })} />

        {form.aiProvider === 'openai-compatible' && (
          <>
            <Selector
              label="Service"
              options={[...presets.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom (any OpenAI-compatible URL)' }]}
              value={form.fastLlm.preset}
              onChange={choosePreset}
            />
            <TextInput label="API key" type="password" value={form.fastLlm.apiKey} onChange={(apiKey) => patchLlm({ apiKey })} placeholder="Key for the selected service" autoComplete="off" />
            {form.fastLlm.preset === 'custom'
              ? <TextInput label="Model" value={form.fastLlm.model} onChange={(model) => patchLlm({ model })} />
              : <Selector label="Model" options={modelOptions} value={form.fastLlm.model} onChange={(model) => patchLlm({ model })} description="Run npm run bench:llm to measure which model is fastest with your key." />}
            <TextInput label="Base URL" value={form.fastLlm.baseUrl} onChange={(baseUrl) => patchLlm({ baseUrl })} />
          </>
        )}

        {form.aiProvider === 'gemini' && (
          <>
            <TextInput label="Gemini API key(s)" type="password" value={form.geminiApiKey} onChange={(geminiApiKey) => patch({ geminiApiKey })} description="Several keys can be separated with commas." autoComplete="off" />
            <Selector label="Gemini model" options={settings.geminiModels || []} value={form.geminiModel} onChange={(geminiModel) => patch({ geminiModel })} />
          </>
        )}

        {form.aiProvider === 'ollama' && (
          <>
            <TextInput label="Ollama server URL" value={form.ollamaBaseUrl} onChange={(ollamaBaseUrl) => patch({ ollamaBaseUrl })} placeholder="http://localhost:11434" />
            <HStack gap={2} vAlign="end">
              <TextInput label="Ollama model" value={form.ollamaModel} onChange={(ollamaModel) => patch({ ollamaModel })} placeholder="llama3.2" width="100%" />
              <Button
                label="List models"
                size="md"
                clickAction={async () => {
                  const result = await run(null, () => actions.listOllamaModels(form.ollamaBaseUrl));
                  const names = result?.models?.map((m) => m.name || m).filter(Boolean) || [];
                  actions.toast(names.length ? `Installed: ${names.join(', ')}` : 'No models found', names.length ? 'info' : 'error');
                }}
              />
            </HStack>
          </>
        )}

        <Selector label="Programming language for code answers" options={settings.programmingLanguages || []} value={form.programmingLanguage} onChange={(programmingLanguage) => patch({ programmingLanguage })} />
      </Section>

      <Divider />

      <Section title="Transcription" description="AssemblyAI turns the interviewer's voice and your mic into text.">
        <TextInput label="AssemblyAI API key" type="password" value={form.assemblyAiApiKey} onChange={(assemblyAiApiKey) => patch({ assemblyAiApiKey })} autoComplete="off" />
        <Selector label="Speech model" options={settings.assemblyAiSpeechModels || []} value={form.assemblyAiSpeechModel} onChange={(assemblyAiSpeechModel) => patch({ assemblyAiSpeechModel })} description="Applies from the next time you press Listen." />
      </Section>

      <HStack hAlign="end"><Button label="Save settings" variant="primary" clickAction={save} /></HStack>
    </VStack>
  );
}

// ── Interview profile ──
const PROFILE_FIELDS = ['name', 'currentRole', 'targetCompany', 'targetRole', 'jobDescription', 'resumeText', 'notes', 'keyterms', 'language', 'answerTiming'];
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' }
];
const TIMING_OPTIONS = [
  { value: 'balanced', label: 'Balanced', description: 'Waits for a natural pause (AssemblyAI default).' },
  { value: 'fast', label: 'Faster', description: 'Answers after a shorter pause. May split a slow question.' }
];

function JobUrlImport({ onImported }) {
  const { actions } = useStore();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const job = await actions.importJobUrl(url.trim());
      onImported(job);
      actions.toast('Filled from the job post. Check it, then click Save profile.');
      setUrl('');
    } catch (error) {
      actions.toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <HStack gap={2} vAlign="end">
      <TextInput label="Job post link" isOptional width="100%" value={url} onChange={setUrl} onEnter={go} placeholder="https://boards.greenhouse.io/… or a LinkedIn / Lever / company careers link" />
      <Button label="Import" size="md" icon={<Icon icon={Link2} />} isLoading={busy} clickAction={go} />
    </HStack>
  );
}

function ProfileTab() {
  const { actions } = useStore();
  const { interview } = useSessionState();
  const [form, setForm] = useState(null);
  const run = useAsync(actions);

  useEffect(() => {
    if (!interview?.profile || form) return;
    setForm(Object.fromEntries(PROFILE_FIELDS.map((key) => [key, interview.profile[key] || ''])));
    // Enum fields need a valid default.
    setForm((f) => ({ ...f, language: f.language || 'en', answerTiming: f.answerTiming || 'balanced' }));
  }, [interview, form]);

  if (!interview) return <Text color="secondary">The interview features aren't available.</Text>;
  if (!form) return <Text color="secondary">Loading…</Text>;
  const patch = (values) => setForm((f) => ({ ...f, ...values }));
  const fastMode = Boolean(interview.profile.fastMode);
  const { session, bank } = interview;

  const importInto = (kind, field) => run(null, async () => {
    const text = await actions.importText(kind);
    if (text != null) {
      patch({ [field]: text });
      actions.toast('Imported. Click Save profile to keep it.');
    }
  });

  return (
    <VStack gap={6}>
      <Section title="Fast mode">
        <Switch
          label="Answer automatically"
          description="Answers appear when the interviewer finishes a question, using your prepared answers first. If you're interrupted, a short follow-up answer replaces it."
          value={fastMode}
          changeAction={(value) => run(value ? 'Fast mode on' : 'Fast mode off', () => actions.saveProfile({ ...interview.profile, ...form, fastMode: value }))}
        />
      </Section>

      <Divider />

      <Section title="About you and the job" description="Used in every answer so it sounds like you and fits the role.">
        <TextInput label="Your name" value={form.name} onChange={(name) => patch({ name })} />
        <TextInput label="Current role" value={form.currentRole} onChange={(currentRole) => patch({ currentRole })} placeholder="e.g. Senior Backend Engineer at …" />
        <JobUrlImport onImported={(job) => patch({
          ...(job.company ? { targetCompany: job.company } : {}),
          ...(job.role ? { targetRole: job.role } : {}),
          jobDescription: job.jobDescription
        })} />
        <HStack gap={3}>
          <TextInput label="Company you're interviewing with" value={form.targetCompany} onChange={(targetCompany) => patch({ targetCompany })} width="100%" />
          <TextInput label="Job title" value={form.targetRole} onChange={(targetRole) => patch({ targetRole })} width="100%" />
        </HStack>
        <VStack gap={1}>
          <HStack hAlign="end"><Button label="Import job description" size="sm" variant="ghost" icon={<Icon icon={Upload} />} clickAction={() => importInto('jobDescription', 'jobDescription')} /></HStack>
          <TextArea label="Job description" rows={5} value={form.jobDescription} onChange={(jobDescription) => patch({ jobDescription })} />
        </VStack>
        <VStack gap={1}>
          <HStack hAlign="end"><Button label="Import resume PDF" size="sm" variant="ghost" icon={<Icon icon={Upload} />} clickAction={() => importInto('resume', 'resumeText')} /></HStack>
          <TextArea label="Resume" rows={6} value={form.resumeText} onChange={(resumeText) => patch({ resumeText })} />
        </VStack>
        <TextArea label="Notes for the AI" isOptional rows={3} value={form.notes} onChange={(notes) => patch({ notes })} placeholder="e.g. keep answers humble, mention my AWS certification when relevant" />
        <TextArea
          label="Key terms"
          isOptional
          rows={2}
          value={form.keyterms}
          onChange={(keyterms) => patch({ keyterms })}
          placeholder="Comma separated, e.g. Kubernetes, gRPC, your project names"
          description="Helps transcription spell names right. Tech words from your resume and the job description are added automatically (up to 100)."
        />
        <HStack gap={3}>
          <Selector label="Interview language" options={LANGUAGE_OPTIONS} value={form.language} onChange={(language) => patch({ language })} description="Transcription and answers." width="100%" />
          <Selector label="Answer timing" options={TIMING_OPTIONS} value={form.answerTiming} onChange={(answerTiming) => patch({ answerTiming })} description="When the interviewer counts as done." width="100%" />
        </HStack>
        <Text size="sm" color="secondary">Language, timing and key terms apply the next time you start listening.</Text>
        <HStack hAlign="end"><Button label="Save profile" variant="primary" clickAction={() => run('Profile saved', () => actions.saveProfile({ ...interview.profile, ...form }))} /></HStack>
      </Section>

      <Divider />

      <Section title="Prepared Q&A" description="A PDF or text file with your questions and answers (Q: … / A: …). When the interviewer asks one of them, even reworded, your answer is shown instantly.">
        <HStack gap={2} vAlign="center">
          {bank?.count > 0
            ? <Badge variant="green" label={`${bank.count} prepared answers${bank.source ? ` · ${bank.source}` : ''}`} />
            : <Badge variant="neutral" label="None loaded" />}
          <Button
            label={bank?.count > 0 ? 'Replace file' : 'Import Q&A file'}
            size="sm"
            icon={<Icon icon={Upload} />}
            clickAction={() => run(null, async () => {
              const count = await actions.importQa();
              if (count != null) actions.toast(`Loaded ${count} prepared answers`);
            })}
          />
        </HStack>
      </Section>

      <Divider />

      <Section
        title="Session"
        description={session?.questions
          ? `Continuing your session: ${session.questions} interviewer lines, ${session.answers} answers, ${session.spokenAnswers} of your spoken answers used to match your style.`
          : 'New session. Questions and answers are kept here across restarts.'}
      >
        <HStack><Button label="Start a fresh session" size="sm" variant="secondary" clickAction={() => run('Started a fresh session', actions.clearSession)} /></HStack>
      </Section>
    </VStack>
  );
}

function updateText(update = {}) {
  if (!update.supported) return 'Automatic updates work in the installed Windows app. Otherwise: git pull, npm ci, npm start (see the README).';
  if (update.state === 'ready') return `Version ${update.version} is downloaded and installs when you restart.`;
  if (update.state === 'downloading') return `Downloading version ${update.version || ''}${update.percent ? ` (${update.percent}%)` : ''}…`;
  if (update.state === 'checking') return 'Checking for updates…';
  if (update.state === 'error') return 'Could not check for updates. It tries again later.';
  return 'Up to date. Checks GitHub Releases every few hours.';
}

// ── Window ──
function WindowTab() {
  const { actions } = useStore();
  const state = useSessionState();
  const { settings, theme } = state;
  const [opacity, setOpacity] = useState(settings?.windowOpacityLevel ?? 10);
  const run = useAsync(actions);
  useEffect(() => { if (settings) setOpacity(settings.windowOpacityLevel ?? 10); }, [settings]);
  if (!settings) return null;

  const saveOpacity = (level) => run(null, () => actions.saveSettings({
    aiProvider: settings.aiProvider,
    geminiApiKey: settings.geminiApiKey,
    assemblyAiApiKey: settings.assemblyAiApiKey,
    geminiModel: settings.geminiModel,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    ollamaModel: settings.ollamaModel,
    fastLlm: settings.fastLlm,
    programmingLanguage: settings.programmingLanguage,
    assemblyAiSpeechModel: settings.assemblyAiSpeechModel,
    windowOpacityLevel: level
  }));

  return (
    <VStack gap={6}>
      <Section title="Appearance">
        <Switch label="Dark mode" value={theme === 'dark'} onChange={(dark) => actions.setTheme(dark ? 'dark' : 'light')} />
        <Slider
          label="Panel background"
          description="Lower it to see the interviewer through the window. Text stays solid."
          min={0}
          max={100}
          step={5}
          value={state.backgroundLevel}
          onChange={actions.setBackgroundLevel}
          formatValue={(v) => `${v}%`}
        />
        <Slider label="Whole window opacity" description="Fades everything, text included." min={1} max={10} step={1} value={opacity} onChange={setOpacity} onChangeEnd={saveOpacity} formatValue={(v) => `${v}/10`} />
        <Slider
          label="Text size"
          description="Alt+Shift+= bigger, Alt+Shift+- smaller, Alt+Shift+0 reset."
          min={0.8}
          max={1.8}
          step={0.05}
          value={state.prefs.textZoom}
          onChange={(value) => actions.setPref('textZoom', value)}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </Section>
      <Section title="During the interview" description="Compact mode shows only the interviewer's latest line and one answer, in a small strip at the top center of the screen, just under the webcam. Alt+Shift+Left/Right flips between answers, Alt+Shift+Up/Down scrolls.">
        <Switch label="Compact mode (Alt+Shift+M)" value={state.compact} onChange={(on) => actions.setCompact(on)} />
        <Switch
          label="Click-through in compact mode"
          description="Clicks go to the meeting app under the strip, except on its top bar and buttons."
          value={state.prefs.clickThrough}
          onChange={(on) => actions.setPref('clickThrough', on)}
        />
        <Switch
          label="Never take keyboard focus in compact mode"
          description="Typing in the meeting or your code editor is never interrupted. Buttons still work."
          value={state.prefs.noFocus}
          onChange={(on) => actions.setPref('noFocus', on)}
        />
        <Switch
          label="Ctrl+Enter answers while listening"
          description="Ctrl+Enter = Ask AI, Ctrl+Shift+Enter = screenshot and answer. Only while listening. Leave off for coding rounds where Ctrl+Enter runs your code."
          value={state.prefs.callShortcuts}
          onChange={(on) => actions.setPref('callShortcuts', on)}
        />
        <Switch
          label="Offer to listen when a call starts"
          description="When Zoom, Teams, Meet, Webex, Slack or Discord starts using the microphone (Windows), or a Zoom meeting starts (Mac)."
          value={state.prefs.meetingDetect}
          onChange={(on) => actions.setPref('meetingDetect', on)}
        />
        <HStack gap={2}>
          <Button label="Move under webcam (Alt+Shift+W)" size="sm" onClick={actions.moveTopCenter} />
          <Button label="Next screen (Alt+Shift+D)" size="sm" variant="secondary" onClick={actions.nextScreen} />
        </HStack>
      </Section>
      <Section
        title="Privacy"
        description={state.telemetry?.configured
          ? "Anonymous usage and speed stats help the app's author make it faster: timings, errors, which features are used, app version, OS, and your country and city (estimated from your IP). Never transcripts, answers, your profile, files or keys."
          : 'Usage stats are turned off in this build. Nothing is sent anywhere except to your AI and transcription services.'}
      >
        {state.telemetry?.required && (
          <Text size="sm" color="secondary">Required while the app is in beta.</Text>
        )}
        {state.telemetry?.configured && !state.telemetry.required && (
          <Switch
            label="Share anonymous usage stats"
            value={state.telemetry.consent === true}
            onChange={(on) => actions.setTelemetryConsent(on)}
          />
        )}
      </Section>
      <Section title="Updates" description={updateText(state.update)}>
        {state.update?.state === 'ready' && <HStack><Button label="Restart and install" size="sm" onClick={actions.installUpdate} /></HStack>}
      </Section>
    </VStack>
  );
}

// ── Shortcuts ──
function ShortcutsTab() {
  const { settings } = useSessionState();
  const shortcuts = settings?.keyboardShortcuts || [];
  return (
    <Section title="Keyboard shortcuts" description="Change them in src/config.js. On Windows with several keyboard languages, Alt+Shift may also switch language; turn that off under Settings → Time & language → Typing → Advanced keyboard settings → Input language hot keys.">
      <VStack gap={2}>
        {shortcuts.map((shortcut) => (
          <HStack key={shortcut.id} gap={3} vAlign="center" hAlign="between">
            <Text>{shortcut.description || shortcut.buttonLabel || shortcut.id}</Text>
            <Kbd keys={shortcut.accelerator.replace(/\bLeft\b/, '←').replace(/\bRight\b/, '→').replace(/\bUp\b/, '↑').replace(/\bDown\b/, '↓')} />
          </HStack>
        ))}
      </VStack>
    </Section>
  );
}

// ── Diagnostics ──
const STATUS_VARIANT = { listening: 'success', connecting: 'warning', error: 'error', off: 'neutral' };

function DiagnosticsTab() {
  const { sources, logs } = useSessionState();
  return (
    <VStack gap={6}>
      <Section title="Transcription sources">
        {[['system', 'Interviewer (system audio)'], ['mic', 'Your mic']].map(([key, label]) => (
          <VStack key={key} gap={1}>
            <HStack gap={2} vAlign="center">
              <StatusDot variant={STATUS_VARIANT[sources[key].status] || 'neutral'} label={sources[key].status} />
              <Text weight="medium">{label}</Text>
              <Text size="sm" color="secondary">{sources[key].status}</Text>
            </HStack>
            <Text size="sm" color="secondary" maxLines={2}>{sources[key].lastText}</Text>
          </VStack>
        ))}
      </Section>
      <Section title="Recent events">
        <div className="log-list">
          {[...logs].reverse().map((entry) => (
            <div key={entry.id} className={entry.level === 'error' ? 'log-row log-error' : 'log-row'}>
              {new Date(entry.timestamp).toLocaleTimeString()} {entry.source ? `[${entry.source}] ` : ''}{entry.event}: {entry.message}
            </div>
          ))}
        </div>
      </Section>
    </VStack>
  );
}

const TABS = [
  { value: 'ai', label: 'AI & keys', Panel: AiTab },
  { value: 'profile', label: 'Interview', Panel: ProfileTab },
  { value: 'window', label: 'Window', Panel: WindowTab },
  { value: 'shortcuts', label: 'Shortcuts', Panel: ShortcutsTab },
  { value: 'diagnostics', label: 'Diagnostics', Panel: DiagnosticsTab }
];

export function SettingsDrawer({ isOpen, onOpenChange, tab, onTabChange }) {
  const active = TABS.find((t) => t.value === tab) || TABS[0];
  const { Panel } = active;
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange} label="Settings" side="end" width="min(560px, 100vw)" purpose="form" padding={0}>
      <Layout
        header={
          <div className="drawer-head">
            <DrawerHeader title="Settings" onOpenChange={onOpenChange} />
            <TabList value={active.value} onChange={onTabChange} size="sm" overflow="auto" hasDivider>
              {TABS.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
            </TabList>
          </div>
        }
        content={<LayoutContent><div className="drawer-panel"><Panel /></div></LayoutContent>}
      />
    </Drawer>
  );
}
