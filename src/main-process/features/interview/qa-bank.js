'use strict';

// Prepared question-and-answer bank. Parses the candidate's own Q&A document
// (from a PDF or text file) and finds the prepared answer for a question the
// interviewer asks, so it can be shown instantly without calling the model.

const STOPWORDS = new Set((
  'a an the and or but if then so of to in on at for from by with about into over as is are was were be been being '
  + 'do does did doing have has had having i me my we our you your he she it its they them their this that these those '
  + 'what which who whom whose when where why how can could would should will shall may might must just also very '
  + 'tell give share describe explain talk walk through please let us lets kind sort some any there here up out me '
  + 'say think biggest greatest main top one most really actually maybe'
).split(' '));

// Common interview phrasings that mean the same thing. Each variant is
// rewritten to its canonical phrase before matching.
const CANONICAL_PHRASES = [
  ['about yourself', ['introduce yourself', 'your background', 'walk me through your resume', 'walk me through your background', 'tell me about you']],
  ['why this company', ['why do you want to work here', 'why do you want to join', 'why are you interested in this company', 'why us', 'why our company']],
  ['your weakness', ['your weaknesses', 'areas of improvement', 'area of improvement', 'what do you struggle with']],
  ['your strength', ['your strengths', 'what are you good at', 'your best quality']],
  ['why leaving', ['why are you leaving', 'why do you want to leave', 'why did you leave', 'reason for leaving', 'why change jobs', 'why are you looking for a change']],
  ['salary expectation', ['salary expectations', 'expected salary', 'compensation expectations', 'expected compensation', 'what are you expecting']],
  ['five years', ['5 years', 'see yourself in the future', 'career goals', 'long term goals']],
  ['conflict', ['disagreement', 'disagreed', 'difficult coworker', 'difficult colleague', 'clash']],
  ['challenging project', ['hardest project', 'most difficult project', 'biggest challenge', 'toughest problem']]
];

function normalizeText(text) {
  let normalized = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const [canonical, variants] of CANONICAL_PHRASES) {
    for (const variant of variants) {
      normalized = normalized.split(` ${variant} `).join(` ${canonical} `);
    }
  }
  return normalized.trim();
}

function stem(word) {
  if (word.length <= 4) return word;
  return word.replace(/(ing|ed|es|s|ly)$/, '');
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .map(stem);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const QUESTION_MARKER = /^\s*(?:\*\*)?\s*(?:q(?:uestion)?\s*\d*\s*[:.)\-]|\d+\s*[.)]\s*(?:q(?:uestion)?\s*[:.)\-])?)\s*(?:\*\*)?\s*/i;
const ANSWER_MARKER = /^\s*(?:\*\*)?\s*a(?:nswer|ns)?\s*\d*\s*[:.)\-]\s*(?:\*\*)?\s*/i;
const EXPLICIT_Q = /^\s*(?:\*\*)?\s*q(?:uestion)?\s*\d*\s*[:.)\-]/i;
const INTERROGATIVE = /^(what|why|how|when|where|who|which|tell|describe|explain|walk|can|could|would|do|did|have|are|is|give|share)\b/i;

function looksLikeQuestion(line) {
  const text = line.replace(QUESTION_MARKER, '').trim();
  return text.endsWith('?') || INTERROGATIVE.test(text);
}

function cleanBlock(lines) {
  return lines.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Accepts several layouts:
//   Q: ... / A: ...           Question 1: ... / Answer: ...
//   1. Tell me ...? <answer>  plain "...?" line followed by the answer
function parseQaText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const hasExplicitQ = lines.some((line) => EXPLICIT_Q.test(line));
  const pairs = [];
  let question = null;
  let questionLines = [];
  let answerLines = [];
  let inAnswer = false;

  const finish = () => {
    if (question !== null) {
      const q = cleanBlock([question, ...questionLines]);
      const a = cleanBlock(answerLines);
      if (q && a) pairs.push({ question: q, answer: a });
    }
    question = null;
    questionLines = [];
    answerLines = [];
    inAnswer = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (question !== null && !inAnswer && questionLines.length === 0 && !hasExplicitQ) inAnswer = true;
      continue;
    }

    const startsQuestion = hasExplicitQ
      ? EXPLICIT_Q.test(line)
      : (QUESTION_MARKER.test(line) && looksLikeQuestion(line)) || (line.endsWith('?') && line.length < 220);

    if (startsQuestion) {
      finish();
      question = line.replace(QUESTION_MARKER, '').trim();
      inAnswer = !hasExplicitQ && question.endsWith('?');
      continue;
    }

    if (question === null) continue;

    if (ANSWER_MARKER.test(line)) {
      inAnswer = true;
      const rest = line.replace(ANSWER_MARKER, '').trim();
      if (rest) answerLines.push(rest);
      continue;
    }

    if (inAnswer) {
      answerLines.push(line);
    } else {
      questionLines.push(line);
    }
  }
  finish();
  return pairs;
}

// ── Matching ─────────────────────────────────────────────────────────────────

function createQaIndex(pairs = []) {
  const docs = pairs.map((pair) => {
    const tokens = tokenize(pair.question);
    const counts = new Map();
    tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
    return { ...pair, tokens, counts, normalized: normalizeText(pair.question) };
  });

  const documentFrequency = new Map();
  for (const doc of docs) {
    for (const token of doc.counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const idf = (token) => Math.log(1 + (docs.length + 1) / ((documentFrequency.get(token) || 0) + 0.5));

  function vector(counts) {
    const weights = new Map();
    let norm = 0;
    for (const [token, count] of counts) {
      const weight = (1 + Math.log(count)) * idf(token);
      weights.set(token, weight);
      norm += weight * weight;
    }
    return { weights, norm: Math.sqrt(norm) || 1 };
  }

  docs.forEach((doc) => { doc.vector = vector(doc.counts); });

  // Returns candidates sorted by score (0..1). Score is cosine similarity
  // of IDF-weighted terms, nudged up when the whole prepared question appears
  // inside what was asked.
  function search(query, { limit = 3 } = {}) {
    const tokens = tokenize(query);
    if (tokens.length === 0 || docs.length === 0) return [];
    const counts = new Map();
    tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
    const queryVector = vector(counts);
    const normalizedQuery = normalizeText(query);

    return docs
      .map((doc) => {
        let dot = 0;
        for (const [token, weight] of queryVector.weights) {
          const docWeight = doc.vector.weights.get(token);
          if (docWeight) dot += weight * docWeight;
        }
        let score = dot / (queryVector.norm * doc.vector.norm);
        if (doc.normalized.length > 8 && normalizedQuery.includes(doc.normalized)) {
          score = Math.max(score, 0.9);
        }
        return { question: doc.question, answer: doc.answer, score: Math.min(1, score) };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  return { size: docs.length, search };
}

module.exports = {
  createQaIndex,
  normalizeText,
  parseQaText,
  tokenize
};
