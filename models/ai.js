const { getDb, run, get, all } = require('../config/database');
const commentModel = require('./comment');
const articleModel = require('../models/article');

const https = require('https');
const http = require('http');
const url = require('url');

// 预置供应商信息
// inputTokens/outputTokens 为各供应商主流模型的上下文窗口默认值（输入/输出 token 上限）。
exports.presetProviders = {
  deepseek: {
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1',
    website: 'https://platform.deepseek.com',
    inputTokens: 65536,   // deepseek-chat / deepseek-reasoner 输入窗口
    outputTokens: 8192,   // 默认输出上限
    thinking: true
  },
  glm: {
    name: '智谱 GLM',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    website: 'https://open.bigmodel.cn',
    inputTokens: 131072,  // GLM-4 系列输入窗口
    outputTokens: 8192,
    thinking: true
  },
  openai: {
    name: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1',
    website: 'https://platform.openai.com',
    inputTokens: 128000,  // gpt-4o 输入窗口
    outputTokens: 16384,
    thinking: true
  },
  moonshot: {
    name: '月之暗面 Moonshot',
    apiUrl: 'https://api.moonshot.cn/v1',
    website: 'https://platform.moonshot.cn',
    inputTokens: 128000,  // moonshot-v1-128k
    outputTokens: 4096,
    thinking: false
  },
  qwen: {
    name: '通义千问 Qwen',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    website: 'https://help.aliyun.com/zh/model-studio',
    inputTokens: 32768,   // qwen-max 输入窗口
    outputTokens: 8192,
    thinking: true
  },
  agnes: {
    name: 'Agnes',
    apiUrl: 'https://api.agnes-ai.cn/v1',
    website: 'https://agnes-ai.cn',
    inputTokens: 524288,  // Agnes 2.5 Flash 上下文窗口 512K
    outputTokens: 65536,  // 最大输出 65.5K
    thinking: true        // 通过 chat_template_kwargs.enable_thinking 启用
  }
};

// 获取所有 AI 配置
async function findAll() {
  await getDb();
  return all(`SELECT * FROM ai_providers ORDER BY id DESC`);
}

// 根据 ID 查找
async function findById(id) {
  await getDb();
  return get(`SELECT * FROM ai_providers WHERE id = ?`, [id]);
}

// ---- MCP（工具）配置 ----
// 读取某个已启用的 MCP 配置项，返回其 api_key；未启用/不存在返回 null
async function getMcpSetting(name) {
  await getDb();
  const row = get(`SELECT * FROM mcp_settings WHERE name = ?`, [name]);
  if (!row || !row.enabled) return null;
  return row.api_key || null;
}

// 查询是否已配置某个 MCP（不暴露密钥，仅用于前端展示）
async function isMcpConfigured(name) {
  await getDb();
  const row = get(`SELECT enabled, updated_at FROM mcp_settings WHERE name = ?`, [name]);
  return row && row.enabled ? { enabled: true, updated_at: row.updated_at } : { enabled: false };
}

// 保存某个 MCP 配置
async function saveMcpSetting({ name, api_key, enabled }) {
  await getDb();
  run(`INSERT INTO mcp_settings (name, api_key, enabled) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET api_key = excluded.api_key, enabled = excluded.enabled, updated_at = datetime('now','localtime')`,
    [name, api_key || '', enabled ? 1 : 0]);
  return get(`SELECT * FROM mcp_settings WHERE name = ?`, [name]);
}

// ---- AI 评论防护配置（防 token 被刷）----
const AI_CONFIG_DEFAULTS = {
  daily_moderate_limit: '100',       // 每日最大审核评论条数，0=不限
  daily_reply_limit: '50',           // 每日最大 AI 回复条数，0=不限
  moderate_batch_interval_min: '1',  // 每 X 分钟批量审核一次未审核评论
  rate_limit_per_minute: '3',        // 每分钟单 IP 最多评论条数
  rate_limit_blacklist_threshold: '30', // 频繁触发次数的阈值，达到则拉黑
  rate_limit_blacklist_hours: '1'    // 拉黑时长（小时）
};

async function getAllAiConfig() {
  await getDb();
  const rows = all(`SELECT k, v FROM ai_config`);
  const cfg = Object.assign({}, AI_CONFIG_DEFAULTS);
  rows.forEach(r => { cfg[r.k] = r.v; });
  return cfg;
}

async function getAiConfig(key) {
  await getDb();
  const r = get(`SELECT v FROM ai_config WHERE k = ?`, [key]);
  if (r && r.v != null) return r.v;
  return AI_CONFIG_DEFAULTS[key] != null ? AI_CONFIG_DEFAULTS[key] : null;
}

async function setAiConfig(key, value) {
  await getDb();
  run(`INSERT INTO ai_config (k, v) VALUES (?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = datetime('now','localtime')`, [key, String(value)]);
}

// 每日计数跨天自动清零
async function ensureDailyReset() {
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  const saved = await getAiConfig('daily_date');
  if (saved !== today) {
    await setAiConfig('daily_date', today);
    await setAiConfig('daily_moderate_count', '0');
    await setAiConfig('daily_reply_count', '0');
    return true;
  }
  return false;
}

