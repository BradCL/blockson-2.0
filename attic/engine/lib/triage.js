/* ============================================================
   engine/lib/triage.js — Deterministic request pre-filter (v3.1)

   The AGENT_INSTRUCTIONS "hard stops" exist as prose the model must
   obey. Live testing (gemma3:1b) shows small models complying with
   styling requests by writing the styling WORDS into a legal content
   field — a wrong write the resolver cannot catch, because the
   resolver never sees the request. So enforce the hard stops here,
   in code, by narrowing which patch actions the per-request schema
   offers AT ALL.

   Returns { allowedActions, note } — allowedActions is null (no
   restriction) or an array passed to buildPatchSchema(). "refuse"
   is always re-added by the schema builder, so the model always has
   an exit.

   v3.1: TEXT-side color requests refuse outright. Pair-exclusion
   (SPEC §9) says owners may only ever change the BACKGROUND/brand
   side of a contrast pair — live testing (gemma3:4b) showed that
   when the token path was open, "change the body text color to
   white" became set-token --color-primary #ffffff: a complete,
   format-valid patch the resolver rightly accepts on dark themes.
   The contrast guard polices READABILITY, not INTENT; intent must
   be refused here, before the model ever sees the request.

   Known cost: a request like 'change the headline to "Bold Ideas"'
   trips the style filter and degrades to a refusal. That is a
   helpfulness cost ("email the developer"), never a safety cost —
   the correct side of the trade for an unattended pipeline.
   ============================================================ */

'use strict';

// Pure styling / structural vocabulary → only "refuse" is offered.
const HARD_STOP = new RegExp([
  '\\bfonts?\\b', '\\btypefaces?\\b', '\\barial\\b', '\\bhelvetica\\b',
  '\\bbold\\b', '\\bitalic\\b', '\\bunderline\\b',
  '\\bbigger\\b', '\\bsmaller\\b', '\\bfont.?size\\b', '\\btext.?size\\b',
  '\\bspacing\\b', '\\blayout\\b', '\\bwider\\b', '\\btaller\\b',
  '\\bmove the\\b', '\\bre-?arrange\\b',
  '\\bnew page\\b', '\\badd a page\\b', '\\bdelete (the |a )?page\\b',
  '\\brename\\b.*\\bid\\b', '\\bchange\\b.*\\bid\\b',
].join('|'), 'i');

const COLOR_WORDS = 'red|green|blue|white|black|yellow|orange|purple|pink|teal|navy|gold|grey|gray|brown|silver|maroon|crimson|cream|beige';
const TEXT_NOUNS  = 'text|fonts?|headings?|headlines?|paragraphs?|letters?|words?|prices?|links?|labels?';

// TEXT-side color requests → only "refuse" is offered. The model may
// never satisfy a text-color request by writing a background/brand
// token instead (pair-exclusion).
const TEXT_COLOR_STOP = new RegExp([
  `\\b(?:${TEXT_NOUNS})\\b[^.?!]{0,24}\\bcolou?rs?\\b`,   // "text ... color"
  `\\bcolou?rs?\\b[^.?!]{0,24}\\b(?:${TEXT_NOUNS})\\b`,   // "color of the text"
  `\\b(?:${TEXT_NOUNS})\\b[^.?!]{0,16}\\b(?:${COLOR_WORDS})\\b`, // "prices red"
  `\\b(?:${COLOR_WORDS})\\b[^.?!]{0,16}\\b(?:${TEXT_NOUNS})\\b`, // "red headings"
].join('|'), 'i');

// Remaining color vocabulary → only "set-token" (gated by the safe-token
// allowlist + contrast guard) or "refuse" are offered. A plain "set"
// can no longer smuggle a color request into a content field.
const COLOR_TALK = new RegExp(
  `\\bcolou?rs?\\b|\\bbrand colou?r\\b|#[0-9a-f]{3,6}\\b|\\b(?:${COLOR_WORDS})\\b`, 'i');

function triageRequest(text) {
  const t = String(text || '');
  if (HARD_STOP.test(t)) {
    return { allowedActions: ['refuse'], note: 'hard-stop vocabulary (styling/structural)' };
  }
  if (TEXT_COLOR_STOP.test(t)) {
    return { allowedActions: ['refuse'], note: 'text-side color request (pair-exclusion)' };
  }
  if (COLOR_TALK.test(t)) {
    return { allowedActions: ['set-token', 'refuse'], note: 'color request — token path only' };
  }
  return { allowedActions: null, note: null };
}

module.exports = { triageRequest, HARD_STOP, TEXT_COLOR_STOP, COLOR_TALK };