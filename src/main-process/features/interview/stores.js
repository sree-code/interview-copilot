'use strict';

// On-disk state for the interview features, all under <userData>/interview/:
//   profile.json   - who you are, the target job, resume and job description
//   qa-bank.json   - your prepared questions and answers (parsed from a file)
//   session.jsonl  - one running session: every interviewer line, your own
//                    spoken lines and every answer shown, kept across restarts

const fs = require('fs');
const path = require('path');

const PROFILE_FIELDS = {
  name: 200,
  currentRole: 200,
  targetCompany: 200,
  targetRole: 200,
  jobDescription: 20000,
  resumeText: 30000,
  notes: 5000,
  keyterms: 3000
};

// Transcription + answer language. Anything but English uses AssemblyAI's
// multilingual model, which covers these languages.
const LANGUAGES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese'
};
const ANSWER_TIMINGS = ['balanced', 'fast'];

const DEFAULT_PROFILE = {
  name: '',
  currentRole: '',
  targetCompany: '',
  targetRole: '',
  jobDescription: '',
  resumeText: '',
  notes: '',
  keyterms: '',
  language: 'en',
  answerTiming: 'balanced',
  fastMode: false
};

function sanitizeProfile(input = {}) {
  const profile = { ...DEFAULT_PROFILE };
  for (const [field, maxLength] of Object.entries(PROFILE_FIELDS)) {
    if (typeof input[field] === 'string') {
      profile[field] = input[field].slice(0, maxLength);
    }
  }
  profile.fastMode = Boolean(input.fastMode);
  if (Object.hasOwn(LANGUAGES, input.language)) profile.language = input.language;
  if (ANSWER_TIMINGS.includes(input.answerTiming)) profile.answerTiming = input.answerTiming;
  return profile;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function createInterviewStores({ baseDir, maxSessionEvents = 2000 }) {
  const profilePath = path.join(baseDir, 'profile.json');
  const bankPath = path.join(baseDir, 'qa-bank.json');
  const sessionPath = path.join(baseDir, 'session.jsonl');

  let profile = sanitizeProfile(readJson(profilePath, {}));
  let bank = Array.isArray(readJson(bankPath, null)?.pairs) ? readJson(bankPath, null) : { source: '', pairs: [] };
  let events = loadEvents();

  function loadEvents() {
    try {
      return fs.readFileSync(sessionPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch (_) { return null; }
        })
        .filter((event) => event && typeof event.text === 'string')
        .slice(-maxSessionEvents);
    } catch (_) {
      return [];
    }
  }

  // ── Profile ──
  function getProfile() {
    return { ...profile };
  }

  function saveProfile(next) {
    profile = sanitizeProfile({ ...profile, ...next });
    writeJsonAtomic(profilePath, profile);
    return getProfile();
  }

  // ── Q&A bank ──
  function getBank() {
    return { source: bank.source, pairs: bank.pairs.slice() };
  }

  function saveBank(pairs, source) {
    bank = { source: String(source || ''), importedAt: new Date().toISOString(), pairs };
    writeJsonAtomic(bankPath, bank);
    return getBank();
  }

  // ── Session ──
  // kind: 'host' (interviewer), 'you' (your mic), 'answer' (shown to you)
  function appendEvent(kind, text, extra = {}) {
    const event = { t: Date.now(), kind, text: String(text || '').trim(), ...extra };
    if (!event.text) return null;
    events.push(event);
    if (events.length > maxSessionEvents) events = events.slice(-maxSessionEvents);
    fs.mkdirSync(baseDir, { recursive: true });
    fs.appendFileSync(sessionPath, `${JSON.stringify(event)}\n`);
    return event;
  }

  function getEvents() {
    return events.slice();
  }

  function clearSession() {
    events = [];
    try { fs.unlinkSync(sessionPath); } catch (_) { /* nothing to clear */ }
  }

  // Previous questions with the answer that was shown for each.
  function getQaHistory(limit = 6) {
    return events
      .filter((event) => event.kind === 'answer' && event.question)
      .slice(-limit)
      .map((event) => ({ question: event.question, answer: event.text, source: event.source || 'llm' }));
  }

  // What you actually said after each interviewer question (consecutive mic
  // lines joined). Used as examples of your speaking style.
  function getSpokenAnswers({ limit = 3, minWords = 20, maxWords = 140 } = {}) {
    const answers = [];
    let current = null;
    for (const event of events) {
      if (event.kind === 'host') {
        if (current?.text) answers.push(current);
        current = { question: event.text, text: '' };
      } else if (event.kind === 'you' && current) {
        current.text = `${current.text} ${event.text}`.trim();
      }
    }
    if (current?.text) answers.push(current);

    return answers
      .filter((answer) => answer.text.split(/\s+/).length >= minWords)
      .slice(-limit)
      .map((answer) => ({
        question: answer.question,
        text: answer.text.split(/\s+/).slice(0, maxWords).join(' ')
      }));
  }

  return {
    appendEvent,
    clearSession,
    getBank,
    getEvents,
    getProfile,
    getQaHistory,
    getSpokenAnswers,
    saveBank,
    saveProfile
  };
}

module.exports = {
  ANSWER_TIMINGS,
  DEFAULT_PROFILE,
  LANGUAGES,
  createInterviewStores,
  sanitizeProfile
};
