const commentModel = require('../models/comment');
const articleModel = require('../models/article');

function getClientIp(req) {
  return req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()
    || req.connection.remoteAddress
    || req.socket.remoteAddress
    || '127.0.0.1';
}

exports.create = async (req, res) => {
  try {
    const { content, article_id, page_type, nickname, email, website, parent_id } = req.body;

    if (!nickname || !email || !content) {
      const backUrl = req.get('Referer') || '/';
      return res.redirect(backUrl);
    }

    await commentModel.create({
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

    const backUrl = req.get('Referer') || '/';
    const separator = backUrl.includes('?') ? '&' : '?';
    res.redirect(backUrl + separator + 'comment_submitted=1');
  } catch (err) {
    const backUrl = req.get('Referer') || '/';
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