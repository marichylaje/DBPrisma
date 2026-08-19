function parseDeckKey(deckKey) {
  if (typeof deckKey !== 'string') return null;

  const value = deckKey.trim();
  if (!value) return null;

  if (value.startsWith('cloud:')) {
    const id = value.slice('cloud:'.length).trim();
    if (!id) return null;
    return { type: 'cloud', id, deckKey: id };
  }

  if (value.startsWith('precon:')) {
    const name = value.slice('precon:'.length).trim();
    if (!name) return null;
    return { type: 'precon', id: null, deckKey: `precon:${name}` };
  }

  if (value.startsWith('influencer:')) {
    const name = value.slice('influencer:'.length).trim();
    if (!name) return null;
    return { type: 'influencer', id: null, deckKey: `influencer:${name}` };
  }

  return null;
}

function isDeckDownloadKey(value) {
  return parseDeckKey(value) !== null;
}

function buildDownloadCountsResponse(deckKeys, countsByKey) {
  const list = Array.isArray(deckKeys) ? deckKeys : [];
  return list.reduce((acc, key) => {
    const parsed = parseDeckKey(key);
    if (!parsed) {
      acc[key] = 0;
      return acc;
    }

    const resolvedKey = parsed.type === 'cloud' ? `cloud:${parsed.id}` : parsed.deckKey;
    acc[key] = Number(countsByKey?.[key] ?? countsByKey?.[resolvedKey] ?? 0);
    return acc;
  }, {});
}

module.exports = {
  parseDeckKey,
  isDeckDownloadKey,
  buildDownloadCountsResponse,
};
