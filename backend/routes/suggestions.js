import { Router } from 'express';
import { getGroqClient, trimToWords, validateSuggestions } from '../utils/groq.js';
import { SUGGESTION_SYSTEM_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

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
    const completion = await groq.chat.completions.create({
      model:           resolvedModel,
      temperature:     resolvedTemperature,
      max_tokens:      resolvedMaxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: resolvedPrompt },
        { role: 'user',   content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Model returned invalid JSON — try again' });
    }

    if (!validateSuggestions(parsed)) {
      // Retry once with a stricter prompt appended rather than failing silently
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