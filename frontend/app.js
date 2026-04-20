// ============================================================
//  TwinMind Live Suggestions — Frontend Application
// ============================================================

import { DEFAULT_SETTINGS, TYPE_META } from './constants.js';

const API_BASE = '/api';

// ─── Application State ───────────────────────────────────────────────────────
const state = {
  isRecording:        false,
  mediaRecorder:      null,
  audioChunks:        [],
  transcriptChunks:   [],   // [{ text: string, timestamp: Date }]
  suggestionBatches:  [],   // [{ suggestions: [], timestamp: Date }]
  chatHistory:        [],   // [{ role: string, content: string, timestamp: Date }]
  settings:           loadSettings(),
  refreshTimerId:     null,
  countdownTimerId:   null,
  secondsUntilRefresh: 0,
  chunkFlushTimerId:  null,
  metrics: {
    transcribeMs:   null,
    suggestionsMs:  null,
    chatFirstToken: null,
  },
};

// ─── DOM References ───────────────────────────────────────────────────────────
const el = {
  btnMic:                document.getElementById('btnMic'),
  micHint:               document.getElementById('micHint'),
  recordingStatus:       document.getElementById('recordingStatus'),
  sessionStatus:         document.getElementById('sessionStatus'),
  transcriptEmpty:       document.getElementById('transcriptEmpty'),
  transcriptChunks:      document.getElementById('transcriptChunks'),
  transcriptScroll:      document.getElementById('transcriptScroll'),
  batchCount:            document.getElementById('batchCount'),
  btnRefresh:            document.getElementById('btnRefresh'),
  refreshTimer:          document.getElementById('refreshTimer'),
  refreshIcon:           document.getElementById('refreshIcon'),
  suggestionsFeed:       document.getElementById('suggestionsFeed'),
  chatMessages:          document.getElementById('chatMessages'),
  chatWelcome:           document.getElementById('chatWelcome'),
  chatInput:             document.getElementById('chatInput'),
  btnSend:               document.getElementById('btnSend'),
  btnSettings:           document.getElementById('btnSettings'),
  btnExport:             document.getElementById('btnExport'),
  btnSummary:            document.getElementById('btnSummary'),
  settingsOverlay:       document.getElementById('settingsOverlay'),
  btnCloseSettings:      document.getElementById('btnCloseSettings'),
  btnSaveSettings:       document.getElementById('btnSaveSettings'),
  btnResetSettings:      document.getElementById('btnResetSettings'),
  settingApiKey:         document.getElementById('settingApiKey'),
  settingModel:          document.getElementById('settingModel'),
  settingCtxSuggestion:  document.getElementById('settingCtxSuggestion'),
  settingCtxChat:        document.getElementById('settingCtxChat'),
  settingRefreshInterval:document.getElementById('settingRefreshInterval'),
  settingSuggestionPrompt:document.getElementById('settingSuggestionPrompt'),
  settingDetailPrompt:   document.getElementById('settingDetailPrompt'),
  settingChatPrompt:     document.getElementById('settingChatPrompt'),
  latencyTranscribe:     document.getElementById('latencyTranscribe'),
  latencySuggestions:    document.getElementById('latencySuggestions'),
  latencyChat:           document.getElementById('latencyChat'),
  latencyPanel:          document.getElementById('latencyPanel'),
};

// ─── Settings Persistence ─────────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = sessionStorage.getItem('tm_settings');
    if (!saved) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings() {
  sessionStorage.setItem('tm_settings', JSON.stringify(state.settings));
}

// ─── Recording ────────────────────────────────────────────────────────────────
async function startRecording() {
  if (!state.settings.apiKey) {
    openSettings();
    setTimeout(() => alert('Please paste your Groq API key, then click Save.'), 100);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // Determine supported MIME type
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    state.mediaRecorder = new MediaRecorder(stream, { mimeType });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = evt => {
      if (evt.data.size > 0) state.audioChunks.push(evt.data);
    };

    state.mediaRecorder.onstop = async () => {
      if (state.audioChunks.length === 0) return;
      const blob = new Blob(state.audioChunks, { type: mimeType });
      state.audioChunks = [];
      await transcribeAndProcess(blob);
    };

    // Start recording — request data every N seconds
    const chunkMs = state.settings.autoRefreshSeconds * 1000;
    state.mediaRecorder.start(chunkMs);

    // Flush data periodically so transcript updates even during long recording
    state.chunkFlushTimerId = setInterval(() => {
      if (state.mediaRecorder?.state === 'recording') {
        state.mediaRecorder.requestData();
      }
    }, chunkMs);

    state.isRecording = true;
    updateRecordingUI(true);
    startRefreshCycle();
    el.btnSummary.disabled = false;
  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Microphone permission denied. Please allow mic access and try again.'
      : `Microphone error: ${err.message}`;
    alert(msg);
    console.error('[recording]', err);
  }
}

