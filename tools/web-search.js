// 工具：web_search —— 基于 Tavily 的联网搜索。当需要准确、最新信息（如新闻、事实、资料）时使用
const https = require('https');

const TAVILY_API = 'https://api.tavily.com/search';

// 调用 Tavily 搜索，返回组织好的搜索结果文本
async function tavilySearch({ apiKey, query, maxResults = 5 }) {
  if (!apiKey) throw new Error('未配置 Tavily API Key');
  if (!query || !String(query).trim()) throw new Error('搜索关键词不能为空');

  const body = JSON.stringify({
    api_key: apiKey,
    query: String(query).trim(),
    max_results: Math.max(1, Math.min(10, maxResults || 5)),
    search_depth: 'basic',
    include_answer: true
  });

  return new Promise((resolve, reject) => {
    const u = new URL(TAVILY_API);
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
          if (!json || !arrayHas(j => !!j, json.results)) {
            return reject(new Error('Tavily 返回为空或解析失败'));
          }
          const answer = json.answer ? '总结：' + json.answer + '\n' : '';
          const items = (json.results || []).slice(0, maxResults).map(function(r, i) {
            return `${i + 1}. ${r.title}\n   链接：${r.url}\n   内容：${(r.content || '').substring(0, 500)}`;
          }).join('\n\n');
          resolve((answer + items).trim());
        } catch (e) {
          reject(new Error('解析 Tavily 响应失败: ' + e.message));
        }
      });
    });
    req.on('error', (err) => reject(new Error('Tavily 请求失败: ' + err.message)));
    req.setTimeout(20000, () => { req.destroy(new Error('Tavily 请求超时')); });
    req.write(body);
    req.end();
  });
}

function arrayHas(pred, arr) {
  return Array.isArray(arr) && arr.some(pred);
}

module.exports = {
  name: 'web_search',
  description: '联网搜索：当问题需要准确、实时或外部资料（新闻、事实、数据、教程等）时，用它搜索网络获取可靠信息后再回答。仅在确实需要最新/准确信息时调用，避免过度使用。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要搜索的关键词或问题' },
      max_results: { type: 'integer', description: '返回结果条数，默认 5，最多 10' }
    },
    required: ['query']
  },
  async run(context, args) {
    const apiKey = context.tavilyApiKey || '';
    if (!apiKey) {
      return { error: '未配置 Tavily MCP，请在管理员后台 /admin/ai → MCP 配置 中启用 Tavily 后使用' };
    }
    try {
      const text = await tavilySearch({ apiKey, query: args && args.query, maxResults: args && args.max_results });
      return { results_text: text, note: '以上为搜索结果摘要，请据此准确作答，并可在回复中注明信息来自网络检索。' };
    } catch (e) {
      return { error: '搜索失败：' + e.message };
    }
  }
};

// 供控制器「保存前测试」复用
module.exports.tavilySearch = tavilySearch;