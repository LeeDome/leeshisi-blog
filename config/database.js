const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'blog.db');

let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function exportDb() {
  if (!db) return null;
  return Buffer.from(db.export());
}

function initFromBuffer(buffer) {
  db = new SQL.Database(buffer);
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  saveDb();
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return { changes: db.getRowsModified() };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function exec(sql) {
  db.exec(sql);
  saveDb();
}

function initSchema() {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    nickname VARCHAR(50),
    avatar VARCHAR(255),
    bio TEXT,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    content TEXT,
    excerpt TEXT,
    cover_image VARCHAR(255),
    category_id INTEGER REFERENCES categories(id),
    user_id INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'draft',
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    rating_score REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS article_tags (
    article_id INTEGER NOT NULL REFERENCES articles(id),
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    PRIMARY KEY (article_id, tag_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    article_id INTEGER REFERENCES articles(id),
    page_type VARCHAR(20) DEFAULT 'article',
    nickname VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    website VARCHAR(255),
    parent_id INTEGER REFERENCES comments(id),
    like_count INTEGER DEFAULT 0,
    dislike_count INTEGER DEFAULT 0,
    is_author INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'approved',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS galleries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cover_image VARCHAR(255),
    user_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gallery_id INTEGER NOT NULL REFERENCES galleries(id),
    image_url VARCHAR(255) NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    content TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_name VARCHAR(100) DEFAULT '李拾肆博客',
    site_logo VARCHAR(255),
    footer_links TEXT DEFAULT '[]',
    copyright VARCHAR(255) DEFAULT '',
    theme VARCHAR(50) DEFAULT 'default',
    start_time DATETIME DEFAULT (datetime('now','localtime')),
    upload_type VARCHAR(20) DEFAULT 'local',
    qiniu_access_key VARCHAR(255) DEFAULT '',
    qiniu_secret_key VARCHAR(255) DEFAULT '',
    qiniu_bucket VARCHAR(100) DEFAULT '',
    qiniu_domain VARCHAR(255) DEFAULT '',
    site_url VARCHAR(255) DEFAULT '',
    site_description TEXT DEFAULT '',
    site_keywords TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // 兼容旧表：添加新字段
  try { db.run('ALTER TABLE site_settings ADD COLUMN upload_type VARCHAR(20) DEFAULT \'local\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN qiniu_access_key VARCHAR(255) DEFAULT \'\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN qiniu_secret_key VARCHAR(255) DEFAULT \'\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN qiniu_bucket VARCHAR(100) DEFAULT \'\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN qiniu_domain VARCHAR(255) DEFAULT \'\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN icp_record VARCHAR(255) DEFAULT \'\''); } catch(_) {}
  // SEO 字段兼容
  try { db.run('ALTER TABLE site_settings ADD COLUMN site_url VARCHAR(255) DEFAULT \'\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN site_description TEXT DEFAULT \'\''); } catch(_) {}
  try { db.run('ALTER TABLE site_settings ADD COLUMN site_keywords TEXT DEFAULT \'\''); } catch(_) {}
  // AI 评论审核字段兼容
  try { db.run('ALTER TABLE comments ADD COLUMN ai_moderated INTEGER DEFAULT 0'); } catch(_) {}

  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comment_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL REFERENCES comments(id),
    ip_address VARCHAR(45) NOT NULL,
    vote_type VARCHAR(10) NOT NULL CHECK(vote_type IN ('like', 'dislike')),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    UNIQUE(comment_id, ip_address)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR(255) PRIMARY KEY,
    expires DATETIME,
    data TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(50) NOT NULL,
    provider_type VARCHAR(30) DEFAULT 'custom',
    api_url VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) NOT NULL,
    model_id VARCHAR(100) NOT NULL,
    is_multimodal INTEGER DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    thinking_mode INTEGER DEFAULT 0,
    functions TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // 兼容旧表：添加上下文限制字段
  try { db.run('ALTER TABLE ai_providers ADD COLUMN input_tokens INTEGER'); } catch(_) {}
  try { db.run('ALTER TABLE ai_providers ADD COLUMN output_tokens INTEGER'); } catch(_) {}
  try { db.run('ALTER TABLE ai_providers ADD COLUMN thinking_mode INTEGER DEFAULT 0'); } catch(_) {}

  db.run(`CREATE TABLE IF NOT EXISTS ai_function_map (
    func VARCHAR(20) PRIMARY KEY,
    provider_id INTEGER,
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mcp_settings (
    name VARCHAR(50) PRIMARY KEY,
    api_key TEXT,
    enabled INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ai_config (
    k VARCHAR(50) PRIMARY KEY,
    v TEXT,
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ip_blacklist (
    ip VARCHAR(64) PRIMARY KEY,
    blocked_until DATETIME,
    reason VARCHAR(255),
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type VARCHAR(20) NOT NULL,  -- reply/moderate
    comment_id INTEGER,
    article_id INTEGER,
    provider_id INTEGER,
    request_content TEXT,
    response_content TEXT,
    result VARCHAR(20),  -- ok/violation/error
    duration INTEGER,  -- 耗时毫秒
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  saveDb();
}

async function seedData() {
  const siteSetting = get('SELECT * FROM site_settings LIMIT 1');
  if (!siteSetting) {
    run(`INSERT INTO site_settings (site_name, copyright, start_time) VALUES (?, ?, datetime('now','localtime'))`,
      ['李拾肆博客', '']);
  }

  const categories = all('SELECT * FROM categories');
  if (categories.length === 0) {
    // 注意：不创建"首页"分类，导航栏已有内置的首页入口
    const cats = [
      ['项目', 'project', '项目跟踪'],
      ['笔记', 'note', '学习笔记'],
      ['杂谈', 'essay', '杂谈随笔'],
      ['图册', 'gallery', '图册集']
    ];
    for (const [name, slug, desc] of cats) {
      run('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)', [name, slug, desc]);
    }
  }

  const aboutPage = get('SELECT * FROM pages WHERE slug = ?', ['about']);
  if (!aboutPage) {
    run(`INSERT INTO pages (title, slug, content, user_id) VALUES (?, ?, ?, ?)`,
      ['关于', 'about', '<p>欢迎来到李拾肆博客！这里是我分享技术、生活和思考的地方。</p>', null]);
  }

  const messagePage = get('SELECT * FROM pages WHERE slug = ?', ['message']);
  if (!messagePage) {
    run(`INSERT INTO pages (title, slug, content, user_id) VALUES (?, ?, ?, ?)`,
      ['留言板', 'message', '<p>欢迎留言，有什么想说的都可以在这里留下。</p>', null]);
  }

  const adminUser = get('SELECT * FROM users WHERE email = ? OR username = ?', ['admin@blog.com', 'admin']);
  if (!adminUser) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    run(`INSERT INTO users (username, nickname, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
      ['admin', '李拾肆', 'admin@blog.com', passwordHash, 'admin']);
  }
}

module.exports = { getDb, saveDb, exportDb, initFromBuffer, run, get, all, exec, initSchema, seedData };