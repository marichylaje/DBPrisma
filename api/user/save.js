const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const {
      userId,
      nickname,
      role,
      storeAddress = null,
      storeName = null,
    } = payload || {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (userId !== auth.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (!nickname) {
      return res.status(400).json({ error: 'nickname is required' });
    }

    const selectFields = {
      id: true,
      nickname: true,
      role: true,
      xp: true,
      level: true,
      storeName: true,
      storeAddress: true,
      createdAt: true,
      updatedAt: true,
      badgesJson: true,
    };

    // Seguridad: el rol es inmutable a través de este endpoint una vez creada la cuenta.
    // Si se permitiera re-enviar `role` en cada guardado, cualquier usuario autenticado
    // podría auto-promoverse a 'store' y desbloquear operaciones de organizador de torneos
    // (crear/finalizar torneos, gestionar co-admins, emitir reportes de juez).
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    let upserted;
    if (existingUser) {
      const updateData = { nickname };
      if (existingUser.role === 'store') {
        updateData.storeName = storeName;
        updateData.storeAddress = storeAddress;
      }

      upserted = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: selectFields,
      });

      // Mantiene sincronizada la copia desnormalizada "nickname" en las tablas
      // relacionadas cuando el usuario cambia su nickname (no borra ni mueve datos).
      await Promise.all([
        prisma.userDeck.updateMany({ where: { userId }, data: { nickname } }),
        prisma.allDeck.updateMany({ where: { userId }, data: { nickname } }),
        prisma.userCollection.updateMany({ where: { userId }, data: { nickname } }),
        prisma.userEntitlement.updateMany({ where: { userKey: userId }, data: { nickname } }),
        prisma.sharedDeck.updateMany({ where: { userKey: userId }, data: { nickname } }),
        prisma.analyticsEvent.updateMany({ where: { userKey: userId }, data: { nickname } }),
        prisma.processedIapNotification.updateMany({ where: { userKey: userId }, data: { nickname } }),
      ]);
    } else {
      upserted = await prisma.user.create({
        data: {
          id: userId,
          nickname,
          role: role || 'player',
          xp: 0,
          level: 1,
          storeName: role === 'store' ? storeName : null,
          storeAddress: role === 'store' ? storeAddress : null,
        },
        select: selectFields,
      });
    }

    res.status(200).json({ ok: true, user: upserted });
  } catch (e) {
    console.error('❌ /api/user/save error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

