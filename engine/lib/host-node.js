/* ============================================================
   engine/lib/host-node.js — Node host adapter for the owner editor

   The owner-editor session model (engine/lib/owner.js) is storage- and
   environment-agnostic: it keeps ALL the deterministic logic (patch
   construction, the one-pending-change rule, the staged list, change-card
   derivation, replay orchestration, the ledger boundary) and delegates
   every side effect — reading/writing candidate + live content, image
   bytes, building the preview, publishing, the maintenance ledger — to an
   injected "host". This file is the DEFAULT host: it does on disk exactly
   what owner.js used to do inline, so the Node path (engine/serve.js and the
   proof suite) is behavior-identical.

   A second host (engine/lib/host-browser.js, added later) drives the same
   owner.js entirely in-memory for the no-install demo editor, where the only
   difference is that Publish is disabled — a property of the host, never a
   fork of the keep/staged flow.

   PER-CLIENT CONFIG (clients/<client>/owner-config.json) and the publish
   command live here because they are inherently Node/git concerns; see the
   header of owner.js for the field reference.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_SUFFIX = '__candidate';
const PUBLISH_MARKER = client => `[blockson-publish ${client}]`;

const DEFAULT_CONFIG = {
  clientName: null,            // falls back to the client id
  publish: 'git',
  publishMessage: 'Site update ({client}): {summary} {marker}',
  contact: null,
  host: '127.0.0.1',
  port: 4173,
  allowRemote: false,
  accessToken: '',             // enforced by serve.js when non-empty; required for allowRemote
};

// ── Maintenance ledger ─────────────────────────────────────────
const LEDGER_FILE = 'edits.log.jsonl';
const LEDGER_ROTATED = 'edits.log.1.jsonl';
const LEDGER_MAX_BYTES = 1024 * 1024;

function loadConfig(client) {
  const p = path.join(ROOT, 'clients', client, 'owner-config.json');
  let fileCfg = {};
  if (fs.existsSync(p)) {
    try { fileCfg = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`owner-config.json is not valid JSON: ${e.message}`); }
  }
  return { ...DEFAULT_CONFIG, ...fileCfg };
}

function publishModeOf(config) {
  if (config.publish === 'none') return 'none';
  if (config.publish === 'git' || config.publish == null) return 'git';
  return 'custom';
}

/* Build the default Node host for one client. Owns paths, disk I/O, the
   preview/live builds (spawned engine/build.js), the publish command, and
   the per-client ledger. `overrides` mirror the CLI flags serve.js passes. */
