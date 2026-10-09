function getJsonBody(req) {
  if (!req || typeof req !== 'object') return {};

  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : typeof req.rawBody === 'string'
        ? req.rawBody
        : '';

  if (!rawBody.trim()) return {};

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    const err = new Error('Invalid JSON');
    err.cause = error;
    throw err;
  }
}

module.exports = {
  getJsonBody,
};
