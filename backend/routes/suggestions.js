import { Router } from 'express';
import { getGroqClient, trimToWords, validateSuggestions } from '../utils/groq.js';
import { SUGGESTION_SYSTEM_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

function parseJsonLoose(raw) {
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
    suggestions: arr.map((s, i) => ({
      type: String(s.type || 'CLARIFY').toUpperCase(),
      title: String(s.title || `Suggestion ${i + 1}`).trim(),
      preview: String(s.preview || s.summary || '').trim(),
      detail_prompt: String(s.detail_prompt || s.detailPrompt || s.preview || '').trim(),
      evidenceQuote: typeof s.evidenceQuote === 'string' ? s.evidenceQuote.trim() : '',
      confidence: typeof s.confidence === 'string' ? s.confidence.trim() : '',
    })).filter(s => s.title && s.preview && s.detail_prompt),
  };
}

router.post('/', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });

  // Every parameter comes from the client. Defaults are fallbacks only.
  const {
    systemPrompt,
    userMessage,
    model,
    temperature,
    maxTokens,
  } = req.body;

  if (!userMessage?.trim()) return res.status(400).json({ error: 'userMessage is required' });

  const resolvedModel       = model       ?? DEFAULT_SETTINGS.model;
  const resolvedPrompt      = systemPrompt ?? SUGGESTION_SYSTEM_PROMPT;
  const resolvedTemperature = typeof temperature === 'number' ? temperature : DEFAULT_SETTINGS.suggestionTemperature;
  const resolvedMaxTokens   = typeof maxTokens   === 'number' ? maxTokens   : DEFAULT_SETTINGS.maxSuggestionTokens;

  const startMs = Date.now();

  try {
    const groq       = getGroqClient(apiKey);
    let completion = await groq.chat.completions.create({
      model:           resolvedModel,
      temperature:     resolvedTemperature,
      max_tokens:      resolvedMaxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: resolvedPrompt },
        { role: 'user',   content: userMessage },
      ],
    });

    let raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed = normalizeSuggestions(parseJsonLoose(raw));

    if (!validateSuggestions(parsed)) {
      // Retry once with stricter instruction when model drifts from schema.
      completion = await groq.chat.completions.create({
        model:           resolvedModel,
        temperature:     0.2,
        max_tokens:      resolvedMaxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: resolvedPrompt },
          { role: 'user', content: `${userMessage}\n\nReturn only valid JSON with key "suggestions" and exactly 3 items.` },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? '{}';
      parsed = normalizeSuggestions(parseJsonLoose(raw));
    }

    if (!validateSuggestions(parsed)) {
      return res.status(500).json({ error: 'Model response failed schema validation' });
    }

    return res.json({
      suggestions: parsed.suggestions.slice(0, 3),
      model:       resolvedModel,
      latencyMs:   Date.now() - startMs,
    });
  } catch (err) {
    console.error('[suggestions]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;