const { getDb, run, get } = require('../config/database');

const getSettings = async () => {
  await getDb();
  return get('SELECT * FROM site_settings LIMIT 1');
};

const update = async (data) => {
  await getDb();
  const fields = [];
  const values = [];
  if (data.site_name !== undefined) {
    fields.push('site_name = ?');
    values.push(data.site_name);
  }
  if (data.site_logo !== undefined) {
    fields.push('site_logo = ?');
    values.push(data.site_logo);
  }
  if (data.footer_links !== undefined) {
    fields.push('footer_links = ?');
    values.push(typeof data.footer_links === 'string' ? data.footer_links : JSON.stringify(data.footer_links));
  }
  if (data.copyright !== undefined) {
    fields.push('copyright = ?');
    values.push(data.copyright);
  }
  if (data.theme !== undefined) {
    fields.push('theme = ?');
    values.push(data.theme);
  }
  if (data.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(data.start_time);
  }
  if (data.upload_type !== undefined) {
    fields.push('upload_type = ?');
    values.push(data.upload_type);
  }
  if (data.qiniu_access_key !== undefined) {
    fields.push('qiniu_access_key = ?');
    values.push(data.qiniu_access_key);
  }
  if (data.qiniu_secret_key !== undefined) {
    fields.push('qiniu_secret_key = ?');
    values.push(data.qiniu_secret_key);
  }
  if (data.qiniu_bucket !== undefined) {
    fields.push('qiniu_bucket = ?');
    values.push(data.qiniu_bucket);
  }
  if (data.qiniu_domain !== undefined) {
    fields.push('qiniu_domain = ?');
    values.push(data.qiniu_domain);
  }
  if (data.icp_record !== undefined) {
    fields.push('icp_record = ?');
    values.push(data.icp_record);
  }
  if (data.site_url !== undefined) {
    fields.push('site_url = ?');
    values.push(data.site_url);
  }
  if (data.site_description !== undefined) {
    fields.push('site_description = ?');
    values.push(data.site_description);
  }
  if (data.site_keywords !== undefined) {
    fields.push('site_keywords = ?');
    values.push(data.site_keywords);
  }
  if (fields.length === 0) {
    return get('SELECT * FROM site_settings LIMIT 1');
  }
  fields.push("updated_at = datetime('now','localtime')");
  run(`UPDATE site_settings SET ${fields.join(', ')}`, values);
  return get('SELECT * FROM site_settings LIMIT 1');
};

const getStartTime = async () => {
  await getDb();
  const row = get('SELECT start_time FROM site_settings LIMIT 1');
  return row ? row.start_time : null;
};

module.exports = { get: getSettings, update, getStartTime };