// 当日已用次数（kind: 'moderate' | 'reply'）
async function getDailyCount(kind) {
  await ensureDailyReset();
  const key = kind === 'reply' ? 'daily_reply_count' : 'daily_moderate_count';
  const v = await getAiConfig(key);
  return parseInt(v) || 0;
}

// 当日配额上限（0 = 不限）
async function dailyLimit(kind) {
  const key = kind === 'reply' ? 'daily_reply_limit' : 'daily_moderate_limit';
  const v = await getAiConfig(key);
  return parseInt(v) || 0;
}

// 当日剩余配额
async function dailyBudgetRemaining(kind) {
  const limit = await dailyLimit(kind);
  if (limit <= 0) return Infinity;
  return Math.max(0, limit - await getDailyCount(kind));
}

async function incrementDailyCount(kind, n = 1) {
  const key = kind === 'reply' ? 'daily_reply_count' : 'daily_moderate_count';
  const cur = await getDailyCount(kind);
  await setAiConfig(key, String(cur + (parseInt(n) || 0)));
}

// 批量审核：将一批尚未 AI 审核的评论合并进一次调用统一审核，降低 token 消耗。
// 返回审核通过（不违规）的评论数组，供后续决定是否回复。
async function moderatePendingBatch() {
  const aiProvider = await findByFunction('moderate');
  const remaining = await dailyBudgetRemaining('moderate');
  if (remaining <= 0) return []; // 每日审核配额已用尽，本轮跳过

  const pending = await commentModel.findPendingModeration(50, remaining);
  if (!pending.length) return [];

  const okIds = new Set();
  if (aiProvider) {
    const contentLines = pending.map(c => {
      const t = (c.article_title || '未识别文章') + '（#' + c.id + '）';
      return `${c.id}::${c.nickname || '匿名'}：${String(c.content || '').replace(/\n+/g, ' ')}（文章：${t}）`;
    }).join('\n');

    const messages = [
      { role: 'system', content: `你是博客评论批量审核助手。下面每一行是一条待审核评论，格式为「ID::昵称：内容（文章：#ID）」。\n判断每条评论是否违规。违规包括：广告链接、辱骂诽谤、违法内容、色情内容、骚扰信息、刷屏恶意内容。\n请逐条输出审核结论，每条占一行，格式严格固定为：\nID::OK\n或\nID::VIOLATION: 简要说明原因\n不要输出任何其他内容。` },
      { role: 'user', content: contentLines }
    ];

    try {
      const result = await callAI(aiProvider, messages, { temperature: 0 });
      const verdictMap = parseModerationResult(result);
      await getDb();

      for (const c of pending) {
        const v = verdictMap[c.id];
        if (v && v.violation) {
          run(`UPDATE comments SET status = 'disabled', ai_moderated = 2, updated_at = datetime('now','localtime') WHERE id = ?`, [c.id]);
          logAction({
            type: 'moderate', commentId: c.id, articleId: c.article_id, providerId: aiProvider.id,
            requestContent: c.content, responseContent: 'VIOLATION: ' + v.reason, result: 'violation', duration: null
          });
          console.log(`[AI审核] 评论 #${c.id} 违规已禁用: ${v.reason}`);
        } else if (v) {
          okIds.add(c.id);
        }
        // 未出现在返回中的评论（模型漏判）：保守视为正常放行，与"失败放行"策略一致
        if (!v) okIds.add(c.id);
      }
    } catch (err) {
      console.error('[AI批量审核] 失败，本轮放行:', err.message);
      pending.forEach(c => okIds.add(c.id));
    }
  } else {
    // 未配置审核 AI：全部放行
    pending.forEach(c => okIds.add(c.id));
  }

  // 更新通过审核的评论状态
  const passed = pending.filter(c => okIds.has(c.id));
  if (passed.length) {
    const ids = passed.map(c => c.id);
    run(`UPDATE comments SET ai_moderated = 1, updated_at = datetime('now','localtime')
         WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    passed.forEach(c => { c.ai_moderated = 1; });
  }

  await incrementDailyCount('moderate', passed.length);
  console.log(`[AI审核] 批量处理 ${pending.length} 条，通过 ${passed.length} 条`);
  return passed;
}

// 解析批量审核结果（逐行 ID::OK / ID::VIOLATION: 原因）
function parseModerationResult(text) {
  const map = {};
  String(text || '').split(/\r?\n/).forEach(line => {
    line = line.trim();
    const m = line.match(/^(\d+)\s*::\s*(OK|VIOLATION)(?::\s*(.*))?$/i);
    if (m) map[parseInt(m[1])] = { violation: m[2].toUpperCase() === 'VIOLATION', reason: m[3] || '' };
  });
  return map;
}

// 根据功能获取启用的 AI 配置
// 优先使用 ai_function_map 中显式指定的供应商；若未指定则回退到旧逻辑
// （在启用该功能的配置中取 id 最大的一个，保证老数据行为不变）
async function findByFunction(func) {
  await getDb();
  try {
    const mapped = get(`SELECT provider_id FROM ai_function_map WHERE func = ?`, [func]);
    if (mapped && mapped.provider_id) {
      const p = await findById(mapped.provider_id);
      if (p) return p;
    }
  } catch(e) { /* 表可能不存在，忽略 */ }
  const providers = all(`SELECT * FROM ai_providers ORDER BY id DESC`);
  for (const p of providers) {
    try {
      const functions = JSON.parse(p.functions || '[]');
      if (functions.includes(func)) {
        return p;
      }
    } catch(e) {
      continue;
    }
  }
  return null;
}

// 获取功能→供应商映射 { reply: providerId, ... }
async function getFunctionMap() {
  await getDb();
  const rows = all(`SELECT func, provider_id FROM ai_function_map`);
  const map = {};
  rows.forEach(r => { map[r.func] = r.provider_id; });
  return map;
}

// 保存功能→供应商映射
async function saveFunctionMap(map) {
  await getDb();
  const funcs = ['reply', 'moderate', 'polish', 'vision'];
  for (const func of funcs) {
    const pid = map[func];
    if (pid) {
      run(`INSERT INTO ai_function_map (func, provider_id) VALUES (?, ?)
           ON CONFLICT(func) DO UPDATE SET provider_id = excluded.provider_id, updated_at = datetime('now','localtime')`,
        [func, pid]);
    } else {
      run(`DELETE FROM ai_function_map WHERE func = ?`, [func]);
    }
  }
}

// 创建/更新
async function save({ id, name, provider_type, api_url, api_key, model_id, is_multimodal, input_tokens, output_tokens, thinking_mode, functions }) {
  await getDb();

  const functionsJson = JSON.stringify(functions || []);

  if (id) {
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (provider_type !== undefined) { fields.push('provider_type = ?'); values.push(provider_type); }
    if (api_url !== undefined) { fields.push('api_url = ?'); values.push(api_url); }
    if (api_key !== undefined) { fields.push('api_key = ?'); values.push(api_key); }
    if (model_id !== undefined) { fields.push('model_id = ?'); values.push(model_id); }
    if (is_multimodal !== undefined) { fields.push('is_multimodal = ?'); values.push(is_multimodal ? 1 : 0); }
    if (input_tokens !== undefined) { fields.push('input_tokens = ?'); values.push(input_tokens ? parseInt(input_tokens) : null); }
    if (output_tokens !== undefined) { fields.push('output_tokens = ?'); values.push(output_tokens ? parseInt(output_tokens) : null); }
    if (thinking_mode !== undefined) { fields.push('thinking_mode = ?'); values.push(thinking_mode ? 1 : 0); }
    if (functions !== undefined) { fields.push('functions = ?'); values.push(functionsJson); }
    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    run(`UPDATE ai_providers SET ${fields.join(', ')} WHERE id = ?`, values);
    return findById(id);
  } else {
    run(
      `INSERT INTO ai_providers (name, provider_type, api_url, api_key, model_id, is_multimodal, input_tokens, output_tokens, thinking_mode, functions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, provider_type, api_url, api_key, model_id, is_multimodal ? 1 : 0,
       input_tokens ? parseInt(input_tokens) : null,
       output_tokens ? parseInt(output_tokens) : null,
       thinking_mode ? 1 : 0, functionsJson]
    );
    const last = get(`SELECT * FROM ai_providers ORDER BY id DESC LIMIT 1`);
    return last;
  }
}

