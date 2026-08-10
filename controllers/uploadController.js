const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const qiniu = require('qiniu');
const settingModel = require('../models/setting');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

exports.upload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }

    const settings = await settingModel.get();
    const uploadType = (settings && settings.upload_type) || 'local';

    if (uploadType === 'qiniu') {
      return uploadToQiniu(req, res, settings);
    } else {
      return uploadLocal(req, res);
    }
  } catch (err) {
    console.error('上传失败:', err);
    return res.status(500).json({ success: false, message: '上传失败: ' + err.message });
  }
};

function uploadLocal(req, res) {
  const ext = path.extname(req.file.originalname).toLowerCase();
  const filename = crypto.randomUUID() + ext;
  const destPath = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(destPath, req.file.buffer);

  const url = '/uploads/' + filename;
  return res.json({ success: true, url });
}

function uploadToQiniu(req, res, settings) {
  const accessKey = settings.qiniu_access_key;
  const secretKey = settings.qiniu_secret_key;
  const bucket = settings.qiniu_bucket;
  const domain = settings.qiniu_domain;

  if (!accessKey || !secretKey || !bucket || !domain) {
    return res.status(400).json({ success: false, message: '七牛云配置不完整，请先在站点设置中配置七牛云参数' });
  }

  const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
  const ext = path.extname(req.file.originalname).toLowerCase();
  const key = crypto.randomUUID() + ext;

  const putPolicy = new qiniu.rs.PutPolicy({ scope: bucket + ':' + key });
  const uploadToken = putPolicy.uploadToken(mac);

  const formUploader = new qiniu.form_up.FormUploader(
    new qiniu.conf.Config({ zone: qiniu.zone.Zone_z2 })
  );

  const putExtra = new qiniu.form_up.PutExtra();

  formUploader.put(uploadToken, key, req.file.buffer, putExtra, function(err, body, info) {
    if (err) {
      console.error('七牛云上传失败:', err);
      return res.status(500).json({ success: false, message: '七牛云上传失败: ' + err.message });
    }
    if (info.statusCode === 200) {
      // 确保 domain 以 / 结尾时不重复
      const baseUrl = domain.replace(/\/+$/, '');
      const url = baseUrl + '/' + body.key;
      return res.json({ success: true, url });
    } else {
      console.error('七牛云上传失败:', body);
      return res.status(500).json({ success: false, message: '七牛云上传失败: ' + (body.error || '未知错误') });
    }
  });
}