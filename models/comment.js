const { getDb, run, get, all } = require('../config/database');

async function findByArticle({ articleId, pageType, page = 1, limit = 10, sort = 'newest' }) {
  await getDb();

  const whereClauses = ['c.parent_id IS NULL', 'c.status = ?'];
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

  const orderBy = sort === 'hottest'
    ? 'ORDER BY c.like_count DESC, c.created_at DESC'
    : 'ORDER BY c.created_at DESC';

  const countRow = get(
    `SELECT COUNT(*) as total FROM comments c ${whereStr}`,
    params
  );
  const total = countRow.total;
  const totalPages = Math.ceil(total / limit);

  const offset = (page - 1) * limit;
  const topComments = all(
    `SELECT c.* FROM comments c ${whereStr} ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  async function buildChildren(parentId) {
    const children = all(
      `SELECT * FROM comments WHERE parent_id = ? AND status = ? ORDER BY created_at ASC`,
      [parentId, 'approved']
    );
    for (const child of children) {
      child.children = await buildChildren(child.id);
    }
    return children;
  }

  for (const comment of topComments) {
    comment.children = await buildChildren(comment.id);
  }

  return { comments: topComments, total, page, totalPages };
}

async function create({ content, article_id, page_type, nickname, email, website, parent_id }) {
  await getDb();

  if (parent_id) {
    const parent = get('SELECT id FROM comments WHERE id = ?', [parent_id]);
    if (!parent) {
      throw new Error('父评论不存在');
    }
  }

  run(
    `INSERT INTO comments (content, article_id, page_type, nickname, email, website, parent_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`,
    [content, article_id || null, page_type || 'article', nickname, email, website || null, parent_id || null]
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

module.exports = {
  findByArticle,
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
  vote
};