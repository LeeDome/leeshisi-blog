const bcrypt = require('bcryptjs');
const { getDb, run, get, all } = require('../config/database');
const databaseModule = require('../config/database');
const fs = require('fs');
const path = require('path');
const userModel = require('../models/user');
const articleModel = require('../models/article');
const categoryModel = require('../models/category');
const tagModel = require('../models/tag');
const galleryModel = require('../models/gallery');
const pageModel = require('../models/page');
const commentModel = require('../models/comment');
const settingModel = require('../models/setting');

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

exports.loginPage = (req, res) => {
  res.render('admin/login', { title: '管理员登录', error: null, layout: false });
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await userModel.findByEmail(email);
    if (!user) {
      return res.render('admin/login', { title: '管理员登录', error: '邮箱不存在', layout: false });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('admin/login', { title: '管理员登录', error: '密码错误', layout: false });
    }
    req.session.user = user;
    res.redirect('/admin');
  } catch (err) {
    res.render('admin/login', { title: '管理员登录', error: '登录失败，请重试', layout: false });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
};

exports.dashboard = async (req, res) => {
  try {
    await getDb();
    const articleCount = get('SELECT COUNT(*) as count FROM articles');
    const commentCount = get('SELECT COUNT(*) as count FROM comments');
    const galleryCount = get('SELECT COUNT(*) as count FROM galleries');
    const pageCount = get('SELECT COUNT(*) as count FROM pages');

    const recentArticles = all(
      `SELECT a.*, c.name as category_name
       FROM articles a
       LEFT JOIN categories c ON a.category_id = c.id
       ORDER BY a.created_at DESC
       LIMIT 5`
    );

    const recentComments = all(
      `SELECT c.*, a.title as article_title
       FROM comments c
       LEFT JOIN articles a ON c.article_id = a.id
       ORDER BY c.created_at DESC
       LIMIT 5`
    );

    res.render('admin/dashboard', {
      title: '仪表盘',
      articleCount: articleCount.count,
      commentCount: commentCount.count,
      galleryCount: galleryCount.count,
      pageCount: pageCount.count,
      recentArticles,
      recentComments,
      layout: false
    });
  } catch (err) {
    res.render('admin/dashboard', {
      title: '仪表盘',
      articleCount: 0,
      commentCount: 0,
      galleryCount: 0,
      pageCount: 0,
      recentArticles: [],
      recentComments: [],
      error: '加载仪表盘失败',
      layout: false
    });
  }
};

exports.database = async (req, res) => {
  const messages = req.session.messages || [];
  req.session.messages = [];
  res.render('admin/database', {
    title: '数据库管理',
    messages,
    error: null,
    layout: false
  });
};

