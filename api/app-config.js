const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { sendServerError } = require('../lib/httpError');

// Cambia este valor manualmente para forzar actualización de clientes.
const LATEST_VERSION = '1.1.02';
const LATEST_IOS_VERSION = '1.1.02';
const LATEST_ANDROID_VERSION = '1.1.04';
const MIN_REQUIRED_VERSION_IOS =
  process.env.MIN_REQUIRED_VERSION_IOS?.trim() ||  LATEST_IOS_VERSION ||  LATEST_VERSION;
const MIN_REQUIRED_VERSION_ANDROID =
  process.env.MIN_REQUIRED_VERSION_ANDROID?.trim() || LATEST_ANDROID_VERSION ||  LATEST_VERSION;
const ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mtgdeckbuilder';
const IOS_STORE_URL = 'https://apps.apple.com';

function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const normalized = version.trim();
  if (!normalized) return null;

  const core = normalized.split('-')[0].split('+')[0];
  const parts = core.split('.');
  if (!parts.length) return null;

  const parsed = parts.map((part) => {
    if (!/^\d+$/.test(part)) return null;
    return Number.parseInt(part, 10);
  });

  if (parsed.some((value) => value === null)) return null;
  return parsed;
}

function isLowerVersion(currentVersion, requiredVersion) {
  const current = parseVersion(currentVersion);
  const required = parseVersion(requiredVersion);
  if (!current || !required) return false;

  const maxLength = Math.max(current.length, required.length);
  for (let index = 0; index < maxLength; index += 1) {
    const currentPart = current[index] ?? 0;
    const requiredPart = required[index] ?? 0;

    if (currentPart === requiredPart) continue;
    return currentPart < requiredPart;
  }

  return false;
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();

    const versionFromQuery =
      typeof req.query?.currentVersion === 'string'
        ? req.query.currentVersion
        : '';
    const versionFromHeader =
      typeof req.headers['x-app-version'] === 'string'
        ? req.headers['x-app-version']
        : '';
    const currentVersion = versionFromQuery || versionFromHeader;

    res.status(200).json({
      latestVersion: LATEST_VERSION,
      minRequiredVersion: LATEST_VERSION,
      minRequiredVersionIos: MIN_REQUIRED_VERSION_IOS,
      minRequiredVersionAndroid: MIN_REQUIRED_VERSION_ANDROID,
      isUpdateRequired: currentVersion
        ? isLowerVersion(currentVersion, LATEST_VERSION)
        : false,
      storeUrlAndroid: ANDROID_STORE_URL,
      storeUrlIos: IOS_STORE_URL,
    });
  } catch (error) {
    sendServerError(res, '/api/app-config', error);
  }
};
