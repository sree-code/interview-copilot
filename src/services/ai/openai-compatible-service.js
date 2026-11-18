'use strict';

// Provider for any OpenAI-compatible chat-completions API: OpenAI, Groq,
// Cerebras, OpenRouter, Gemini's /v1beta/openai endpoint, or a local server.
// Reuses OllamaService for the prompt-building methods (same public
// interface as GeminiService) and replaces the transport.

const OllamaService = require('./ollama-service');
const {
  buildAskAiSessionPrompt,
  buildScreenshotAnalysisPrompt
} = require('./prompts');

// Presets. Model lineups change often: run `npm run bench:llm` with your keys
// to measure time-to-first-token and pick the fastest model that works.
const OPENAI_COMPATIBLE_PRESETS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Measured 2026-11-17 on a free-tier key: gpt-oss-20b ~0.2 s to first
    // token, ~0.3 s full answer. Llama models weren't enabled for that key.
    defaultModel: 'openai/gpt-oss-20b',
    candidateModels: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'],
    supportsVision: false,
    // Screenshots go to this model as images (the main model is text-only).
    // If the key can't use it, the answer falls back to the OCR text.
    visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    envKey: 'GROQ_API_KEY'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6-luna',
    candidateModels: ['gpt-6-luna', 'gpt-6.1-terra'],
    supportsVision: true,
    envKey: 'OPENAI_API_KEY'
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'gpt-oss-120b',
    candidateModels: ['gpt-oss-120b'],
    supportsVision: false,
    envKey: 'CEREBRAS_API_KEY'
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-oss-20b',
    candidateModels: ['openai/gpt-oss-20b'],
    supportsVision: false,
    envKey: 'OPENROUTER_API_KEY'
  },
  gemini: {
    label: 'Gemini (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-4-hydrogen',
    candidateModels: ['gemini-4-hydrogen'],
    supportsVision: true,
    envKey: 'GEMINI_API_KEY'
  }
};

// gpt-oss models think before answering. At "medium" effort the thinking
// used up the token limit and answers were cut off; "low" uses ~10 tokens.
function defaultExtraBodyFor(modelName) {
  return /(^|\/)gpt-oss-/.test(String(modelName || '')) ? { reasoning_effort: 'low' } : {};
}

function resolvePreset(name) {
  return OPENAI_COMPATIBLE_PRESETS[String(name || '').toLowerCase()] || null;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted/i.test(String(error?.message || ''));
}

// Parses an SSE byte stream from /chat/completions and calls onDelta(text).
async function readChatCompletionStream(body, onDelta) {
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return true;
    try {
      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        fullText += delta;
        onDelta(delta);
      }
    } catch (_) {
      // ignore keep-alive comments / partial JSON
    }
    return false;
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (handleLine(line)) return fullText;
    }
  }
  if (buffer) handleLine(buffer);
  return fullText;
}

