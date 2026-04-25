import { Router } from 'express';
import { getGroqClient, validateSuggestions } from '../utils/groq.js';
import { SUGGESTION_SYSTEM_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

function parseJsonLoose(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch {}

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }

  return null;
}

function normalizeSuggestions(parsed) {
  if (!parsed) return null;
  const arr = Array.isArray(parsed.suggestions) ? parsed.suggestions : null;
  if (!arr) return null;

  return {
    suggestions: arr.map((s, i) => {
      const title = String(s.title || `Suggestion ${i + 1}`).trim();
      const preview = String(s.preview || s.summary || '').trim();
      const detail_prompt = String(s.detail_prompt || s.detailPrompt || preview || '').trim();
      const evidenceQuote = typeof s.evidenceQuote === 'string' ? s.evidenceQuote.trim() : '';
      const confidence = typeof s.confidence === 'string' ? s.confidence.trim() : 'med';
      return {
        type: String(s.type || 'CLARIFY').toUpperCase(),
        title,
        preview,
        detail_prompt,
        evidenceQuote: evidenceQuote || preview.slice(0, 80),
        confidence: confidence || 'med',
      };
    }).filter(s => s.title && s.preview && s.detail_prompt),
  };
}

async function callSuggestionsModel(groq, body, useJsonObject) {
  const {
    systemPrompt,
    userMessage,
    model,
    temperature,
    maxTokens,
  } = body;

  const resolvedModel = model ?? DEFAULT_SETTINGS.model;
  const resolvedPrompt = systemPrompt ?? SUGGESTION_SYSTEM_PROMPT;
  const resolvedTemperature = typeof temperature === 'number' ? temperature : DEFAULT_SETTINGS.suggestionTemperature;
  const resolvedMaxTokens = typeof maxTokens === 'number' ? maxTokens : DEFAULT_SETTINGS.maxSuggestionTokens;

  const req = {
    model: resolvedModel,
    temperature: resolvedTemperature,
    max_tokens: resolvedMaxTokens,
    messages: [
      { role: 'system', content: resolvedPrompt },
      { role: 'user', content: userMessage },
    ],
  };
  if (useJsonObject) req.response_format = { type: 'json_object' };
  return groq.chat.completions.create(req);
}

router.post('/', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });

  const { userMessage, model } = req.body;
  if (!userMessage?.trim()) return res.status(400).json({ error: 'userMessage is required' });

  const resolvedModel = model ?? DEFAULT_SETTINGS.model;
  const startMs = Date.now();

  try {
    const groq = getGroqClient(apiKey);

    // Do NOT use response_format json_object with models that emit reasoning or invalid JSON
    // (Groq returns 400 json_validate_failed). Parse plain text as JSON instead.
    let completion = await callSuggestionsModel(groq, req.body, false);
    let raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed = normalizeSuggestions(parseJsonLoose(raw));

    if (!validateSuggestions(parsed)) {
      completion = await callSuggestionsModel(groq, {
        ...req.body,
        userMessage: `${userMessage}\n\nReply with ONLY one JSON object (no markdown). Shape: {"suggestions":[{"type":"QUESTION","title":"...","preview":"...","evidenceQuote":"...","confidence":"high","detail_prompt":"..."}, ...]} with exactly 3 items.`,
      }, false);
      raw = completion.choices[0]?.message?.content ?? '{}';
      parsed = normalizeSuggestions(parseJsonLoose(raw));
    }

    if (!validateSuggestions(parsed)) {
      return res.status(500).json({ error: 'Model response failed schema validation — try lowering suggestion temperature in Settings.' });
    }

    return res.json({
      suggestions: parsed.suggestions.slice(0, 3),
      model: resolvedModel,
      latencyMs: Date.now() - startMs,
    });
  } catch (err) {
    console.error('[suggestions]', err?.message || err);
    const msg = String(err?.message || err || 'Suggestions request failed');
    const status = /400|json_validate|invalid_request/i.test(msg) ? 502 : 500;
    return res.status(status).json({ error: msg });
  }
});

export default router;