exports.databaseBackup = async (req, res) => {
  try {
    await getDb();
    const buffer = databaseModule.exportDb();
    if (!buffer) {
      req.session.messages = [{ type: 'error', text: '导出失败' }];
      return res.redirect('/admin/database');
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="blog-backup-${timestamp}.db"`);
    res.send(buffer);
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '备份失败：' + err.message }];
    res.redirect('/admin/database');
  }
};

exports.databaseImportConfirm = (req, res) => {
  const messages = req.session.messages || [];
  req.session.messages = [];
  res.render('admin/database-import', {
    title: '导入数据库',
    messages,
    error: null,
    layout: false
  });
};

exports.databaseImport = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      req.session.messages = [{ type: 'error', text: '未选择文件' }];
      return res.redirect('/admin/database/import');
    }
    const confirm = (req.body.confirm || '').trim();
    if (confirm !== '确认进行导入') {
      req.session.messages = [{ type: 'error', text: '请输入 "确认进行导入" 以继续' }];
      return res.redirect('/admin/database/import');
    }

    await getDb();
    const currentBuffer = databaseModule.exportDb();
    const backupPath = path.join(__dirname, '..', 'data', 'blog-backup-' + Date.now() + '.db');
    fs.writeFileSync(backupPath, currentBuffer);

    const newBuffer = fs.readFileSync(file.path);
    databaseModule.initFromBuffer(newBuffer);
    fs.unlinkSync(file.path);

    req.session.messages = [{ type: 'success', text: '导入成功，原数据已备份至 ' + path.basename(backupPath) }];
    res.redirect('/admin/database');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '导入失败：' + err.message }];
    res.redirect('/admin/database/import');
  }
};

exports.passwordPage = (req, res) => {
  const messages = req.session.messages || [];
  req.session.messages = [];
  res.render('admin/account', { title: '账号设置', messages, user: req.session.user, error: null, layout: false });
};

exports.passwordUpdate = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const { nickname, email, avatar } = req.body;

    const user = await userModel.findById(req.session.user.id);
    if (!user) {
      req.session.messages = [{ type: 'error', text: '用户不存在' }];
      return res.redirect('/admin/account');
    }

    let password_hash = user.password_hash;
    if (current_password || new_password || confirm_password) {
      if (!current_password || !new_password || !confirm_password) {
        req.session.messages = [{ type: 'error', text: '修改密码请填写完整信息' }];
        return res.redirect('/admin/account');
      }
      if (new_password !== confirm_password) {
        req.session.messages = [{ type: 'error', text: '两次输入的新密码不一致' }];
        return res.redirect('/admin/account');
      }
      if (new_password.length < 6) {
        req.session.messages = [{ type: 'error', text: '新密码长度不能少于6位' }];
        return res.redirect('/admin/account');
      }
      const match = await bcrypt.compare(current_password, password_hash);
      if (!match) {
        req.session.messages = [{ type: 'error', text: '当前密码错误' }];
        return res.redirect('/admin/account');
      }
      password_hash = await bcrypt.hash(new_password, 10);
    }

    if (nickname !== undefined || avatar !== undefined) {
      await userModel.update(user.id, { nickname, email, avatar, password_hash });
    } else {
      await userModel.updatePassword(user.id, password_hash);
    }

    res.locals.successMessage = '保存成功，请重新登录';
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '保存失败：' + err.message }];
    res.redirect('/admin/account');
  }
};

exports.seedAdmin = async (req, res) => {
  try {
    const existing = await userModel.findByEmail('admin@blog.com');
    if (existing) {
      return res.json({ message: '管理员已存在' });
    }
    const passwordHash = bcrypt.hashSync('admin123', 10);
    await userModel.create({
      username: 'admin',
      nickname: '李拾肆',
      email: 'admin@blog.com',
      password_hash: passwordHash
    });
    res.json({ message: '管理员创建成功' });
  } catch (err) {
    res.status(500).json({ error: '创建管理员失败' });
  }
};

exports.articles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    await getDb();
    const countRow = get('SELECT COUNT(*) as total FROM articles');
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const articles = all(
      `SELECT a.*, c.name as category_name
       FROM articles a
       LEFT JOIN categories c ON a.category_id = c.id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.render('admin/articles', { title: '文章管理', articles, page, totalPages, total, messages: req.session.messages || [], layout: false });
    req.session.messages = [];
  } catch (err) {
    const messages = req.session.messages || [];
    req.session.messages = [];
    res.render('admin/articles', {
      title: '文章管理',
      articles: [],
      page: 1,
      totalPages: 0,
      total: 0,
      messages,
      layout: false
    });
  }
};

exports.articleNew = async (req, res) => {
  try {
    const categories = await categoryModel.getAll();
    const tags = await tagModel.getAll();
    res.render('admin/article-edit', {
      title: '新建文章',
      article: null,
      categories,
      tags,
      selectedTags: [],
      layout: false
    });
  } catch (err) {
    res.redirect('/admin/articles');
  }
};

exports.articleCreate = async (req, res) => {
  try {
    console.log('[articleCreate] req.body keys:', Object.keys(req.body));
    console.log('[articleCreate] req.body:', JSON.stringify(req.body).substring(0, 500));
    const { title, content, excerpt, cover_image, category_id, status } = req.body;
    let { slug, tag_ids } = req.body;

    console.log('[articleCreate] 解析后 -> title:', title, 'slug:', slug, 'category_id:', category_id, 'status:', status, 'tag_ids:', tag_ids);

    if (!slug) {
      slug = generateSlug(title);
      console.log('[articleCreate] 自动生成 slug:', slug);
    }

    if (!Array.isArray(tag_ids)) {
      tag_ids = tag_ids ? [tag_ids] : [];
    }
    console.log('[articleCreate] 最终参数 -> title:', title, 'slug:', slug, 'category_id:', category_id, 'tag_ids:', tag_ids);

    const result = await articleModel.create({
      title,
      slug,
      content,
      excerpt,
      cover_image,
      category_id: category_id || null,
      user_id: req.session.user.id,
      status: status || 'draft',
      tag_ids
    });
    console.log('[articleCreate] 创建结果:', result);

    req.session.messages = [{ type: 'success', text: '发布成功' }];
    res.redirect('/admin/articles');
  } catch (err) {
    console.error('[articleCreate] 错误:', err.message);
    console.error('[articleCreate] 堆栈:', err.stack);
    const categories = await categoryModel.getAll();
    const tags = await tagModel.getAll();
    req.session.messages = [{ type: 'error', text: '创建文章失败: ' + err.message }];
    res.render('admin/article-edit', {
      title: '新建文章',
      article: req.body,
      categories,
      tags,
      selectedTags: Array.isArray(req.body.tag_ids) ? req.body.tag_ids : (req.body.tag_ids ? [req.body.tag_ids] : []),
      error: '创建文章失败：' + err.message,
      layout: false
    });
    return;
  }
};

exports.articleEdit = async (req, res) => {
  try {
    const article = await articleModel.findById(req.params.id);
    if (!article) {
      return res.redirect('/admin/articles');
    }
    const categories = await categoryModel.getAll();
    const tags = await tagModel.getAll();
    const selectedTags = article.tags ? article.tags.map(t => t.id) : [];

    res.render('admin/article-edit', { title: '编辑文章', article, categories, tags, selectedTags, layout: false });
  } catch (err) {
    res.redirect('/admin/articles');
  }
};

exports.articleUpdate = async (req, res) => {
  try {
    const { title, content, excerpt, cover_image, category_id, status } = req.body;
    let { slug, tag_ids } = req.body;

    if (!slug) {
      slug = generateSlug(title);
    }

    if (!Array.isArray(tag_ids)) {
      tag_ids = tag_ids ? [tag_ids] : [];
    }

    await articleModel.update(req.params.id, {
      title,
      slug,
      content,
      excerpt,
      cover_image,
      category_id: category_id || null,
      status: status || 'draft',
      tag_ids
    });

    req.session.messages = [{ type: 'success', text: '保存成功' }];
    res.redirect('/admin/articles');
  } catch (err) {
    const article = await articleModel.findById(req.params.id);
    const categories = await categoryModel.getAll();
    const tags = await tagModel.getAll();
    const selectedTags = article && article.tags ? article.tags.map(t => t.id) : [];
    req.session.messages = [{ type: 'error', text: '更新文章失败' }];
    res.render('admin/article-edit', {
      title: '编辑文章',
      article: { ...req.body, id: req.params.id },
      categories,
      tags,
      selectedTags,
      error: '更新文章失败：' + err.message,
      layout: false
    });
  }
};

exports.articleDelete = async (req, res) => {
  try {
    await articleModel.delete(req.params.id);
    req.session.messages = [{ type: 'success', text: '删除成功' }];
    res.redirect('/admin/articles');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '删除文章失败' }];
    res.redirect('/admin/articles');
  }
};

