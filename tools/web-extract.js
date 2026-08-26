// 工具：web_extract —— 基于 Tavily 提取指定网页的正文内容。当需要读取某个 URL 的完整内容时使用（常配合 web_search 使用）
const https = require('https');

const TAVILY_EXTRACT_API = 'https://api.tavily.com/extract';

// 调用 Tavily 提取多个 URL 的内容，返回文本
async function tavilyExtract({ apiKey, urls, maxChars }) {
  if (!apiKey) throw new Error('未配置 Tavily API Key');
  const list = (Array.isArray(urls) ? urls : [urls])
    .map(function(s) { return String(s).trim(); })
    .filter(Boolean);
  if (!list.length) throw new Error('请提供至少一个待提取的 URL');

  const body = JSON.stringify({
    api_key: apiKey,
    urls: list.slice(0, 10)
  });

  return new Promise((resolve, reject) => {
    const u = new URL(TAVILY_EXTRACT_API);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`Tavily 返回错误 ${res.statusCode}: ${data}`));
          }
          const json = JSON.parse(data);
          const results = (json.results || []).filter(Boolean);
          if (!results.length) {
            const failed = json.failed_results || [];
            return reject(new Error(failed.length ? '提取失败：' + failed.map(f => f.error || f.url).join('; ') : 'Tavily 返回空结果'));
          }
          const cap = Math.max(200, parseInt(maxChars) || 3000);
          const parts = results.map(function(r, i) {
            const raw = (r.raw_content || r.content || '暂无内容').trim();
            return `${i + 1}. ${r.url}\n${raw.substring(0, cap)}${raw.length > cap ? '……（已截断）' : ''}`;
          });
          resolve(parts.join('\n\n---\n\n'));
        } catch (e) {
          reject(new Error('解析 Tavily extract 响应失败: ' + e.message));
        }
      });
    });
    req.on('error', (err) => reject(new Error('Tavily 请求失败: ' + err.message)));
    req.setTimeout(25000, () => { req.destroy(new Error('Tavily 请求超时')); });
    req.write(body);
    req.end();
  });
}

module.exports = {
  name: 'web_extract',
  description: '网页内容提取：给定一个或多个 URL，抓取其正文并返回。当你需要阅读某个网页/链接的具体内容（例如搜索结果里的一篇文章、一份资料）时使用。通常与 web_search 搭配：先搜索得到链接，再提取内容。',
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: '需要提取内容的 URL 列表，最多 10 个'
      },
      max_chars: { type: 'integer', description: '每个 URL 返回的最大字符数，默认 3000' }
    },
    required: ['urls']
  },
  async run(context, args) {
    const apiKey = context.tavilyApiKey || '';
    if (!apiKey) {
      return { error: '未配置 Tavily MCP，请在管理员后台 /admin/ai → MCP 配置 中启用 Tavily 后使用' };
    }
    try {
      const text = await tavilyExtract({ apiKey, urls: args && args.urls, maxChars: args && args.max_chars });
      return { extracted_text: text };
    } catch (e) {
      return { error: '提取失败：' + e.message };
    }
  }
};

// 供其他模块复用
module.exports.tavilyExtract = tavilyExtract;