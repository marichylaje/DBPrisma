const FREE_DECK_LIMIT = 20;
const PAID_DECK_LIMIT = 50;

class DeckQuotaError extends Error {
  constructor(quota) {
    super('deck_limit_reached');
    this.quota = quota;
  }
}

async function readDeckQuota(tx, userKey) {
  const [privateDecks, publicDecks, ent] = await Promise.all([
    tx.userDeck.findMany({ where: { userKey }, select: { deckName: true } }),
    tx.cloudDeck.findMany({ where: { userKey }, select: { deckName: true } }),
    tx.userEntitlement.findUnique({
      where: { userKey }, include: { sharedTrial: true },
    }),
  ]);
  const now = Date.now();
  const subscriptionActive = !!(ent?.subActive && ent.subExpiry?.getTime() > now);
  const trial = ent?.sharedTrialKey ? ent.sharedTrial : ent;
  if (ent?.sharedTrialKey && (!trial || trial.sharedTrialKey || !trial.trialGranted)) {
    throw new Error('invalid_shared_trial');
  }
  const trialActive = !!(ent?.trialGranted && trial?.trialGranted && trial.trialExpiry?.getTime() > now);
  const deckNames = [...new Set([...privateDecks, ...publicDecks].map((deck) => deck.deckName))];
  return {
    limit: subscriptionActive || trialActive ? PAID_DECK_LIMIT : FREE_DECK_LIMIT,
    count: deckNames.length,
    deckNames,
    privateDeckNames: privateDecks.map((deck) => deck.deckName),
    publicDeckNames: publicDecks.map((deck) => deck.deckName),
  };
}

function quotaResponse(quota) {
  return { limit: quota.limit, count: quota.count, deckNames: quota.deckNames };
}

async function enforceDeckQuota(tx, userKey, model, previousName, deckName) {
  // Ordinary edits do not change the union and need no quota reads.
  if (previousName === deckName) return;
  const quota = await readDeckQuota(tx, userKey);
  if (quota.deckNames.includes(deckName)) return;
  const otherNames = model === 'userDeck' ? quota.publicDeckNames : quota.privateDeckNames;
  const removesOldName = previousName && !otherNames.includes(previousName);
  if (!removesOldName && quota.count >= quota.limit) {
    throw new DeckQuotaError(quotaResponse(quota));
  }
}

function sendDeckQuotaError(res, error) {
  if (!(error instanceof DeckQuotaError)) return false;
  res.status(409).json({ error: 'deck_limit_reached', ...error.quota });
  return true;
}

module.exports = {
  DeckQuotaError, readDeckQuota, quotaResponse, enforceDeckQuota, sendDeckQuotaError,
};
