const aiModel = require('../models/ai');

// AI 配置管理页面
exports.settingsPage = async (req, res) => {
  try {
    const providers = await aiModel.findAll();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const type = req.query.type || 'all';
    const { rows: logs, total } = await aiModel.getLogs({ page, limit: 20, type });
    const totalPages = Math.ceil(total / 20);
    const messages = req.session.messages || [];
    req.session.messages = [];
    res.render('admin/ai-settings', {
      title: 'AI 站长',
      providers,
      logs,
      logPage: page,
      logTotalPages: totalPages,
      logType: type,
      presets: aiModel.presetProviders,
      messages,
      error: null,
      layout: false
    });
  } catch (err) {
    res.render('admin/ai-settings', {
      title: 'AI 站长',
      providers: [],
      logs: [],
      logPage: 1,
      logTotalPages: 1,
      logType: 'all',
      presets: aiModel.presetProviders,
      messages: [],
      error: '加载失败: ' + err.message,
      layout: false
    });
  }
};

// 获取模型列表：根据 API 地址 + 密钥调用 /models 接口
exports.listModels = async (req, res) => {
  try {
    const { url, key } = req.body;
    if (!url || !key) {
      return res.json({ success: false, message: '请先填写 API 地址和 API 密钥' });
    }
    const models = await aiModel.listModels({ apiUrl: url, apiKey: key });
    res.json({ success: true, models });
  } catch (err) {
    res.json({ success: false, message: err.message || '获取模型列表失败' });
  }
};

// 保存/更新配置
exports.save = async (req, res) => {
  try {
    const { id, name, provider_type, api_url, api_key, model_id, is_multimodal, input_tokens, output_tokens, thinking_mode, functions } = req.body;

    if (!api_url || !api_key || !model_id) {
      req.session.messages = [{ type: 'error', text: 'API 地址、密钥、模型 ID 均为必填项' }];
      return res.redirect('/admin/ai');
    }

    // 保存前向模型发送"你好"测试调用，确认模型可正常回复
    const thinking = thinking_mode === 'on' || thinking_mode === '1' || thinking_mode === 'true' || thinking_mode === true;
    try {
      const testProvider = {
        provider_type,
        api_url,
        api_key,
        model_id,
        input_tokens: input_tokens ? parseInt(input_tokens) : null,
        output_tokens: output_tokens ? parseInt(output_tokens) : null,
        thinking_mode: thinking ? 1 : 0
      };
      await aiModel.callAI(testProvider, [{ role: 'user', content: '你好' }], { max_tokens: 100 });
    } catch (testErr) {
      req.session.messages = [{ type: 'error', text: '模型测试调用失败，未保存配置：' + testErr.message }];
      return res.redirect('/admin/ai');
    }

    let funcArr = [];
    if (functions) {
      funcArr = Array.isArray(functions) ? functions : (typeof functions === 'string' ? [functions] : []);
    }

    await aiModel.save({
      id: id || null,
      name, provider_type, api_url, api_key, model_id,
      is_multimodal: is_multimodal === 'on' || is_multimodal === '1' || is_multimodal === true,
      input_tokens: input_tokens ? parseInt(input_tokens) : null,
      output_tokens: output_tokens ? parseInt(output_tokens) : null,
      thinking_mode: thinking,
      functions: funcArr
    });

    req.session.messages = [{ type: 'success', text: '配置已保存，模型测试通过' }];
    res.redirect('/admin/ai');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '保存失败: ' + err.message }];
    res.redirect('/admin/ai');
  }
};

// 删除配置
exports.delete = async (req, res) => {
  try {
    await aiModel.delete(req.params.id);
    req.session.messages = [{ type: 'success', text: '配置已删除' }];
    res.redirect('/admin/ai');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '删除失败: ' + err.message }];
    res.redirect('/admin/ai');
  }
};

// 文章润色 API
exports.polish = async (req, res) => {
  try {
    const { content, style } = req.body;
    if (!content) {
      return res.json({ success: false, message: '内容不能为空' });
    }

    const result = await aiModel.polishArticle(content, style || 'polish');
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, message: err.message || '润色失败' });
  }
};