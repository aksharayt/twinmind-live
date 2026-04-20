import { Router } from 'express';
import { getGroqClient, trimToWords, validateSuggestions } from '../utils/groq.js';
import { SUGGESTION_SYSTEM_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

router.post('/', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const { recentTranscript, previousSuggestions = [], settings = {} } = req.body;
  if (!recentTranscript?.trim()) return res.status(400).json({ error: 'Transcript text required' });

  const contextWords   = settings.suggestionContextWords ?? DEFAULT_SETTINGS.suggestionContextWords;
  const model          = settings.model ?? DEFAULT_SETTINGS.model;
  const systemPrompt   = settings.suggestionPrompt ?? SUGGESTION_SYSTEM_PROMPT;
  const temperature    = DEFAULT_SETTINGS.temperature;

  const context = trimToWords(recentTranscript, contextWords);

  // Build deduplication list from the last 2 batches
  const avoidList = previousSuggestions
    .flat()
    .slice(-6)
    .map(s => `- ${s.title}`)
    .join('\n');

  const userMessage = [
    `LIVE CONVERSATION TRANSCRIPT (recent ${contextWords} words):`,
    context,
    avoidList ? `\nSUGGESTIONS ALREADY SHOWN — do NOT repeat these:\n${avoidList}` : '',
    '\nGenerate exactly 3 new suggestions now.',
  ].filter(Boolean).join('\n');

  const startTime = Date.now();

  try {
    const groq = getGroqClient(apiKey);

    const completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: DEFAULT_SETTINGS.maxSuggestionTokens,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Model returned invalid JSON' });
    }

    if (!validateSuggestions(parsed)) {
      return res.status(500).json({ error: 'Model response failed schema validation' });
    }

    // Ensure exactly 3 suggestions
    const suggestions = parsed.suggestions.slice(0, 3);

    res.json({
      suggestions,
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[suggestions] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;