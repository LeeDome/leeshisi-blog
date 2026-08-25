const pageModel = require('../models/page');
const commentModel = require('../models/comment');
const galleryModel = require('../models/gallery');
const https = require('https');

function getClientIp(req) {
  return req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()
    || req.connection.remoteAddress
    || req.socket.remoteAddress
    || '127.0.0.1';
}

// QQ 昵称查询接口
exports.qqInfo = async (req, res) => {
  try {
    const qq = req.query.qq;
    if (!qq || !/^\d+$/.test(qq)) {
      return res.json({ success: false, message: '无效的 QQ 号码' });
    }

    const url = 'https://users.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins=' + qq;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, function(response) {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) { raw += chunk; });
      response.on('end', function() {
        try {
          // 返回格式: portraitCallBack({"QQ号":["头像url小","头像url大","昵称","性别","邮箱"]})
          var jsonStr = raw.replace(/^portraitCallBack\s*\(/, '').replace(/\)\s*;?\s*$/, '').trim();
          var obj = JSON.parse(jsonStr);

          // 遍历对象属性，找到对应 QQ 号的数据
          var keys = Object.keys(obj);
          if (keys.length > 0) {
            var arr = obj[keys[0]];
            if (Array.isArray(arr) && arr.length >= 3 && arr[2]) {
              var nickname = arr[2];
              try { nickname = decodeURIComponent(nickname); } catch(_) {}
              return res.json({ success: true, nickname: nickname });
            }
          }
          return res.json({ success: false, message: '获取昵称失败' });
        } catch (e) {
          return res.json({ success: false, message: '解析昵称失败: ' + e.message });
        }
      });
    }).on('error', function(err) {
      return res.json({ success: false, message: '请求失败: ' + err.message });
    });
  } catch (err) {
    return res.json({ success: false, message: '服务器错误' });
  }
};

exports.about = async (req, res) => {
  try {
    const page = await pageModel.findBySlug('about');

    if (!page) {
      return res.status(404).render('page', {
        title: '404 - 页面未找到',
        siteName: res.locals.siteName,
        page: { title: '404 - 页面未找到', content: '<p>抱歉，您访问的页面不存在。</p><p><a href="/">返回首页</a></p>' },
        comments: [], commentTotal: 0, commentPage: 1, commentTotalPages: 1,
        layout: 'layout'
      });
    }

    const commentResult = await commentModel.findByArticle({
      articleId: null,
      pageType: 'about',
      page: 1,
      limit: 10,
      sort: 'newest'
    });

    // 获取当前访客已投票的评论 ID 和对应投票类型
    const ip = getClientIp(req);
    const votedCommentIds = await commentModel.getVotedCommentIds(ip);
    const votedCommentMap = {};
    for (const cid of votedCommentIds) {
      const status = await commentModel.getVoteStatus(cid, ip);
      if (status) votedCommentMap[cid] = status;
    }

    res.render('page', {
      title: page ? page.title : '关于',
      page,
      comments: commentResult.comments,
      commentTotal: commentResult.total,
      commentPage: commentResult.page,
      commentTotalPages: commentResult.totalPages,
      comment_submitted: req.query.comment_submitted,
      comment_error: req.query.comment_error,
      votedCommentIds,
      votedCommentMap
    });
  } catch (err) {
    res.render('page', {
      title: '关于',
      page: null,
      comments: [],
      commentPage: 1,
      commentTotalPages: 0,
      error: '加载页面失败',
      votedCommentIds: [],
      votedCommentMap: {}
    });
  }
};

exports.message = async (req, res) => {
  try {
    const page = await pageModel.findBySlug('message');

    if (!page) {
      return res.status(404).render('page', {
        title: '404 - 页面未找到',
        siteName: res.locals.siteName,
        page: { title: '404 - 页面未找到', content: '<p>抱歉，您访问的页面不存在。</p><p><a href="/">返回首页</a></p>' },
        comments: [], commentTotal: 0, commentPage: 1, commentTotalPages: 1,
        layout: 'layout'
      });
    }

    const commentPage = parseInt(req.query.page) || 1;
    const commentResult = await commentModel.findByArticle({
      articleId: null,
      pageType: 'message',
      page: commentPage,
      limit: 10,
      sort: 'newest'
    });

    // 获取当前访客已投票的评论 ID 和对应投票类型
    const ip = getClientIp(req);
    const votedCommentIds = await commentModel.getVotedCommentIds(ip);
    const votedCommentMap = {};
    for (const cid of votedCommentIds) {
      const status = await commentModel.getVoteStatus(cid, ip);
      if (status) votedCommentMap[cid] = status;
    }

    res.render('page', {
      title: page ? page.title : '留言',
      page,
      comments: commentResult.comments,
      commentTotal: commentResult.total,
      commentPage: commentResult.page,
      commentTotalPages: commentResult.totalPages,
      comment_submitted: req.query.comment_submitted,
      comment_error: req.query.comment_error,
      votedCommentIds,
      votedCommentMap
    });
  } catch (err) {
    res.render('page', {
      title: '留言',
      page: null,
      comments: [],
      commentPage: 1,
      commentTotalPages: 0,
      error: '加载留言页面失败',
      votedCommentIds: [],
      votedCommentMap: {}
    });
  }
};

exports.gallery = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;

    const result = await galleryModel.findAll({ page, limit });

    res.render('gallery-list', {
      title: '图册',
      galleries: result.galleries,
      page: result.page,
      totalPages: result.totalPages
    });
  } catch (err) {
    res.render('gallery-list', {
      title: '图册',
      galleries: [],
      page: 1,
      totalPages: 0,
      error: '加载图册列表失败'
    });
  }
};

exports.galleryDetail = async (req, res) => {
  try {
    const gallery = await galleryModel.findById(parseInt(req.params.id));

    if (!gallery) {
      return res.status(404).render('page', {
        title: '404 - 页面未找到',
        siteName: res.locals.siteName,
        page: { title: '404 - 页面未找到', content: '<p>抱歉，您访问的页面不存在。</p><p><a href="/">返回首页</a></p>' },
        comments: [], commentTotal: 0, commentPage: 1, commentTotalPages: 1,
        layout: 'layout'
      });
    }

    res.render('gallery-detail', {
      title: gallery ? gallery.title : '图册详情',
      gallery
    });
  } catch (err) {
    res.status(500).render('page', {
      title: '500 - 服务器错误',
      siteName: res.locals.siteName,
      page: { title: '500 - 服务器错误', content: '<p>服务器内部错误，请稍后重试。</p><p><a href="/">返回首页</a></p>' },
      comments: [], commentTotal: 0, commentPage: 1, commentTotalPages: 1,
      layout: 'layout'
    });
  }
};