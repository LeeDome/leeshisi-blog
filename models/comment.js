const { getDb, run, get, all } = require('../config/database');

async function findByArticle({ articleId, pageType, page = 1, limit = 10, sort = 'newest', childLimit = 5 }) {
  await getDb();

  const whereClauses = ['c.status = ?'];
  const params = ['approved'];

  if (pageType !== 'article') {
    whereClauses.push('c.page_type = ?');
    params.push(pageType);
    whereClauses.push('c.article_id IS NULL');
  } else {
    whereClauses.push('c.page_type = ?');
    params.push(pageType);
    if (articleId) {
      whereClauses.push('c.article_id = ?');
      params.push(articleId);
    }
  }

  const whereStr = 'WHERE ' + whereClauses.join(' AND ');

  // 查询该文章下所有审核通过的评论
  const allComments = all(
    `SELECT c.* FROM comments c ${whereStr} ORDER BY c.created_at ASC`,
    params
  );

  // 分离顶级评论和子评论
  const topComments = [];
  const replies = [];
  const commentMap = {};

  allComments.forEach(c => {
    commentMap[c.id] = c;
    if (c.parent_id === null) {
      topComments.push(c);
    } else {
      replies.push(c);
    }
  });

  // 顶级评论容器
  const rootMap = {};
  topComments.forEach(c => { rootMap[c.id] = c; });

  // 将回复归拢到根顶级评论，并标记其直接父评论昵称
  const replyGroups = {};
  replies.forEach(c => {
    let current = c;
    while (current.parent_id && !rootMap[current.id]) {
      const p = commentMap[current.parent_id];
      if (!p) break;
      current = p;
    }
    if (rootMap[current.id]) {
      const parent = commentMap[c.parent_id];
      c.reply_to = parent ? parent.nickname : null;
      if (!replyGroups[current.id]) replyGroups[current.id] = [];
      replyGroups[current.id].push(c);
    }
  });

  // 每个根评论的子评论按最新优先排序
  Object.keys(replyGroups).forEach(rootId => {
    replyGroups[rootId].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  });

  // 按时间/热度排序顶级评论（不修改原数组）
  const sortedTop = sort === 'hottest'
    ? topComments.slice().sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || new Date(b.created_at) - new Date(a.created_at))
    : topComments.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 顶级评论分页
  const total = sortedTop.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const pagedTop = sortedTop.slice(offset, offset + limit);

  // 为当前页的顶级评论附加最新 childLimit 条子回复及加载更多标记
  pagedTop.forEach(c => {
    const kids = replyGroups[c.id] || [];
    c.childrenTotal = kids.length;
    c.hasMoreChildren = kids.length > childLimit;
    c.children = kids.slice(0, childLimit);
  });

  return { comments: pagedTop, total, page, totalPages };
}

// 获取某个根顶级评论下的子回复（分页，最新优先）
async function findChildrenForRoot({ articleId, pageType, rootId, page = 1, limit = 5 }) {
  await getDb();

  const whereClauses = ['c.status = ?'];
  const params = ['approved'];

  if (pageType !== 'article') {
    whereClauses.push('c.page_type = ?');
    params.push(pageType);
    whereClauses.push('c.article_id IS NULL');
  } else {
    whereClauses.push('c.page_type = ?');
    params.push(pageType);
    if (articleId) {
      whereClauses.push('c.article_id = ?');
      params.push(articleId);
    }
  }

  const whereStr = 'WHERE ' + whereClauses.join(' AND ');

  const allComments = all(
    `SELECT c.* FROM comments c ${whereStr} ORDER BY c.created_at ASC`,
    params
  );

  const commentMap = {};
  const rootMap = {};
  allComments.forEach(c => {
    commentMap[c.id] = c;
    if (c.parent_id === null) rootMap[c.id] = c;
  });

  const children = [];
  allComments.forEach(c => {
    if (c.parent_id === null || c.id === rootId) return;
    // 向上追溯根顶级评论
    let current = c;
    while (current.parent_id && !rootMap[current.id]) {
      const p = commentMap[current.parent_id];
      if (!p) break;
      current = p;
    }
    if (current.id === rootId) {
      const parent = commentMap[c.parent_id];
      c.reply_to = parent ? parent.nickname : null;
      children.push(c);
    }
  });

  children.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = children.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;

  return { children: children.slice(offset, offset + limit), total, page, totalPages };
}

