'use strict';

// Builds what the model needs to answer as YOU: profile, target job, your
// prepared answers, earlier questions in this session and examples of how
// you actually speak. Also decides when a prepared answer can be used as-is.

const { LANGUAGES } = require('./stores');

// Measured on rephrased vs unrelated questions (see test/qa-bank.test.js):
// real rephrasings score >= 0.58, unrelated technical questions <= 0.25.
const DIRECT_MATCH_THRESHOLD = 0.5;
const REFERENCE_THRESHOLD = 0.2;

const LIMITS = {
  resume: 3500,
  jobDescription: 2500,
  notes: 800,
  qaHistory: 6,
  answerChars: 600,
  styleSamples: 3
};

function clip(text, max) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function block(label, content) {
  const value = String(content || '').trim();
  return value ? `=== ${label} ===\n${value}\n\n` : '';
}

// Returns { direct, references }: `direct` is a prepared answer to show
// without calling the model; `references` are near matches for the prompt.
function routeQuestion(question, qaIndex) {
  if (!qaIndex || qaIndex.size === 0 || !String(question || '').trim()) {
    return { direct: null, references: [] };
  }
  // Interviewers wrap questions in small talk ("Thanks for joining. Could
  // you introduce yourself?"), so also score each sentence on its own and
  // keep the best score per prepared question.
  const sentences = String(question).split(/(?<=[.?!])\s+/).filter((part) => part.trim().split(/\s+/).length >= 2);
  const best = new Map();
  for (const text of [question, ...(sentences.length > 1 ? sentences : [])]) {
    for (const candidate of qaIndex.search(text, { limit: 3 })) {
      const existing = best.get(candidate.question);
      if (!existing || candidate.score > existing.score) best.set(candidate.question, candidate);
    }
  }
  const candidates = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  const [top] = candidates;
  if (top && top.score >= DIRECT_MATCH_THRESHOLD) {
    return { direct: top, references: [] };
  }
  return { direct: null, references: candidates.filter((c) => c.score >= REFERENCE_THRESHOLD) };
}

function buildPersonalContext({ profile = {}, references = [], qaHistory = [], spokenAnswers = [] } = {}) {
  const who = [
    profile.name && `Name: ${profile.name}`,
    profile.currentRole && `Current role: ${profile.currentRole}`,
    profile.targetRole && `Interviewing for: ${profile.targetRole}${profile.targetCompany ? ` at ${profile.targetCompany}` : ''}`,
    !profile.targetRole && profile.targetCompany && `Interviewing at: ${profile.targetCompany}`
  ].filter(Boolean).join('\n');

  const prepared = references
    .map((ref) => `Q: ${ref.question}\nA: ${clip(ref.answer, LIMITS.answerChars)}`)
    .join('\n\n');

  const history = qaHistory
    .slice(-LIMITS.qaHistory)
    .map((item) => `Q: ${item.question}\nA: ${clip(item.answer, 300)}`)
    .join('\n\n');

  const style = spokenAnswers
    .slice(-LIMITS.styleSamples)
    .map((sample) => `"${sample.text}"`)
    .join('\n\n');

  const language = profile.language && profile.language !== 'en' ? LANGUAGES[profile.language] : '';

  return [
    language ? block('LANGUAGE', `The interview is in ${language}. Write every answer in ${language}.`) : '',
    block('CANDIDATE', who),
    block('RESUME', clip(profile.resumeText, LIMITS.resume)),
    block('JOB DESCRIPTION', clip(profile.jobDescription, LIMITS.jobDescription)),
    block('CANDIDATE NOTES', clip(profile.notes, LIMITS.notes)),
    block('PREPARED ANSWERS THAT MAY FIT (prefer these facts and wording when relevant)', prepared),
    block('ALREADY DISCUSSED IN THIS SESSION (stay consistent, don\'t repeat stories)', history),
    block('HOW THE CANDIDATE ACTUALLY TALKS (match vocabulary, sentence length and tone)', style)
  ].join('').trim();
}

// Prompt for live answers in fast mode. `interruption` is set when the
// interviewer cut in while the previous answer was still being written.
function buildLiveAnswerPrompt({ question, personalContext = '', recentTranscript = '', interruption = null, programmingLanguage = 'Python' }) {
  const task = interruption
    ? `The interviewer interrupted. Previous question: "${interruption.previousQuestion}".
What the candidate had been given so far: "${clip(interruption.partialAnswer, 500)}".
The interviewer just said: "${question}".
Reply with 1-3 sentences that respond to what they just said. If it was a follow-up, answer it directly; if they changed topic, answer the new topic; if it was a short remark, acknowledge it and continue the point briefly.`
    : `The interviewer just asked: "${question}".
Reply with what the candidate should say next: start with the direct answer, 2-4 short sentences, then stop.`;

  return `You write what a job candidate will say out loud in a live interview, in first person, as natural speech.
${task}

Rules:
- Use the candidate's real background below; never invent employers, titles, numbers or projects that aren't there. If you don't know a detail, stay general.
- Sound like the candidate (see their speaking samples). Plain spoken English, no markdown headings, no bullet lists unless a list is truly needed.
- For coding questions: give the approach in 1-2 sentences, then a compact ${programmingLanguage} code block only if they asked for code.
- If a prepared answer fits the question, reuse its facts and phrasing.

${personalContext ? `${personalContext}\n\n` : ''}${recentTranscript ? `=== RECENT CONVERSATION ===\n${recentTranscript}\n` : ''}`.trim();
}

module.exports = {
  DIRECT_MATCH_THRESHOLD,
  REFERENCE_THRESHOLD,
  buildLiveAnswerPrompt,
  buildPersonalContext,
  routeQuestion
};
