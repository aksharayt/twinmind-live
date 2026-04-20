import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import transcribeRouter from './routes/transcribe.js';
import suggestionsRouter from './routes/suggestions.js';
import chatRouter from './routes/chat.js';

const app = express();

// Security headers
app.use(helmet());

// CORS — allow frontend origin
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ?? '*',
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting — 60 requests per minute per IP
const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true });
app.use('/api', limiter);

// Routes
app.use('/api/transcribe', transcribeRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/chat', chatRouter);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// 404 fallback
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`[server] Listening on port ${PORT}`));