function stopRecording() {
  if (state.mediaRecorder?.state === 'recording') {
    state.mediaRecorder.requestData();
    state.mediaRecorder.stop();
    state.mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(state.chunkFlushTimerId);
  clearInterval(state.refreshTimerId);
  clearInterval(state.countdownTimerId);
  state.isRecording = false;
  updateRecordingUI(false);
}

// ─── Transcription ────────────────────────────────────────────────────────────
async function transcribeAndProcess(blob) {
  const formData = new FormData();
  formData.append('audio', blob, 'audio.webm');

  const start = Date.now();

  try {
    const res = await fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: { 'x-groq-api-key': state.settings.apiKey },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (!data.text?.trim()) return;

    const latencyMs = Date.now() - start;
    state.metrics.transcribeMs = latencyMs;
    updateLatencyDisplay('transcribe', latencyMs);

    appendTranscriptChunk(data.text.trim());
  } catch (err) {
    console.error('[transcribe]', err.message);
  }
}

function appendTranscriptChunk(text) {
  const chunk = { text, timestamp: new Date() };
  state.transcriptChunks.push(chunk);

  if (el.transcriptEmpty) el.transcriptEmpty.remove();

  const div = document.createElement('div');
  div.className = 'transcript-chunk';
  div.innerHTML = `
    <div class="transcript-chunk-time">${formatTime(chunk.timestamp)}</div>
    <div class="transcript-chunk-text">${escapeHtml(text)}</div>
  `;
  el.transcriptChunks.appendChild(div);
  el.transcriptScroll.scrollTop = el.transcriptScroll.scrollHeight;
}

// ─── Suggestions ──────────────────────────────────────────────────────────────
function startRefreshCycle() {
  state.secondsUntilRefresh = state.settings.autoRefreshSeconds;

  state.countdownTimerId = setInterval(() => {
    state.secondsUntilRefresh = Math.max(0, state.secondsUntilRefresh - 1);
    el.refreshTimer.textContent = `auto-refresh in ${state.secondsUntilRefresh}s`;
  }, 1000);

  state.refreshTimerId = setInterval(async () => {
    await fetchSuggestions();
    state.secondsUntilRefresh = state.settings.autoRefreshSeconds;
  }, state.settings.autoRefreshSeconds * 1000);
}

async function fetchSuggestions() {
  const transcript = state.transcriptChunks.map(c => c.text).join(' ');
  if (!transcript.trim()) return;

  setRefreshLoading(true);
  renderSkeletonBatch();

  const start = Date.now();

  try {
    const res = await fetch(`${API_BASE}/suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-groq-api-key': state.settings.apiKey,
      },
      body: JSON.stringify({
        recentTranscript: transcript,
        previousSuggestions: state.suggestionBatches.map(b => b.suggestions),
        settings: {
          suggestionContextWords: state.settings.suggestionContextWords,
          model: state.settings.model,
          suggestionPrompt: state.settings.suggestionPrompt,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const latencyMs = Date.now() - start;
    state.metrics.suggestionsMs = latencyMs;
    updateLatencyDisplay('suggestions', latencyMs);

    state.suggestionBatches.unshift({ suggestions: data.suggestions, timestamp: new Date() });
    renderAllBatches();
    el.batchCount.textContent = `${state.suggestionBatches.length} BATCH${state.suggestionBatches.length !== 1 ? 'ES' : ''}`;
  } catch (err) {
    console.error('[suggestions]', err.message);
    removeSkeletonBatch();
  } finally {
    setRefreshLoading(false);
  }
}

function renderAllBatches() {
  el.suggestionsFeed.innerHTML = '';

  state.suggestionBatches.forEach((batch, index) => {
    const batchEl = document.createElement('div');
    batchEl.className = `suggestion-batch${index > 0 ? ' batch-older' : ''}`;

    const labelEl = document.createElement('div');
    labelEl.className = 'batch-label';
    labelEl.textContent = index === 0
      ? `Latest — ${formatTime(batch.timestamp)}`
      : formatTime(batch.timestamp);
    batchEl.appendChild(labelEl);

    batch.suggestions.forEach(s => batchEl.appendChild(buildSuggestionCard(s)));
    el.suggestionsFeed.appendChild(batchEl);
  });
}

function buildSuggestionCard(suggestion) {
  const meta = TYPE_META[suggestion.type] ?? TYPE_META.QUESTION;

  const card = document.createElement('div');
  card.className = 'suggestion-card';
  card.style.setProperty('--card-accent', meta.accent);
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${meta.label}: ${suggestion.title}`);

  card.innerHTML = `
    <div class="card-type-badge">${escapeHtml(meta.label)}</div>
    <div class="card-title">${escapeHtml(suggestion.title)}</div>
    <div class="card-preview">${escapeHtml(suggestion.preview)}</div>
  `;

  const handleClick = () => expandSuggestion(suggestion);
  card.addEventListener('click', handleClick);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handleClick(); });

  return card;
}

