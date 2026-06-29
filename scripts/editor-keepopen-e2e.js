#!/usr/bin/env node
/**
 * editor-keepopen-e2e.js — browser test for the editor's keep-in-place flow
 * (engine/ui/ui.js), the behaviour the Node proof suite cannot reach because
 * it is editor-pane DOM logic driven over the real /api endpoints.
 *
 *   node scripts/editor-keepopen-e2e.js     # or: npm run test:editor
 *
 * Owner feedback was that every Save closed the editor back to "nothing
 * selected", forcing a re-find before the next related edit (worst in the hero
 * background editor: replace → save focus → save zoom). The fix keeps the editor
 * open: after a save the Now→After review renders INSIDE the editor, and Keep /
 * Discard re-open the SAME editor so the owner continues in place. The
 * one-pending-change rule is unchanged — they still keep between edits.
 *
 * This starts the real owner server (engine/serve.js) against example-restaurant
 * and drives the real app: click a field, Save, and assert the editor stays open
 * with the inline review; Keep and confirm the editor re-opens (not the standalone
 * card) with the change staged; then Discard and confirm the same. It never
 * publishes, so it touches only the gitignored candidate/ and dist/ — no git.
 *
 * Standalone (not part of `npm test`) because it needs a browser; requires the
 * Playwright Chromium that the other browser tests already depend on.
 */
'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = 'example-restaurant';
const PORT = 4182; // off the editor default (4173) and the capture flows (4180/4181)
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['engine/serve.js', CLIENT, '--port', String(PORT)],
      { cwd: ROOT });
    let buf = '';
    const timer = setTimeout(() => reject(new Error('serve.js never printed its banner:\n' + buf)), 60000);
    const onData = (d) => {
      buf += d.toString();
      if (buf.includes(BASE)) { clearTimeout(timer); resolve(proc); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE + '/');
    await page.waitForSelector('#client-name');
    const preview = page.frameLocator('#preview');
    // The candidate preview renders into the iframe; wait for the hero headline.
    await preview.locator('.hero h1').waitFor({ timeout: 30000 });

    // Open the headline editor by clicking it in the preview (the real overlay
    // → bk-edit → openEditor path), then save a change.
    await preview.locator('.hero h1').click();
    await page.waitForSelector('#editor:not([hidden])');
    await page.locator('#editor input[type="text"]').first().fill('Keep-open smoke headline');
    await page.locator('#editor button:has-text("Save")').click();

    // (1) After the save the editor STAYS OPEN with the inline review — it does
    //     not close back to the standalone pending card.
    await page.waitForSelector('#editor:has-text("Review your change")', { timeout: 60000 });
    expect(!(await page.locator('#editor').isHidden()), 'editor closed after Save (should stay open)');
    expect(await page.locator('#pending-card').isHidden(),
      'standalone #pending-card showed while an editor was open (should be inline instead)');
    expect(await page.locator('#editor button:has-text("Keep")').count() === 1,
      'inline review has no Keep button');
    expect(await page.locator('#editor button:has-text("Discard")').count() === 1,
      'inline review has no Discard button');

    // (2) Keep re-opens the SAME editor in place (the text input is back), the
    //     change is staged, and no pending card lingers.
    await page.locator('#editor button:has-text("Keep")').click();
    await page.waitForSelector('#session-card:not([hidden])', { timeout: 60000 });
    await page.locator('#editor input[type="text"]').first().waitFor({ timeout: 60000 });
    expect((await page.locator('#editor:has-text("Review your change")').count()) === 0,
      'the review stayed up after Keep (editor should have re-opened)');
    expect(await page.locator('#pending-card').isHidden(), 'pending card showed after Keep');
    expect((await page.locator('#staged-list .staged-row').count()) === 1,
      'Keep did not stage exactly one change');
    // The confirmation must survive the re-open (it is shown after openEditor,
    // which clears messages) — otherwise the owner never sees it.
    expect(!(await page.locator('#message').isHidden())
      && (await page.locator('#message').textContent()).includes('Change kept'),
      'the "Change kept" confirmation did not survive the editor re-open');

    // (3) A second edit then Discard: editor re-opens, the kept change survives,
    //     no pending remains.
    await page.locator('#editor input[type="text"]').first().fill('A second experiment');
    await page.locator('#editor button:has-text("Save")').click();
    await page.waitForSelector('#editor:has-text("Review your change")', { timeout: 60000 });
    await page.locator('#editor button:has-text("Discard")').click();
    await page.locator('#editor input[type="text"]').first().waitFor({ timeout: 60000 });
    expect((await page.locator('#editor:has-text("Review your change")').count()) === 0,
      'the review stayed up after Discard (editor should have re-opened)');
    expect(await page.locator('#pending-card').isHidden(), 'pending card showed after Discard');
    expect((await page.locator('#staged-list .staged-row').count()) === 1,
      'Discard did not preserve the one kept change');
    expect(!(await page.locator('#message').isHidden())
      && (await page.locator('#message').textContent()).includes('discarded'),
      'the "discarded" confirmation did not survive the editor re-open');

    // Tidy the session so the candidate goes back to live (gitignored either way).
    page.on('dialog', (d) => d.accept());
    await page.locator('#btn-discard-all').click();
    await page.locator('#session-card').waitFor({ state: 'hidden', timeout: 60000 });

    await context.close();
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n═══ EDITOR KEEP-OPEN E2E — Save keeps the editor in place; Keep/Discard re-open it ═══');
  if (failures.length === 0) {
    console.log('PASS — saving a change leaves the editor open with the Now→After review inline');
    console.log('       (not the standalone card); Keep stages the change and re-opens the same');
    console.log('       editor; a later Discard drops only the experiment and re-opens the editor,');
    console.log('       with the kept change still staged.');
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach((f) => console.log(`       ✗ ${f}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
