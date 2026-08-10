const { getDb, run, get, all } = require('../config/database');

const findBySlug = async (slug) => {
  await getDb();
  return get('SELECT * FROM pages WHERE slug = ?', [slug]);
};

const findById = async (id) => {
  await getDb();
  return get('SELECT * FROM pages WHERE id = ?', [id]);
};

const create = async ({ title, slug, content, user_id }) => {
  await getDb();
  run(
    'INSERT INTO pages (title, slug, content, user_id) VALUES (?, ?, ?, ?)',
    [title, slug, content, user_id]
  );
  return get('SELECT * FROM pages WHERE slug = ?', [slug]);
};

const update = async (id, { title, slug, content }) => {
  await getDb();
  const fields = [];
  const values = [];
  if (title !== undefined) {
    fields.push('title = ?');
    values.push(title);
  }
  if (slug !== undefined) {
    fields.push('slug = ?');
    values.push(slug);
  }
  if (content !== undefined) {
    fields.push('content = ?');
    values.push(content);
  }
  if (fields.length === 0) {
    return get('SELECT * FROM pages WHERE id = ?', [id]);
  }
  fields.push("updated_at = datetime('now','localtime')");
  values.push(id);
  run(`UPDATE pages SET ${fields.join(', ')} WHERE id = ?`, values);
  return get('SELECT * FROM pages WHERE id = ?', [id]);
};

const delete_ = async (id) => {
  await getDb();
  run('DELETE FROM pages WHERE id = ?', [id]);
};

const getAll = async () => {
  await getDb();
  return all('SELECT * FROM pages ORDER BY created_at DESC');
};

module.exports = { findBySlug, findById, create, update, delete: delete_, getAll };