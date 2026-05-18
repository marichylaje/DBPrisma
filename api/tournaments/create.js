const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const {
      title,
      description = null,
      format,
      powerLevel,
      locationName,
      latitude,
      longitude,
      entryFee,
      maxPlayers,
      startDate,
      storeId,
    } = req.body || {};

    if (!title || !format || !powerLevel || !locationName || latitude === undefined || longitude === undefined || entryFee === undefined || !maxPlayers || !startDate || !storeId) {
      return res.status(400).json({ error: 'Missing required tournament creation fields' });
    }

    // Validación defensiva de roles: comprobar que la tienda existe y tiene el rol correcto
    const storeUser = await prisma.user.findUnique({
      where: { id: storeId }
    });

    if (!storeUser || storeUser.role !== 'store') {
      return res.status(400).json({ error: 'Only registered store accounts can organize tournaments' });
    }

    // Validación de tope diario: Máximo 5 torneos creados hoy
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const createdTodayCount = await prisma.tournament.count({
      where: {
        storeId,
        createdAt: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
    });

    if (createdTodayCount >= 5) {
      return res.status(400).json({
        error: 'Tournament creation limit reached. Stores are restricted to organizing a maximum of 5 tournaments per calendar day.',
      });
    }

    const created = await prisma.tournament.create({
      data: {
        title,
        description,
        format,
        powerLevel,
        locationName,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        entryFee: parseInt(entryFee, 10),
        maxPlayers: parseInt(maxPlayers, 10),
        startDate: new Date(startDate),
        storeId,
        status: 'created',
      },
    });

    res.status(200).json({ ok: true, tournament: created });
  } catch (e) {
    console.error('❌ /api/tournaments/create error:', e);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
};
