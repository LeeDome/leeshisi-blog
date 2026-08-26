// 工具：get_article_text —— 按字符区间读取当前文章正文
module.exports = {
  // 工具名（AI 调用时使用，须唯一、小写驼峰）
  name: 'get_article_text',
  // 工具介绍：说明用途与参数，会同时注入 AI 的系统上下文
  description: '按字符区间读取当前文章的正文（纯文本）。start 为起始位置（从 1 开始），length 为读取长度。返回对应区间的文本、总字数与图片数量。用于长文按需分段阅读。',
  // 参数 JSON Schema（供 AI 按格式传参）
  parameters: {
    type: 'object',
    properties: {
      start: { type: 'integer', description: '起始字符位置，从 1 开始' },
      length: { type: 'integer', description: '读取长度，建议 500~2000' }
    },
    required: ['start', 'length']
  },
  // 执行体：context 由调用方（autoReply）注入，args 为 AI 传参
  async run(context, args) {
    const plainBody = context.plainBody || '';
    const imageUrls = context.imageUrls || [];
    const start = Math.max(1, parseInt(args.start, 10) || 1);
    const length = Math.max(1, Math.min(8000, parseInt(args.length, 10) || 500));
    const s = Math.min(start - 1, plainBody.length);
    const slice = plainBody.substring(s, s + length);
    return {
      start: s + 1,
      end: s + slice.length,
      total_chars: plainBody.length,
      total_images: imageUrls.length,
      image_urls: imageUrls.slice(0, 20),
      text: slice || '（已超出正文末尾，无更多内容）'
    };
  }
};