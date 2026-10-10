const { prisma } = require('./prisma');

/**
 * Intenta resolver el nickname de un usuario registrado a partir de un identificador
 * (userKey o userId). Devuelve null sin lanzar error si el valor no corresponde a
 * ningún User (p. ej. userKey anónimo de un dispositivo sin cuenta todavía).
 */
async function lookupNickname(idOrKey) {
  if (!idOrKey) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: idOrKey },
      select: { nickname: true },
    });
    return user ? user.nickname : null;
  } catch {
    return null;
  }
}

/**
 * Variante batch: resuelve nicknames para múltiples identificadores en una sola consulta.
 * Devuelve un Map<idOrKey, nickname>. Las claves sin User asociado no aparecen en el Map.
 */
async function lookupNicknames(idsOrKeys) {
  const unique = [...new Set((idsOrKeys || []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, nickname: true },
    });
    return new Map(users.map((u) => [u.id, u.nickname]));
  } catch {
    return new Map();
  }
}

/**
 * Devuelve { id, nickname } del User cuyo id coincide con idOrKey, o null si no existe.
 */
async function lookupUser(idOrKey) {
  if (!idOrKey) return null;
  try {
    return await prisma.user.findUnique({
      where: { id: idOrKey },
      select: { id: true, nickname: true },
    });
  } catch {
    return null;
  }
}

/**
 * Resuelve el dueño real de una petición: primero por el JWT (cuenta, igual en todos los
 * dispositivos) y, si no hay sesión, por userKey (solo coincide si userKey es un User.id).
 */
async function resolveOwner(req, userKey) {
  const { getOptionalUserId } = require('./auth');
  const jwtUserId = getOptionalUserId(req);
  if (jwtUserId) {
    const user = await lookupUser(jwtUserId);
    if (user) return user;
  }
  return lookupUser(userKey);
}

module.exports = { lookupNickname, lookupNicknames, lookupUser, resolveOwner };
