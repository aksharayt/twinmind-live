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
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

  // All parameters are overridable — client sends them, we fall back to defaults
  const whisperModel = req.headers['x-whisper-model'] ?? DEFAULT_SETTINGS.whisperModel;
  const whisperLanguage = req.headers['x-whisper-language'] ?? DEFAULT_SETTINGS.whisperLanguage;

  const startMs = Date.now();

  try {
    const groq = getGroqClient(apiKey);
    const audioFile = new File([req.file.buffer], 'audio.webm', { type: req.file.mimetype });

    const result = await groq.audio.transcriptions.create({
      file: audioFile,
      model: whisperModel,
      response_format: 'verbose_json',
      language: whisperLanguage,
    });

    return res.json({
      text: (result.text ?? '').trim(),
      duration: result.duration ?? 0,
      whisperModel,
      latencyMs: Date.now() - startMs,
    });
  } catch (err) {
    console.error('[transcribe]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;