// 删除
async function delete_(id) {
  await getDb();
  run(`DELETE FROM ai_providers WHERE id = ?`, [id]);
}

// 计算一条消息的文本长度（多模态数组内容只统计文本部分，图片部分不裁剪）
function contentLen(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    return content.reduce(function(s, part) {
      return s + (part && typeof part.text === 'string' ? part.text.length : 0);
    }, 0);
  }
  return 0;
}

// 将消息截断到指定输入 token 上限（按字符数近似 token），尽量保留每条消息靠前的内容。
// 多模态数组（如 {type:'image_url'}）原样保留，只裁剪纯字符串文本。
function fitToContext(messages, maxChars) {
  if (!maxChars || maxChars <= 0) return messages;
  const copy = messages.map(m => ({ role: m.role, content: m.content }));
  const total = copy.reduce(function(s, m) { return s + contentLen(m.content); }, 0);
  if (total <= maxChars) return messages;
  let budget = total - maxChars;
  while (budget > 0) {
    let bi = -1, bl = 0;
    for (let i = 0; i < copy.length; i++) {
      if (typeof copy[i].content === 'string' && copy[i].content.length > bl) {
        bl = copy[i].content.length;
        bi = i;
      }
    }
    if (bi < 0 || bl <= 1) break; // 无可裁剪的文本消息
    const cut = Math.min(budget, Math.max(1, Math.ceil(bl * 0.4)));
    copy[bi].content = copy[bi].content.substring(0, bl - cut) + (bl - cut > 0 ? '\n…（内容已按上下文限制截断）' : '');
    budget -= cut;
  }
  return copy;
}

