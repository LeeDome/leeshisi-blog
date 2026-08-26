const settingModel = require('../models/setting');
const commentModel = require('../models/comment');
const articleModel = require('../models/article');
const tagModel = require('../models/tag');
const userModel = require('../models/user');
const categoryModel = require('../models/category');
async function loadCommonData(req, res, next) {
  try {
    const settings = await settingModel.get();
    res.locals.settings = settings || {};
    res.locals.siteName = settings ? settings.site_name : '李拾肆博客';
    res.locals.siteLogo = settings ? settings.site_logo : '';
    res.locals.copyright = settings ? settings.copyright : '';
    res.locals.footerLinks = settings ? settings.footer_links : '[]';
    res.locals.siteStartTime = settings ? settings.start_time : '';
    res.locals.icpRecord = settings ? settings.icp_record : '';
    res.locals.siteDescription = settings ? settings.site_description : '';
    res.locals.siteKeywords = settings ? settings.site_keywords : '';
    res.locals.siteUrl = settings && settings.site_url ? settings.site_url.replace(/\/+$/, '') : '';
  } catch (err) {
    res.locals.settings = {};
    res.locals.siteName = '李拾肆博客';
    res.locals.siteLogo = '';
    res.locals.copyright = '';
    res.locals.footerLinks = '[]';
    res.locals.siteStartTime = '';
    res.locals.icpRecord = '';
    res.locals.siteDescription = '';
    res.locals.siteKeywords = '';
    res.locals.siteUrl = '';
  }

  try {
    res.locals.categories = await categoryModel.getAll();
  } catch (err) {
    res.locals.categories = [];
  }

  try {
    res.locals.recentComments = await commentModel.getRecentComments(5);
  } catch (err) {
    res.locals.recentComments = [];
  }

  try {
    res.locals.hotArticles = await articleModel.getHotArticles(5);
  } catch (err) {
    res.locals.hotArticles = [];
  }

  try {
    res.locals.archives = await articleModel.getArchives();
  } catch (err) {
    res.locals.archives = [];
  }

  try {
    res.locals.tagCloud = await tagModel.getTagCloud();
  } catch (err) {
    res.locals.tagCloud = [];
  }

  try {
    res.locals.author = await userModel.getAuthor();
    res.locals.authorAvatar = res.locals.author && res.locals.author.avatar ? res.locals.author.avatar : '/images/default-avatar.svg';
  } catch (err) {
    res.locals.author = null;
    res.locals.authorAvatar = '/images/default-avatar.svg';
  }

  res.locals.currentYear = new Date().getFullYear();
  res.locals.currentPath = req.path;

  // ===== SEO 默认值（控制器可通过 render 数据覆盖） =====
  res.locals.baseUrl = res.locals.siteUrl || (req.protocol + '://' + req.get('host'));
  res.locals.canonical = res.locals.baseUrl + req.path;
  res.locals.description = res.locals.siteDescription || '';
  res.locals.keywords = res.locals.siteKeywords || '';
  res.locals.ogType = 'website';
  res.locals.ogImage = res.locals.siteLogo || '';
  // 搜索页无独立价值，禁止索引
  res.locals.noindex = req.path.indexOf('/search') === 0;

  next();
}

module.exports = { loadCommonData };