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

module.exports = function legalContent(fields) {
  const content = (fields.content || []).map(renderNode).join('\n      ');
  return `<section class="about-intro legal-content-section fade-in">
  <div class="container">
    <article class="about-intro-body legal-content">
      ${content}
    </article>
  </div>
</section>`;
};
