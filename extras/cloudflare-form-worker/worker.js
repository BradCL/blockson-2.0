/* ============================================================
   extras/cloudflare-form-worker/worker.js — contact-form endpoint

   A deploy-time artifact, NOT engine runtime: the engine never imports
   anything under extras/ (the proof suite checks this). Deploy it once
   per client on Cloudflare, point the contact-form block's formAction
   at the worker URL, and submissions arrive as plain-text email via
   Cloudflare Email Routing — free, to the owner's VERIFIED destination
   address, with no relay subscription. Setup steps: README.md beside
   this file.

   Workers runtime API only — no npm packages, no bundler. The single
   import below ("cloudflare:email") is a Workers built-in module.
   ============================================================ */

import { EmailMessage } from 'cloudflare:email';

// A contact form's fields fit in a few KB; anything bigger is not a
// human enquiry. (Browsers always send Content-Length for form posts.)
const MAX_BODY_BYTES = 32 * 1024;

// The honeypot field the contact-form block renders in both delivery
// modes. A filled honeypot marks a bot: the submission is dropped and
// the bot receives the exact same success redirect a human would —
// never tell it the trick worked.
const HONEYPOT_FIELD = '_gotcha';

// Field names accepted into the email body when env.ALLOWED_FIELDS is
// not set. Anything not on the list is silently ignored.
const DEFAULT_ALLOWED = ['name', 'email', 'phone', 'message', '_subject'];

// Header values embed user input (the _subject field): strip anything
// that could smuggle an extra header into the hand-built MIME message.
function headerSafe(v) {
  return String(v).replace(/[\r\n]+/g, ' ').trim();
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
      return new Response('Submission too large', { status: 413 });
    }

    let form;
    try {
      form = await request.formData(); // urlencoded and multipart both parse
    } catch {
      return new Response('Expected form data', { status: 400 });
    }

    const redirect = () => new Response(null, {
      status: 303,
      headers: { Location: env.THANKS_PATH || '/' },
    });

    // Bot check first: same redirect, no email, no signal.
    if (String(form.get(HONEYPOT_FIELD) || '').trim() !== '') return redirect();

    // Whitelist of expected field names — configurable per client via the
    // ALLOWED_FIELDS var (comma-separated) to match the block's field set.
    const allowed = (env.ALLOWED_FIELDS
      ? String(env.ALLOWED_FIELDS).split(',').map(s => s.trim())
      : DEFAULT_ALLOWED).filter(f => f && f !== HONEYPOT_FIELD);

    const lines = [];
    for (const field of allowed) {
      if (field === '_subject') continue; // travels in the Subject header
      const value = form.get(field);
      if (typeof value === 'string' && value.trim() !== '') {
        lines.push(`${field}: ${value.trim()}`);
      }
    }
    if (lines.length === 0) return redirect(); // nothing a human filled in

    const subject = headerSafe(
      form.get('_subject') || `Website enquiry (${new URL(request.url).hostname})`);
    const from = headerSafe(env.MAIL_FROM);
    const to   = headerSafe(env.MAIL_TO);

    // The MIME message, by hand — one plain-text part, nothing else needed.
    const raw =
      `From: ${from}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1] || 'form-worker'}>\r\n` +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      '\r\n' +
      lines.join('\n') + '\n';

    try {
      await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
    } catch (e) {
      // A real delivery failure is reported honestly (only the honeypot
      // path lies). The visitor can fall back to phone/email.
      return new Response('Sorry — your message could not be sent. Please call or email us directly.',
        { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return redirect();
  },
};
