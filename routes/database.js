const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { isAuthenticated } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

const upload = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, path.join(__dirname, '..', 'data', 'tmp'));
    },
    filename: function(req, file, cb) {
      cb(null, 'import-' + Date.now() + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const allowed = /\.(db|sqlite)$/i;
    const ext = path.extname(file.originalname);
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 .db 或 .sqlite 数据库文件'));
    }
  }
});

// 确保 tmp 目录存在
const fs = require('fs');
const tmpDir = path.join(__dirname, '..', 'data', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

router.post('/admin/database/import', isAuthenticated, upload.single('db_file'), adminController.databaseImport);

module.exports = router;
