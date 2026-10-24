const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { decodeVerifiedToken, requireUser } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { checkWriteRateLimit } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

/**
 * POST /api/auth-sync/migrate-user-data
 * Traslada los datos de una sesión anónima (dispositivo) a la cuenta autenticada.
 *
 * La propiedad de los datos se demuestra con el JWT de dispositivo (`deviceToken`), firmado por
 * el servidor; el cliente ya no puede reclamar el userKey de otra persona. Nunca se pisan datos
 * que la cuenta ya tenga (los conflictos se reportan y se dejan intactos).
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, 'auth-sync-migrate'))) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const device = decodeVerifiedToken(typeof body?.deviceToken === 'string' ? body.deviceToken : '');
    if (!device || device.kind !== 'device') {
      return res.status(400).json({ error: 'invalid_device_token' });
    }

    const userId = auth.userId;
    const deviceKey = device.sub;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const link = { userId, nickname: user.nickname };

    const summary = await prisma.$transaction(async (tx) => {
      const result = { decks: 0, allDecks: 0, collection: 0, wishlist: 0, entitlement: 0, conflicts: 0 };

      // Mazos: solo se mueven los que no chocan por nombre con los de la cuenta.
      for (const [model, key] of [['userDeck', 'decks'], ['allDeck', 'allDecks']]) {
        const [mine, theirs] = await Promise.all([
          tx[model].findMany({ where: { userKey: userId }, select: { deckName: true } }),
          tx[model].findMany({ where: { userKey: deviceKey }, select: { id: true, deckName: true } }),
        ]);
        const taken = new Set(mine.map((d) => d.deckName));
        const movable = theirs.filter((d) => !taken.has(d.deckName)).map((d) => d.id);
        result.conflicts += theirs.length - movable.length;
        if (movable.length) {
          const moved = await tx[model].updateMany({
            where: { id: { in: movable } },
            data: { userKey: userId, ...link },
          });
          result[key] = moved.count;
        }
      }

      // Colección (clave primaria = userKey): solo si la cuenta aún no tiene una.
      const [collectionTarget, collectionSource] = await Promise.all([
        tx.userCollection.findUnique({ where: { userKey: userId } }),
        tx.userCollection.findUnique({ where: { userKey: deviceKey } }),
      ]);
      if (collectionSource) {
        if (collectionTarget) {
          result.conflicts += 1;
        } else {
          await tx.userCollection.update({ where: { userKey: deviceKey }, data: { userKey: userId, ...link } });
          result.collection = 1;
        }
      }

      // Wishlist: se fusiona (unión de nombres).
      const [wishTarget, wishSource] = await Promise.all([
        tx.userWishlist.findUnique({ where: { userKey: userId } }),
        tx.userWishlist.findUnique({ where: { userKey: deviceKey } }),
      ]);
      if (wishSource) {
        if (wishTarget) {
          const merged = [
            ...new Set([
              ...(Array.isArray(wishTarget.cards) ? wishTarget.cards : []),
              ...(Array.isArray(wishSource.cards) ? wishSource.cards : []),
            ]),
          ];
          await tx.userWishlist.update({ where: { userKey: userId }, data: { cards: merged, ...link } });
          await tx.userWishlist.delete({ where: { userKey: deviceKey } });
        } else {
          await tx.userWishlist.update({ where: { userKey: deviceKey }, data: { userKey: userId, ...link } });
        }
        result.wishlist = 1;
      }

      // Trial / suscripción compradas antes de iniciar sesión.
      const [entTarget, entSource] = await Promise.all([
        tx.userEntitlement.findUnique({ where: { userKey: userId } }),
        tx.userEntitlement.findUnique({ where: { userKey: deviceKey } }),
      ]);
      if (entSource) {
        if (entTarget) {
          result.conflicts += 1;
        } else {
          await tx.userEntitlement.update({
            where: { userKey: deviceKey },
            data: { userKey: userId, nickname: user.nickname },
          });
          result.entitlement = 1;
        }
      }

      return result;
    });

    res.status(200).json({ ok: true, migrated: summary });
  } catch (e) {
    sendServerError(res, '/api/auth-sync/migrate-user-data', e);
  }
};
