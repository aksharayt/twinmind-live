import { Router } from 'express';
import multer from 'multer';
import { DEFAULT_SETTINGS } from '../utils/prompts.js';
import { Blob as BufferBlob } from 'node:buffer';

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
    // Use direct multipart request to Groq for max compatibility with browser-recorded blobs.
    const BlobImpl = globalThis.Blob ?? BufferBlob;
    const audioBlob = new BlobImpl([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });

    const form = new FormData();
    form.append('file', audioBlob, req.file.originalname || 'audio.webm');
    form.append('model', whisperModel);
    form.append('response_format', 'verbose_json');
    if (whisperLanguage) form.append('language', whisperLanguage);

    const rsp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const result = await rsp.json();
    if (!rsp.ok) {
      const msg = result?.error?.message || result?.error || 'Transcription request failed';
      return res.status(rsp.status).json({ error: msg });
    }

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