const { marked } = require('marked');
const hljs = require('highlight.js');

marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (_) {}
    }
    return hljs.highlightAuto(code).value;
  },
  gfm: true,
  breaks: true,
  pedantic: false,
  smartypants: false
});

function renderMarkdown(content) {
  if (!content) return '';
  return marked.parse(content);
}

module.exports = { renderMarkdown };