exports.categories = async (req, res) => {
  try {
    const categories = await categoryModel.getAll();
    res.render('admin/categories', { title: '分类管理', categories, messages: req.session.messages || [], layout: false });
    req.session.messages = [];
  } catch (err) {
    const messages = req.session.messages || [];
    req.session.messages = [];
    res.render('admin/categories', { title: '分类管理', categories: [], messages, error: '加载分类失败', layout: false });
  }
};

exports.categoryEdit = async (req, res) => {
  try {
    const category = await categoryModel.findById(req.params.id);
    if (!category) {
      return res.redirect('/admin/categories');
    }
    res.render('admin/category-edit', { title: '编辑分类', category, layout: false });
  } catch (err) {
    res.redirect('/admin/categories');
  }
};

exports.categoryCreate = async (req, res) => {
  try {
    const { name, description } = req.body;
    let { slug } = req.body;
    if (!slug) {
      slug = generateSlug(name);
    }
    await categoryModel.create({ name, slug, description });
    req.session.messages = [{ type: 'success', text: '分类更新成功' }];
    res.redirect('/admin/categories');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '分类更新失败' }];
    const categories = await categoryModel.getAll();
    res.render('admin/categories', {
      title: '分类管理',
      categories,
      error: '创建分类失败：' + err.message,
      layout: false
    });
  }
};

exports.categoryUpdate = async (req, res) => {
  try {
    const { name, description } = req.body;
    let { slug } = req.body;
    if (!slug) {
      slug = generateSlug(name);
    }
    await categoryModel.update(req.params.id, { name, slug, description });
    res.redirect('/admin/categories');
  } catch (err) {
    const categories = await categoryModel.getAll();
    res.render('admin/categories', {
      title: '分类管理',
      categories,
      error: '更新分类失败：' + err.message,
      layout: false
    });
  }
};

exports.categoryDelete = async (req, res) => {
  try {
    await categoryModel.delete(req.params.id);
    res.redirect('/admin/categories');
  } catch (err) {
    res.redirect('/admin/categories');
  }
};