// 延迟工具（重试退避用）
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 调用 OpenAI 兼容 API 的单次请求（自动重试：网络错误或非 200 状态码，最多重试 retries 次）
// 返回 { content, tool_calls }；支持 tools 参数，供 Agent 调用
async function chatOnce(provider, messages, options = {}) {
  const endpoint = provider.api_url.endsWith('/chat/completions')
    ? provider.api_url
    : provider.api_url.replace(/\/$/, '') + '/chat/completions';

  const configuredInput = provider.input_tokens > 0 ? parseInt(provider.input_tokens) : null;
  const msgs = configuredInput ? fitToContext(messages, configuredInput) : messages;

  const configuredOutput = provider.output_tokens > 0 ? parseInt(provider.output_tokens) : null;
  let maxTokens;
  if (options.max_tokens != null) {
    maxTokens = configuredOutput
      ? Math.min(parseInt(options.max_tokens), configuredOutput)
      : parseInt(options.max_tokens);
  } else {
    maxTokens = configuredOutput || 2000;
  }

  const body = {
    model: provider.model_id,
    messages: msgs,
    temperature: options.temperature || 0.7,
    max_tokens: maxTokens,
    stream: false
  };

  if (options.temperature === undefined) {
    delete body.temperature;
  }

  // Agent：启用工具
  if (options.tools && options.tools.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice || 'auto';
  }

  // 思考模式：仅当开启时传入对应供应商的 Thinking 参数（关闭时省略，保持向后兼容）
  if (provider.thinking_mode) {
    if (provider.provider_type === 'agnes') {
      // Agnes 2.5 Flash 通过 OpenAI 兼容的 chat_template_kwargs.enable_thinking 启用思考
      body.chat_template_kwargs = { enable_thinking: true };
    } else {
      body.thinking = true;
    }
  }

  // 单次 HTTP 请求
  function performRequest() {
    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(endpoint);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + provider.api_key,
          'Accept': 'application/json'
        }
      };

      const req = client.request(reqOptions, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          try {
            if (res.statusCode !== 200) {
              const err = new Error(`API 返回错误 ${res.statusCode}: ${data}`);
              err.statusCode = res.statusCode;
              return reject(err);
            }
            const result = JSON.parse(data);
            const message = result.choices && result.choices[0] && result.choices[0].message;
            if (!message) {
              return reject(new Error('API 返回为空'));
            }
            const content = message.content == null ? '' : String(message.content);
            let toolCalls = null;
            if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
              toolCalls = message.tool_calls.map(function(tc) {
                return {
                  id: tc.id,
                  type: tc.type || 'function',
                  function: {
                    name: tc.function && tc.function.name,
                    arguments: tc.function && tc.function.arguments
                  }
                };
              });
            }
            if (!content && (!toolCalls || !toolCalls.length)) {
              return reject(new Error('API 返回为空'));
            }
            resolve({ content: content.trim(), tool_calls: toolCalls });
          } catch (e) {
            reject(new Error('解析 API 响应失败: ' + e.message));
          }
        });
      });

      // 单次请求超时：防止某次请求卡死（Agent 整体还有总时限兜底）
      req.setTimeout(300000, function() {
        req.destroy(new Error('请求超时'));
      });

      req.on('error', (err) => {
        const networkErr = new Error('请求失败: ' + err.message);
        networkErr.network = true;
        reject(networkErr);
      });
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  // 自动重试：网络错误或非 200 状态码，最多重试 options.retries 次（默认 3）
  const retries = options.retries != null ? parseInt(options.retries) : 3;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await performRequest();
    } catch (err) {
      lastError = err;
      const retryable = !!err.network || (err.statusCode && err.statusCode !== 200);
      if (attempt >= retries || !retryable) {
        break; // 达到最大重试次数或该错误不可重试
      }
      await sleep(500 * (attempt + 1)); // 递增退避：0.5s / 1s / 1.5s
    }
  }
  throw lastError;
}

// 简化调用：返回最终文本内容（兼容旧用法）
async function callAI(provider, messages, options = {}) {
  const r = await chatOnce(provider, messages, options);
  return r.content;
}

