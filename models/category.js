const { getDb, run, get, all } = require('../config/database');

async function getAll() {
  await getDb();
  return all('SELECT * FROM categories ORDER BY id ASC');
}

async function findBySlug(slug) {
  await getDb();
  return get('SELECT * FROM categories WHERE slug = ?', [slug]);
}

async function findById(id) {
  await getDb();
  return get('SELECT * FROM categories WHERE id = ?', [id]);
}

async function create({ name, slug, description }) {
  await getDb();
  run(
    'INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)',
    [name, slug, description || null]
  );
  return get('SELECT * FROM categories WHERE slug = ?', [slug]);
}

async function update(id, { name, slug, description }) {
  await getDb();
  const fields = [];
  const values = [];
  const allowedFields = ['name', 'slug', 'description'];

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

  run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

async function delete_(id) {
  await getDb();
  run('DELETE FROM categories WHERE id = ?', [id]);
}

module.exports = { getAll, findBySlug, findById, create, update, delete: delete_ };