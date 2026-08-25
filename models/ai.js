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

// 根据功能获取启用的 AI 配置
async function findByFunction(func) {
  await getDb();
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

// 将消息截断到指定输入 token 上限（按字符数近似 token），尽量保留每条消息靠前的内容
function fitToContext(messages, maxChars) {
  if (!maxChars || maxChars <= 0) return messages;
  const copy = messages.map(m => ({ role: m.role, content: String(m.content || '') }));
  const totalLen = () => copy.reduce((s, m) => s + m.content.length, 0);
  if (totalLen() <= maxChars) return messages;
  let budget = totalLen() - maxChars;
  while (budget > 0) {
    let bi = 0, bl = 0;
    for (let i = 0; i < copy.length; i++) {
      if (copy[i].content.length > bl) { bl = copy[i].content.length; bi = i; }
    }
    if (bl <= 1) break; // 无法继续裁剪
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

// 调用 OpenAI 兼容 API（自动重试：网络错误或非 200 状态码，最多重试 retries 次）
async function callAI(provider, messages, options = {}) {
  const endpoint = provider.api_url.endsWith('/chat/completions')
    ? provider.api_url
    : provider.api_url.replace(/\/$/, '') + '/chat/completions';

  // 输入上下文限制：所有调用都遵循配置的 input_tokens 上限
  const configuredInput = provider.input_tokens > 0 ? parseInt(provider.input_tokens) : null;
  const msgs = configuredInput ? fitToContext(messages, configuredInput) : messages;

  // 输出 token 上限：按配置的 output_tokens 约束（保留每处调用自身的上限，但不可超过配置）
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
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              const err = new Error(`API 返回错误 ${res.statusCode}: ${data}`);
              err.statusCode = res.statusCode;
              return reject(err);
            }
            const result = JSON.parse(data);
            const content = result.choices[0]?.message?.content;
            if (!content) {
              return reject(new Error('API 返回为空'));
            }
            resolve(content.trim());
          } catch (e) {
            reject(new Error('解析 API 响应失败: ' + e.message));
          }
        });
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
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
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

// AI 自动回复评论
async function autoReply(comment) {
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

  // 获取文章信息（包含正文）
  let articleContext = '';
  if (comment.article_id) {
    const article = await articleModel.findById(comment.article_id);
    if (article) {
      const body = article.content || '';
      articleContext = `当前文章：《${article.title}》\n${body.length > 5000 ? body.substring(0, 5000) + '...' : body}\n\n`;
    }
  }

  // 获取完整对话链
  const conversationChain = await buildConversationChain(comment.id);

  // 构建消息
  const messages = [
    {
      role: 'system',
      content: `你是「${siteName}」的 AI 小助手，你的任务是代表博主「${adminNickname}」解答和回复朋友们的评论。
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
- 不要在 mermaid 图中使用 emoji，可能解析失败`
    }
  ];

  if (articleContext) {
    messages.push({
      role: 'system',
      content: articleContext
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
    const replyContent = await callAI(aiProvider, messages, { max_tokens: 500 });
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

  // 获取文章信息（辅助审核判断上下文）
  let articleContext = '';
  if (comment.article_id) {
    const article = await articleModel.findById(comment.article_id);
    if (article) {
      const body = article.content || '';
      articleContext = `当前文章：《${article.title}》\n${body.length > 5000 ? body.substring(0, 5000) + '...' : body}\n\n`;
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
  save,
  delete: delete_,
  callAI,
  listModels,
  autoReply,
  moderateComment,
  polishArticle,
  logAction,
  getLogs,
  presetProviders: exports.presetProviders
};
