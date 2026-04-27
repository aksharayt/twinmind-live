# TwinMind Live Suggestions

A real-time AI meeting copilot built for the TwinMind take-home assignment. It listens to your microphone, transcribes speech as you talk, and surfaces three contextual suggestions every few seconds to help you stay sharp during any conversation — whether that is a team standup, a client call, or a technical discussion.

Built by Akshara Tarikere.

Live app: https://twinmind-live-umber.vercel.app  
GitHub: https://github.com/aksharayt/twinmind-live

---

## What it does

The app runs three things in parallel the moment you start recording.

On the left, your speech is transcribed in real time using Groq Whisper. Each chunk of speech appears as you talk, timestamped, so you always have a clean record of what was said.

In the middle, the AI generates three fresh suggestions every few seconds based on what was just spoken. These are not generic prompts. Each suggestion is grounded in the actual words from the conversation and can be one of six types: a follow-up question worth asking, a talking point to raise, a direct answer to a question just asked, a fact check on something that was stated, a clarification on a term or acronym, or an action item to capture. The mix of types changes based on what the conversation actually needs at that moment.

On the right, clicking any suggestion opens a detailed, structured answer in the chat panel. You can also type your own questions about the meeting at any time and get answers that reference what was actually said.

When you stop recording, the app automatically generates a meeting summary with action items and owners, key decisions made, open questions left unresolved, and a breakdown of the topics covered. Every summary is saved in your browser and accessible from the View Summary button at any point, even across sessions.

---

## How to use the live app

No installation required. The app runs entirely in your browser.

**Step 1: Open the app**

Go to https://twinmind-live-umber.vercel.app in Chrome. Chrome is strongly recommended because it produces the audio format that Groq Whisper handles most reliably.

**Step 2: Get a free Groq API key**

Go to https://console.groq.com and create a free account. Navigate to API Keys, click Create API Key, and copy the key that appears. It will start with gsk_.

**Step 3: Add your key in Settings**

Click the Settings button in the top right corner of the app. Paste your Groq API key into the first field. The Backend URL field should already contain https://twinmind-backend-6wc0.onrender.com. Leave it as is. Click Save Settings.

**Step 4: Record a meeting**

Click the blue microphone button and allow microphone access when the browser prompts you. Start speaking. The transcript will appear in the left column within a few seconds. Suggestions will appear in the middle column automatically. Click any card to get a detailed answer in the right panel, or type a question directly into the chat input.

**Step 5: Stop and review**

Click the red microphone button to stop. The app generates a meeting summary in the background. When it is ready, you will see a toast notification. Click View Summary to read the structured output. You can rename the summary, copy it as plain text, or delete it. Click Export Session to download a complete JSON file with the full transcript, every suggestion batch, and the chat history.

---

## Running locally

**What you need**

- Node.js version 18 or higher
- A Groq API key from https://console.groq.com

**Step 1: Clone the repo**


git clone https://github.com/aksharayt/twinmind-live
cd twinmind-live


**Step 2: Start the backend**


cd backend
npm install
node server.js


The backend starts on port 3001. Open http://localhost:3001/health in your browser to confirm it is running. You should see {"status":"ok"}.

**Step 3: Open the frontend**

Open frontend/index.html directly in your browser. There is no build step and no package to install for the frontend.

Once it opens, go to Settings. Set the Backend URL to http://localhost:3001. Paste your Groq API key. Click Save Settings. Then click the microphone button to begin.

---

## Project structure


twinmind-live/
├── frontend/
│   ├── index.html        # Complete UI, all client logic, and styles in one file
│   └── vercel.json       # Routes /api requests to the Render backend
├── backend/
│   ├── server.js         # Express server with CORS, rate limiting, and routing
│   ├── routes/
│   │   ├── transcribe.js # Receives audio blobs and calls Groq Whisper
│   │   ├── suggestions.js# Generates three contextual suggestions per refresh
│   │   └── chat.js       # Handles streaming and non-streaming chat responses
│   └── utils/
│       ├── groq.js       # Groq SDK client, JSON parsing, and validation helpers
│       └── prompts.js    # All default prompts and model configuration
└── README.md


---

## Tech stack

Frontend: Plain HTML, CSS, and JavaScript with no framework and no build step. The entire UI lives in a single index.html file.

Backend: Node.js with Express 5, deployed on Render.

Transcription: Groq Whisper Large V3 Turbo.

Suggestions and chat: Groq meta-llama/llama-4-scout-17b-16e-instruct (configurable in Settings).

Frontend hosting: Vercel.

Backend hosting: Render.

---

## Prompt strategy

Getting suggestions to feel genuinely useful rather than generic was the central challenge of this project.

**Live suggestions**

The suggestion system prompt instructs the model to produce exactly three items per refresh. Each item must have a specific type chosen from QUESTION, TALKING_POINT, ANSWER, FACT_CHECK, CLARIFY, or ACTION_ITEM. The model is told to vary the types across the three items based on what the conversation actually needs, to tie every suggestion to specific words spoken in the transcript, and never to repeat a title that appeared in a previous batch. The previously seen titles are passed back in every request so the model has full context on what has already been surfaced.

