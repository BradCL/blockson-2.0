'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const header = require('./blocks/page-header');
const { NOOP_BLOCK, buildAnnotator } = require('./lib/annotate');
const { validate, fallbackValidate } = require('./lib/validate');
const { applyPatch } = require('./lib/patch');
const { instantiate, removeItem } = require('./lib/scaffold');

module.exports = function testHeaderActions() {
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '../clients/example-contractor/content.json')));
  const block = { id: 'test-header', type: 'page-header', fields: { tag: 'Service', heading: 'Project', subhead: 'Details' } };
  content.pages[0].blocks = [block];
  const before = header(block.fields, content.site, NOOP_BLOCK);
  block.fields.actions = [];
  assert.equal(header(block.fields, content.site, NOOP_BLOCK), before);
  delete block.fields.actions;
  const bp = JSON.parse(fs.readFileSync(path.join(__dirname, '../blueprints/page-header-button.json')));
  const add = () => instantiate(content, bp, 'primary', { label: 'Get in Touch', href: 'contact.html#quote' }, { targetBlock: block.id });
  const first = add(); assert.equal(first.ok, true);
  assert.equal(validate(content).ok, true);
  const button = block.fields.actions[0];
  assert.equal(applyPatch(content, { action: 'set', block: block.id, item: button.id, field: 'label', value: 'Ask & discuss' }).ok, true);
  assert.equal(applyPatch(content, { action: 'set', block: block.id, item: button.id, field: 'href', value: 'javascript:alert(1)' }).ok, true);
  assert.equal(validate(content).ok, false); // Owner build gate rejects the candidate.
  assert.equal(fallbackValidate(content).ok, false);
  applyPatch(content, { action: 'set', block: block.id, item: button.id, field: 'href', value: 'contact.html#quote' });
  const live = header(block.fields, content.site, NOOP_BLOCK);
  assert.match(live, /<div class="hero-actions"><a href="contact.html#quote" class="btn btn-primary">Ask &amp; discuss<\/a><\/div>/);
  assert.doesNotMatch(live, /data-bk-/);
  const annotated = header(block.fields, content.site, buildAnnotator(content).forBlock(block.id));
  assert.match(annotated, /data-bk-item="button" data-bk-field="label"/);
  assert.doesNotMatch(annotated, /data-bk-field="(?:href|style)"/);
  const second = add(); assert.equal(second.ok, true); assert.notEqual(second.created.itemId, first.created.itemId);
  assert.equal(removeItem(content, { block: block.id, item: second.created.itemId }).ok, true);
  assert.equal(removeItem(content, { block: block.id, item: first.created.itemId }).ok, false); // Existing last-item guard remains.
  delete block.fields.actions;
  assert.equal(header(block.fields, content.site, NOOP_BLOCK), before);
  for (const invalid of [
    [{ label: 'Bad', href: 'javascript:alert(1)', style: 'primary' }],
    [{ label: 'Bad', href: 'contact.html', style: 'unknown' }],
    [{ href: 'contact.html', style: 'primary' }],
    { label: 'Not an array' },
  ]) { block.fields.actions = invalid; assert.equal(validate(content).ok, false); }
  block.fields.actions = [{ label: 'Bad', href: 'data:text/html,bad', style: 'primary' }];
  assert.equal(fallbackValidate(content).ok, false);
};
if (require.main === module) { module.exports(); console.log('PASS: declarative header actions, safe links, escaping, owner patch/annotation/add/remove and unchanged empty output'); }
