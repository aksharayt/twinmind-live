import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import rateLimit    from 'express-rate-limit';
import transcribeRouter  from './routes/transcribe.js';
import suggestionsRouter from './routes/suggestions.js';
import chatRouter        from './routes/chat.js';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.options(/.*/, cors());
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs:       60_000,
  max:            100,
  standardHeaders: true,
  legacyHeaders:  false,
});
app.use('/api', limiter);

app.use('/api/transcribe',  transcribeRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/chat',        chatRouter);

app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`[server] running on port ${PORT}`));