// Agent：工具调用循环。AI 可随时直接输出；需要时可调用工具获取信息，返回工具结果后再继续。
// options: { tools, toolExecutor, maxRounds, timeoutMs, fallbackContent, ...(传给 chatOnce) }
async function callAgent(provider, messages, options = {}) {
  const tools = options.tools || [];
  const toolExecutor = options.toolExecutor || null;
  const maxRounds = options.maxRounds != null ? parseInt(options.maxRounds) : 10;
  const timeoutMs = options.timeoutMs != null ? parseInt(options.timeoutMs) : 600000;
  const fallback = options.fallbackContent || '';
  const msgs = messages.map(function(m) { return { role: m.role, content: m.content }; });
  const start = Date.now();
  let lastContent = '';

  for (let round = 0; round < maxRounds; round++) {
    if (Date.now() - start > timeoutMs) break; // 整体超时，回退
    const bodyOptions = {};
    for (const k in options) {
      if (k !== 'tools' && k !== 'toolExecutor' && k !== 'maxRounds' && k !== 'timeoutMs' && k !== 'fallbackContent') {
        bodyOptions[k] = options[k];
      }
    }
    if (tools.length) bodyOptions.tools = tools;

    const result = await chatOnce(provider, msgs, bodyOptions);
    lastContent = result.content || '';

    if (!result.tool_calls || !result.tool_calls.length) {
      return lastContent; // 模型直接输出，结束
    }

    // 追加 assistant 的 tool_calls 消息
    msgs.push({ role: 'assistant', content: result.content || null, tool_calls: result.tool_calls });

    // 执行每个工具调用并回填结果
    let executed = false;
    for (const call of result.tool_calls) {
      let output;
      try {
        const args = JSON.parse((call.function && call.function.arguments) || '{}');
        const fn = toolExecutor && toolExecutor[call.function.name];
        output = fn ? await fn(args) : { error: '未知工具' };
      } catch (e) {
        output = { error: '工具执行失败: ' + e.message };
      }
      msgs.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof output === 'string' ? output : JSON.stringify(output)
      });
      executed = true;
    }
    if (!executed) break; // 防御：无可执行的工具调用
  }

  // 轮数/超时到达仍未直接输出：用最后一次内容或回退消息兜底
  return lastContent && lastContent.trim() ? lastContent : fallback;
}

// 获取模型列表（OpenAI 兼容：GET {url}/models）
async function listModels({ apiUrl, apiKey }) {
  const base = (apiUrl || '').trim().replace(/\/$/, '');
  const endpoint = base + '/models';
  const parsedUrl = url.parse(endpoint);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Accept': 'application/json'
      }
    }, (res) => {
      let chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`API 返回错误 ${res.statusCode}: ${data}`));
          }
          const result = JSON.parse(data);
          let list = [];
          if (Array.isArray(result)) {
            list = result;
          } else if (result.data && Array.isArray(result.data)) {
            list = result.data;
          }
          // 提取 id 列表，兼容 字符串数组 与 对象数组
          const ids = list
            .map(m => (typeof m === 'string' ? m : m.id))
            .filter(Boolean);
          resolve(ids);
        } catch (e) {
          reject(new Error('解析模型列表失败: ' + e.message));
        }
      });
    });
    req.on('error', (err) => reject(new Error('请求失败: ' + err.message)));
    req.end();
  });
}

// 构建对话历史：递归获取从根开始的完整对话链
async function buildConversationChain(commentId) {
  const chain = [];
  let current = await commentModel.findById(commentId);
  while (current) {
    chain.unshift({
      id: current.id,
      content: current.content,
      nickname: current.nickname,
      is_author: current.is_author,
      created_at: current.created_at
    });
    if (current.parent_id) {
      current = await commentModel.findById(current.parent_id);
    } else {
      break;
    }
  }
  return chain;
}

