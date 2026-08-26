// 工具：get_article_image —— 定位当前文章中的某张图片，校验公网可访问，并返回视觉识别结果
const http = require('http');
const https = require('https');

// 探测图片是否公网可访问（跟随重定向，最多 3 跳，15s 超时）
function checkImageAccessible(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return resolve({ ok: false, error: '非法或非绝对的图片地址，无法探测' });
    }
    const isHttps = u.protocol === 'https:';
    const client = isHttps ? https : http;
    const req = client.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.destroy();
        const next = new URL(res.headers.location, u).href;
        return resolve(checkImageAccessible(next, redirectsLeft - 1));
      }
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const info = {
        ok,
        status: res.statusCode,
        contentType: (res.headers['content-type'] || '').toLowerCase(),
        error: ok ? undefined : 'HTTP ' + res.statusCode
      };
      res.destroy();
      return resolve(info);
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(15000, () => { req.destroy(new Error('连接超时')); });
    req.end();
  });
}

module.exports = {
  name: 'get_article_image',
  description: '校验并识别当前文章中的某张图片：核对图片在文章中的顺序、校验其公网可访问性、并进行视觉识别，返回可访问地址与实际识别结果。用 image_index（0 开头）或 image_url 指定图片。文章图片清单可通过 get_article_text 的 image_urls 字段获取。',
  parameters: {
    type: 'object',
    properties: {
      image_index: { type: 'integer', description: '图片在文章中的索引（从 0 开始）。可不传 image_url，仅靠此定位图片' },
      image_url: { type: 'string', description: '图片的 URL（相对或绝对路径均可）。与 image_index 二选一，传一个即可' }
    }
  },
  async run(context, args) {
    const imageUrls = context.imageUrls || [];
    const siteBase = context.siteBase || '';

    // 定位目标图片：优先用 image_index（0 开头），否则用 image_url
    let raw = '';
    if (args && args.image_index !== undefined && args.image_index !== null && args.image_index !== '') {
      const idx = parseInt(args.image_index, 10);
      if (isNaN(idx) || idx < 0 || idx >= imageUrls.length) {
        return {
          error: 'image_index 超出范围或不是有效索引',
          total_images: imageUrls.length,
          image_urls: imageUrls.slice(0, 30),
          tip: '请根据 get_article_text 返回的 image_urls 列表，用 0 开头的正确索引重试'
        };
      }
      raw = imageUrls[idx];
    } else if (args && args.image_url) {
      raw = String(args.image_url);
    } else {
      return {
        error: '缺少指定图片的参数，请提供 image_index（0 开头）或 image_url',
        total_images: imageUrls.length,
        image_urls: imageUrls.slice(0, 30)
      };
    }

    // 归一化站点基准地址：去末尾斜杠
    const base = siteBase ? siteBase.replace(/\/+$/, '') : '';

    // 解析为绝对地址，兼容三类来源：
    // 1) 绝对 http/https（含七牛云 CDN、外部 https 图片）→ 原样返回
    // 2) 协议相对 //domain/path → 补 http:
    // 3) 本地相对路径 /uploads/x.png → 拼接站点地址
    function resolve(u2) {
      if (!u2) return '';
      if (/^https?:\/\//i.test(u2)) return u2;
      if (/^\/\//.test(u2)) return 'http:' + u2;
      if (base) return base + (u2.charAt(0) === '/' ? u2 : '/' + u2);
      return u2; // 未配置站点地址时保持原样
    }

    const abs = raw ? resolve(raw) : '';
    if (!abs) {
      return { error: '图片地址为空', total_images: imageUrls.length };
    }

    // 1) 探测公网可访问性
    const check = await checkImageAccessible(abs);
    if (!check.ok || check.status >= 300) {
      return { error: '图片无法访问：' + (check.error || '未知错误'), url: abs, total_images: imageUrls.length };
    }

    // 2) 视觉识别（依赖调用方注入 context.describeImage，仅多模态模型可用）
    //    describeImage 返回图里内容的文字描述；未注入则说明当前模型无视觉能力，如实告知 AI。
    if (typeof context.describeImage === 'function') {
      try {
        const description = await context.describeImage(abs);
        return {
          image_url: abs,
          total_images: imageUrls.length,
          description: description && description.trim()
            ? description.trim()
            : '（未能识别出图片内容）'
        };
      } catch (e) {
        return { error: '图片识别失败：' + e.message, url: abs, total_images: imageUrls.length };
      }
    }

    // 3) 未配置视觉辅助：如实告知 AI 需要管理员在后台配置
    return {
      error: '未配置视觉辅助，请在管理员后台配置（/admin/ai → 功能分配 → 视觉辅助）',
      url: abs,
      total_images: imageUrls.length
    };
  }
};