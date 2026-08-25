const { marked } = require('marked');
const hljs = require('highlight.js');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

// 服务端 DOM Purify 初始化
const { window } = new JSDOM('');
const DOMPurify = createDOMPurify(window);

marked.setOptions({
  highlight: function(code, lang) {
    // 跳过 mermaid 图表代码块，不添加语法高亮
    if (lang === 'mermaid' || lang === 'flow' || lang === 'sequence') return code;
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
  // 先解析 markdown 为 HTML
  const html = marked.parse(content);
  // 再用 DOMPurify 过滤 XSS，只保留安全标签
  // 允许 pre/code 用于 mermaid 代码块，a 标签允许 href 但禁止 javascript: 协议
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'a', 'img',
      'pre', 'code', 'kbd', 'samp', 'tt', 'var',
      'blockquote', 'q', 'cite',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'div', 'span', 'sub', 'sup', 'abbr', 'acronym',
      'details', 'summary', 'figure', 'figcaption',
      'col', 'colgroup', 'caption', 'center', 'address'
    ],
    ALLOWED_ATTR: ['href', 'target', 'title', 'alt', 'src', 'class', 'id', 'name', 'rel'],
    ALLOW_DATA_ATTR: false,
    // 禁止 javascript: 等危险协议
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|ftp:\/\/|mailto:|tel:|#)/i
  });
}

module.exports = { renderMarkdown };