// ---- 文章工具辅助：为 Agent 提供正文/图片按需读取 ----
function stripMarkdown(md) {
  return String(md || '')
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, function(m) { return m.replace(/```/g, '').replace(/^[^\n]+\n/, ''); })
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^>+\s?/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function extractImageUrls(md) {
  const urls = [];
  const seen = new Set();
  const add = function(u) {
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };
  // Markdown 图片 ![alt](url)
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(String(md || '')))) add(m[1]);
  // 内联 HTML 图片 <img src="...">
  const reImg = /<img[^>]*src=["']([^"']+)["']/gi;
  let m2;
  while ((m2 = reImg.exec(String(md || '')))) add(m2[1]);
  return urls;
}

// AI 自动回复评论
async function autoReply(comment) {
  // 只对已通过 AI 审核的评论回复（安全兜底，正常流程由调度器在审核后调用）
  if (comment.ai_moderated !== 1) {
    return;
  }

  // 每日回复配额守卫：超限则不回复
  const replyRemaining = await dailyBudgetRemaining('reply');
  if (replyRemaining <= 0) {
    console.log(`[AI回复] 今日回复配额已用尽，跳过评论 #${comment.id}`);
    return;
  }

  const aiProvider = await findByFunction('reply');
  if (!aiProvider) {
    return; // 未配置回复功能的 AI
  }

  // 判断是否应该回复：
  // 1. 一级评论（parent_id IS NULL）→ 回复
  // 2. 二级评论，且父评论是 AI 回复（is_author=1）→ 回复
  // 3. 其他情况（用户回复其他用户）→ 不回复
  if (comment.parent_id) {
    const parentComment = await commentModel.findById(comment.parent_id);
    if (!parentComment || !parentComment.is_author) {
      return; // 父评论不是 AI 回复，跳过
    }
  }

  const startTime = Date.now();

  // 获取站点信息：站点名称、管理员昵称
  await getDb();
  const siteSetting = get('SELECT * FROM site_settings LIMIT 1');
  const admin = get(`SELECT id, nickname FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  const siteName = (siteSetting && siteSetting.site_name) || '博客';
  const adminNickname = (admin && admin.nickname) || '站长';

  // 获取文章信息：仅携带"标题+摘要+开头+统计"，正文其余部分由 Agent 按需读取
  let articleContext = '';
  let plainBody = '';
  let imageUrls = [];
  if (comment.article_id) {
    const article = await articleModel.findById(comment.article_id);
    if (article) {
      plainBody = stripMarkdown(article.content || '');
      imageUrls = extractImageUrls(article.content || '');
      const excerpt = (article.excerpt && article.excerpt.trim())
        ? article.excerpt
        : plainBody.substring(0, 200);
      const opening = plainBody.substring(0, 1200);
      const publishedAt = article.created_at || '';
      articleContext = `当前文章：《${article.title}》${publishedAt ? `\n发布时间：${publishedAt}` : ''}\n摘要：${excerpt}\n\n正文开头：\n${opening}\n\n全文统计：共 ${plainBody.length} 字，含 ${imageUrls.length} 张图片。`;
    }
  }

  // 工具注册表：自动加载 tools/ 下所有工具，构建定义/执行器/上下文说明
  const toolRegistry = require('../tools');
  const siteBase = (siteSetting && siteSetting.site_url) || '';
  let tools = [];
  let toolExecutor = null;

  const toolCtx = { plainBody, imageUrls, siteBase };
  if (articleContext) {
    // 视觉辅助：仅当在 /admin/ai 功能分配中配置了「视觉辅助」供应商才注入识图回调
    const visionProvider = await findByFunction('vision');
    if (visionProvider) {
      toolCtx.describeImage = function(imageUrl) {
        return callAI(visionProvider, [
          { role: 'system', content: '你是图片内容识别助手。请用中文、一两句话准确描述这张图片的内容、主体与关键细节，不要猜测图片之外的信息。' },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请描述这张图片的内容。' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ], { max_tokens: 300 });
      };
    }
  }

  // MCP：Tavily 联网搜索。配置了 Tavily API Key 才注入并暴露 web_search 工具
  const tavilyKey = await getMcpSetting('tavily');
  if (tavilyKey) toolCtx.tavilyApiKey = tavilyKey;

  // 仅暴露"依赖已满足"的工具
  const availableTools = toolRegistry.getTools().filter(function(t) {
    if (t.name === 'get_article_text' || t.name === 'get_article_image') return !!articleContext;
    if (t.name === 'web_search' || t.name === 'web_extract') return !!tavilyKey;
    return true; // 未来工具默认暴露
  });
  if (availableTools.length) {
    tools = availableTools.map(function(t) {
      return {
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      };
    });
    toolExecutor = toolRegistry.getToolExecutor(toolCtx);
  }

  // 获取完整对话链
  const conversationChain = await buildConversationChain(comment.id);

  // 构建消息
  const messages = [
    {
      role: 'system',
      content: `你是「${siteName}」的 AI 小助手，你的任务是代表博主「${adminNickname}」解答和回复朋友们的评论。
当前时间：${new Date().toLocaleString('zh-CN', { hour12: false })}
请保持回复简洁、友好、有礼貌，语气自然亲切。
你清楚自己的身份是 AI 助手，不是博主本人，但你的回复代表了博主的形象。
根据文章上下文和对话历史进行回复。

重要：回复时直接输出正文内容，不要加任何前缀、昵称、冒号或引号，不要在前面加任何人名。比如用户问"你好"你直接回复"你好呀！"——绝不要写成"李拾肆: 你好呀！"或"李拾肆: 用户: 你好呀！"。

格式要求：你可以使用标准 Markdown 语法来丰富回复内容，包括：
- **粗体**表示强调
- *斜体*表示强调
- \`行内代码\` 表示代码或命令
- \`\`\` 代码块 格式化代码
- - 无序列表
- 1. 有序列表
- > 引用块
- --- 分割线
- [链接](url) 超链接

图表：你可以用 mermaid 代码块绘制饼图、流程图、时序图，博客系统会自动渲染为 SVG 图表。
支持的 mermaid 图表类型：pie（饼图）、flowchart（流程图）、sequence（时序图）、gantt（甘特图）、classDiagram（类图）、gitGraph（git 图）。

画图时，必须严格按照以下格式，\`\`\`mermaid 必须独占一行，前面不能有任何文字：

\`\`\`mermaid
flowchart LR
  A[开始] --> B[结束]
\`\`\`

如果 \`\`\`mermaid 前面有文字，图表不会被渲染。务必让 \`\`\`mermaid 单独成行。

mermaid 语法必须严格遵守以下规范，否则图表渲染会失败：
- 优先使用 flowchart，它最稳定：flowchart TD 或 flowchart LR，节点 A[文本]、A{判断}，连线 A --> B，子图 subgraph id["标题"] ... end
- pie 饼图：pie title 标题，然后每行 "标签" : 数值
- sequenceDiagram 时序图：participant X as 名称，X->>Y: 消息内容
- gantt 甘特图语法严格，dateFormat 只能是日期格式（如 YYYY-MM-DD），任务依赖 :after 任务ID 中的 ID 必须在该任务之前定义过。没有把握时不要用 gantt，改用 flowchart 表达
- 节点文本包含特殊字符（括号、引号、百分号）时，必须用双引号包裹：A["文本(带括号)"]
- 不要在 mermaid 图中使用 emoji，可能解析失败

回复要求：
- 优先把问题解释清楚、图文完整，不要因为篇幅而中途截断，尤其是 mermaid 图表要完整写全（包括 subgraph 子图、所有节点和连线），不要半途省略。
- 篇幅以讲清楚为准，不设固定字数上限；用户需要详细展开时就完整展开。`
    }
  ];

  if (articleContext) {
    messages.push({
      role: 'system',
      content: articleContext +
        '\n\n内部说明（仅系统可见）：当需要了解正文细节或图片真实内容时，你可以静默调用对应工具获取信息后再作答。但绝不能向用户提及工具名称，不能说"我可以读取文章/识别图片/调工具"之类话术，也不要主动告诉用户你有工具可用。'
    });
  }

  // 添加对话历史到消息
  for (const turn of conversationChain) {
    const role = turn.is_author ? 'assistant' : 'user';
    // 清洗旧 AI 回复中的前缀，避免 AI 学到错误格式
    let content = turn.content.replace(/^[\u4e00-\u9fa5a-zA-Z0-9_]+:\s*/, '');
    if (!turn.is_author) {
      content = `用户 ${turn.nickname}: ${content}`;
    }
    messages.push({ role, content });
  }

  try {
    let replyContent;
    try {
      if (tools.length && toolExecutor) {
        // Agent 工具循环：AI 可随时直接输出；需要时调用工具读取正文/图片（最多 10 轮，10 分钟兜底）
        replyContent = await callAgent(aiProvider, messages, {
          tools: tools,
          toolExecutor: toolExecutor,
          maxRounds: 10,
          timeoutMs: 600000,
          fallbackContent: ''
        });
        if (!replyContent) throw new Error('Agent 无有效输出');
      } else {
        // 无文章上下文/未启用工具：直接单次回复
        replyContent = await callAI(aiProvider, messages);
      }
    } catch (err) {
      // 供应商不支持 tools / 超时等异常：回退为"标题+摘要+开头"的单次回复，保证有回复
      replyContent = await callAI(aiProvider, messages);
    }
    const duration = Date.now() - startTime;

    // 后处理：清洗 AI 回复中可能残留的前缀
    let cleanedContent = replyContent.replace(/^[\u4e00-\u9fa5a-zA-Z0-9_]+:\s*[\u4e00-\u9fa5a-zA-Z0-9_]+:\s*/, '').replace(/^[\u4e00-\u9fa5a-zA-Z0-9_]+:\s*/, '');

    // 保存 AI 回复，is_author = 1，表示是作者（AI站长）
    const { create } = require('./comment');
    await create({
      content: cleanedContent,
      article_id: comment.article_id,
      page_type: comment.page_type || 'article',
      nickname: adminNickname,
      email: 'admin@blog.com',
      website: null,
      parent_id: comment.id,
      is_author: 1
    });

    // 计入当日回复配额
    await incrementDailyCount('reply', 1);

    // 记录日志
    logAction({
      type: 'reply',
      commentId: comment.id,
      articleId: comment.article_id,
      providerId: aiProvider.id,
      requestContent: JSON.stringify(messages.map(m => ({ role: m.role, content: m.content.substring(0, 200) }))),
      responseContent: replyContent,
      result: 'ok',
      duration
    });

    // 更新文章评论计数
    if (comment.article_id) {
      await articleModel.updateCommentCount(comment.article_id);
    }

    console.log(`[AI回复] 成功回复评论 #${comment.id}`);
  } catch (err) {
    const duration = Date.now() - startTime;
    logAction({
      type: 'reply',
      commentId: comment.id,
      articleId: comment.article_id,
      providerId: aiProvider.id,
      requestContent: null,
      responseContent: err.message,
      result: 'error',
      duration
    });
    console.error(`[AI回复] 失败:`, err.message);
  }
}

