/**
 * Flow spec: the OWNER tutorial's captures — the click-to-edit cycle in
 * the real editor (engine/serve.js): edit → pending card → Keep/Discard,
 * adding a page from a blueprint, Publish, and Restore.
 *
 *   node scripts/capture-tutorial.js scripts/flows/owner-editor.js
 *
 * Publish and Restore really run git (commit, revert, push), so this flow
 * NEVER drives the editor against this repo. setup() clones the repo into
 * a temp sandbox whose `origin` is a throwaway bare repo, junctions
 * node_modules in, and starts serve.js from the clone — every write,
 * commit, and push lands inside the sandbox, which teardown() deletes.
 * Nothing is mocked: the captures show the genuine publish/restore story.
 *
 * The steps are SEQUENTIAL (each builds on the editor session left by the
 * one before), so --only is not useful here.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SANDBOX = path.join(os.tmpdir(), 'blockson-owner-flow');
const BARE = path.join(SANDBOX, 'origin.git');
const REPO = path.join(SANDBOX, 'repo');
const PORT = 4181; // off the editor's default 4173 and the dev flow's 4180
const BASE = `http://127.0.0.1:${PORT}`;

const HEADLINE = '[data-bk-block="home-hero"][data-bk-field="headline"]';
const TAG = '[data-bk-block="home-hero"][data-bk-field="tag"]';

let editor = null;

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${(r.stdout || '') + (r.stderr || '')}`);
  }
}

function removeSandbox() {
  // The node_modules junction must go first: rmdir removes the reparse
  // point only, so the real node_modules can never be swept up.
  try { fs.rmdirSync(path.join(REPO, 'node_modules')); } catch { /* not there */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/* Open the editor app and let the candidate preview iframe render. */
async function openApp(page) {
  await page.goto(BASE + '/');
  await page.waitForSelector('#client-name');
  await page.waitForTimeout(3500);
}

const preview = page => page.frameLocator('#preview');

/* The Add-page form for the "Care Guide" content page, filled but not
   submitted — shared by the form capture and the submit step. */
async function fillCareGuideForm(page) {
  await page.click('#btn-add');
  await page.waitForSelector('#editor:not([hidden])');
  await page.locator('.bp-row', { hasText: 'Content page' }).locator('button').click();
  await page.waitForSelector('#editor input[type="text"]');
  const texts = page.locator('#editor input[type="text"]');
  await texts.nth(0).fill('Care Guide');
  await texts.nth(1).fill('Looking after your colour');
  const areas = page.locator('#editor textarea');
  await areas.nth(0).fill('Simple habits that keep your colour fresh between salon visits.');
  await areas.nth(1).fill(
    'Fresh colour is an investment, and the first week decides how long it lasts. '
    + 'Wait 48 hours before your first wash, then wash less often than you think you '
    + 'need to — twice a week is plenty for most of our colour clients.\n\n'
    + 'Use cool water and a sulphate-free shampoo. Heat opens the cuticle and lets '
    + 'colour escape, so keep hot tools to a minimum and always use a heat protectant.\n\n'
    + 'Between appointments, a toning conditioner once a week keeps blonde from going '
    + 'brassy and vivids from going muddy. Ask your stylist which one suits your '
    + 'formula — it depends on what we mixed.');
}

