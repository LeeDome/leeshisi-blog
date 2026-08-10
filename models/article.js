const { getDb, run, get, all } = require('../config/database');

async function findAll({ page = 1, limit = 10, categorySlug, tagId, status = 'published', search } = {}) {
  await getDb();

  const whereClauses = [];
  const params = [];

  whereClauses.push('a.status = ?');
  params.push(status);

  if (categorySlug) {
    whereClauses.push('c.slug = ?');
    params.push(categorySlug);
  }

  if (tagId) {
    whereClauses.push('a.id IN (SELECT article_id FROM article_tags WHERE tag_id = ?)');
    params.push(tagId);
  }

  if (search) {
    whereClauses.push('(a.title LIKE ? OR a.content LIKE ?)');
    params.push(`%${search}%`);
    params.push(`%${search}%`);
  }

  const whereStr = 'WHERE ' + whereClauses.join(' AND ');

  const countRow = get(
    `SELECT COUNT(*) as total FROM articles a LEFT JOIN categories c ON a.category_id = c.id ${whereStr}`,
    params
  );
  const total = countRow.total;
  const totalPages = Math.ceil(total / limit);

  const offset = (page - 1) * limit;
  const articles = all(
    `SELECT a.*, c.name as category_name FROM articles a LEFT JOIN categories c ON a.category_id = c.id ${whereStr} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { articles, total, page, totalPages };
}

async function findBySlug(slug) {
  await getDb();
  return get(
    `SELECT a.*, c.name as category_name
     FROM articles a
     LEFT JOIN categories c ON a.category_id = c.id
     WHERE a.slug = ?`,
    [slug]
  );
}

async function findById(id) {
  await getDb();
  const article = get(
    `SELECT a.*, c.name as category_name
     FROM articles a
     LEFT JOIN categories c ON a.category_id = c.id
     WHERE a.id = ?`,
    [id]
  );
  if (article) {
    article.tags = all(
      `SELECT t.* FROM tags t
       INNER JOIN article_tags at ON t.id = at.tag_id
       WHERE at.article_id = ?
       ORDER BY t.id ASC`,
      [id]
    );
  }
  return article;
}

async function create({ title, slug, content, excerpt, cover_image, category_id, user_id, status = 'draft', tag_ids = [] }) {
  await getDb();
  // 确保 slug 唯一
  let finalSlug = slug;
  let suffix = 1;
  while (get('SELECT id FROM articles WHERE slug = ?', [finalSlug])) {
    finalSlug = slug + '-' + suffix;
    suffix++;
  }
  console.log('[article create] 参数:', { title, slug, finalSlug, category_id, user_id, status, tag_ids });
  run(
    `INSERT INTO articles (title, slug, content, excerpt, cover_image, category_id, user_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, finalSlug, content || null, excerpt || null, cover_image || null, category_id || null, user_id || null, status]
  );
  console.log('[article create] INSERT 成功');

  // sql.js wasm 中 last_insert_rowid() 不可靠，改用 slug + title 查找
  const article = get(
    `SELECT * FROM articles WHERE slug = ? AND title = ? ORDER BY id DESC LIMIT 1`,
    [finalSlug, title]
  );
  console.log('[article create] 查询新文章:', article ? article.id : 'null');

  if (tag_ids && tag_ids.length > 0) {
    for (const tagId of tag_ids) {
      run('INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)', [article.id, tagId]);
    }
    console.log('[article create] 标签关联完成，tags:', tag_ids);
  }

  return findById(article.id);
}

async function update(id, data) {
  await getDb();

  const fields = [];
  const values = [];
  const allowedFields = ['title', 'slug', 'content', 'excerpt', 'cover_image', 'category_id', 'user_id', 'status'];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    run(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  if (data.tag_ids !== undefined) {
    run('DELETE FROM article_tags WHERE article_id = ?', [id]);
    if (data.tag_ids && data.tag_ids.length > 0) {
      for (const tagId of data.tag_ids) {
        run('INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)', [id, tagId]);
      }
    }
  }

  return findById(id);
}

async function delete_(id) {
  await getDb();
  run('DELETE FROM article_tags WHERE article_id = ?', [id]);
  run('DELETE FROM articles WHERE id = ?', [id]);
}

async function incrementView(id) {
  await getDb();
  run('UPDATE articles SET view_count = view_count + 1 WHERE id = ?', [id]);
}

async function incrementLike(id) {
  await getDb();
  run('UPDATE articles SET like_count = like_count + 1 WHERE id = ?', [id]);
}

async function updateCommentCount(id) {
  await getDb();
  const row = get(
    'SELECT COUNT(*) as count FROM comments WHERE article_id = ? AND status = ?',
    [id, 'approved']
  );
  run('UPDATE articles SET comment_count = ? WHERE id = ?', [row.count, id]);
}

async function getHotArticles(limit = 10) {
  await getDb();
  return all(
    `SELECT a.*, c.name as category_name
     FROM articles a
     LEFT JOIN categories c ON a.category_id = c.id
     WHERE a.status = 'published'
     ORDER BY a.view_count DESC
     LIMIT ?`,
    [limit]
  );
}

async function getArchives() {
  await getDb();
  return all(
    `SELECT strftime('%Y', created_at) as year, strftime('%m', created_at) as month, strftime('%Y-%m', created_at) as yearMonth, COUNT(*) as count
     FROM articles
     WHERE status = 'published'
     GROUP BY yearMonth
     ORDER BY yearMonth DESC`
  );
}

async function getRecentArticles(limit = 10) {
  await getDb();
  return all(
    `SELECT a.*, c.name as category_name
     FROM articles a
     LEFT JOIN categories c ON a.category_id = c.id
     WHERE a.status = 'published'
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [limit]
  );
}

async function findByYearMonth(yearMonth) {
  await getDb();
  return all(
    `SELECT a.*, c.name as category_name
     FROM articles a
     LEFT JOIN categories c ON a.category_id = c.id
     WHERE a.status = 'published' AND strftime('%Y-%m', a.created_at) = ?
     ORDER BY a.created_at DESC`,
    [yearMonth]
  );
}

module.exports = {
  findAll,
  findBySlug,
  findById,
  create,
  update,
  delete: delete_,
  incrementView,
  incrementLike,
  updateCommentCount,
  getHotArticles,
  getArchives,
  getRecentArticles,
  findByYearMonth
};