async function getTournamentManageAccess(prisma, tournamentId, userId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, storeId: true, admins: true },
  });

  if (!tournament) {
    return { ok: false, reason: 'not_found' };
  }

  const admins = Array.isArray(tournament.admins) ? tournament.admins : [];
  const canManage = tournament.storeId === userId || admins.includes(userId);

  return {
    ok: canManage,
    reason: canManage ? null : 'forbidden',
    tournament,
  };
}

module.exports = {
  getTournamentManageAccess,
};
