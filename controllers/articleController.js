const articleModel = require('../models/article');
const categoryModel = require('../models/category');
const commentModel = require('../models/comment');
const tagModel = require('../models/tag');
const { getDb, get, run, all } = require('../config/database');
const { renderMarkdown } = require('../utils/markdown');

exports.index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const categorySlug = req.query.categorySlug || null;

    const result = await articleModel.findAll({
      page,
      limit,
      categorySlug,
      status: 'published'
    });

    res.render('index', {
      title: '首页',
      articles: result.articles,
      page: result.page,
      totalPages: result.totalPages,
      currentCategory: null
    });
  } catch (err) {
    res.render('index', {
      title: '首页',
      articles: [],
      page: 1,
      totalPages: 0,
      currentCategory: null,
      error: '加载文章列表失败'
    });
  }
};

exports.listByCategory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const categorySlug = req.params.slug;

    const category = await categoryModel.findBySlug(categorySlug);

    const result = await articleModel.findAll({
      page,
      limit,
      categorySlug,
      status: 'published'
    });

    res.render('index', {
      title: category ? category.name : '分类',
      description: category ? category.description : '',
      articles: result.articles,
      page: result.page,
      totalPages: result.totalPages,
      currentCategory: category
    });
  } catch (err) {
    res.render('index', {
      title: '分类',
      description: '',
      articles: [],
      page: 1,
      totalPages: 0,
      currentCategory: null,
      error: '加载分类文章失败'
    });
  }
};

exports.listByTag = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const tagId = parseInt(req.params.id);

    const result = await articleModel.findAll({
      page,
      limit,
      tagId,
      status: 'published'
    });

    const tag = await tagModel.findById(tagId);

    res.render('index', {
      title: tag ? '标签：' + tag.name : '标签',
      articles: result.articles,
      page: result.page,
      totalPages: result.totalPages,
      currentCategory: null,
      currentTag: tag
    });
  } catch (err) {
    res.render('index', {
      title: '标签',
      articles: [],
      page: 1,
      totalPages: 0,
      currentCategory: null,
      currentTag: null,
      error: '加载标签文章失败'
    });
  }
};

exports.detail = async (req, res, next) => {
  try {
    const article = await articleModel.findById(req.params.id);

    if (!article || article.status !== 'published') {
      return res.status(404).render('404', { title: '404 - 页面未找到' });
    }

    await articleModel.incrementView(article.id);

    const tags = await tagModel.getArticleTags(article.id);

    // 将 Markdown 内容渲染为 HTML
    article.content = renderMarkdown(article.content);

    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const sort = req.query.sort || 'newest';

    const commentResult = await commentModel.findByArticle({
      articleId: article.id,
      pageType: 'article',
      page,
      limit,
      sort
    });

    // 获取当前访客已投票的评论 ID 和对应投票类型
    const ip = req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()
      || req.connection.remoteAddress
      || req.socket.remoteAddress
      || '127.0.0.1';
    const votedCommentIds = await commentModel.getVotedCommentIds(ip);
    const votedCommentMap = {};
    for (const cid of votedCommentIds) {
      const status = await commentModel.getVoteStatus(cid, ip);
      if (status) votedCommentMap[cid] = status;
    }

    res.render('article-detail', {
      title: article.title,
      description: article.excerpt || article.title,
      keywords: tags.map(function(t) { return t.name; }).join(','),
      ogType: 'article',
      ogImage: article.cover_image || '',
      article,
      tags,
      comments: commentResult.comments,
      commentTotal: commentResult.total,
      commentPage: commentResult.page,
      commentTotalPages: commentResult.totalPages,
      commentSort: sort,
      comment_submitted: req.query.comment_submitted,
      comment_error: req.query.comment_error,
      votedCommentIds,
      votedCommentMap
    }, function(err, html) {
      if (err) {
        console.error('模板渲染错误:', err.message);
        console.error('错误堆栈:', err.stack);
        return res.status(500).send('<h1>500 渲染错误</h1><pre>' + err.message + '\n\n' + (err.stack || '') + '</pre>');
      }
      res.send(html);
    });
  } catch (err) {
    console.error('文章详情加载错误:', err);
    next(err);
  }
};

// 获取客户端真实 IP（优先取 X-Forwarded-For，兼容 Nginx 反向代理）
function getClientIp(req) {
  return req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()
    || req.connection.remoteAddress
    || req.socket.remoteAddress
    || '127.0.0.1';
}

exports.rate = async (req, res) => {
  try {
    const { article_id, score } = req.body;
    const ip = getClientIp(req);
    console.log('[rate] article_id:', article_id, 'score:', score, 'ip:', ip);

    await getDb();

    const existing = get(
      'SELECT id FROM ratings WHERE article_id = ? AND ip_address = ?',
      [article_id, ip]
    );

    if (existing) {
      return res.json({ success: false, message: '您已评分' });
    }

    run(
      'INSERT INTO ratings (article_id, score, ip_address) VALUES (?, ?, ?)',
      [article_id, score, ip]
    );

    const ratingResult = get(
      'SELECT SUM(score) as total_score, COUNT(*) as count FROM ratings WHERE article_id = ?',
      [article_id]
    );

    const ratingScore = Math.round((ratingResult.total_score / ratingResult.count) * 100) / 100;
    const ratingCount = ratingResult.count;

    run(
      'UPDATE articles SET rating_score = ?, rating_count = ? WHERE id = ?',
      [ratingScore, ratingCount, article_id]
    );

    res.json({
      success: true,
      rating_score: ratingScore,
      rating_count: ratingCount
    });
  } catch (err) {
    console.error('[rate] 错误:', err.message);
    console.error('[rate] 堆栈:', err.stack);
    res.json({ success: false, message: '评分失败，请重试' });
  }
};

exports.like = async (req, res) => {
  try {
    const { article_id } = req.body;
    const ip = getClientIp(req);

    await getDb();

    const existing = get(
      'SELECT id FROM likes WHERE article_id = ? AND ip_address = ?',
      [article_id, ip]
    );

    if (existing) {
      return res.json({ success: false, message: '您已点赞' });
    }

    run('INSERT INTO likes (article_id, ip_address) VALUES (?, ?)', [article_id, ip]);

    await articleModel.incrementLike(article_id);

    const article = await articleModel.findById(article_id);

    res.json({
      success: true,
      like_count: article.like_count
    });
  } catch (err) {
    res.json({ success: false, message: '点赞失败，请重试' });
  }
};

exports.search = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const search = req.query.q || '';

    const result = await articleModel.findAll({
      page,
      limit,
      search,
      status: 'published'
    });

    res.render('index', {
      title: '搜索：' + search,
      articles: result.articles,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      currentCategory: null,
      search: search
    });
  } catch (err) {
    res.render('index', {
      title: '搜索',
      articles: [],
      total: 0,
      page: 1,
      totalPages: 0,
      currentCategory: null,
      searchKeyword: '',
      error: '搜索失败'
    });
  }
};

exports.listByArchive = async (req, res) => {
  try {
    const yearMonth = req.params.yearMonth;
    const articles = await articleModel.findByYearMonth(yearMonth);

    res.render('archive', {
      title: '归档：' + yearMonth,
      articles,
      archive: yearMonth
    });
  } catch (err) {
    res.render('archive', {
      title: '归档',
      articles: [],
      archive: '',
      error: '加载归档文章失败'
    });
  }
};