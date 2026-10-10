const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { lookupNickname } = require('../../lib/userLookup');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const { userKey, cards } = payload || {};

    if (!userKey) {
      return res.status(400).json({ error: 'userKey is required' });
    }
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards must be an array' });
    }

    // Desnormalizado: si userKey resulta ser el id de un usuario registrado, guardamos su
    // nickname para poder leerlo rápido al revisar la tabla manualmente (no afecta la lógica).
    const nickname = await lookupNickname(userKey);

    const upserted = await prisma.userCollection.upsert({
      where: { userKey },
      create: {
        userKey,
        nickname,
        cards,
      },
      update: {
        nickname,
        cards,
      },
    });

    res.status(200).json({ ok: true, collection: upserted });
  } catch (e) {
    console.error('❌ /api/collection/save', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

