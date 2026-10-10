function getRequestUrl(req) {
  const rawUrl = typeof req?.url === 'string' ? req.url : '/';
  if (/^https?:\/\//i.test(rawUrl)) {
    return new URL(rawUrl);
  }

  const headers = req?.headers || {};
  const forwardedProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || 'https';
  const host = headers['x-forwarded-host'] || headers.host || 'localhost';
  return new URL(rawUrl, `${protocol}://${host}`);
}

function getQueryParam(req, name) {
  const requestUrl = getRequestUrl(req);
  return requestUrl.searchParams.get(name);
}

module.exports = {
  getQueryParam,
};