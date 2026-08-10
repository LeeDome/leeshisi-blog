const { getDb, run, get, all } = require('../config/database');

async function getAll() {
  await getDb();
  return all('SELECT * FROM tags ORDER BY id ASC');
}

async function findById(id) {
  await getDb();
  return get('SELECT * FROM tags WHERE id = ?', [id]);
}

async function findBySlug(slug) {
  await getDb();
  return get('SELECT * FROM tags WHERE slug = ?', [slug]);
}

async function create({ name, slug }) {
  await getDb();
  run(
    'INSERT INTO tags (name, slug) VALUES (?, ?)',
    [name, slug]
  );
  return get('SELECT * FROM tags WHERE slug = ?', [slug]);
}

async function update(id, { name, slug }) {
  await getDb();
  const fields = [];
  const values = [];
  const allowedFields = ['name', 'slug'];

  for (const key of allowedFields) {
    if (arguments[1][key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(arguments[1][key]);
    }
  }

  if (fields.length === 0) {
    return findById(id);
  }

  fields.push("updated_at = datetime('now','localtime')");
  values.push(id);

  run(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

async function delete_(id) {
  await getDb();
  run('DELETE FROM article_tags WHERE tag_id = ?', [id]);
  run('DELETE FROM tags WHERE id = ?', [id]);
}

async function getArticleTags(articleId) {
  await getDb();
  return all(
    `SELECT t.* FROM tags t
     INNER JOIN article_tags at ON t.id = at.tag_id
     WHERE at.article_id = ?
     ORDER BY t.id ASC`,
    [articleId]
  );
}

async function getTagCloud() {
  await getDb();
  return all(
    `SELECT t.*, COUNT(at.article_id) as count
     FROM tags t
     LEFT JOIN article_tags at ON t.id = at.tag_id
     GROUP BY t.id
     ORDER BY count DESC`
  );
}

module.exports = { getAll, findById, findBySlug, create, update, delete: delete_, getArticleTags, getTagCloud };