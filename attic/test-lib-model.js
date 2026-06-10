'use strict';
// Model-interaction utilities extracted from test-lib.js in v4 (Task 0).
// Retained in attic/ for reference; no longer part of the active codebase.

// `format`: 'json' for free-form JSON mode, a JSON Schema OBJECT for
// Ollama structured outputs (grammar-constrained decoding), or false for plain text.
// `user` may be a string or a full messages array.
async function askOllama(model, system, user, { format = 'json' } = {}) {
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),
    Number(process.env.OLLAMA_TIMEOUT_MS || 300000));
  const userMessages = Array.isArray(user)
    ? user
    : [{ role: 'user', content: user }];
  const body = {
    model, stream: false,
    options: { temperature: 0, think: false },
    messages: [
      { role: 'system', content: system },
      ...userMessages,
    ],
  };
  if (format) body.format = format;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.message && data.message.content) || '';
  } finally {
    clearTimeout(timeout);
  }
}

// Pull the first balanced top-level JSON object out of a model reply.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return body.slice(start, i + 1); }
    }
  }
  return null;
}

module.exports = { askOllama, extractJson };
