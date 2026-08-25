exports.index = async (req, res) => {
  res.render('tools', {
    title: '实用工具',
    layout: 'layout'
  });
};

exports.imageCompress = async (req, res) => {
  res.render('tools-image-compress', {
    title: '图片压缩工具',
    layout: 'layout'
  });
};