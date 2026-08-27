const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const { getDb, initSchema, seedData } = require('./config/database');
const { loadCommonData } = require('./middleware/common');

const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const databaseRoutes = require('./routes/database');
const aiScheduler = require('./services/aiScheduler');
const commentRateLimiter = require('./services/commentRateLimiter');
const loginGuard = require('./services/loginGuard');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.set('layout extractScripts', false);
app.set('layout extractStyles', false);

// 反向代理下正确识别 https（用于 canonical/OG/sitemap 生成绝对 URL）
app.set('trust proxy', 1);

app.use(expressLayouts);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'leeshisi-blog-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));

app.use(function(req, res, next) {
  res.locals.messages = req.session.messages || [];
  if (req.session && req.session.messages) {
    req.session.messages = [];
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: function(res, filePath) {
    // 第三方库文件（lib/）基本不变，开启浏览器长缓存，避免每次重复拉取
    if (filePath.indexOf(path.join(__dirname, 'public', 'lib')) === 0) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

const { renderMarkdown } = require('./utils/markdown');

app.use(function(req, res, next) {
  res.locals.currentPath = req.path;
  res.locals.user = req.session.user || null;
  res.locals.gravatar = function(email, size) {
    // QQ 邮箱：返回 QQ 头像
    var match = email && email.match(/^(\d+)@qq\.com$/);
    if (match) {
      return 'https://q.qlogo.cn/headimg_dl?dst_uin=' + match[1] + '&spec=100&img_type=jpg';
    }
    return '/images/default-avatar.svg';
  };
  res.locals.renderMarkdown = renderMarkdown;
  next();
});

app.use(function(req, res, next) {
  res.locals.siteName = res.locals.siteName || '李拾肆博客';
  res.locals.title = res.locals.title || '';
  res.locals.currentPath = res.locals.currentPath || req.path;
  next();
});

// 全局 SEO 默认值（对所有页面生效，含 404/500；index 路由会被 common.js 用站点配置覆盖）
app.use(function(req, res, next) {
  if (typeof res.locals.baseUrl === 'undefined') {
    res.locals.baseUrl = req.protocol + '://' + req.get('host');
  }
  if (typeof res.locals.canonical === 'undefined') {
    res.locals.canonical = res.locals.baseUrl + req.path;
  }
  if (typeof res.locals.description === 'undefined') res.locals.description = '';
  if (typeof res.locals.keywords === 'undefined') res.locals.keywords = '';
  if (typeof res.locals.ogType === 'undefined') res.locals.ogType = 'website';
  if (typeof res.locals.ogImage === 'undefined') res.locals.ogImage = '';
  if (typeof res.locals.noindex === 'undefined') res.locals.noindex = false;
  // 相对路径转绝对 URL（用于 OG 图片 / JSON-LD）
  res.locals.absoluteUrl = function(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) || url.indexOf('//') === 0) return url;
    if (url.indexOf('/') === 0) return res.locals.baseUrl + url;
    return url;
  };
  next();
});

app.use('/', indexRoutes);
app.use('/', adminRoutes);
app.use('/', uploadRoutes);
app.use('/', databaseRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use(function(req, res) {
  res.status(404).render('page', {
    title: '404 - 页面未找到',
    siteName: res.locals.siteName,
    votedCommentMap: {},
    votedCommentIds: [],
    page: {
      title: '404 - 页面未找到',
      content: '<p>抱歉，您访问的页面不存在。</p><p><a href="/">返回首页</a></p>'
    },
    comments: [],
    commentTotal: 0,
    commentPage: 1,
    commentTotalPages: 1,
    layout: 'layout'
  });
});

app.use(function(err, req, res, next) {
  console.error('Server Error:', err.message);
  console.error(err.stack);
  res.status(500).render('page', {
    title: '500 - 服务器错误',
    siteName: res.locals.siteName,
    votedCommentMap: {},
    votedCommentIds: [],
    page: {
      title: '500 - 服务器错误',
      content: '<p>服务器内部错误，请稍后重试。</p><p><a href="/">返回首页</a></p>'
    },
    comments: [],
    commentTotal: 0,
    commentPage: 1,
    commentTotalPages: 1,
    layout: 'layout'
  });
});

async function startServer() {
  try {
    await getDb();
    console.log('数据库连接成功');
    initSchema();
    console.log('数据库表初始化完成');
    await seedData();
    console.log('初始数据填充完成');

    app.listen(PORT, function() {
      console.log('========================================');
      console.log('  李拾肆博客系统已启动');
      console.log('  地址: http://localhost:' + PORT);
      console.log('  管理后台: http://localhost:' + PORT + '/admin');
      console.log('  默认管理员: admin@blog.com / admin123');
      console.log('========================================');
    });

    // 启动后台任务：AI 评论批量审核/回复调度 + 限流内存清理
    aiScheduler.start();
    commentRateLimiter.startCleanup();
    loginGuard.startCleanup();
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

startServer();