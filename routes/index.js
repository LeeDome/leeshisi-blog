const express = require('express');
const router = express.Router();
const { loadCommonData } = require('../middleware/common');
const articleController = require('../controllers/articleController');
const commentController = require('../controllers/commentController');
const pageController = require('../controllers/pageController');
const toolController = require('../controllers/toolController');
const seoController = require('../controllers/seoController');

router.use(loadCommonData);

router.get('/', articleController.index);
router.get('/sitemap.xml', seoController.sitemap);
router.get('/robots.txt', seoController.robots);
router.get('/category/:slug', articleController.listByCategory);
router.get('/tag/:id', articleController.listByTag);
router.get('/article/:id', articleController.detail);
router.get('/search', articleController.search);
router.get('/archive/:yearMonth', articleController.listByArchive);
router.post('/article/rate', articleController.rate);
router.post('/article/like', articleController.like);
router.post('/comment', commentController.create);
router.post('/comment/create', commentController.create);
router.post('/comment/like', commentController.like);
router.post('/comment/dislike', commentController.dislike);
router.get('/comment/load', commentController.loadMore);
router.get('/api/qq-info', pageController.qqInfo);
router.get('/about', pageController.about);
router.get('/message', pageController.message);
router.get('/gallery', pageController.gallery);
router.get('/gallery/:id', pageController.galleryDetail);
router.get('/tools', toolController.index);
router.get('/tools/image-compress', toolController.imageCompress);

module.exports = router;