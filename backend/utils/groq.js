import Groq from 'groq-sdk';

let _client     = null;
let _currentKey = null;

// Returns a cached Groq client, recreating only when the key changes.
export function getGroqClient(apiKey) {
  if (!apiKey) throw new Error('Groq API key is required');
  if (_currentKey !== apiKey) {
    _client     = new Groq({ apiKey });
    _currentKey = apiKey;
  }
  return _client;
}

// Trim a string to its last N words (most recent context).
export function trimToWords(text, maxWords) {
  if (!text?.trim()) return '';
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text : words.slice(-maxWords).join(' ');
}

// Validate that the model returned a properly shaped suggestions array.
export function validateSuggestions(parsed) {
  if (!Array.isArray(parsed?.suggestions) || parsed.suggestions.length === 0) return false;
  const required = ['type', 'title', 'preview', 'detail_prompt'];
  return parsed.suggestions.every(s => required.every(k => typeof s[k] === 'string' && s[k].length > 0));
}