exports.tags = async (req, res) => {
  try {
    const tags = await tagModel.getTagCloud();
    res.render('admin/tags', { title: '标签管理', tags, messages: req.session.messages || [], layout: false });
    req.session.messages = [];
  } catch (err) {
    const messages = req.session.messages || [];
    req.session.messages = [];
    res.render('admin/tags', { title: '标签管理', tags: [], messages, error: '加载标签失败', layout: false });
  }
};

exports.tagEdit = async (req, res) => {
  try {
    const tag = await tagModel.findById(req.params.id);
    if (!tag) {
      return res.redirect('/admin/tags');
    }
    res.render('admin/tag-edit', { title: '编辑标签', tag, layout: false });
  } catch (err) {
    res.redirect('/admin/tags');
  }
};

exports.tagCreate = async (req, res) => {
  try {
    const { name } = req.body;
    let { slug } = req.body;
    if (!slug) {
      slug = generateSlug(name);
    }
    await tagModel.create({ name, slug });
    req.session.messages = [{ type: 'success', text: '标签更新成功' }];
    res.redirect('/admin/tags');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '标签更新失败' }];
    const tags = await tagModel.getTagCloud();
    res.render('admin/tags', {
      title: '标签管理',
      tags,
      error: '创建标签失败：' + err.message,
      layout: false
    });
  }
};

exports.tagUpdate = async (req, res) => {
  try {
    const { name } = req.body;
    let { slug } = req.body;
    if (!slug) {
      slug = generateSlug(name);
    }
    await tagModel.update(req.params.id, { name, slug });
    res.redirect('/admin/tags');
  } catch (err) {
    const tags = await tagModel.getTagCloud();
    res.render('admin/tags', {
      title: '标签管理',
      tags,
      error: '更新标签失败：' + err.message,
      layout: false
    });
  }
};

exports.tagDelete = async (req, res) => {
  try {
    await tagModel.delete(req.params.id);
    res.redirect('/admin/tags');
  } catch (err) {
    res.redirect('/admin/tags');
  }
};

exports.galleries = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const result = await galleryModel.findAll({ page, limit: 10 });
    res.render('admin/galleries', {
      title: '图册管理',
      galleries: result.galleries,
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
      layout: false
    });
  } catch (err) {
    res.render('admin/galleries', {
      title: '图册管理',
      galleries: [],
      page: 1,
      totalPages: 0,
      total: 0,
      error: '加载图册失败',
      layout: false
    });
  }
};

exports.galleryCreate = async (req, res) => {
  try {
    const { title, description, cover_image } = req.body;
    await galleryModel.create({
      title,
      description,
      cover_image,
      user_id: req.session.user.id
    });
    req.session.messages = [{ type: 'success', text: '图册添加成功' }];
    res.redirect('/admin/galleries');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '图册添加失败' }];
    const result = await galleryModel.findAll({ page: 1, limit: 10 });
    res.render('admin/galleries', {
      title: '图册管理',
      galleries: result.galleries,
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
      error: '创建图册失败：' + err.message,
      layout: false
    });
  }
};

exports.galleryEdit = async (req, res) => {
  try {
    const gallery = await galleryModel.findById(req.params.id);
    if (!gallery) {
      return res.redirect('/admin/galleries');
    }
    res.render('admin/gallery-edit', { title: '编辑图册', gallery, layout: false });
  } catch (err) {
    res.redirect('/admin/galleries');
  }
};

exports.galleryUpdate = async (req, res) => {
  try {
    const { title, description, cover_image } = req.body;
    await galleryModel.update(req.params.id, {
      title,
      description,
      cover_image
    });
    res.redirect('/admin/galleries');
  } catch (err) {
    const gallery = await galleryModel.findById(req.params.id);
    res.render('admin/gallery-edit', {
      title: '编辑图册',
      gallery: gallery || req.body,
      error: '更新图册失败：' + err.message,
      layout: false
    });
  }
};

exports.galleryDelete = async (req, res) => {
  try {
    await galleryModel.delete(req.params.id);
    res.redirect('/admin/galleries');
  } catch (err) {
    res.redirect('/admin/galleries');
  }
};

exports.galleryImageAdd = async (req, res) => {
  try {
    const { image_url, caption, sort_order } = req.body;
    await galleryModel.addImage({
      gallery_id: req.params.id,
      image_url,
      caption,
      sort_order: sort_order || 0
    });
    res.redirect('/admin/galleries/' + req.params.id + '/edit');
  } catch (err) {
    const gallery = await galleryModel.findById(req.params.id);
    res.render('admin/gallery-edit', {
      title: '编辑图册',
      gallery,
      error: '添加图片失败：' + err.message,
      layout: false
    });
  }
};