function createNodeHost(client, overrides) {
  if (!/^[a-zA-Z0-9_-]+$/.test(client || '')) {
    throw new Error(`invalid client name "${client}"`);
  }
  const candidateClient = client + CANDIDATE_SUFFIX;
  const config = { ...loadConfig(client), ...(overrides || {}) };

  const liveDir = () => path.join(ROOT, 'clients', client);
  const candDir = () => path.join(ROOT, 'clients', candidateClient);
  const liveContentPath = () => path.join(liveDir(), 'content.json');
  const candContentPath = () => path.join(candDir(), 'content.json');
  const candDistDir = () => path.join(ROOT, 'dist', candidateClient + '__annotated');
  const candImgDir = () => path.join(candDir(), 'img');

  function buildClient(name, annotate) {
    const args = [path.join(ROOT, 'engine', 'build.js'), name];
    if (annotate) args.push('--annotate');
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
  }
  function git(args) {
    return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  }

  function buildCandidate() { return buildClient(candidateClient, true); }
  function buildLive()      { return buildClient(client, false); }

  /* Reset the candidate from live: a full copy, minus the ledger (a
     live-dir-only artifact, not site content — it never rides into the
     candidate copy). */
  function resetCandidateFromLive() {
    fs.rmSync(candDir(), { recursive: true, force: true });
    fs.cpSync(liveDir(), candDir(), {
      recursive: true,
      filter: src => !path.basename(src).startsWith('edits.log'),
    });
  }

  function presetTokens(content) {
    const theme = (content.site && content.site.theme) || 'default';
    const p = path.join(ROOT, 'themes', theme, 'tokens.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
  }

  /* Append one event line to the per-client ledger. Logging is a courtesy,
     not a control: every failure in here is swallowed by design — a ledger
     problem must never block, fail, or alter the edit it describes. */
  function ledgerAppend(entry) {
    try {
      const file = path.join(liveDir(), LEDGER_FILE);
      try {
        if (fs.statSync(file).size > LEDGER_MAX_BYTES) {
          const rotated = path.join(liveDir(), LEDGER_ROTATED);
          fs.rmSync(rotated, { force: true });
          fs.renameSync(file, rotated);
        }
      } catch (e) { /* no existing ledger — nothing to rotate */ }
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    } catch (e) { /* swallowed by design — see above */ }
  }

  function publishMessageFor(summary) {
    return String(config.publishMessage || DEFAULT_CONFIG.publishMessage)
      .replace(/\{client\}/g, client)
      .replace(/\{summary\}/g, summary || 'content update')
      .replace(/\{marker\}/g, PUBLISH_MARKER(client));
  }

  function runPublish(summary) {
    const mode = publishModeOf(config);
    if (mode === 'none') {
      return { ok: true, skipped: true, message: 'Saved and rebuilt locally. Publishing is turned off for this client (publish: "none").' };
    }
    const message = publishMessageFor(summary);

    if (mode === 'custom') {
      // {message} is interpolated into a SHELL command, so it is reduced to a
      // conservative character set first (the summary embeds free-form owner
      // text such as a blueprint's menu label). The git path below needs no
      // such reduction — there the message travels as a spawn argument.
      const shellSafeMessage = message.replace(/[^\w \[\]().,:'/-]+/g, ' ').trim();
      const cmd = String(config.publish)
        .replace(/\{message\}/g, shellSafeMessage)
        .replace(/\{client\}/g, client);
      const r = spawnSync(cmd, { shell: true, cwd: ROOT, encoding: 'utf8' });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      if (r.error) return { ok: false, message: `The publish command could not be run: ${r.error.message}. The site was updated locally but not published.` };
      return r.status === 0
        ? { ok: true, message: 'Published.' }
        : { ok: false, message: `The publish command failed (the site was updated locally but not published):\n${out}` };
    }

    // mode === 'git' (default): add → commit → push, with plain-language
    // failure messages at each step.
    const probe = git(['--version']);
    if (probe.error && probe.error.code === 'ENOENT') {
      return { ok: false, message: 'git is not installed (or not on PATH). The site was updated locally but not published.' };
    }
    const toAdd = [path.join('clients', client, 'content.json')];
    if (fs.existsSync(path.join(liveDir(), 'img'))) {
      toAdd.push(path.join('clients', client, 'img'));
    }
    const add = git(['add', '--', ...toAdd]);
    if (add.status !== 0) {
      return { ok: false, message: `Could not stage the change for publishing:\n${(add.stderr || '').trim()}` };
    }
    const commit = git(['commit', '-m', message]);
    if (commit.status !== 0) {
      return { ok: false, message: `Could not record the change for publishing:\n${((commit.stdout || '') + (commit.stderr || '')).trim()}` };
    }
    const push = git(['push']);
    if (push.status !== 0) {
      return { ok: false, retryable: true, message: `The change was saved locally, but sending it to the host failed. Use Retry publish after the connection or host is fixed:\n${((push.stdout || '') + (push.stderr || '')).trim()}` };
    }
    return { ok: true, message: 'Published — the change is on its way to the live site.' };
  }

  function retryPublish(summary) {
    const mode = publishModeOf(config);
    if (mode === 'git') {
      const push = git(['push']);
      return push.status === 0
        ? { ok: true, message: 'Published — the waiting local change was sent to the host.' }
        : { ok: false, retryable: true, message: `Still could not send the waiting local change:\n${((push.stdout || '') + (push.stderr || '')).trim()}` };
    }
    if (mode === 'custom') return runPublish(summary || 'content update');
    return { ok: true, skipped: true, message: 'Publishing is turned off for this client.' };
  }

  /* Ship the whole staged session to live in one step: candidate content
     (+ every image the session uploaded) copied to live, live rebuilt
     WITHOUT annotations, then the publish command run ONCE. A failing live
     rebuild rolls everything back — live is never left updated-and-broken.
     Returns { ok, live, ... }: `live` is true once live content was written,
     which is what tells owner.publish() to clear the staged session. */
  function shipSession({ uploads, summary }) {
    const liveBackup = fs.readFileSync(liveContentPath(), 'utf8');
    fs.writeFileSync(liveContentPath(), fs.readFileSync(candContentPath(), 'utf8'), 'utf8');

    const copied = [];
    for (const name of uploads) {
      const src = path.join(candImgDir(), name);
      const dst = path.join(liveDir(), 'img', name);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied.push(dst);
    }

    const b = buildLive();
    if (!b.ok) {
      // Should be impossible (the same content already built as the candidate)
      // — but never leave live updated-and-broken. Roll everything back.
      fs.writeFileSync(liveContentPath(), liveBackup, 'utf8');
      for (const f of copied) fs.rmSync(f, { force: true });
      buildLive();
      return { ok: false, live: false, buildFailed: true, error: `The live rebuild failed unexpectedly; the live site was left unchanged:\n${b.out}` };
    }

    const result = runPublish(summary);
    return { ok: true, live: true, publish: result };
  }

  /* Revert the last publish commit (found by the marker the default publish
     message embeds), rebuild live + candidate, republish. One publish = one
     commit = the whole session, so this reverts the whole session as one
     unit. */
  function restore() {
    let log = git(['log', '-n', '1', '--fixed-strings', '--grep', PUBLISH_MARKER(client), '--format=%H']);
    if (log.error && log.error.code === 'ENOENT') {
      return { ok: false, error: 'git is not installed (or not on PATH), so there is no publish history to restore from.' };
    }
    const hash = (log.stdout || '').trim();
    if (log.status !== 0 || !hash) {
      return { ok: false, error: 'No published change was found for this client — nothing to restore.' };
    }
    const revert = git(['revert', '--no-edit', hash]);
    if (revert.status !== 0) {
      git(['revert', '--abort']);
      return { ok: false, error: `Could not undo the last publish automatically:\n${((revert.stdout || '') + (revert.stderr || '')).trim()}` };
    }

    resetCandidateFromLive();
    const live = buildLive();
    const cand = buildCandidate();
    if (!live.ok || !cand.ok) {
      return { ok: false, buildFailed: true, error: `The undo was committed but the rebuild failed:\n${(live.ok ? '' : live.out)}\n${(cand.ok ? '' : cand.out)}`.trim() };
    }

    let publish;
    const mode = publishModeOf(config);
    if (mode === 'git') {
      const push = git(['push']);
      publish = push.status === 0
        ? { ok: true, message: 'The previous version is live again (reverted and pushed).' }
        : { ok: false, message: `Reverted locally, but the push failed:\n${((push.stdout || '') + (push.stderr || '')).trim()}` };
    } else if (mode === 'custom') {
      publish = runPublish(`restore previous version`);
    } else {
      publish = { ok: true, skipped: true, message: 'Reverted locally. Publishing is turned off for this client.' };
    }
    return { ok: true, publish };
  }

  return {
    config,
    // Content store
    readCandidateText: () => fs.readFileSync(candContentPath(), 'utf8'),
    writeCandidateText: (text) => fs.writeFileSync(candContentPath(), text, 'utf8'),
    readLiveText: () => fs.readFileSync(liveContentPath(), 'utf8'),
    writeLiveText: (text) => fs.writeFileSync(liveContentPath(), text, 'utf8'),
    liveExists: () => fs.existsSync(liveContentPath()),
    resetCandidateFromLive,
    // Images (candidate-side; publish copies them to live)
    writeCandidateImage: (name, bytes) => {
      fs.mkdirSync(candImgDir(), { recursive: true });
      fs.writeFileSync(path.join(candImgDir(), name), bytes);
    },
    removeCandidateImage: (name) => fs.rmSync(path.join(candImgDir(), name), { force: true }),
    candidateImageExists: (name) => fs.existsSync(path.join(candImgDir(), name)),
    // Builds
    buildCandidate,
    buildLive,
    // Derived data
    presetTokens,
    publishMode: () => publishModeOf(config),
    // Maintenance ledger
    ledgerAppend,
    // Whole-session operations
    shipSession,
    retryPublish,
    restore,
    // Path accessors used by engine/serve.js
    candDistDir,
    candContentPath,
    liveContentPath,
  };
}

module.exports = { createNodeHost, loadConfig, CANDIDATE_SUFFIX, DEFAULT_CONFIG };
