const { all } = require('../config/database');
const categoryModel = require('../models/category');
const tagModel = require('../models/tag');

// 站点基础 URL：优先使用后台配置的 site_url，否则按请求协议/域名推导
function getBaseUrl(req, res) {
  if (res.locals.siteUrl) return res.locals.siteUrl;
  return req.protocol + '://' + req.get('host');
}

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

exports.sitemap = async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req, res);
    const articles = all('SELECT id, updated_at FROM articles WHERE status = ? ORDER BY id ASC', ['published']);
    const categories = await categoryModel.getAll();
    const tags = await tagModel.getAll();
    const galleries = all('SELECT id FROM galleries ORDER BY id ASC');

    let urls = [];
    urls.push(baseUrl + '/');
    urls.push(baseUrl + '/about');
    urls.push(baseUrl + '/message');
    urls.push(baseUrl + '/gallery');
    urls.push(baseUrl + '/tools');
    urls.push(baseUrl + '/tools/image-compress');

    categories.forEach(function(c) {
      if (c.slug === 'gallery' || c.slug === 'home') return;
      urls.push(baseUrl + '/category/' + c.slug);
    });
    articles.forEach(function(a) {
      urls.push({ loc: baseUrl + '/article/' + a.id, lastmod: a.updated_at });
    });
    tags.forEach(function(t) {
      urls.push(baseUrl + '/tag/' + t.id);
    });
    galleries.forEach(function(g) {
      urls.push(baseUrl + '/gallery/' + g.id);
    });

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    urls.forEach(function(u) {
      if (typeof u === 'string') u = { loc: u };
      xml += '  <url>\n';
      xml += '    <loc>' + xmlEscape(u.loc) + '</loc>\n';
      if (u.lastmod) xml += '    <lastmod>' + String(u.lastmod).slice(0, 10) + '</lastmod>\n';
      xml += '  </url>\n';
    });
    xml += '</urlset>';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    console.error('sitemap 生成错误:', err.message);
    res.status(500).set('Content-Type', 'application/xml; charset=utf-8')
      .send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
};

exports.robots = (req, res) => {
  const baseUrl = getBaseUrl(req, res);
  const txt = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /search',
    'Disallow: /uploads',
    '',
    'Sitemap: ' + baseUrl + '/sitemap.xml',
    ''
  ].join('\n');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(txt);
};