// 评论内容审核：检测广告/辱骂/违法言论
async function moderateComment(comment) {
  // 已审核通过（1）→ 返回 false（不违规，可继续回复）；已禁用（2）→ 返回 true（违规，不再处理）
  if (comment.ai_moderated === 1) {
    return false;
  }
  if (comment.ai_moderated === 2) {
    return true;
  }

  const aiProvider = await findByFunction('moderate');
  if (!aiProvider) {
    return false; // 未配置审核功能的 AI，视为不违规，放行
  }

  // 获取文章信息（辅助审核判断上下文，仅取摘要，不携带全文）
  let articleContext = '';
  if (comment.article_id) {
    const article = await articleModel.findById(comment.article_id);
    if (article) {
      const plain = stripMarkdown(article.content || '');
      const excerpt = (article.excerpt && article.excerpt.trim()) ? article.excerpt : plain.substring(0, 300);
      articleContext = `当前文章：《${article.title}》\n摘要：${excerpt}\n`;
    }
  }

  const messages = [
    {
      role: 'system',
      content: `你是博客评论审核助手，请判断用户评论是否违规。
违规包括：广告链接、辱骂诽谤、违法内容、色情内容、骚扰信息。
如果违规，请只回复 "VIOLATION: 简要说明原因"。
如果不违规，请只回复 "OK"。
不要回复其他内容。`
    }
  ];

  if (articleContext) {
    messages.push({
      role: 'system',
      content: articleContext
    });
  }

  messages.push({
    role: 'user',
    content: `需要审核的评论内容：\n\n${comment.content}`
  });

  try {
    const startTime = Date.now();
    const result = await callAI(aiProvider, messages, { temperature: 0 });
    const duration = Date.now() - startTime;
    const lowerResult = result.toLowerCase();
    await getDb();

    if (lowerResult.startsWith('violation')) {
      // 违规，禁用评论
      run(`UPDATE comments SET status = 'disabled', ai_moderated = 2, updated_at = datetime('now','localtime') WHERE id = ?`, [comment.id]);
      console.log(`[AI审核] 评论 #${comment.id} 被禁用: ${result}`);
      logAction({
        type: 'moderate',
        commentId: comment.id,
        articleId: comment.article_id,
        providerId: aiProvider.id,
        requestContent: comment.content,
        responseContent: result,
        result: 'violation',
        duration
      });
      return true; // 违规，已禁用，调用方不应再回复
    } else {
      // 正常，标记已审核
      run(`UPDATE comments SET ai_moderated = 1, updated_at = datetime('now','localtime') WHERE id = ?`, [comment.id]);
      console.log(`[AI审核] 评论 #${comment.id} 正常`);
      logAction({
        type: 'moderate',
        commentId: comment.id,
        articleId: comment.article_id,
        providerId: aiProvider.id,
        requestContent: comment.content,
        responseContent: result,
        result: 'ok',
        duration
      });
      return false; // 不违规
    }
  } catch (err) {
    console.error(`[AI审核] 失败:`, err.message);
    logAction({
      type: 'moderate',
      commentId: comment.id,
      articleId: comment.article_id,
      providerId: aiProvider ? aiProvider.id : null,
      requestContent: comment.content,
      responseContent: err.message,
      result: 'error',
      duration: null
    });
    // 审核失败不影响评论显示，保持原样；无法确认违规，默认不违规放行
    return false;
  }
}