module.exports = {
  name: 'owner-editor',
  outDir: 'docs/tutorial/owner/img',

  setup: async () => {
    removeSandbox();
    fs.mkdirSync(SANDBOX, { recursive: true });

    // A bare clone is the sandbox's "host": pushes from the working clone
    // land there, exactly like a git-connected static host's repo.
    run('git', ['clone', '--quiet', '--bare', ROOT, BARE]);
    run('git', ['clone', '--quiet', BARE, REPO]);
    run('git', ['config', 'user.name', 'Wren & Willow Owner'], REPO);
    run('git', ['config', 'user.email', 'owner@wrenandwillow.example'], REPO);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(REPO, 'node_modules'), 'junction');

    fs.writeFileSync(path.join(REPO, 'clients', 'wren-and-willow', 'owner-config.json'),
      JSON.stringify({
        clientName: 'Wren & Willow Hair Studio',
        publish: 'git',
        contact: { name: 'Your Dev', email: 'dev@example.com' },
      }, null, 2) + '\n');

    await new Promise((resolve, reject) => {
      editor = spawn('node', ['engine/serve.js', 'wren-and-willow', '--port', String(PORT)],
        { cwd: REPO });
      let buf = '';
      const timer = setTimeout(() => reject(new Error('serve.js never printed its banner:\n' + buf)), 60000);
      const onData = d => {
        buf += d.toString();
        if (buf.includes(BASE)) { clearTimeout(timer); resolve(); }
      };
      editor.stdout.on('data', onData);
      editor.stderr.on('data', onData);
      editor.on('error', reject);
    });
  },

  teardown: async () => {
    if (editor) {
      await new Promise(resolve => {
        editor.on('exit', resolve);
        editor.kill();
        setTimeout(resolve, 3000);
      });
    }
    removeSandbox();
  },

  steps: [
    {
      slug: 'editor-home',
      description: 'The editor as it opens: live preview beside the panel, headline hovered (click-to-edit affordance)',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await preview(page).locator(HEADLINE).hover();
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'click-to-edit',
      description: 'Headline clicked in the preview: the matching editor opens in the panel',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await preview(page).locator(HEADLINE).click();
        await page.waitForSelector('#editor:not([hidden])');
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'pending-card',
      description: 'Headline edit saved: the pending card shows the change as Now → After, preview already updated',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await preview(page).locator(HEADLINE).click();
        await page.waitForSelector('#editor:not([hidden])');
        await page.locator('#editor input[type="text"]')
          .fill('Hair that still looks good six weeks from now.');
        await page.locator('#editor button:has-text("Save")').click();
        await page.waitForSelector('#pending-card:not([hidden])', { timeout: 60000 });
        await page.waitForTimeout(2500); // preview reloads with the new headline
      },
    },

    {
      slug: 'keep',
      description: 'Keep pressed: the change moves to the "Kept this session" list; nothing is live yet',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await page.waitForSelector('#pending-card:not([hidden])');
        await page.click('#btn-keep');
        await page.waitForSelector('#session-card:not([hidden])');
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'discard',
      description: 'A second edit (the hero tag) discarded: the experiment is gone, the kept change survives',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await preview(page).locator(TAG).click();
        await page.waitForSelector('#editor:not([hidden])');
        await page.locator('#editor input[type="text"]')
          .fill('Edmonton · 124 Street · Walk-ins welcome');
        await page.locator('#editor button:has-text("Save")').click();
        await page.waitForSelector('#pending-card:not([hidden])', { timeout: 60000 });
        await page.click('#btn-discard');
        await page.waitForSelector('#message:not([hidden])');
        await page.waitForTimeout(2500); // preview reloads without the experiment
      },
    },

    {
      slug: 'add-page-menu',
      description: 'The "Add a page…" menu: the developer-blessed page blueprints',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await page.click('#btn-add');
        await page.waitForSelector('#editor:not([hidden])');
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'add-page-form',
      description: 'The Content page blueprint form, filled in (a "Care Guide" page) but not yet submitted',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await fillCareGuideForm(page);
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'add-page-pending',
      description: 'Create preview pressed: the whole new page is pending, shown in the preview like any other change',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await fillCareGuideForm(page);
        await page.locator('#editor button:has-text("Create preview")').click();
        await page.waitForSelector('#pending-card:not([hidden])', { timeout: 90000 });
        await page.waitForTimeout(2500); // preview navigates to the new page
      },
    },

    {
      slug: 'keep-page',
      description: 'The new page kept: two changes staged, the new "Care Guide" entry visible in the preview menu',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await page.waitForSelector('#pending-card:not([hidden])');
        await page.click('#btn-keep');
        await page.waitForFunction(() =>
          document.querySelector('#btn-publish').textContent.includes('2'));
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'publish',
      description: 'Publish pressed: the whole session goes live as one unit (one real git commit, pushed)',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        await page.click('#btn-publish');
        await page.waitForSelector('#message.ok', { timeout: 90000 });
        await page.waitForTimeout(2500);
      },
    },

    {
      slug: 'restore',
      description: 'Undo last publish: the whole published session reverted in one click, preview back to the original',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      idle: false,
      action: async ({ page }) => {
        await openApp(page);
        page.on('dialog', d => d.accept());
        await page.click('#btn-restore');
        await page.waitForSelector('#message.ok', { timeout: 120000 });
        await page.waitForTimeout(2500); // preview reloads on the restored content
      },
    },
  ],
};