async function create({ content, article_id, page_type, nickname, email, website, parent_id, is_author }) {
  await getDb();

  if (parent_id) {
    const parent = get('SELECT id FROM comments WHERE id = ?', [parent_id]);
    if (!parent) {
      throw new Error('父评论不存在');
    }
  }

  run(
    `INSERT INTO comments (content, article_id, page_type, nickname, email, website, parent_id, is_author, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
    [content, article_id || null, page_type || 'article', nickname, email, website || null, parent_id || null, is_author ? 1 : 0]
  );

  const comment = get(
    `SELECT * FROM comments WHERE nickname = ? AND email = ? AND content = ? ORDER BY id DESC LIMIT 1`,
    [nickname, email, content]
  );
  return comment;
}

async function like(id) {
  await getDb();
  run('UPDATE comments SET like_count = like_count + 1 WHERE id = ?', [id]);
  return get('SELECT * FROM comments WHERE id = ?', [id]);
}

async function dislike(id) {
  await getDb();
  run('UPDATE comments SET dislike_count = dislike_count + 1 WHERE id = ?', [id]);
  return get('SELECT * FROM comments WHERE id = ?', [id]);
}

async function getRecentComments(limit = 5) {
  await getDb();
  return all(
    `SELECT c.*, a.title as articleTitle, a.slug as articleSlug
     FROM comments c
     LEFT JOIN articles a ON c.article_id = a.id
     WHERE c.status = 'approved'
     ORDER BY c.created_at DESC
     LIMIT ?`,
    [limit]
  );
}

async function getCommentCount(articleId, pageType) {
  await getDb();
  const row = get(
    `SELECT COUNT(*) as count FROM comments WHERE article_id IS ? AND page_type = ? AND status = 'approved'`,
    [articleId || null, pageType || 'article']
  );
  return row.count;
}

async function findById(id) {
  await getDb();
  return get('SELECT * FROM comments WHERE id = ?', [id]);
}

async function delete_(id) {
  await getDb();
  const children = all('SELECT id FROM comments WHERE parent_id = ?', [id]);
  for (const child of children) {
    await delete_(child.id);
  }
  run('DELETE FROM comments WHERE id = ?', [id]);
}

async function approve(id) {
  await getDb();
  run("UPDATE comments SET status = 'approved', updated_at = datetime('now','localtime') WHERE id = ?", [id]);
  return get('SELECT * FROM comments WHERE id = ?', [id]);
}

async function markSpam(id) {
  await getDb();
  run("UPDATE comments SET status = 'spam', updated_at = datetime('now','localtime') WHERE id = ?", [id]);
  return get('SELECT * FROM comments WHERE id = ?', [id]);
}

async function getVotedCommentIds(ipAddress) {
  await getDb();
  const rows = all(
    `SELECT DISTINCT comment_id FROM comment_votes WHERE ip_address = ?`,
    [ipAddress]
  );
  return rows.map(r => r.comment_id);
}

async function getVoteStatus(commentId, ipAddress) {
  await getDb();
  const row = get(
    `SELECT vote_type FROM comment_votes WHERE comment_id = ? AND ip_address = ?`,
    [commentId, ipAddress]
  );
  return row ? row.vote_type : null;
}

async function vote(commentId, ipAddress, voteType) {
  await getDb();
  // 重复点击同类型：直接返回当前计数
  const existing = get(
    `SELECT id FROM comment_votes WHERE comment_id = ? AND ip_address = ? AND vote_type = ?`,
    [commentId, ipAddress, voteType]
  );
  if (existing) {
    return get('SELECT * FROM comments WHERE id = ?', [commentId]);
  }

  // 已有相反投票，拒绝（互斥：点了踩就不能点赞，点了赞就不能点踩）
  const oppositeType = voteType === 'like' ? 'dislike' : 'like';
  const opposite = get(
    `SELECT id FROM comment_votes WHERE comment_id = ? AND ip_address = ? AND vote_type = ?`,
    [commentId, ipAddress, oppositeType]
  );
  if (opposite) {
    throw new Error('已经点过' + (oppositeType === 'like' ? '赞' : '踩') + '，不能同时点踩');
  }

  run(
    `INSERT INTO comment_votes (comment_id, ip_address, vote_type) VALUES (?, ?, ?)`,
    [commentId, ipAddress, voteType]
  );
  run(
    `UPDATE comments SET ${voteType === 'like' ? 'like_count' : 'dislike_count'} = ${voteType === 'like' ? 'like_count' : 'dislike_count'} + 1 WHERE id = ?`,
    [commentId]
  );
  return get('SELECT * FROM comments WHERE id = ?', [commentId]);
}

// 查询仍未 AI 审核的评论（按时间顺序，limit 为每批上限，maxCount 为余量净配额）
async function findPendingModeration(limit = 50, maxCount) {
  await getDb();
  const cap = maxCount != null && maxCount < limit ? maxCount : limit;
  return all(
    `SELECT c.*, a.title as article_title
     FROM comments c
     LEFT JOIN articles a ON c.article_id = a.id
     WHERE c.ai_moderated = 0 AND c.status != 'disabled' AND c.is_author != 1
     ORDER BY c.created_at ASC
     LIMIT ?`,
    [cap]
  );
}

// ---- IP 拉黑 ----
// 是否仍在拉黑期内（返回解除时间，未拉黑/已过期返回 null）
function isIpBlocked(ip) {
  const row = get(
    `SELECT blocked_until FROM ip_blacklist WHERE ip = ? AND blocked_until > datetime('now','localtime')`,
    [ip]
  );
  return row ? row.blocked_until : null;
}

// 拉黑 IP（hours 小时）
function addIpBlacklist(ip, reason, hours) {
  const h = parseInt(hours) || 21;
  run(`INSERT INTO ip_blacklist (ip, blocked_until, reason) VALUES (?, datetime('now','localtime','+${h} hours'), ?)
       ON CONFLICT(ip) DO UPDATE SET blocked_until = excluded.blocked_until, reason = excluded.reason, created_at = datetime('now','localtime')`,
    [ip, reason]);
}

// 查询所有仍在拉黑期内的 IP（按创建时间倒序）
function getIpBlacklist() {
  return all(
    `SELECT ip, blocked_until, reason, created_at
     FROM ip_blacklist
     WHERE blocked_until > datetime('now','localtime')
     ORDER BY created_at DESC`
  );
}

// 解除某 IP 的拉黑（删除记录）
function removeIpBlacklist(ip) {
  run('DELETE FROM ip_blacklist WHERE ip = ?', [ip]);
}

module.exports = {
  findByArticle,
  findChildrenForRoot,
  create,
  like,
  dislike,
  getRecentComments,
  getCommentCount,
  findById,
  delete: delete_,
  approve,
  markSpam,
  getVotedCommentIds,
  getVoteStatus,
  vote,
  findPendingModeration,
  isIpBlocked,
  addIpBlacklist,
  getIpBlacklist,
  removeIpBlacklist
};