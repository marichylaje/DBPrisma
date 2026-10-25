const { z } = require("zod");

const MAX_CARD_ENTRIES = 500;
const MAX_SIDEBOARD_ENTRIES = 200;
const MAX_JSON_BYTES = 400_000;

const optStr = (max) => z.string().max(max).nullish();

const jsonSizeOk = (value, maxBytes = MAX_JSON_BYTES) =>
  JSON.stringify(value ?? null).length <= maxBytes;

const entryList = (max, maxBytes = MAX_JSON_BYTES) =>
  z
    .array(z.any())
    .max(max)
    .refine((value) => jsonSizeOk(value, maxBytes), {
      message: "payload_too_large",
    });

const cardRef = z
  .object({ name: optStr(200), id: optStr(100) })
  .partial()
  .nullish();

const deckPayload = z.object({
  deckName: z.string().trim().min(1).max(120),
  deckDescription: optStr(4000),
  instagram: optStr(120),
  commander: cardRef,
  commanderName: optStr(200),
  commanderId: optStr(100),
  partner: cardRef,
  partnerName: optStr(200),
  partnerId: optStr(100),
  cards: entryList(MAX_CARD_ENTRIES).default([]),
  sideboard: entryList(MAX_SIDEBOARD_ENTRIES).default([]),
});

const userDeckSavePayload = deckPayload.extend({
  deckId: optStr(64),
  oldDeckName: optStr(120),
  deckData: z
    .any()
    .optional()
    .refine((value) => jsonSizeOk(value), {
      message: "payload_too_large",
    }),
});

const sharedDeckPayload = deckPayload.extend({
  sharedType: z.string().max(20).default("QR"),
  tournamentId: optStr(64),
});

const deckPatchPayload = z.object({
  id: z.string().min(1).max(64),
  deckDescription: optStr(4000),
  instagram: optStr(120),
});

const deckRefPayload = z
  .object({
    id: z.string().min(1).max(64).optional(),
    deckName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.id || v.deckName, { message: "id_or_deckName_required" });

const collectionPayload = z.object({
  cards: entryList(20_000, 3_000_000),
});

const wishlistPayload = z.object({
  cards: z.array(z.string().max(200)).max(5000),
});

const loginPayload = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
});

const registerPayload = z.object({
  username: z.string().trim().min(3).max(30),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

/**
 * Valida `data` con `schema`. Si falla responde 400 y devuelve null; si no, devuelve el dato
 * ya limpio (campos desconocidos descartados).
 */
function parseOrReject(res, schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  res.status(400).json({
    error: "invalid_payload",
    issues: result.error.issues
      .slice(0, 5)
      .map((i) => ({ path: i.path.join("."), message: i.message })),
  });
  return null;
}

module.exports = {
  collectionPayload,
  deckPatchPayload,
  deckPayload,
  deckRefPayload,
  loginPayload,
  parseOrReject,
  registerPayload,
  sharedDeckPayload,
  userDeckSavePayload,
  wishlistPayload,
  z,
};