function renderSkeletonBatch() {
  const skeletonEl = document.createElement('div');
  skeletonEl.className = 'suggestion-batch skeleton-batch';
  skeletonEl.innerHTML = `
    <div class="skeleton"></div>
    <div class="skeleton"></div>
    <div class="skeleton"></div>
  `;
  el.suggestionsFeed.insertBefore(skeletonEl, el.suggestionsFeed.firstChild);
}

function removeSkeletonBatch() {
  el.suggestionsFeed.querySelector('.skeleton-batch')?.remove();
}

function setRefreshLoading(loading) {
  if (loading) {
    el.refreshIcon.style.animation = 'spin 0.8s linear infinite';
  } else {
    el.refreshIcon.style.animation = '';
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
async function expandSuggestion(suggestion) {
  const message = suggestion.detail_prompt || suggestion.preview;
  await sendChatMessage(message, true);
}

async function sendChatMessage(message, isDetailExpansion = false) {
  if (!message.trim()) return;

  const transcript = state.transcriptChunks.map(c => c.text).join(' ');

  if (el.chatWelcome) el.chatWelcome.remove();

  appendChatBubble('user', message);
  state.chatHistory.push({ role: 'user', content: message, timestamp: new Date() });

  el.chatInput.value = '';
  el.chatInput.style.height = 'auto';
  el.btnSend.disabled = true;

  const assistantBubble = appendChatBubble('assistant', '');
  const contentEl = assistantBubble.querySelector('.chat-message-content');

  let fullResponse = '';
  let firstTokenAt = null;

  try {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-groq-api-key': state.settings.apiKey,
      },
      body: JSON.stringify({
        message,
        fullTranscript: transcript,
        chatHistory: state.chatHistory.slice(-10),
        isDetailExpansion,
        settings: {
          chatContextWords: state.settings.chatContextWords,
          detailContextWords: state.settings.detailContextWords,
          model: state.settings.model,
          chatPrompt: state.settings.chatPrompt,
          detailPrompt: state.settings.detailPrompt,
        },
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;

        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.delta) {
            if (!firstTokenAt) {
              firstTokenAt = Date.now();
            }
            fullResponse += parsed.delta;
            contentEl.textContent = fullResponse;
            el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
          }
        } catch (parseErr) {
          // Partial SSE chunk — ignore
        }
      }
    }

    if (firstTokenAt) {
      updateLatencyDisplay('chat', firstTokenAt - Date.now() + 1);
    }

    state.chatHistory.push({ role: 'assistant', content: fullResponse, timestamp: new Date() });
  } catch (err) {
    contentEl.textContent = `Error: ${err.message}`;
    console.error('[chat]', err);
  } finally {
    el.btnSend.disabled = false;
  }
}

function appendChatBubble(role, content) {
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.innerHTML = `
    <div class="chat-message-role">${role === 'user' ? 'You' : 'TwinMind'}</div>
    <div class="chat-message-content">${escapeHtml(content)}</div>
  `;
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  return div;
}

