const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { lat, lng } = req.query || {};

    if (!lat || !lng) {
      // Si no hay coordenadas, devolvemos todos los torneos activos/creados ordenados por fecha
      const allTournaments = await prisma.tournament.findMany({
        where: {
          status: { in: ['created', 'active'] },
        },
        orderBy: {
          startDate: 'asc',
        },
        include: {
          participants: true,
        },
      });
      return res.status(200).json({ ok: true, tournaments: allTournaments });
    }

    const latVal = parseFloat(lat);
    const lngVal = parseFloat(lng);

    if (isNaN(latVal) || isNaN(lngVal)) {
      return res.status(400).json({ error: 'Invalid latitude or longitude values' });
    }

    // Consulta SQL nativa con la Fórmula de Haversine para filtrar en un rango de 100km
    // 6371 es el radio de la Tierra en kilómetros.
    const tournaments = await prisma.$queryRaw`
      SELECT *, (
        6371 * acos(
          cos(radians(latitude)) * cos(radians(${latVal})) * cos(radians(${lngVal}) - radians(longitude)) + 
          sin(radians(latitude)) * sin(radians(${latVal}))
        )
      ) AS distance
      FROM "Tournament"
      WHERE (
        6371 * acos(
          cos(radians(latitude)) * cos(radians(${latVal})) * cos(radians(${lngVal}) - radians(longitude)) + 
          sin(radians(latitude)) * sin(radians(${latVal}))
        )
      ) <= 100
      ORDER BY distance ASC;
    `;

    // Para cada torneo, buscamos también la cuenta de sus participantes
    const tournamentIds = tournaments.map(t => t.id);
    const participants = await prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: { in: tournamentIds },
      },
    });

    const enrichedTournaments = tournaments.map(t => {
      // Convertimos el BigInt de la distancia (si lo fuera) o Float a número simple js
      const distNum = Number(t.distance);
      return {
        ...t,
        distance: isNaN(distNum) ? 0 : parseFloat(distNum.toFixed(1)),
        participants: participants.filter(p => p.tournamentId === t.id),
      };
    });

    res.status(200).json({ ok: true, tournaments: enrichedTournaments });
  } catch (e) {
    console.error('❌ /api/tournaments/search error:', e);
    res.status(500).json({ error: 'Failed to search nearby tournaments' });
  }
};
