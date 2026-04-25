import { Router } from 'express';
import { getGroqClient } from '../utils/groq.js';
import { CHAT_SYSTEM_PROMPT, DETAIL_ANSWER_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

function buildMessages(body) {
  const {
    message,
    transcriptContext = '',
    chatHistory = [],
    isExpansion = false,
    systemPrompt,
  } = body;

  const basePrompt = systemPrompt ?? (isExpansion ? DETAIL_ANSWER_PROMPT : CHAT_SYSTEM_PROMPT);
  const systemContent = `${basePrompt}

CONVERSATION TRANSCRIPT:
${String(transcriptContext).trim() || '(No transcript captured yet)'}`;

  const history = Array.isArray(chatHistory) ? chatHistory : [];
  const safeHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }));

  return [
    { role: 'system', content: systemContent },
    ...safeHistory,
    { role: 'user', content: String(message).trim() },
  ];
}

function resolveChatParams(body) {
  const { model, temperature, maxTokens } = body;
  return {
    model:       model ?? DEFAULT_SETTINGS.model,
    temperature: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : DEFAULT_SETTINGS.chatTemperature,
    maxTokens:   typeof maxTokens === 'number' && Number.isFinite(maxTokens) ? maxTokens : DEFAULT_SETTINGS.maxChatTokens,
  };
}

/** Non-streaming fallback (reliable through proxies). */
router.post('/complete', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const { model, temperature, maxTokens } = resolveChatParams(req.body);
  const messages = buildMessages(req.body);

  try {
    const groq = getGroqClient(apiKey);
    const completion = await groq.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      messages,
    });
    const text = completion.choices?.[0]?.message?.content ?? '';
    return res.json({ text: String(text).trim(), model });
  } catch (err) {
    console.error('[chat/complete]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/stream', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const { model, temperature, maxTokens } = resolveChatParams(req.body);
  const messages = buildMessages(req.body);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const groq = getGroqClient(apiKey);
    const stream = await groq.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      messages,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      const piece = (delta?.content ?? delta?.reasoning ?? '').toString();
      if (piece) res.write(`data: ${JSON.stringify({ delta: piece })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[chat/stream]', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
