# TwinMind — Live Suggestions (assignment)

Live mic → chunked transcription (Groq Whisper) → three contextual suggestions (Groq chat) → click or type for detailed chat. Session export (JSON). **Bring your own Groq API key** (Settings).

## Stack

| Layer | Choice |
|--------|--------|
| Frontend | Static `index.html` + CSS + JS (no build step) |
| Backend | Node.js + Express 5 |
| AI | Groq: `whisper-large-v3` (or configurable), `openai/gpt-oss-120b` for suggestions + chat |
| Hosting | Frontend: Vercel. Backend: Render (or any Node host). |

## Repo layout

```
twinmind-live/
├── frontend/
│   ├── index.html      # entire UI + client logic
│   └── vercel.json     # rewrites /api/* → your backend (optional if using direct API base)
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── transcribe.js   # POST /api/transcribe (multipart audio)
│   │   ├── suggestions.js  # POST /api/suggestions (JSON in/out)
│   │   └── chat.js         # POST /api/chat/stream | /api/chat/complete
│   └── utils/
│       ├── groq.js
│       └── prompts.js      # default prompts + DEFAULT_SETTINGS
└── README.md
```

## Local development

### Backend

```bash
cd backend
npm install
npm run dev
# listens on PORT or 3001
```

Health: `GET http://localhost:3001/health`

### Frontend

Open `frontend/index.html` in a browser **or** serve the folder (any static server). For mic + API calls you need **HTTPS** (or localhost).

If the backend is not same-origin, set **Backend base URL** in Settings to `http://localhost:3001` (no trailing slash).

## Deploy (summary)

1. **Backend (Render)**  
   - Root directory: `backend`  
   - Build: `npm install`  
   - Start: `node server.js`  
   - Optional env: `PORT` is provided by Render.

2. **Frontend (Vercel)**  
   - Root directory: `frontend`  
   - `vercel.json` rewrites `/api/*` to your Render URL (update to match your service).

3. **Settings in the app**  
   - Paste Groq API key (`gsk_…`).  
   - **Backend base URL**: set to your Render URL so `/api` calls and **SSE chat** hit Render directly (avoids some static hosts buffering `text/event-stream`).  
   - Leave empty only if you rely entirely on same-origin `/api` rewrites and verified streaming works.

## Prompt strategy (short)

- **Live suggestions**: system prompt forces exactly three items, typed, transcript-grounded, with `preview` as standalone value and `detail_prompt` for the right-column expansion. We **do not** use Groq `response_format: json_object` for suggestions because **GPT-OSS 120B** can fail Groq’s JSON validator (`json_validate_failed`). The server parses JSON from plain text instead.
- **Chat**: system prompt + full transcript excerpt + last turns; streaming with `/api/chat/stream` and **fallback** `POST /api/chat/complete` if the stream yields no text (proxy issues).
- **Transcription**: browser sends **WebM/Opus** chunks; the client **merges** small slices before upload so Whisper receives a valid file. Recorder uses a **fixed 10s** `MediaRecorder` timeslice (independent of suggestion refresh interval).

## Troubleshooting

| Symptom | Likely cause | What to try |
|---------|----------------|-------------|
| `json_validate_failed` on suggestions | Strict JSON mode + model output | Fixed in current backend (no `json_object` for suggestions). Redeploy backend. |
| `could not process file` / invalid media | Tiny or partial WebM | Fixed by merging audio parts + 10s timeslice. Redeploy frontend. |
| Chat empty, Send seems dead | SSE buffered by host / parse errors | Set **Backend base URL** to Render; hard refresh. Check Network tab for `/api/chat/stream` or `/complete`. |
| CORS errors on direct backend | Wrong URL or backend down | Backend uses `cors({ origin: '*' })`. Confirm URL has no trailing slash. |

## API (for debugging)

- `POST /api/transcribe` — headers: `x-groq-api-key`, optional `x-whisper-model`, `x-whisper-language`. Body: `multipart/form-data` field `audio`.
- `POST /api/suggestions` — JSON `{ userMessage, systemPrompt?, model?, temperature?, maxTokens? }`.
- `POST /api/chat/stream` — JSON `{ message, transcriptContext, chatHistory, isExpansion, systemPrompt?, model?, temperature?, maxTokens? }` — SSE `data: {"delta":"..."}` lines.
- `POST /api/chat/complete` — same body as stream; JSON `{ text, model }`.

## Tradeoffs

- **Single `index.html`**: fast to ship and deploy; less modular than a bundled SPA.
- **No JSON schema enforcement on Groq for suggestions**: avoids 400s from strict JSON mode; we validate in Node and retry with stricter user message once.
- **10s transcription cadence**: assignment asked ~30s; we use 10s for reliability, while **suggestion auto-refresh** still follows Settings (`refreshSec`).

## License

ISC (see `backend/package.json`). Use for the TwinMind take-home as instructed.
