import { Router } from 'express';
import { getGroqClient, validateSuggestions } from '../utils/groq.js';
import { SUGGESTION_SYSTEM_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

function parseJsonLoose(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  // Strip markdown fences
  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  try { return JSON.parse(cleaned); } catch {}

  // Extract JSON object
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return null;
}

function normalizeSuggestions(parsed) {
  if (!parsed) return null;
  const arr = Array.isArray(parsed.suggestions) ? parsed.suggestions : null;
  if (!arr || arr.length === 0) return null;

  return {
    suggestions: arr.map((s, i) => ({
      type: String(s.type || 'QUESTION').toUpperCase(),
      title: String(s.title || `Suggestion ${i + 1}`).trim(),
      preview: String(s.preview || s.summary || '').trim(),
      detail_prompt: String(s.detail_prompt || s.detailPrompt || s.preview || '').trim(),
      evidenceQuote: String(s.evidenceQuote || '').trim().slice(0, 120),
      confidence: String(s.confidence || 'med').trim(),
    })).filter(s => s.title && s.preview && s.detail_prompt),
  };
}

async function callModel(groq, body) {
  const {
    systemPrompt,
    userMessage,
    model,
    temperature,
    maxTokens,
  } = body;

  // NEVER use response_format: json_object — causes json_validate_failed on Groq
  return groq.chat.completions.create({
    model: model ?? DEFAULT_SETTINGS.model,
    temperature: typeof temperature === 'number' ? temperature : DEFAULT_SETTINGS.suggestionTemperature,
    max_tokens: typeof maxTokens === 'number' ? maxTokens : DEFAULT_SETTINGS.maxSuggestionTokens,
    messages: [
      { role: 'system', content: systemPrompt ?? SUGGESTION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    // No response_format — parse manually
  });
}

router.post('/', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });

  const { userMessage } = req.body;
  if (!userMessage?.trim()) return res.status(400).json({ error: 'userMessage is required' });

  const startMs = Date.now();

  try {
    const groq = getGroqClient(apiKey);

    // First attempt
    let completion = await callModel(groq, req.body);
    let raw = completion.choices[0]?.message?.content ?? '';
    let parsed = normalizeSuggestions(parseJsonLoose(raw));

    // Retry with stricter instruction if first attempt failed
    if (!validateSuggestions(parsed)) {
      console.warn('[suggestions] First attempt invalid, retrying...');
      const retryBody = {
        ...req.body,
        temperature: 0.2, // lower temp for more reliable JSON
        userMessage: `${req.body.userMessage}\n\nCRITICAL: Your previous response was not valid JSON. Reply with ONLY a raw JSON object. No markdown, no explanation, no backticks. Start your response with { and end with }. Use exactly this shape: {"suggestions":[{"type":"QUESTION","title":"short title","preview":"one sentence value","evidenceQuote":"phrase from transcript","confidence":"high","detail_prompt":"expanded question"}]} with exactly 3 items.`,
      };
      completion = await callModel(groq, retryBody);
      raw = completion.choices[0]?.message?.content ?? '';
      parsed = normalizeSuggestions(parseJsonLoose(raw));
    }

    if (!validateSuggestions(parsed)) {
      console.error('[suggestions] Both attempts failed. Raw:', raw?.slice(0, 300));
      return res.status(500).json({ 
        error: 'Could not generate valid suggestions. Try refreshing or check your prompt in Settings.' 
      });
    }

    return res.json({
      suggestions: parsed.suggestions.slice(0, 3),
      model: req.body.model ?? DEFAULT_SETTINGS.model,
      latencyMs: Date.now() - startMs,
    });
  } catch (err) {
    console.error('[suggestions]', err?.message || err);
    return res.status(500).json({ error: String(err?.message || 'Suggestions request failed') });
  }
});

export default router;