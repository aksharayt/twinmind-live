import { Router } from 'express';
import { getGroqClient, trimToWords } from '../utils/groq.js';
import { CHAT_SYSTEM_PROMPT, DETAIL_ANSWER_SYSTEM_PROMPT, DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();

// Streaming endpoint for all chat messages and suggestion expansions
router.post('/stream', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  const { message, fullTranscript, chatHistory = [], isDetailExpansion = false, settings = {} } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  const contextWords = isDetailExpansion
    ? (settings.detailContextWords ?? DEFAULT_SETTINGS.detailContextWords)
    : (settings.chatContextWords ?? DEFAULT_SETTINGS.chatContextWords);

  const model = settings.model ?? DEFAULT_SETTINGS.model;
  const basePrompt = isDetailExpansion
    ? (settings.detailPrompt ?? DETAIL_ANSWER_SYSTEM_PROMPT)
    : (settings.chatPrompt ?? CHAT_SYSTEM_PROMPT);

  const transcriptContext = trimToWords(fullTranscript ?? '', contextWords);

  const systemContent = `${basePrompt}

CONVERSATION TRANSCRIPT:
${transcriptContext || '(No transcript captured yet)'}`;

  const messages = [
    { role: 'system', content: systemContent },
    ...chatHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // Set SSE headers before streaming begins
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const groq = getGroqClient(apiKey);
    const stream = await groq.chat.completions.create({
      model,
      messages,
      temperature: 0.5,
      max_tokens: DEFAULT_SETTINGS.maxChatTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[chat/stream] Error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;