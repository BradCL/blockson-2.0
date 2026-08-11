'use strict';

/* Closed, escaped inline text shared by policy/legal content and form notices.

   Content supplies only text plus an optional schema-validated href. The
   renderer chooses the elements, attributes and classes: there is no raw HTML
   channel and no way for content to add an attribute. Keeping this in one
   helper means legal documents and their form notices share the same escaping
   and link-rendering path. */
const { esc } = require('./escape');

function renderInline(runs) {
  return (runs || []).map(run => {
    const renderedText = esc(run && run.text);
    return run && typeof run.href === 'string'
      ? `<a class="service-card-cue" href="${esc(run.href)}">${renderedText}</a>`
      : renderedText;
  }).join('');
}

module.exports = { renderInline };
