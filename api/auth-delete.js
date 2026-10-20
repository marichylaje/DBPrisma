const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../lib/prisma');
const { requireUser } = require('../lib/auth');
const { checkRateLimitTiers } = require('../lib/rateLimit');

/**
 * POST /api/auth-delete
 * Elimina de forma permanente la cuenta del usuario autenticado (JWT) y sus datos.
 *
 * - Todas las relaciones con User tienen onDelete: Cascade, así que borrar el User
 *   elimina mazos, colección, wishlist, amistades, friend nights, participaciones en
 *   torneos y reportes de juez.
 * - Además se borran los datos que NO cascadean: analítica y mazos compartidos ligados
 *   a sus userKey, eventos IAP por userId y filas anónimas del mismo dispositivo.
 * - UserEntitlement / ProcessedIapNotification se conservan (registro de compra,
 *   ligado a transacciones de Apple/Google) pero se desvinculan del nickname.
 * - Una cuenta tienda con torneos sin finalizar no puede borrarse (409).
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;

    const tiersOk = await checkRateLimitTiers(req, res, 'auth-delete', [
      { id: 'burst', limit: 3, windowSeconds: 10 },
      { id: 'sustained', limit: 5, windowSeconds: 600 },
    ]);
    if (!tiersOk) return;

    const userId = auth.userId;
    if (!userId) return res.status(401).json({ error: 'invalid_token' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const activeTournaments = await prisma.tournament.count({
      where: { storeId: userId, status: { not: 'finished' } },
    });
    if (activeTournaments > 0) {
      return res.status(409).json({
        error: 'active_tournaments',
        message: 'Finaliza o elimina tus torneos activos antes de borrar la cuenta.',
      });
    }

    // userKey con los que se guardaron datos de esta cuenta (id de usuario y/o clave de dispositivo).
    const [decks, allDecks, collections, wishlists] = await Promise.all([
      prisma.userDeck.findMany({ where: { userId }, select: { userKey: true }, distinct: ['userKey'] }),
      prisma.allDeck.findMany({ where: { userId }, select: { userKey: true }, distinct: ['userKey'] }),
      prisma.userCollection.findMany({ where: { userId }, select: { userKey: true } }),
      prisma.userWishlist.findMany({ where: { userId }, select: { userKey: true } }),
    ]);
    const userKeys = [
      ...new Set([userId, ...[...decks, ...allDecks, ...collections, ...wishlists].map((r) => r.userKey)]),
    ];

    await prisma.$transaction([
      prisma.analyticsEvent.deleteMany({ where: { userKey: { in: userKeys } } }),
      prisma.sharedDeck.deleteMany({ where: { userKey: { in: userKeys } } }),
      prisma.iapTrackingEvent.deleteMany({ where: { userId } }),
      prisma.userDeck.deleteMany({ where: { userKey: { in: userKeys }, userId: null } }),
      prisma.allDeck.deleteMany({ where: { userKey: { in: userKeys }, userId: null } }),
      prisma.userCollection.deleteMany({ where: { userKey: { in: userKeys }, userId: null } }),
      prisma.userWishlist.deleteMany({ where: { userKey: { in: userKeys }, userId: null } }),
      prisma.userEntitlement.updateMany({ where: { userKey: { in: userKeys } }, data: { nickname: null } }),
      prisma.processedIapNotification.updateMany({ where: { userKey: { in: userKeys } }, data: { nickname: null } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    console.log('auth-delete: account removed', { userId });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('❌ /api/auth-delete error:', e);
    res.status(500).json({ error: 'failed', message: 'Account deletion failed' });
  }
};