exports.galleryImageDelete = async (req, res) => {
  try {
    await galleryModel.deleteImage(req.params.imageId);
    req.session.messages = [{ type: 'success', text: '图片删除成功' }];
    res.redirect('/admin/galleries/' + req.params.id + '/edit');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '删除图片失败' }];
    res.redirect('/admin/galleries/' + req.params.id + '/edit');
  }
};

exports.comments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    await getDb();
    const countRow = get('SELECT COUNT(*) as total FROM comments');
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const comments = all(
      `SELECT c.*, a.title as article_title
       FROM comments c
       LEFT JOIN articles a ON c.article_id = a.id
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.render('admin/comments', { title: '评论管理', comments, page, totalPages, total, layout: false });
  } catch (err) {
    res.render('admin/comments', {
      title: '评论管理',
      comments: [],
      page: 1,
      totalPages: 0,
      total: 0,
      error: '加载评论失败',
      layout: false
    });
  }
};

exports.commentApprove = async (req, res) => {
  try {
    await commentModel.approve(req.params.id);
    req.session.messages = [{ type: 'success', text: '评论已通过' }];
    res.redirect('/admin/comments');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '操作失败' }];
    res.redirect('/admin/comments');
  }
};

exports.commentMarkSpam = async (req, res) => {
  try {
    await commentModel.markSpam(req.params.id);
    req.session.messages = [{ type: 'success', text: '评论已标记为垃圾' }];
    res.redirect('/admin/comments');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '操作失败' }];
    res.redirect('/admin/comments');
  }
};

exports.commentDelete = async (req, res) => {
  try {
    await commentModel.delete(req.params.id);
    req.session.messages = [{ type: 'success', text: '评论已删除' }];
    res.redirect('/admin/comments');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '操作失败' }];
    res.redirect('/admin/comments');
  }
};

exports.pages = async (req, res) => {
  try {
    const pages = await pageModel.getAll();
    res.render('admin/pages', { title: '页面管理', pages, messages: req.session.messages || [], layout: false });
    req.session.messages = [];
  } catch (err) {
    const messages = req.session.messages || [];
    req.session.messages = [];
    res.render('admin/pages', { title: '页面管理', pages: [], messages, error: '加载页面失败', layout: false });
  }
};

exports.pageEdit = async (req, res) => {
  try {
    const page = await pageModel.findById(req.params.id);
    if (!page) {
      return res.redirect('/admin/pages');
    }
    res.render('admin/page-edit', { title: '编辑页面', page, layout: false });
  } catch (err) {
    res.redirect('/admin/pages');
  }
};

exports.pageUpdate = async (req, res) => {
  try {
    const { title, content } = req.body;
    let { slug } = req.body;
    if (!slug) {
      slug = generateSlug(title);
    }
    await pageModel.update(req.params.id, { title, slug, content });
    req.session.messages = [{ type: 'success', text: '页面更新成功' }];
    res.redirect('/admin/pages');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '页面更新失败' }];
    const page = await pageModel.findById(req.params.id);
    res.render('admin/page-edit', {
      title: '编辑页面',
      page: page || req.body,
      error: '更新页面失败：' + err.message,
      layout: false
    });
  }
};

exports.settings = async (req, res) => {
  try {
    const settings = await settingModel.get();
    res.render('admin/settings', { title: '站点设置', settings, messages: req.session.messages || [], layout: false });
    req.session.messages = [];
  } catch (err) {
    const messages = req.session.messages || [];
    req.session.messages = [];
    res.render('admin/settings', { title: '站点设置', settings: {}, messages, error: '加载设置失败', layout: false });
  }
};

exports.settingsUpdate = async (req, res) => {
  try {
    const { site_name, site_logo, footer_links, copyright, theme, start_time, upload_type, qiniu_access_key, qiniu_secret_key, qiniu_bucket, qiniu_domain, icp_record } = req.body;
    await settingModel.update({
      site_name,
      site_logo,
      footer_links,
      copyright,
      theme,
      start_time,
      upload_type,
      qiniu_access_key,
      qiniu_secret_key,
      qiniu_bucket,
      qiniu_domain,
      icp_record
    });
    req.session.messages = [{ type: 'success', text: '设置已保存' }];
    res.redirect('/admin/settings');
  } catch (err) {
    req.session.messages = [{ type: 'error', text: '设置保存失败' }];
    const settings = await settingModel.get();
    res.render('admin/settings', {
      title: '站点设置',
      settings,
      error: '更新设置失败：' + err.message,
      layout: false
    });
  }
};