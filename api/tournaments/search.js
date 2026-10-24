const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { decodeVerifiedToken, parseBearerToken } = require('../../lib/auth');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

const MAX_RESULTS = 200;
const PUBLIC_USER_SELECT = { id: true, nickname: true, level: true };
const ORGANIZER_ONLY_FIELDS = ['deckSnapshot', 'paymentStatus', 'paymentMethod', 'decklistUrl'];

// Los datos de pago y listas de mazo solo los ve el organizador del torneo.
function sanitizeParticipant(participant, isOrganizer) {
  if (isOrganizer) return participant;
  const safe = { ...participant };
  for (const field of ORGANIZER_ONLY_FIELDS) delete safe[field];
  return safe;
}

// Búsqueda pública de torneos cercanos (datos no personales); limitada por IP.
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'tournaments-search', [
      { id: 'burst', limit: 10, windowSeconds: 10 },
      { id: 'sustained', limit: 300, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const { lat, lng, id } = req.query || {};
    if (id !== undefined && (typeof id !== 'string' || id.length > 64)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const caller = decodeVerifiedToken(parseBearerToken(req));

    if (id) {
      const tournament = await prisma.tournament.findUnique({
        where: { id },
        include: {
          participants: {
            include: {
              // Nunca exponer email/passwordHash del usuario.
              user: { select: PUBLIC_USER_SELECT },
            },
          },
          matches: true,
        },
      });
      if (!tournament) return res.status(200).json({ ok: true, tournaments: [] });

      const admins = Array.isArray(tournament.admins) ? tournament.admins : [];
      const isOrganizer =
        !!caller &&
        caller.kind === 'user' &&
        (caller.sub === tournament.storeId || admins.includes(caller.sub));
      return res.status(200).json({
        ok: true,
        tournaments: [{ ...tournament, participants: tournament.participants.map((p) => sanitizeParticipant(p, isOrganizer)) }],
      });
    }

    if (!lat || !lng) {
      // Si no hay coordenadas, devolvemos todos los torneos activos/creados ordenados por fecha
      const allTournaments = await prisma.tournament.findMany({
        where: {
          status: { in: ['created', 'active'] },
        },
        orderBy: {
          startDate: 'asc',
        },
        take: MAX_RESULTS,
        include: {
          participants: true,
        },
      });
      return res.status(200).json({
        ok: true,
        tournaments: allTournaments.map((t) => ({
          ...t,
          participants: t.participants.map((p) => sanitizeParticipant(p, false)),
        })),
      });
    }

    const latVal = parseFloat(lat);
    const lngVal = parseFloat(lng);

    if (isNaN(latVal) || isNaN(lngVal) || Math.abs(latVal) > 90 || Math.abs(lngVal) > 180) {
      return res.status(400).json({ error: 'Invalid latitude or longitude values' });
    }

    // Consulta SQL nativa con la Fórmula de Haversine para filtrar en un rango de 100km
    // 6371 es el radio de la Tierra en kilómetros. El prefiltro por caja (~1°≈111km) permite
    // usar el índice de (latitude, longitude) antes de evaluar la fórmula.
    const latDelta = 1;
    const lngDelta = Math.min(180, latDelta / Math.max(0.01, Math.cos((latVal * Math.PI) / 180)));
    const tournaments = await prisma.$queryRaw`
      SELECT * FROM (
        SELECT *, (
          6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians(latitude)) * cos(radians(${latVal})) * cos(radians(${lngVal}) - radians(longitude)) +
              sin(radians(latitude)) * sin(radians(${latVal}))
            ))
          )
        ) AS distance
        FROM "Tournament"
        WHERE latitude BETWEEN ${latVal - latDelta} AND ${latVal + latDelta}
          AND longitude BETWEEN ${lngVal - lngDelta} AND ${lngVal + lngDelta}
      ) t
      WHERE distance <= 100
      ORDER BY distance ASC
      LIMIT ${MAX_RESULTS};
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
        participants: participants
          .filter(p => p.tournamentId === t.id)
          .map((p) => sanitizeParticipant(p, false)),
      };
    });

    res.status(200).json({ ok: true, tournaments: enrichedTournaments });
  } catch (e) {
    sendServerError(res, '/api/tournaments/search', e);
  }
};

