The response got cut off. Here is the complete README:

---

```markdown
# TwinMind Live Suggestions

A real-time AI meeting copilot that listens to your microphone, transcribes what is being said, and surfaces three contextual suggestions every few seconds to help you ask better questions, catch action items, and stay on top of the conversation.

Built by Akshara Tarikere as part of the TwinMind take-home assignment.

Live app: https://twinmind-live-umber.vercel.app

---

## What it does

You click the microphone button, start talking, and the app does three things simultaneously.

First, it transcribes your speech in real time using Groq Whisper. Second, it generates three live suggestions every few seconds based on what was just said. These could be a follow-up question worth asking, a fact that needs verifying, an action item to capture, or a term that needs clarifying. Third, when you click any suggestion, the right panel gives you a detailed, contextual answer. You can also type your own questions into the chat at any time.

When you stop recording, the app automatically generates a structured meeting summary containing action items with owners, key decisions made, open questions, and topics discussed. Every summary is saved to your browser and accessible from the View Summary button at any time.

---

## How to use the live app

No installation required. Everything runs in the browser.

**Step 1**: Open the app

Go to https://twinmind-live-umber.vercel.app in Chrome. Chrome is recommended because it has the best support for the audio recording format the app uses.

Step 2: Get a free Groq API key

Go to https://console.groq.com and create a free account. Navigate to API Keys, create a new key, and copy it. It will start with gsk_.

Step 3: Add your key in Settings

Click the Settings button in the top right corner of the app. Paste your Groq API key into the first field. The Backend URL field should already contain https://twinmind-backend-6wc0.onrender.com. Click Save Settings.

Step 4: Start recording

Click the blue microphone button. Your browser will ask for microphone permission — click Allow. Start speaking. The transcript will appear in the left column within a few seconds. Suggestions will appear in the middle column automatically every few seconds. Click any suggestion card to get a detailed answer in the chat panel on the right.

Step 5: Stop and review

Click the red microphone button to stop recording. The app will generate a meeting summary automatically. Click View Summary to see the structured output. You can rename the summary, copy it as plain text, or delete it. Use Export Session to download a complete JSON file containing the transcript, all suggestion batches, and the full chat history.

---

## Running locally

Requirements

- Node.js version 18 or higher
- A Groq API key (free at console.groq.com)

Step 1: Clone the repository

```
git clone https://github.com/aksharayt/twinmind-live
cd twinmind-live
```

Step 2: Start the backend

```
cd backend
npm install
node server.js
```

The backend starts on port 3001. Confirm it is working by opening http://localhost:3001/health in your browser. You should see: {"status":"ok"}

Step 3: Open the frontend

Open frontend/index.html directly in your browser. There is no build step.

Once it opens, go to Settings and set the Backend URL to http://localhost:3001. Paste your Groq API key and click Save Settings. Then click the microphone button to begin.

---

## Project structure

```
twinmind-live/
├── frontend/
│   ├── index.html        # Complete UI, all client logic, and styles in one file
│   └── vercel.json       # Routes /api requests to the Render backend
├── backend/
│   ├── server.js         # Express server with CORS and rate limiting
│   ├── routes/
│   │   ├── transcribe.js # Receives audio, calls Groq Whisper
│   │   ├── suggestions.js# Generates three contextual suggestions
│   │   └── chat.js       # Handles streaming and non-streaming chat
│   └── utils/
│       ├── groq.js       # Groq client setup and JSON parsing helpers
│       └── prompts.js    # All default prompts and model configuration
└── README.md
```

---

## Tech stack

| Part                 | Technology                                                      |
|----------------------|-----------------------------------------------------------------|
| Frontend             | Plain HTML, CSS, and JavaScript with no framework or build step |
| Backend              | Node.js with Express 5                                          |
| Transcription        | Groq Whisper Large V3 Turbo                                     |
| Suggestions and chat | Groq meta-llama/llama-4-scout-17b-16e-instruct                  |
| Frontend hosting     | Vercel                                                          |
| Backend hosting      | Render                                                          |
------------------------------------------------------------------------------------------

## Prompt strategy

Getting the suggestions to feel genuinely useful rather than generic was the core challenge of this assignment.

Suggestions

The suggestion prompt forces exactly three items per refresh. Each item must have a type (QUESTION, TALKING_POINT, ANSWER, FACT_CHECK, CLARIFY, or ACTION_ITEM), a short title, a preview that delivers standalone value without needing to click, and a detail prompt used to expand the answer in chat. The model is instructed to vary the types across the three items and to tie every suggestion to specific words actually spoken in the transcript. Previously seen suggestion titles are passed back in each request so the model does not repeat itself.

The app does not use Groq's json_object response format for suggestions because the GPT-OSS class of models can fail Groq's JSON validator and return a 400 error. Instead, the backend parses JSON from plain text with a loose parser and retries with stricter instructions if the first attempt fails.

Chat

The chat system prompt includes the full transcript excerpt and the last ten turns of conversation history. Responses stream token by token using server-sent events. If the stream fails or returns nothing (which can happen when a proxy buffers the connection), the client automatically falls back to a non-streaming POST request that returns the full response at once.

Summary

When recording stops, the full transcript is sent to the model with a prompt requesting structured JSON containing a title, overview, action items with owners and deadlines, key decisions, open questions, and topics discussed. The model is instructed to return only JSON with no markdown. The result is parsed, saved to localStorage, and displayed in a structured modal. The user can rename the summary and it persists across browser sessions.

---

## Architecture decisions and tradeoffs

Single index.html for the frontend

The entire frontend is one HTML file with no build toolchain. This was a deliberate choice. It is fast to iterate on, trivially easy to deploy to any static host, and easy for a reviewer to open and read. The tradeoff is that the file is long, but the code is organized into clearly separated sections with comments.

WebM audio chunking

The browser's MediaRecorder API produces WebM audio. Groq's Whisper API requires a valid, decodable WebM file — it cannot process a continuation chunk without the file header. The app solves this by always including the first recorded chunk (which contains the WebM header) when assembling each blob to send. New audio collected since the last transcription is appended after the header, so every request Groq receives is a complete, decodable file.

No cumulative transcript deduplication via text comparison

An earlier version tried to detect repeated text by comparing each Whisper response to the previously shown text. This failed because Whisper is non-deterministic — it transcribes the same audio slightly differently each time, so text-level comparison broke frequently. The current approach sends only genuinely new audio in each request, which means Whisper returns only new speech and no deduplication logic is needed at all.

Backend on Render, frontend on Vercel

Vercel's edge network buffers server-sent events on some routes, which breaks streaming chat. Keeping the backend on Render ensures SSE works reliably. The frontend connects directly to the Render URL for all API calls rather than going through Vercel's proxy.

---

## API reference

These endpoints are available on the live backend at https://twinmind-backend-6wc0.onrender.com

POST /api/transcribe
Accepts multipart/form-data with an audio field containing the audio blob.
Required header: x-groq-api-key
Optional headers: x-whisper-model, x-whisper-language
Returns: { text, latencyMs }

POST /api/suggestions
Accepts JSON with userMessage, and optionally systemPrompt, model, temperature, maxTokens.
Required header: x-groq-api-key
Returns: { suggestions, model, latencyMs }

POST /api/chat/stream
Accepts JSON with message, transcriptContext, chatHistory, isExpansion, and optionally systemPrompt, model, temperature, maxTokens.
Required header: x-groq-api-key
Returns: Server-sent events with data: {"delta":"..."} lines followed by data: [DONE]

POST /api/chat/complete
Same request body as /api/chat/stream.
Returns: { text, model }

GET /health
Returns: { status: "ok", ts: timestamp }

---

## Troubleshooting

╔═════════════════════════════════════════════╦═══════════════════════════════════════╦═════════════════════════════════════════════════════════════════════════════════╗
║ Problem                                     ║ Likely Cause                          ║            Fix                                                                  ║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬═════════════════════════════════════════════════════════════════════════════════╣
║ Suggestions return a 404 model error        ║ Model name changed on Groq            ║ Open Settings and update the LLM Model field to a model available on your key   ║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬═════════════════════════════════════════════════════════════════════════════════╣
║ Transcription error: could not process file ║ Audio chunk too small or malformed    ║ Speak for at least 3 seconds before the first chunk is sent                     ║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬═════════════════════════════════════════════════════════════════════════════════╣
║ Chat sends but nothing appears              ║ SSE stream being buffered by the host ║ Confirm the Backend URL in Settings points directly to the Render URL not the   ║
║                                             ║                                       ║  Vercel proxy                                                                   ║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬═════════════════════════════════════════════════════════════════════════════════╣
║ Microphone permission denied                ║ Browser blocked microphone access     ║ Click the lock icon in the address bar, allow microphone access, reload the page║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬══════════════════════════════════════════════════════════════ ══════════════════╣
║ Summary says generation failed              ║ Model returned malformed JSON         ║ Click View Summary and try again it usually succeeds on a second attempt        ║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬═════════════════════════════════════════════════════════════════════════════════╣
║ CORS error in browser console               ║ Backend URL has a trailing slash      ║ Remove the trailing slash from the Backend URL field in Settings                ║
╠═════════════════════════════════════════════╬═══════════════════════════════════════╬══════════════════════════════════════════════════════════ ══════════════════════╣
║ Mic button does nothing                     ║ Page not served over HTTPS            ║ Use the deployed Vercel URL or localhost as plain IP addresses will not have    ║
║                                             ║                                       ║   microphone access                                                             ║
╚═════════════════════════════════════════════╩═══════════════════════════════════════╩═════════════════════════════════════════════════════ ═══════════════════════════╝


---

## Deployment notes

The backend is deployed on Render with root directory set to backend, build command npm install, and start command node server.js.

The frontend is deployed on Vercel with root directory set to frontend. The vercel.json file rewrites all /api requests to the Render backend URL as a fallback. The app is configured to call the backend directly via the Backend URL setting, so the Vercel rewrite is only used if the direct URL is not set.

---

## License

ISC
```
