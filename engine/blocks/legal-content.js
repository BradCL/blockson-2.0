'use strict';

// legal-content — structured long-form policy/legal copy without a raw-HTML
// escape hatch. The schema permits only headings, paragraphs and lists; their
// inline runs are escaped text with optional safeHref links. This is deliberately
// developer-managed structure: provider-approved wording and hierarchy should
// change through a reviewable content.json diff, not a free-form owner edit.
const { esc } = require('../lib/escape');
const { renderInline } = require('../lib/structuredtext');

function renderNode(node) {
  if (node.type === 'heading') {
    const level = Number(node.level);
    return `<h${level}>${esc(node.text)}</h${level}>`;
  }
  if (node.type === 'paragraph') {
    return `<p>${renderInline(node.content)}</p>`;
  }

  const ordered = node.type === 'list' && node.style === 'ordered';
  const tag = ordered ? 'ol' : 'ul';
  const cls = ordered ? 'legal-list' : 'legal-list pricing-features';
  const style = ordered
    ? ' style="padding-left:1.2rem;margin-bottom:1rem"'
    : ' style="margin-bottom:1rem"';
  const items = (node.items || []).map(item => `<li>${renderInline(item)}</li>`).join('\n        ');
  return `<${tag} class="${cls}"${style}>
        ${items}
      </${tag}>`;
}

module.exports = function legalContent(fields, site, bk, context) {
  const content = (fields.content || []).map(renderNode).join('\n      ');
  // Ordinary sections begin behind the fixed 72px navigation. Heroes and page
  // headers already own their larger top spacing; a standalone legal document
  // does not. Add the bar's full 73px painted height (including its border) plus
  // the normal 3.4rem mobile section gap only when this is the first rendered
  // block. Inline, renderer-owned geometry keeps the shared stylesheet byte-
  // identical for every client and page that does not use this state.
  const navClearance = context && context.isFirstRenderedBlock
    ? ' style="padding-top:calc(73px + 3.4rem)"'
    : '';
  return `<section class="about-intro legal-content-section fade-in"${navClearance}>
  <div class="container">
    <article class="about-intro-body legal-content">
      ${content}
    </article>
  </div>
</section>`;
};
