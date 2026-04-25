import express       from 'express';
import cors          from 'cors';
import helmet        from 'helmet';
import rateLimit     from 'express-rate-limit';
import transcribeRouter   from './routes/transcribe.js';
import suggestionsRouter  from './routes/suggestions.js';
import chatRouter         from './routes/chat.js';

const app = express();
app.set('trust proxy', 1);

// Security
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
// Express 5 + path-to-regexp no longer accepts '*' for routes.
// Use a regex to cover all OPTIONS preflight requests.
app.options(/.*/, cors());

app.use(express.json({ limit: '10mb' }));

// Rate limiting — 100 requests per minute per IP
const limiter = rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

// Routes
app.use('/api/transcribe',  transcribeRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/chat',        chatRouter);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// 404
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`[server] Running on port ${PORT}`));