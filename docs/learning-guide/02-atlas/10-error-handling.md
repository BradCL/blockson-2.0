# Atlas 10 — Error handling: failing loudly vs. failing silently

## In class you learned…

`try/catch`, throwing exceptions, and maybe "always handle your errors."
The unstated assumption was that handling means catching — and that
catching is always good.

## In Blockson it lives at…

Everywhere, with an unusual property: the codebase chooses *per error*
whether to fail loudly, roll back, degrade, or deliberately swallow — and
writes the choice down. Study these four files in this order:

1. `engine/build.js` — loud failure (exit, nothing written)
2. `engine/apply-patch.js` — rollback (restore the backup)
3. `engine/lib/validate.js` — degradation (fallback validator + warning)
4. `engine/lib/owner.js`, `ledgerWrite` — deliberate swallowing

## A guided read-through

**Loud.** `build.js` validates, then:

```js
if (!result.ok) {
  console.error('Validation failed:');
  result.errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}
```

No partial output, no "built with warnings" — the contract is binary.
Note the *shape* of loudness: errors go to **stderr**, each names the
exact field, and the exit code is non-zero so callers can branch on it.

**Rollback.** `apply-patch.js` writes the patched content, rebuilds, and
if the rebuild fails:

```js
fs.writeFileSync(contentPath, originalText, 'utf8');
console.error(`Build failed after patch; content.json restored.\n${stderr}`);
process.exit(1);
```

The error is still loud — but the *system state* is restored first.
`applyEdit` in `owner.js` does the same dance on the candidate, then
rebuilds the preview "to the last good state" so even the owner's iframe
never shows a broken page.

**Degradation.** `validate.js`, when ajv isn't installed, switches to
`fallbackValidate` and attaches:

```js
result.warnings = [
  'AJV not installed — field-level validation is disabled. Run: npm install',
];
```

Reduced service, loudly labeled, with the fix in the message.

**Deliberate swallowing.** `ledgerWrite` in `owner.js`:

```js
fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
} catch (e) { /* swallowed by design — see above */ }
```

The comment above it explains: "Logging is a courtesy, not a control: a
ledger problem must never block, fail, or alter the edit it describes."
An owner mid-edit should not be stopped because a *log file* is
unwritable. The empty catch is the right call — *because* someone decided
it, wrote down why, and proof 16 tests that an unwritable ledger doesn't
block edits.

> **Term: failing loudly.** Surfacing a problem immediately and
> unmissably (error message + non-zero exit + nothing half-done) instead
> of continuing in a corrupted or ambiguous state. Its opposite — the
> silent failure — is the most expensive bug class in production, because
> nobody knows when it started.

## What production adds

- **Refusal is not an error.** `apply-patch.js` exits `0` for a *refused*
  patch (`Refused: <reason>`) and `1` for an invalid one. The resolver
  saying "no, that's out of scope" is the system *working*. Designing
  your statuses means deciding which "failures" are actually successes.
- **Errors are part of the UI.** The resolver's messages are written for
  their reader: `"items cannot be added to or removed from text sections
  on this site — that is developer work"` (`scaffold.removeItem`). The
  token guard's rejection text *is* what the owner sees in the color
  picker (`checkToken` returns `result.error` verbatim). Compare
  `formatErrors` translating ajv output for developers. Same principle,
  two audiences.
- **Should-be-impossible branches still get handled.** `owner.publish`
  rebuilds live content that *already built* as the candidate — and still
  has a rollback branch, commented "Should be impossible … but never
  leave live updated-and-broken." Production code handles the failure it
  can't explain, because disks fill and processes die.
- **Warnings and errors are different species.** Heavy images and the
  `https://UNCONFIGURED` placeholder *warn* and build anyway
  (`warnOnHeavyImages`, `warnOnPlaceholderForms` — "warnings never fail a
  build", proof 14); schema violations *fail*. Quality advice must never
  be able to block a correct deploy, and a correctness violation must
  never be demoted to advice.

## Why here, why this way

The error policy follows the trust model. The developer's tools fail loud
and fast — they can read a stack trace, and an early hard stop is
cheapest. The owner's tools never leave broken state — every failure
rolls back to the last good site, and the message explains in plain
language what didn't happen and why. Same engine, two failure cultures,
each matched to who's standing in front of the error. When you design
error handling, start there: *who sees this, and what can they do about
it?*