// 文章润色
async function polishArticle(content, style = 'polish') {
  const aiProvider = await findByFunction('polish');
  if (!aiProvider) {
    throw new Error('未配置文章润色功能的 AI');
  }

  let systemPrompt = '';
  if (style === 'polish') {
    systemPrompt = `你是专业的写作助手，请润色用户提供的文章内容，使其语言更加流畅、表达更加清晰，保留原文意思不变，只返回润色后的完整文本，不要添加其他解释。`;
  } else if (style === 'continue') {
    systemPrompt = `你是专业的写作助手，请根据用户已写的内容，续写文章，保持文风一致，续写一段内容即可。`;
  } else if (style === 'summarize') {
    systemPrompt = `请总结用户提供的文章内容，生成一段简洁清晰的摘要。`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: content }
  ];

  // 润色需完整返回全文，输出 token 上限要足够。中文约 1~2 token/字，
  // 按输入长度的 2 倍预留输出空间，并设下限 2000、上限 8000，避免截断。
  let maxTokens = 2000;
  if (style === 'polish') {
    maxTokens = Math.min(Math.max(content.length * 2, 2000), 8000);
  } else if (style === 'continue') {
    maxTokens = 2000;
  } else if (style === 'summarize') {
    maxTokens = 1000;
  }

  return await callAI(aiProvider, messages, { max_tokens: maxTokens });
}

// 记录 AI 操作日志
function logAction({ type, commentId, articleId, providerId, requestContent, responseContent, result, duration }) {
  run(
    `INSERT INTO ai_logs (action_type, comment_id, article_id, provider_id, request_content, response_content, result, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [type, commentId || null, articleId || null, providerId || null, requestContent || null, responseContent || null, result || 'ok', duration || null]
  );
}

// 获取 AI 操作日志（支持分页和筛选）
function getLogs({ limit = 20, page = 1, type = '' } = {}) {
  const offset = (page - 1) * limit;
  let whereClause = '';
  let params = [];
  if (type && type !== 'all') {
    whereClause = 'WHERE l.action_type = ?';
    params.push(type);
  }
  const total = get(
    `SELECT COUNT(*) as count FROM ai_logs l ${whereClause}`, params
  );
  const rows = all(
    `SELECT l.*, c.content as comment_text, c.nickname as comment_author, c.article_id as c_article_id
     FROM ai_logs l
     LEFT JOIN comments c ON l.comment_id = c.id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`, params.concat([limit, offset])
  );
  return { rows, total: total ? total.count : 0 };
}

module.exports = {
  findAll,
  findById,
  findByFunction,
  getFunctionMap,
  saveFunctionMap,
  save,
  delete: delete_,
  getMcpSetting,
  isMcpConfigured,
  saveMcpSetting,
  getAllAiConfig,
  getAiConfig,
  setAiConfig,
  getDailyCount,
  dailyBudgetRemaining,
  incrementDailyCount,
  moderatePendingBatch,
  callAI,
  callAgent,
  listModels,
  autoReply,
  moderateComment,
  polishArticle,
  logAction,
  getLogs,
  presetProviders: exports.presetProviders
};
