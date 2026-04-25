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

  // Lower threshold — browser chunks can be small but still valid
  if (!req.file.buffer || req.file.buffer.length < 100) {
    return res.status(400).json({ error: 'Audio chunk too small.' });
  }

  const whisperModel = req.headers['x-whisper-model'] ?? DEFAULT_SETTINGS.whisperModel;
  const whisperLanguage = req.headers['x-whisper-language'] ?? DEFAULT_SETTINGS.whisperLanguage;
  const startMs = Date.now();

  try {
    const BlobImpl = globalThis.Blob ?? BufferBlob;
    const buf = req.file.buffer;
    
    // Force webm mime — browsers sometimes send wrong content-type
    // Whisper accepts webm, ogg, mp4, wav, flac, m4a
    const rawMime = req.file.mimetype || 'audio/webm';
    const mime = rawMime.includes('ogg') ? 'audio/ogg' : 'audio/webm';
    const name = mime.includes('ogg') ? 'audio.ogg' : 'audio.webm';

    const FileCtor = globalThis.File;
    const filePart = FileCtor
      ? new FileCtor([buf], name, { type: mime })
      : Object.assign(new BlobImpl([buf], { type: mime }), { name });

    const form = new FormData();
    form.append('file', filePart);
    form.append('model', whisperModel);
    form.append('response_format', 'json'); // verbose gives us duration + segments
    if (whisperLanguage) form.append('language', whisperLanguage);

    const rsp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const result = await rsp.json();
    if (!rsp.ok) {
      const msg = result?.error?.message || result?.error || 'Transcription failed';
      console.error('[transcribe] Groq error:', msg, '| file size:', buf.length, '| mime:', mime);
      return res.status(rsp.status).json({ error: msg });
    }

    const text = (result.text ?? '').trim();
    console.log(`[transcribe] OK: ${text.length} chars in ${Date.now() - startMs}ms`);
    
    return res.json({
  text,
  latencyMs: Date.now() - startMs,
});

export default router;