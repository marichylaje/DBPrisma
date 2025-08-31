// lib/auth.js
function checkSecret(req, res) {
  const expected = process.env.APP_BACKEND_SECRET;
  const got = req.headers['x-app-secret'];
  if (!expected || got !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
module.exports = { checkSecret };