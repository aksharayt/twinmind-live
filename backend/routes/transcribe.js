import { Router } from 'express';
import multer from 'multer';
import { getGroqClient } from '../utils/groq.js';
import { DEFAULT_SETTINGS } from '../utils/prompts.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25_000_000 },
});

router.post('/', upload.single('audio'), async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required in x-groq-api-key header' });
  if (!req.file) return res.status(400).json({ error: 'Audio file required' });

  const startTime = Date.now();

  try {
    const groq = getGroqClient(apiKey);
    const audioFile = new File([req.file.buffer], 'audio.webm', { type: req.file.mimetype });

    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: DEFAULT_SETTINGS.whisperModel,
      response_format: 'verbose_json',
      language: 'en',
    });

    res.json({
      text: transcription.text?.trim() ?? '',
      duration: transcription.duration ?? 0,
      latencyMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[transcribe] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;