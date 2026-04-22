import { Router } from 'express';
import { getGroqClient } from '../utils/groq.js';
import { CHAT_SYSTEM_PROMPT, DETAIL_ANSWER_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

router.post('/stream', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });

  // Every parameter comes from the client. Defaults are fallbacks only.
  const {
    message,
    transcriptContext = '',
    chatHistory       = [],
    isExpansion       = false,
    systemPrompt,
    model,
    temperature,
    maxTokens,
  } = req.body;

  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const resolvedModel       = model       ?? DEFAULT_SETTINGS.model;
  const resolvedTemperature = typeof temperature === 'number' ? temperature : DEFAULT_SETTINGS.chatTemperature;
  const resolvedMaxTokens   = typeof maxTokens   === 'number' ? maxTokens   : DEFAULT_SETTINGS.maxChatTokens;
  const basePrompt          = systemPrompt ?? (isExpansion ? DETAIL_ANSWER_PROMPT : CHAT_SYSTEM_PROMPT);

  const systemContent = `${basePrompt}

CONVERSATION TRANSCRIPT:
${transcriptContext.trim() || '(No transcript captured yet)'}`;

  const messages = [
    { role: 'system', content: systemContent },
    ...chatHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const groq   = getGroqClient(apiKey);
    const stream = await groq.chat.completions.create({
      model:       resolvedModel,
      temperature: resolvedTemperature,
      max_tokens:  resolvedMaxTokens,
      stream:      true,
      messages,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
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