Each suggestion includes a preview that delivers standalone value without requiring the user to click, and a separate detail_prompt field that is used to generate the expanded answer when a card is clicked. This separation means the preview and the detailed answer are optimised differently — one for quick scanning, one for depth.

The backend does not use Groq's json_object response format for suggestions. The GPT-OSS class of models can fail Groq's strict JSON validator and return a 400 error. Instead, the server parses JSON from plain text using a loose parser that strips markdown fences and extracts the object by bracket matching. If the first attempt produces invalid output, the server retries once with stricter instructions appended to the user message.

**Chat**

The chat system prompt receives the full transcript excerpt and the last ten conversation turns as history. Responses stream token by token using server-sent events so the first words appear almost immediately. If the SSE stream returns nothing, the client automatically falls back to a standard POST request that returns the complete response at once. This fallback handles cases where a proxy or CDN buffers the stream before it reaches the browser.

**Meeting summary**

When recording stops, the full session transcript is sent to the model with a prompt requesting structured JSON containing a meeting title, an overview paragraph, action items with owners and deadlines, key decisions, open questions, and topic summaries. The model is instructed to return only the JSON object with no markdown wrapping. The result is parsed, enriched with session metadata like duration and word count, saved to localStorage, and displayed in a structured modal. Summaries persist across browser sessions and can be renamed, copied, or deleted individually.

---

## Architecture decisions

**Single index.html for the frontend**

The entire frontend is one HTML file with no build toolchain. This was a deliberate choice. It is fast to iterate on, trivially easy to deploy to any static host, easy for a reviewer to open directly in a browser, and produces no dependency surface that can break. The tradeoff is a longer file, but the code is organised into clearly separated sections.

**WebM audio chunking and the header problem**

The browser MediaRecorder API produces WebM audio. Groq Whisper requires a complete, decodable WebM file for every request. A continuation chunk without the file header cannot be decoded and returns a 400 error. The app solves this by always prepending the very first recorded chunk, which contains the WebM EBML header, to every blob that gets sent. New audio collected since the last transcription is appended after the header. Every request Groq receives is therefore a complete, self-contained WebM file.

**Why text-level deduplication does not work**

An earlier approach tried to detect repeated transcript content by comparing each Whisper response to the previously displayed text and showing only the new portion. This broke consistently because Whisper is non-deterministic. It transcribes the same audio slightly differently across calls, so word-level comparison failed and the same sentences would appear twice. The current approach sends only genuinely new audio in each interval, which means Whisper returns only new speech and no text comparison is needed at all.

**Backend on Render, frontend on Vercel**

Vercel's edge network can buffer server-sent events on certain routes, which prevents streaming chat from working correctly. Keeping the backend on Render ensures SSE works reliably. The frontend is configured to call the Render backend directly for all API requests rather than going through Vercel's proxy rewrite.

---

## API reference

All endpoints are available at https://twinmind-backend-6wc0.onrender.com

POST /api/transcribe  
Accepts multipart/form-data with an audio field containing the audio blob.  
Required header: x-groq-api-key  
Optional headers: x-whisper-model, x-whisper-language  
Returns: { text, latencyMs }

POST /api/suggestions  
Accepts JSON with userMessage and optionally systemPrompt, model, temperature, maxTokens.  
Required header: x-groq-api-key  
Returns: { suggestions, model, latencyMs }

POST /api/chat/stream  
Accepts JSON with message, transcriptContext, chatHistory, isExpansion, and optionally systemPrompt, model, temperature, maxTokens.  
Required header: x-groq-api-key  
Returns server-sent events with data: {"delta":"..."} lines followed by data: [DONE]

POST /api/chat/complete  
Same request body as /api/chat/stream.  
Returns: { text, model }

GET /health  
Returns: { status: "ok", ts: timestamp }

---

## Troubleshooting

**Suggestions return a 404 model error**  
The model name on your Groq key does not match. Open Settings and update the LLM Model field to a model listed under your key at console.groq.com.

**Transcription error: could not process file**  
The audio chunk was too small. Speak for at least three seconds before the first chunk is sent.

**Chat sends but nothing appears**  
The SSE stream is being buffered. Confirm the Backend URL in Settings points directly to the Render URL and not the Vercel proxy.

**Microphone permission denied**  
The browser blocked microphone access. Click the lock icon in the address bar, allow microphone access, and reload the page.

**Summary says generation failed**  
The model returned malformed JSON. Click View Summary and try again. It usually succeeds on a second attempt.

**CORS error in browser console**  
The Backend URL has a trailing slash. Remove it from the Backend URL field in Settings.

**Mic button does nothing**  
The page is not served over HTTPS. Use the deployed Vercel URL or localhost. Plain IP addresses do not have microphone access permission in browsers.

---

## Deployment

**Backend on Render**  
Root directory: backend  
Build command: npm install  
Start command: node server.js  
No environment variables are required. The Groq API key is sent by the client on every request.

**Frontend on Vercel**  
Root directory: frontend  
No build command needed.  
The vercel.json file rewrites /api requests to the Render backend as a fallback. The app calls the backend directly via the Backend URL setting, so the rewrite is only used if the direct URL is not configured.

---

## License

MIT