class OpenAICompatibleService extends OllamaService {
  constructor(options = {}) {
    super({ programmingLanguage: options.programmingLanguage, quiet: true });
    const preset = resolvePreset(options.preset);
    this.preset = options.preset || 'custom';
    this.baseUrl = String(options.baseUrl || preset?.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = String(options.apiKey || '').trim();
    this.modelName = String(options.modelName || preset?.defaultModel || '').trim();
    this.supportsVision = options.supportsVision ?? preset?.supportsVision ?? false;
    this.visionModel = this.supportsVision
      ? null
      : String(options.visionModel ?? process.env.FAST_LLM_VISION_MODEL ?? preset?.visionModel ?? '').trim() || null;
    this.extraBody = {
      ...defaultExtraBodyFor(this.modelName),
      ...(options.extraBody && typeof options.extraBody === 'object' ? options.extraBody : {})
    };
    this.maxOutputTokens = Number(options.maxOutputTokens) > 0 ? Number(options.maxOutputTokens) : null;
    this.fetchImpl = options.fetchImpl || fetch;
    this.minRequestInterval = 0;
    this.maxRetries = 2;
    // Exposed so callers that check `service.model` (Gemini convention) work.
    this.model = this.modelName ? { name: this.modelName } : null;

    if (!this.baseUrl) {
      throw new Error('OpenAI-compatible provider needs a base URL.');
    }
  }

  isQuotaExhaustedError(error) {
    return /\b429\b/.test(String(error?.message || '')) && /quota|insufficient/i.test(String(error?.message || ''));
  }

  isAuthenticationError(error) {
    return /\b(401|403)\b/.test(String(error?.message || ''));
  }

  isRetryableError(error) {
    if (isAbortError(error)) return false;
    return /\b(429|500|502|503|504)\b|ECONNRESET|fetch failed/.test(String(error?.message || ''));
  }

  _toContent(data) {
    if (typeof data === 'string') return data;
    if (!Array.isArray(data)) return String(data || '');

    const parts = [];
    for (const part of data) {
      if (typeof part === 'string') {
        parts.push({ type: 'text', text: part });
      } else if (part?.text) {
        parts.push({ type: 'text', text: part.text });
      } else if (part?.inlineData && this.canSeeImages()) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}` }
        });
      }
    }
    return parts.every((part) => part.type === 'text') ? parts.map((part) => part.text).join('\n') : parts;
  }

  canSeeImages() {
    return Boolean(this.supportsVision || this.visionModel);
  }

  _requestBody(request, stream) {
    const content = this._toContent(request.data);
    const useVisionModel = Array.isArray(content) && !this.supportsVision && this.visionModel;
    const body = {
      model: useVisionModel ? this.visionModel : this.modelName,
      messages: [{ role: 'user', content }],
      stream,
      ...(useVisionModel ? {} : this.extraBody)
    };
    const maxTokens = request.maxOutputTokens || this.maxOutputTokens;
    if (maxTokens) {
      // OpenAI's current models reject max_tokens; most other
      // OpenAI-compatible services only understand max_tokens.
      if (this.preset === 'openai') {
        body.max_completion_tokens = maxTokens;
      } else {
        body.max_tokens = maxTokens;
      }
    }
    return body;
  }

  async _post(request, stream) {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify(this._requestBody(request, stream)),
      signal: request.signal || undefined
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${this.preset} API error ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response;
  }

  async _executeRequest(request, retryCount = 0) {
    try {
      if (typeof request.onChunk === 'function') {
        const response = await this._post(request, true);
        let index = 0;
        return await readChatCompletionStream(response.body, (text) => {
          index += 1;
          request._firstChunkSent = true;
          request.onChunk({ text, index });
        });
      }

      const response = await this._post(request, false);
      const json = await response.json();
      return String(json?.choices?.[0]?.message?.content || '');
    } catch (error) {
      if (request._firstChunkSent || isAbortError(error) || retryCount >= this.maxRetries || !this.isRetryableError(error)) {
        throw error;
      }
      const backoff = Math.pow(2, retryCount) * 500;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return this._executeRequest(request, retryCount + 1);
    }
  }

  _enqueue(type, data, options = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        type,
        data,
        resolve,
        reject,
        onChunk: typeof options.onChunk === 'function' ? options.onChunk : null,
        signal: options.signal || null,
        maxOutputTokens: options.maxOutputTokens || null
      });
      this.processQueue();
    });
  }

  async generateText(prompt, options = {}) {
    return this._enqueue('text', prompt, options);
  }

  async generateMultimodal(parts, options = {}) {
    return this._enqueue('multimodal', parts, options);
  }

  async analyzeScreenshots(imageParts, additionalContext = '', options = {}) {
    const contextString = typeof options.contextStringOverride === 'string'
      ? options.contextStringOverride
      : this.getContextString();
    const prompt = buildScreenshotAnalysisPrompt({
      contextString,
      additionalContext,
      programmingLanguage: this.programmingLanguage,
      screenshotCount: imageParts.length
    });
    const textOnly = () => this.generateText(`${prompt}\n\n[The model can't see images; rely on the extracted screen text.]`, options);
    const result = this.canSeeImages()
      ? await this._withImageFallback((onChunk) => this.generateMultimodal([{ text: prompt }, ...imageParts], { ...options, onChunk }), textOnly, options)
      : await textOnly();
    this.addToHistory('assistant', `Screenshot analysis: ${result}`);
    return result;
  }

  // Image request first; if the vision model fails before any text was
  // streamed (not enabled for this key, rate limit...), answer from text.
  async _withImageFallback(withImages, textOnly, options = {}) {
    let streamed = false;
    const onChunk = typeof options.onChunk === 'function'
      ? (chunk) => { streamed = true; options.onChunk(chunk); }
      : null;
    try {
      return await withImages(onChunk);
    } catch (error) {
      if (streamed || isAbortError(error) || options.signal?.aborted) throw error;
      console.warn(`Vision request failed, using screen text instead: ${String(error?.message || error).slice(0, 160)}`);
      this.lastVisionError = String(error?.message || error).slice(0, 160);
      return textOnly();
    }
  }

  async askAiWithSessionContextAndScreenshots(imageParts, options = {}) {
    if (!this.canSeeImages()) {
      return this.askAiWithSessionContext({ ...options, screenshotCount: 0 });
    }
    const prompt = buildAskAiSessionPrompt({
      contextString: typeof options.contextString === 'string' ? options.contextString : this.getContextString(),
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenText: options.screenText || '',
      personalContext: options.personalContext || '',
      programmingLanguage: this.programmingLanguage,
      screenshotCount: options.screenshotCount || imageParts.length
    });
    const result = await this._withImageFallback(
      (onChunk) => this.generateMultimodal([{ text: prompt }, ...imageParts], { ...options, onChunk }),
      () => this.askAiWithSessionContext({ ...options, screenshotCount: 0 }),
      options
    );
    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }
}

module.exports = {
  OPENAI_COMPATIBLE_PRESETS,
  OpenAICompatibleService,
  isAbortError,
  readChatCompletionStream,
  resolvePreset
};