// ─── End-of-Meeting Summary ───────────────────────────────────────────────────
async function generateSummary() {
  const transcript = state.transcriptChunks.map(c => c.text).join(' ');
  if (!transcript.trim()) return;

  const summaryPrompt = `Generate a structured end-of-meeting summary based on this transcript.

Include:
1. Key decisions made
2. Action items (with owner if identifiable)
3. Open questions or unresolved topics
4. Key facts or claims discussed

Be concise and specific. Reference actual content from the transcript.`;

  await sendChatMessage(summaryPrompt, false);
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportSession() {
  const payload = {
    exportedAt: new Date().toISOString(),
    metrics: { ...state.metrics },
    settings: {
      model: state.settings.model,
      suggestionContextWords: state.settings.suggestionContextWords,
      chatContextWords: state.settings.chatContextWords,
      autoRefreshSeconds: state.settings.autoRefreshSeconds,
    },
    transcript: state.transcriptChunks.map(c => ({
      timestamp: c.timestamp.toISOString(),
      text: c.text,
    })),
    suggestionBatches: state.suggestionBatches.map(b => ({
      timestamp: b.timestamp.toISOString(),
      suggestions: b.suggestions,
    })),
    chatHistory: state.chatHistory.map(m => ({
      timestamp: m.timestamp.toISOString(),
      role: m.role,
      content: m.content,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `twinmind-session-${formatDateFile(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function openSettings() {
  el.settingApiKey.value              = state.settings.apiKey ?? '';
  el.settingModel.value               = state.settings.model;
  el.settingCtxSuggestion.value       = state.settings.suggestionContextWords;
  el.settingCtxChat.value             = state.settings.chatContextWords;
  el.settingRefreshInterval.value     = state.settings.autoRefreshSeconds;
  el.settingSuggestionPrompt.value    = state.settings.suggestionPrompt;
  el.settingDetailPrompt.value        = state.settings.detailPrompt;
  el.settingChatPrompt.value          = state.settings.chatPrompt;
  el.settingsOverlay.classList.remove('hidden');
  el.settingApiKey.focus();
}

function closeSettings() {
  el.settingsOverlay.classList.add('hidden');
}

function applySettings() {
  state.settings.apiKey                  = el.settingApiKey.value.trim();
  state.settings.model                   = el.settingModel.value.trim();
  state.settings.suggestionContextWords  = parseInt(el.settingCtxSuggestion.value, 10);
  state.settings.chatContextWords        = parseInt(el.settingCtxChat.value, 10);
  state.settings.autoRefreshSeconds      = parseInt(el.settingRefreshInterval.value, 10);
  state.settings.suggestionPrompt        = el.settingSuggestionPrompt.value.trim();
  state.settings.detailPrompt            = el.settingDetailPrompt.value.trim();
  state.settings.chatPrompt              = el.settingChatPrompt.value.trim();
  persistSettings();
  closeSettings();
}

function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  Object.assign(state.settings, DEFAULT_SETTINGS);
  persistSettings();
  openSettings();
}

// ─── Latency Display ─────────────────────────────────────────────────────────
function updateLatencyDisplay(type, ms) {
  const roundedMs = Math.round(ms);
  const isFast = ms < 3000;

  let labelEl;
  let label;

  if (type === 'transcribe') {
    labelEl = el.latencyTranscribe;
    label = `Transcribe: ${roundedMs}ms`;
  } else if (type === 'suggestions') {
    labelEl = el.latencySuggestions;
    label = `Suggestions: ${roundedMs}ms`;
  } else {
    labelEl = el.latencyChat;
    label = `Chat token: ${roundedMs}ms`;
  }

  labelEl.textContent = label;
  labelEl.classList.remove('hidden', 'fast', 'slow');
  labelEl.classList.add(isFast ? 'fast' : 'slow');
}

// ─── UI State ────────────────────────────────────────────────────────────────
function updateRecordingUI(isRecording) {
  el.btnMic.classList.toggle('recording', isRecording);
  el.micHint.textContent        = isRecording ? 'Click to stop recording' : 'Click mic to start recording';
  el.recordingStatus.textContent = isRecording ? 'RECORDING' : 'IDLE';
  el.sessionStatus.textContent   = isRecording ? 'RECORDING' : 'IDLE';
  el.sessionStatus.classList.toggle('recording', isRecording);
  el.btnRefresh.disabled         = !isRecording;
  el.btnSend.disabled            = !isRecording && state.chatHistory.length === 0;
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────
function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateFile(date) {
  return date.toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
el.btnMic.addEventListener('click', () => {
  state.isRecording ? stopRecording() : startRecording();
});

el.btnRefresh.addEventListener('click', async () => {
  if (!state.isRecording && state.transcriptChunks.length === 0) return;
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.requestData();
  await fetchSuggestions();
  state.secondsUntilRefresh = state.settings.autoRefreshSeconds;
});

el.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage(el.chatInput.value);
  }
});

el.chatInput.addEventListener('input', () => {
  el.chatInput.style.height = 'auto';
  el.chatInput.style.height = `${Math.min(el.chatInput.scrollHeight, 120)}px`;
  el.btnSend.disabled = !el.chatInput.value.trim();
});

el.btnSend.addEventListener('click', () => sendChatMessage(el.chatInput.value));

el.btnSettings.addEventListener('click', openSettings);
el.btnCloseSettings.addEventListener('click', closeSettings);
el.btnSaveSettings.addEventListener('click', applySettings);
el.btnResetSettings.addEventListener('click', resetSettings);
el.btnExport.addEventListener('click', exportSession);
el.btnSummary.addEventListener('click', generateSummary);

el.settingsOverlay.addEventListener('click', e => {
  if (e.target === el.settingsOverlay) closeSettings();
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !el.settingsOverlay.classList.contains('hidden')) closeSettings();
});

// ─── Initial State ────────────────────────────────────────────────────────────
// If no API key is stored, open settings immediately
if (!state.settings.apiKey) {
  openSettings();
}