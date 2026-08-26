const express = require('express');
const router = express.Router();
const multer = require('multer');
const { isAuthenticated } = require('../middleware/auth');
const uploadController = require('../controllers/uploadController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: function(req, file, cb) {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i;
    const ext = require('path').extname(file.originalname);
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件 (jpg, jpeg, png, gif, webp, svg, bmp)'));
    }
  }
});

router.post('/admin/upload', isAuthenticated, upload.single('image'), uploadController.upload);
router.get('/admin/images', isAuthenticated, uploadController.listImages);

module.exports = router;