'use strict';

// Key terms for speech-to-text: names the recognizer would otherwise mishear
// ("Kubernetes", "PostgreSQL", "gRPC", the company name). Taken from what you
// typed in "Key terms", the target company and role, and technical-looking
// words in your resume and the job description. AssemblyAI allows up to 100
// terms of at most 50 characters.

const MAX_TERMS = 100;
const MAX_TERM_LENGTH = 50;

// Capitalized words that are just English, not names worth boosting.
const COMMON = new Set(`a an and are as at be but by for from has have i in is it its of on or our the to was we were with you your
this that these those will can may also into over under about after before during while within across per via using used use
team teams work worked working project projects experience experienced years year role roles company job jobs skills skill
responsibilities requirements required preferred qualifications strong ability excellent knowledge understanding including
develop developed developing design designed build built lead led manage managed support supported create created improve
improved new senior junior lead staff principal engineer engineering software developer development data system systems
ensure collaborate collaborated drive drove deliver delivered own owned help helped make made best other more most all any
january february march april may june july august september october november december remote hybrid onsite full time
us usa united states inc llc ltd corp corporation mr ms dr bachelor master degree university college school
`.split(/\s+/).filter(Boolean));

function splitManual(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function looksTechnical(word) {
  if (word.length < 2 || word.length > MAX_TERM_LENGTH) return false;
  if (/^\d+$/.test(word)) return false;
  if (COMMON.has(word.toLowerCase())) return false;
  return (
    /[a-z][A-Z]/.test(word) ||               // JavaScript, PostgreSQL, gRPC
    /^[A-Z]{2,6}s?$/.test(word) ||           // AWS, SQL, APIs
    /[A-Za-z][+#]+$/.test(word) ||           // C++, C#
    /^[A-Za-z]+\.(js|ts|io|net|py)$/i.test(word) || // Node.js, ASP.NET
    /^[A-Za-z]+[0-9]+[A-Za-z0-9]*$/.test(word) ||   // S3, EC2, OAuth2
    /^[A-Za-z]+[-/][A-Za-z0-9]+$/.test(word) && /[A-Z]/.test(word) // CI/CD, Next-Auth
  );
}

// Technical-looking words first, then capitalized words that are not at the
// start of a sentence (product and company names: Kubernetes, Google).
function technicalWords(text) {
  const source = String(text || '');
  const technical = new Map();
  const names = new Map();
  const pattern = /[A-Za-z][A-Za-z0-9.+#/-]*[A-Za-z0-9+#]|[A-Z]/g;
  let match;
  while ((match = pattern.exec(source))) {
    const word = match[0].replace(/[.\-/]+$/, '');
    if (looksTechnical(word)) {
      technical.set(word, (technical.get(word) || 0) + 1);
      continue;
    }
    if (!/^[A-Z][a-z]{3,}$/.test(word) || COMMON.has(word.toLowerCase())) continue;
    const before = source.slice(Math.max(0, match.index - 3), match.index);
    if (match.index === 0 || /[.!?:\n\u2022*-]\s*$/.test(before)) continue;
    names.set(word, (names.get(word) || 0) + 1);
  }
  const ranked = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
  return [...ranked(technical), ...ranked(names)];
}

function extractKeyterms(profile = {}, { max = MAX_TERMS } = {}) {
  const ordered = [
    ...splitManual(profile.keyterms),
    profile.targetCompany,
    profile.targetRole,
    ...technicalWords(`${profile.jobDescription || ''}\n${profile.targetRole || ''}`),
    ...technicalWords(profile.resumeText),
    ...technicalWords(profile.notes)
  ];
  const seen = new Set();
  const terms = [];
  for (const value of ordered) {
    const term = String(value || '').trim().replace(/\s+/g, ' ');
    if (!term || term.length > MAX_TERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= max) break;
  }
  return terms;
}

module.exports = {
  extractKeyterms,
  looksTechnical,
  technicalWords
};
