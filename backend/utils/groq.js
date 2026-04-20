import Groq from 'groq-sdk';

// Single client instance per API key — avoids re-instantiating on every request
let _client = null;
let _currentKey = null;

export function getGroqClient(apiKey) {
  if (!apiKey) throw new Error('Groq API key required');
  if (_currentKey !== apiKey) {
    _client = new Groq({ apiKey });
    _currentKey = apiKey;
  }
  return _client;
}

// Trim text to a maximum word count from the end (most recent context)
export function trimToWords(text, maxWords) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(-maxWords).join(' ');
}

// Validate that parsed suggestions match expected schema
export function validateSuggestions(parsed) {
  if (!parsed?.suggestions || !Array.isArray(parsed.suggestions)) return false;
  if (parsed.suggestions.length === 0) return false;
  const required = ['type', 'title', 'preview', 'detail_prompt'];
  return parsed.suggestions.every(s => required.every(k => typeof s[k] === 'string'));
}