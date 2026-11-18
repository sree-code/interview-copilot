'use strict';

// "Import from job post link": fetches the page and fills company, role and
// job description. Most job boards (Greenhouse, Lever, LinkedIn's public
// pages, Indeed...) embed a schema.org JobPosting block; otherwise the
// page title and visible text are used.

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, num) => String.fromCodePoint(Number(num)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n').map((line) => line.trim()).join('\n')
    .trim();
}

function findJobPosting(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const type = node['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return node;
  return findJobPosting(node['@graph']) || null;
}

function metaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(pattern)?.[0] || '';
  return decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] || '').trim();
}

function parseJobPage(html) {
  const source = String(html || '');
  const blocks = source.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const posting = findJobPosting(JSON.parse(json));
      if (posting) {
        const org = posting.hiringOrganization;
        return {
          source: 'job-posting',
          role: decodeEntities(String(posting.title || '')).trim(),
          company: decodeEntities(String(typeof org === 'string' ? org : org?.name || '')).trim(),
          // Descriptions are often HTML with its tags entity-encoded.
          jobDescription: htmlToText(decodeEntities(posting.description || ''))
        };
      }
    } catch (_) { /* malformed block, try the next */ }
  }

  const title = metaContent(source, 'og:title') || decodeEntities(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const body = source.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || source;
  return {
    source: 'page-text',
    role: title.split(/\s[|\-–—]\s/)[0].trim(),
    company: metaContent(source, 'og:site_name'),
    jobDescription: htmlToText(body)
  };
}

async function importJobFromUrl(rawUrl, { fetchImpl = globalThis.fetch } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new Error('That is not a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) links are supported.');
  }

  const response = await fetchImpl(url.toString(), {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    }
  });
  if (!response.ok) {
    throw new Error(`The page returned ${response.status}. If it needs a sign-in, paste the description instead.`);
  }
  const html = (await response.text()).slice(0, MAX_BYTES);
  const job = parseJobPage(html);
  job.jobDescription = job.jobDescription.slice(0, 20000);
  if (job.jobDescription.length < 200) {
    throw new Error('Could not read the job description from that page (it may need a sign-in or load with JavaScript). Paste it instead.');
  }
  return job;
}

module.exports = {
  htmlToText,
  importJobFromUrl,
  parseJobPage
};
