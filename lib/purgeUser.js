/**
 * Borrado total de un usuario y de todos sus datos relacionados (uso administrativo / scripts).
 *
 * `key` puede ser un User.id ("auth_...") o una clave de dispositivo anónima ("dkb_...").
 * A diferencia de /api/auth-delete, aquí también se eliminan UserEntitlement,
 * ProcessedIapNotification, torneos creados por el usuario y contadores de descargas de sus mazos.
 */
async function collectKeys(prisma, key) {
  const where = { userId: key };
  const [decks, allDecks, cloudDecks, collections, wishlists] = await Promise.all([
    prisma.userDeck.findMany({ where, select: { id: true, userKey: true } }),
    prisma.allDeck.findMany({ where, select: { id: true, userKey: true } }),
    prisma.cloudDeck.findMany({ where, select: { id: true, userKey: true } }),
    prisma.userCollection.findMany({ where, select: { userKey: true } }),
    prisma.userWishlist.findMany({ where, select: { userKey: true } }),
  ]);

  const userKeys = new Set([key]);
  for (const r of [...decks, ...allDecks, ...cloudDecks, ...collections, ...wishlists]) userKeys.add(r.userKey);

  // También los mazos ligados solo por userKey (sin userId) para obtener sus ids.
  const keyList = [...userKeys];
  const byKey = { userKey: { in: keyList } };
  const [decksByKey, allDecksByKey, cloudDecksByKey] = await Promise.all([
    prisma.userDeck.findMany({ where: byKey, select: { id: true } }),
    prisma.allDeck.findMany({ where: byKey, select: { id: true } }),
    prisma.cloudDeck.findMany({ where: byKey, select: { id: true } }),
  ]);

  const deckIds = new Set(
    [...decks, ...allDecks, ...cloudDecks, ...decksByKey, ...allDecksByKey, ...cloudDecksByKey].map((d) => d.id)
  );

  return { userKeys: keyList, deckIds: [...deckIds] };
}

async function purgeUser(prisma, key, { dryRun = false } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('user key vacío');
  key = key.trim();

  const user = await prisma.user.findUnique({
    where: { id: key },
    select: { id: true, nickname: true, email: true },
  });
  const { userKeys, deckIds } = await collectKeys(prisma, key);
  const byKey = { userKey: { in: userKeys } };

  const owned = { OR: [byKey, { userId: key }] };

  const counts = {};
  const DRY_RUN_ROLLBACK = new Error('dry-run rollback');

  // Todo en una única transacción: o se borra todo o nada. En dry-run se fuerza rollback.
  try {
    await prisma.$transaction(
      async (tx) => {
        const steps = [
          ['DeckDownload', () => tx.deckDownload.deleteMany({ where: { deckKey: { in: deckIds } } })],
          ['AnalyticsEvent', () => tx.analyticsEvent.deleteMany({ where: byKey })],
          ['SharedDeck', () => tx.sharedDeck.deleteMany({ where: byKey })],
          ['IapTrackingEvent', () => tx.iapTrackingEvent.deleteMany({ where: { userId: { in: userKeys } } })],
          ['ProcessedIapNotification', () => tx.processedIapNotification.deleteMany({ where: byKey })],
          ['UserEntitlement', () => tx.userEntitlement.deleteMany({ where: byKey })],
          ['UserDeck', () => tx.userDeck.deleteMany({ where: owned })],
          ['AllDeck', () => tx.allDeck.deleteMany({ where: owned })],
          ['CloudDeck', () => tx.cloudDeck.deleteMany({ where: owned })],
          ['UserCollection', () => tx.userCollection.deleteMany({ where: owned })],
          ['UserWishlist', () => tx.userWishlist.deleteMany({ where: owned })],
          // Tournament no tiene relación con User; matches/participantes/reportes cascadean desde Tournament.
          ['Tournament (storeId)', () => tx.tournament.deleteMany({ where: { storeId: key } })],
          // Cascadea: Friendship, FriendNight*, TournamentParticipant, JudgeReport.
          ['User', () => tx.user.deleteMany({ where: { id: key } })],
        ];
        for (const [name, run] of steps) counts[name] = (await run()).count;
        if (dryRun) throw DRY_RUN_ROLLBACK;
      },
      { timeout: 60000, maxWait: 15000 }
    );
  } catch (e) {
    if (e !== DRY_RUN_ROLLBACK) throw e;
  }

  return { user, userKeys, deckIds, counts, dryRun };
}

module.exports = { purgeUser };
