const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkAdminSecret } = require('../../lib/auth');
const { sendServerError } = require('../../lib/httpError');

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (s) => (s || '').toLowerCase().trim();

function isSameUtcDay(timestamp, date) {
  const timestampDate = new Date(timestamp);
  return (
    !Number.isNaN(timestampDate.getTime()) &&
    timestampDate.getUTCFullYear() === date.getUTCFullYear() &&
    timestampDate.getUTCMonth() === date.getUTCMonth() &&
    timestampDate.getUTCDate() === date.getUTCDate()
  );
}

function getScryfallIdentifier(cardKey) {
  if (cardKey.includes('|')) {
    const parts = cardKey.split('|');
    const name = parts[0];
    const set = parts[1];
    const cn = parts[2];
    if (set && cn) {
      return { set: set.toLowerCase(), collector_number: cn };
    }
    return { name };
  }
  return { name: cardKey };
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkAdminSecret(req, res)) return;

    // 1) Obtener todas las colecciones de usuarios
    const collections = await prisma.userCollection.findMany();
    const uniqueCards = new Set();

    for (const col of collections) {
      if (Array.isArray(col.cards)) {
        for (const card of col.cards) {
          if (typeof card === 'string' && card.trim().length > 0) {
            uniqueCards.add(card.trim());
          }
        }
      }
    }

    const cardsArray = Array.from(uniqueCards);

    if (cardsArray.length === 0) {
      return res.status(200).json({ ok: true, message: 'No cards in collections to update.' });
    }

    const now = new Date();
    // Obtener todos los historiales existentes de estas cartas en una sola consulta
    const existingRecords = await prisma.cardPriceHistory.findMany({
      where: {
        cardKey: { in: cardsArray },
      },
      select: { cardKey: true, history: true },
    });
    const historyMap = new Map(existingRecords.map((r) => [r.cardKey, r.history]));
    const refreshedToday = new Set(
      existingRecords
        .filter((record) => {
          const history = Array.isArray(record.history) ? record.history : [];
          const latest = history[history.length - 1];
          return latest && isSameUtcDay(latest.timestamp, now);
        })
        .map((record) => record.cardKey),
    );
    const cardsToRefresh = cardsArray.filter((key) => !refreshedToday.has(key));

    if (cardsToRefresh.length === 0) {
      return res.status(200).json({
        ok: true,
        message: 'All active card prices were already refreshed today.',
        activeCount: cardsArray.length,
        skippedCount: cardsArray.length,
        updatedCount: 0,
      });
    }

    console.log(
      `[PriceRefresh] ${cardsArray.length} cartas activas; ${cardsToRefresh.length} pendientes de refresco.`,
    );

    // 2) Dividir en lotes de 75 (Límite de Scryfall por request en POST /cards/collection)
    const batches = chunk(cardsToRefresh, 75);
    let updatedCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batchKeys = batches[i];
      const identifiers = batchKeys.map(getScryfallIdentifier);

      try {
        const response = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'MTGCommanderDeckBuilder/1.0',
          },
          body: JSON.stringify({ identifiers }),
        });

        if (!response.ok) {
          console.error(`[PriceRefresh] Error HTTP ${response.status} de Scryfall en lote ${i + 1}`);
          continue;
        }

        const result = await response.json();
        const scryfallCards = result.data || [];

        // 3) Mapear resultados e insertar en historial de precios
        for (const cardData of scryfallCards) {
          if (!cardData) continue;
          
          const usd = cardData.prices?.usd ? parseFloat(cardData.prices.usd) : null;
          const eur = cardData.prices?.eur ? parseFloat(cardData.prices.eur) : null;

          if (usd === null && eur === null) continue;

          // Buscar cuáles de nuestras claves de carta coinciden con esta respuesta de Scryfall
          for (const key of batchKeys) {
            let matches = false;

            if (key.includes('|')) {
              const [name, set, cn] = key.split('|');
              if (
                normalize(cardData.name) === normalize(name) &&
                normalize(cardData.set) === normalize(set) &&
                normalize(cardData.collector_number) === normalize(cn)
              ) {
                matches = true;
              }
            } else {
              if (normalize(cardData.name) === normalize(key)) {
                matches = true;
              }
            }

            if (matches) {
              let historyArray = historyMap.get(key);
              if (!Array.isArray(historyArray)) {
                historyArray = [];
              }

              const timestamp = Date.now();
              if (historyArray.length > 0 && isSameUtcDay(historyArray[historyArray.length - 1].timestamp, now)) {
                historyArray[historyArray.length - 1] = {
                  timestamp,
                  priceUsd: usd,
                  priceEur: eur,
                };
              } else {
                historyArray.push({
                  timestamp,
                  priceUsd: usd,
                  priceEur: eur,
                });
              }

              if (historyArray.length > 30) {
                historyArray = historyArray.slice(-30);
              }

              // Actualizar en el mapa en memoria para consistencia
              historyMap.set(key, historyArray);

              await prisma.cardPriceHistory.upsert({
                where: { cardKey: key },
                create: {
                  cardKey: key,
                  history: historyArray,
                },
                update: {
                  history: historyArray,
                },
              });
              updatedCount++;
            }
          }
        }
      } catch (err) {
        console.error(`[PriceRefresh] Excepción procesando lote ${i + 1}:`, err);
      }

      // Respetar límites de Scryfall
      await sleep(150);
    }

    res.status(200).json({
      ok: true,
      message: `Precios actualizados exitosamente. Total registros insertados: ${updatedCount}`,
      activeCount: cardsArray.length,
      skippedCount: refreshedToday.size,
      updatedCount,
    });
  } catch (e) {
    sendServerError(res, '/api/admin/refresh-prices', e);
  }
};
