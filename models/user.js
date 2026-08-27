const { getDb, run, get, all } = require('../config/database');

async function create({ username, nickname, email, password_hash, avatar, bio }) {
  await getDb();
  run(
    `INSERT INTO users (username, nickname, email, password_hash, avatar, bio) VALUES (?, ?, ?, ?, ?, ?)`,
    [username, nickname, email, password_hash, avatar || null, bio || null]
  );
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

async function findByEmail(email) {
  await getDb();
  return get('SELECT * FROM users WHERE email = ?', [email]);
}

async function findByUsername(username) {
  await getDb();
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

// 账号登录：账号（username）或邮箱均可作为登录标识
async function findByLogin(account) {
  await getDb();
  if (!account) return null;
  return get('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [account, account]);
}

async function findById(id) {
  await getDb();
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

async function update(id, data) {
  await getDb();
  const fields = [];
  const values = [];
  const allowedFields = ['username', 'nickname', 'email', 'password_hash', 'avatar', 'bio', 'role'];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) {
    return findById(id);
  }

  fields.push("updated_at = datetime('now','localtime')");
  values.push(id);

  run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

async function updatePassword(id, password_hash) {
  await getDb();
  run(
    `UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [password_hash, id]
  );
  return findById(id);
}

async function getAuthor() {
  await getDb();
  return get('SELECT * FROM users WHERE role = ? ORDER BY id ASC LIMIT 1', ['admin']);
}

module.exports = { create, findByEmail, findByUsername, findByLogin, findById, update, updatePassword, getAuthor };