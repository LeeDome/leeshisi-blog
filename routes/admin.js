const express = require('express');
const router = express.Router();
const { isAuthenticated, redirectIfAuthenticated } = require('../middleware/auth');
const adminController = require('../controllers/adminController');
const aiController = require('../controllers/aiController');

router.get('/admin/login', redirectIfAuthenticated, adminController.loginPage);
router.post('/admin/login', adminController.login);
router.get('/admin/logout', adminController.logout);
router.get('/admin/seed', adminController.seedAdmin);

router.get('/admin', isAuthenticated, adminController.dashboard);
router.get('/admin/articles', isAuthenticated, adminController.articles);
router.get('/admin/articles/new', isAuthenticated, adminController.articleNew);
router.post('/admin/articles', isAuthenticated, adminController.articleCreate);
router.get('/admin/articles/:id/edit', isAuthenticated, adminController.articleEdit);
router.post('/admin/articles/:id', isAuthenticated, adminController.articleUpdate);
router.post('/admin/articles/:id/delete', isAuthenticated, adminController.articleDelete);

router.get('/admin/categories', isAuthenticated, adminController.categories);
router.get('/admin/categories/:id/edit', isAuthenticated, adminController.categoryEdit);
router.post('/admin/categories', isAuthenticated, adminController.categoryCreate);
router.post('/admin/categories/:id', isAuthenticated, adminController.categoryUpdate);
router.post('/admin/categories/:id/delete', isAuthenticated, adminController.categoryDelete);

router.get('/admin/tags', isAuthenticated, adminController.tags);
router.get('/admin/tags/:id/edit', isAuthenticated, adminController.tagEdit);
router.post('/admin/tags', isAuthenticated, adminController.tagCreate);
router.post('/admin/tags/:id', isAuthenticated, adminController.tagUpdate);
router.post('/admin/tags/:id/delete', isAuthenticated, adminController.tagDelete);

router.get('/admin/galleries', isAuthenticated, adminController.galleries);
router.post('/admin/galleries', isAuthenticated, adminController.galleryCreate);
router.get('/admin/galleries/:id/edit', isAuthenticated, adminController.galleryEdit);
router.post('/admin/galleries/:id', isAuthenticated, adminController.galleryUpdate);
router.post('/admin/galleries/:id/delete', isAuthenticated, adminController.galleryDelete);
router.post('/admin/galleries/:id/images', isAuthenticated, adminController.galleryImageAdd);
router.post('/admin/galleries/:id/images/:imageId/delete', isAuthenticated, adminController.galleryImageDelete);

router.get('/admin/comments', isAuthenticated, adminController.comments);
router.post('/admin/comments/:id/approve', isAuthenticated, adminController.commentApprove);
router.post('/admin/comments/:id/spam', isAuthenticated, adminController.commentMarkSpam);
router.post('/admin/comments/:id/delete', isAuthenticated, adminController.commentDelete);

router.get('/admin/pages', isAuthenticated, adminController.pages);
router.get('/admin/pages/:id/edit', isAuthenticated, adminController.pageEdit);
router.post('/admin/pages/:id', isAuthenticated, adminController.pageUpdate);

router.get('/admin/settings', isAuthenticated, adminController.settings);
router.post('/admin/settings', isAuthenticated, adminController.settingsUpdate);
router.get('/admin/account', isAuthenticated, adminController.passwordPage);
router.post('/admin/account', isAuthenticated, adminController.passwordUpdate);

router.get('/admin/database', isAuthenticated, adminController.database);
router.get('/admin/database/backup', isAuthenticated, adminController.databaseBackup);
router.get('/admin/database/import', isAuthenticated, adminController.databaseImportConfirm);
router.post('/admin/database/import', isAuthenticated, adminController.databaseImport);

// AI 站长配置
router.get('/admin/ai', isAuthenticated, aiController.settingsPage);
router.post('/admin/ai/models', isAuthenticated, aiController.listModels);
router.post('/admin/ai', isAuthenticated, aiController.save);
router.post('/admin/ai/functions', isAuthenticated, aiController.saveFunctionMap);
router.post('/admin/ai/mcp', isAuthenticated, aiController.saveMcp);
router.post('/admin/ai/mcp/disable', isAuthenticated, aiController.disableMcp);
router.post('/admin/ai/config', isAuthenticated, aiController.saveConfigAi);
router.post('/admin/ai/:id/delete', isAuthenticated, aiController.delete);
router.post('/admin/ai/polish', isAuthenticated, aiController.polish);

module.exports = router;