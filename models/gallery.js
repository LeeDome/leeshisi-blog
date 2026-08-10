const { getDb, run, get, all } = require('../config/database');

async function findAll({ page = 1, limit = 12 } = {}) {
  await getDb();

  const countRow = get('SELECT COUNT(*) as total FROM galleries');
  const total = countRow.total;
  const totalPages = Math.ceil(total / limit);

  const offset = (page - 1) * limit;
  const galleries = all(
    'SELECT * FROM galleries ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );

  return { galleries, total, page, totalPages };
}

async function findById(id) {
  await getDb();

  const gallery = get('SELECT * FROM galleries WHERE id = ?', [id]);
  if (gallery) {
    gallery.images = all(
      'SELECT * FROM gallery_images WHERE gallery_id = ? ORDER BY sort_order ASC',
      [id]
    );
  }
  return gallery;
}

async function create({ title, description, cover_image, user_id }) {
  await getDb();

  run(
    `INSERT INTO galleries (title, description, cover_image, user_id)
     VALUES (?, ?, ?, ?)`,
    [title, description || null, cover_image || null, user_id || null]
  );

  const gallery = get('SELECT * FROM galleries WHERE title = ? ORDER BY id DESC LIMIT 1', [title]);
  return gallery;
}

async function update(id, data) {
  await getDb();

  const fields = [];
  const values = [];
  const allowedFields = ['title', 'description', 'cover_image', 'user_id'];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    run(`UPDATE galleries SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return findById(id);
}

async function delete_(id) {
  await getDb();
  run('DELETE FROM gallery_images WHERE gallery_id = ?', [id]);
  run('DELETE FROM galleries WHERE id = ?', [id]);
}

async function addImage({ gallery_id, image_url, caption, sort_order }) {
  await getDb();

  run(
    `INSERT INTO gallery_images (gallery_id, image_url, caption, sort_order)
     VALUES (?, ?, ?, ?)`,
    [gallery_id, image_url, caption || null, sort_order || 0]
  );

  return get(
    `SELECT * FROM gallery_images WHERE gallery_id = ? AND image_url = ? ORDER BY id DESC LIMIT 1`,
    [gallery_id, image_url]
  );
}

async function deleteImage(id) {
  await getDb();
  run('DELETE FROM gallery_images WHERE id = ?', [id]);
}

async function getRecentGalleries(limit = 5) {
  await getDb();
  return all(
    'SELECT * FROM galleries ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  delete: delete_,
  addImage,
  deleteImage,
  getRecentGalleries
};