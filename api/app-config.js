const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { sendServerError } = require('../lib/httpError');

const LATEST_VERSION_UNIFIED = '1.1.03';

const LATEST_IOS_VERSION = '1.1.03';
const LATEST_ANDROID_VERSION = '1.1.04';

/**
 * Compara dos versiones semánticas (ej: '1.1.03' vs '1.1.04').
 * Retorna:
 *  1 si versionA > versionB
 * -1 si versionA < versionB
 *  0 si son iguales
 */
const compareVersions = (versionA: string, versionB: string): number => {
  const partsA = versionA.split('.').map(Number);
  const partsB = versionB.split('.').map(Number);
  const maxLength = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLength; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
};

/**
 * Devuelve la versión mayor entre LATEST_VERSION_UNIFIED y la versión específica del SO.
 */
const resolveEffectiveVersion = (platformVersion: string): string => {
  return compareVersions(LATEST_VERSION_UNIFIED, platformVersion) > 0
    ? LATEST_VERSION_UNIFIED
    : platformVersion;
};

const MIN_REQUIRED_VERSION_IOS =
  process.env.MIN_REQUIRED_VERSION_IOS?.trim() ||
  resolveEffectiveVersion(LATEST_IOS_VERSION);

const MIN_REQUIRED_VERSION_ANDROID =
  process.env.MIN_REQUIRED_VERSION_ANDROID?.trim() ||
  resolveEffectiveVersion(LATEST_ANDROID_VERSION);


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
