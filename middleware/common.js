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
  } catch (err) {
    res.locals.settings = {};
    res.locals.siteName = '李拾肆博客';
    res.locals.siteLogo = '';
    res.locals.copyright = '';
    res.locals.footerLinks = '[]';
    res.locals.siteStartTime = '';
    res.locals.icpRecord = '';
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

  next();
}

module.exports = { loadCommonData };