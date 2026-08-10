function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/admin/login');
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect('/admin');
  }
  next();
}

function setLocals(req, res, next) {
  res.locals.user = req.session.user;
  next();
}

module.exports = { isAuthenticated, redirectIfAuthenticated, setLocals };