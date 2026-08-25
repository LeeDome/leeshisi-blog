const commentModel = require('../models/comment');
const articleModel = require('../models/article');
const aiModel = require('../models/ai');
const userModel = require('../models/user');

function getClientIp(req) {
  return req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()
    || req.connection.remoteAddress
    || req.socket.remoteAddress
    || '127.0.0.1';
}

// 渲染评论片段（用于 AJAX 加载更多）
function renderFragment(res, comments, { article, page, votedCommentMap }) {
  return new Promise((resolve, reject) => {
    res.render('_comment-fragment', {
      layout: false,
      comments,
      article: article || null,
      page: page || null,
      votedCommentMap: votedCommentMap || {}
    }, (err, html) => err ? reject(err) : resolve(html));
  });
}

// 加载更多评论（顶级评论 / 某条评论的子回复）
exports.loadMore = async (req, res) => {
  try {
    const articleId = req.query.article_id;
    const pageType = req.query.page_type || 'article';
    const sort = req.query.sort || 'newest';
    const rootId = req.query.root_id ? parseInt(req.query.root_id) : null;

    const ip = getClientIp(req);

    // 构建渲染片段所需的上下文（用于回复表单）
    let articleObj = null;
    let pageObj = null;
    if (pageType === 'article' && articleId) {
      articleObj = await articleModel.findById(articleId);
    } else {
      // 非文章页：page_type 即页面 slug
      pageObj = { slug: pageType };
    }

    if (rootId) {
      // 加载某个根评论下的更多子回复（每次 5 条，最新优先）
      const page = Math.max(1, parseInt(req.query.child_page) || 1);
      const limit = 5;
      const result = await commentModel.findChildrenForRoot({ articleId, pageType, rootId, page, limit });

      const votedCommentMap = {};
      const voted = await commentModel.getVotedCommentIds(ip);
      for (const cid of voted) {
        const status = await commentModel.getVoteStatus(cid, ip);
        if (status) votedCommentMap[cid] = status;
      }

      const html = await renderFragment(res, result.children || [], { article: articleObj, page: pageObj, votedCommentMap });

      const remaining = Math.max(0, result.total - page * limit);

      res.json({
        success: true,
        type: 'children',
        rootId,
        html,
        remaining,
        hasMore: remaining > 0,
        nextPage: page + 1
      });
    } else {
      // 加载更多顶级评论（每次 10 条）
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = 10;
      const result = await commentModel.findByArticle({ articleId, pageType, page, limit, sort });

      const votedCommentMap = {};
      const voted = await commentModel.getVotedCommentIds(ip);
      for (const cid of voted) {
        const status = await commentModel.getVoteStatus(cid, ip);
        if (status) votedCommentMap[cid] = status;
      }

      const html = await renderFragment(res, result.comments || [], { article: articleObj, page: pageObj, votedCommentMap });

      res.json({
        success: true,
        type: 'top',
        html,
        hasMore: page < result.totalPages,
        nextPage: page + 1
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { content, article_id, page_type, nickname, email, website, parent_id } = req.body;

    // 去除 Referer 中已有的 comment_submitted 参数，避免重定向后参数无限累加
    const backUrl = (req.get('Referer') || '/').replace(/[?&]comment_submitted=[^&]*/g, '');
    if (!nickname || !email || !content) {
      return res.redirect(backUrl);
    }

    // 后端限制：昵称不可与管理员昵称重合
    const author = await userModel.getAuthor();
    if (author && author.nickname && String(nickname).trim().toLowerCase() === String(author.nickname).trim().toLowerCase()) {
      return res.redirect(backUrl + (backUrl.includes('?') ? '&' : '?') + 'comment_error=protected_nickname');
    }

    const comment = await commentModel.create({
      content,
      article_id: article_id || null,
      page_type: page_type || 'article',
      nickname,
      email,
      website: website || null,
      parent_id: parent_id || null
    });

    if (article_id) {
      await articleModel.updateCommentCount(article_id);
    }

    // 异步触发 AI 处理（不阻塞用户请求）：先审核，违规则禁用且不回复，不违规再判断是否回复
    if (comment) {
      setImmediate(async () => {
        try {
          const violated = await aiModel.moderateComment(comment);
          if (violated) {
            console.log(`[AI] 评论 #${comment.id} 违规已禁用，不回复`);
            return;
          }
          await aiModel.autoReply(comment);
        } catch (err) {
          console.error('[AI评论处理] 失败:', err.message);
        }
      });
    }

    const separator = backUrl.includes('?') ? '&' : '?';
    res.redirect(backUrl + separator + 'comment_submitted=1');
  } catch (err) {
    const backUrl = (req.get('Referer') || '/').replace(/[?&]comment_submitted=[^&]*/g, '');
    const separator = backUrl.includes('?') ? '&' : '?';
    res.redirect(backUrl + separator + 'comment_submitted=1');
  }
};

exports.like = async (req, res) => {
  try {
    const { comment_id } = req.body;
    if (!comment_id) {
      return res.json({ success: false, message: '参数缺失' });
    }
    const ip = getClientIp(req);
    const comment = await commentModel.vote(comment_id, ip, 'like');
    res.json({
      success: true,
      like_count: comment.like_count
    });
  } catch (err) {
    res.json({ success: false, message: err.message || '点赞失败，请重试' });
  }
};

exports.dislike = async (req, res) => {
  try {
    const { comment_id } = req.body;
    if (!comment_id) {
      return res.json({ success: false, message: '参数缺失' });
    }
    const ip = getClientIp(req);
    const comment = await commentModel.vote(comment_id, ip, 'dislike');
    res.json({
      success: true,
      dislike_count: comment.dislike_count
    });
  } catch (err) {
    res.json({ success: false, message: err.message || '操作失败，请重试' });
  }
};