const assert = require('assert');

const {
  parseDeckKey,
  isDeckDownloadKey,
  buildDownloadCountsResponse,
} = require('./lib/deckDownloads');

assert.deepStrictEqual(parseDeckKey('cloud:deck-123'), {
  type: 'cloud',
  id: 'deck-123',
  deckKey: 'deck-123',
});

assert.deepStrictEqual(parseDeckKey('precon:Commander Masters'), {
  type: 'precon',
  id: null,
  deckKey: 'Commander Masters',
});

assert.deepStrictEqual(parseDeckKey('influencer:SomePlayer:Mono Red Aggro'), {
  type: 'influencer',
  id: null,
  deckKey: 'SomePlayer:Mono Red Aggro',
});

assert.strictEqual(isDeckDownloadKey('cloud:deck-123'), true);
assert.strictEqual(isDeckDownloadKey('invalid'), false);

assert.deepStrictEqual(buildDownloadCountsResponse(['cloud:deck-1', 'precon:Commander Masters'], {
  'cloud:deck-1': 7,
  'precon:Commander Masters': 2,
}), {
  'cloud:deck-1': 7,
  'precon:Commander Masters': 2,
});

console.log('deck download helper tests passed');
