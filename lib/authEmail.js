const crypto = require('crypto');
const { prisma } = require('./prisma');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const emailCopy = {
  en: ['Verify your email', 'Reset your password', 'Your MTG DeckBuilder code is', 'This code expires in 10 minutes. If you did not request it, ignore this email. Never share this code.'],
  es: ['Verifica tu correo', 'Recupera tu contrase\u00f1a', 'Tu c\u00f3digo de MTG DeckBuilder es', 'Este c\u00f3digo caduca en 10 minutos. Si no lo solicitaste, ignora este correo. No compartas este c\u00f3digo.'],
  de: ['E-Mail best\u00e4tigen', 'Passwort zur\u00fccksetzen', 'Dein MTG DeckBuilder-Code lautet', 'Dieser Code ist 10 Minuten g\u00fcltig. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail. Teile diesen Code niemals.'],
  fr: ['V\u00e9rifiez votre adresse e-mail', 'R\u00e9initialisez votre mot de passe', 'Votre code MTG DeckBuilder est', 'Ce code expire dans 10 minutes. Si vous ne l\u2019avez pas demand\u00e9, ignorez cet e-mail. Ne partagez jamais ce code.'],
  it: ['Verifica la tua email', 'Reimposta la password', 'Il tuo codice MTG DeckBuilder \u00e8', 'Questo codice scade tra 10 minuti. Se non lo hai richiesto, ignora questa email. Non condividere mai questo codice.'],
  ja: ['\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u306e\u78ba\u8a8d', '\u30d1\u30b9\u30ef\u30fc\u30c9\u306e\u518d\u8a2d\u5b9a', 'MTG DeckBuilder \u306e\u78ba\u8a8d\u30b3\u30fc\u30c9', '\u3053\u306e\u30b3\u30fc\u30c9\u306f10\u5206\u9593\u6709\u52b9\u3067\u3059\u3002\u5fc3\u5f53\u305f\u308a\u304c\u306a\u3044\u5834\u5408\u306f\u7121\u8996\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u30b3\u30fc\u30c9\u3092\u4ed6\u306e\u4eba\u3068\u5171\u6709\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002'],
  pt: ['Verifique o seu email', 'Redefina a sua palavra-passe', 'O seu c\u00f3digo MTG DeckBuilder \u00e9', 'Este c\u00f3digo expira em 10 minutos. Se n\u00e3o o solicitou, ignore este email. Nunca partilhe este c\u00f3digo.'],
};

function getEmailConfig() {
  const { RESEND_API_KEY: apiKey, AUTH_EMAIL_FROM: from, AUTH_EMAIL_CODE_SECRET: secret } = process.env;
  if (!apiKey || !from || !secret || secret.length < 32) {
    throw new Error('auth_email_config_invalid');
  }
  return { apiKey, from, secret };
}

function hashCode(email, purpose, code) {
  return crypto.createHmac('sha256', getEmailConfig().secret)
    .update(JSON.stringify([email, purpose, code])).digest('hex');
}

async function lockChallenge(tx, email, purpose) {
  // Serializa envios/verificaciones del mismo correo entre instancias serverless.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-email:${purpose}:${email}`}))`;
}

async function sendCodeEmail(email, purpose, code, language) {
  const { apiKey, from } = getEmailConfig();
  const [registerSubject, resetSubject, label, notice] = emailCopy[language] || emailCopy.en;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `MTG DeckBuilder - ${purpose === 'reset' ? resetSubject : registerSubject}`,
      text: `${label}: ${code}\n\n${notice}`,
      html: `<h2>MTG DeckBuilder</h2><p>${label}:</p><p style="font-size:32px;letter-spacing:6px;font-weight:bold">${code}</p><p>${notice}</p>`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`auth_email_delivery_failed:${response.status}`);
}

async function requestEmailCode(email, purpose, language, userId) {
  getEmailConfig();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hashCode(email, purpose, code);
  const shouldSend = await prisma.$transaction(async (tx) => {
    await lockChallenge(tx, email, purpose);
    const existing = await tx.authEmailChallenge.findUnique({ where: { email_purpose: { email, purpose } } });
    const now = new Date();
    if (existing && now.getTime() - existing.sentAt.getTime() < RESEND_DELAY_MS) return false;
    const user = await tx.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, passwordHash: true },
    });
    const eligible = purpose === 'register' ? !user :
      purpose === 'verify' ? Boolean(user?.passwordHash && user.id === userId) :
        Boolean(user?.passwordHash);
    if (purpose === 'verify' && !eligible) throw new Error('auth_email_account_changed');
    await tx.authEmailChallenge.upsert({
      where: { email_purpose: { email, purpose } },
      create: { email, purpose, codeHash, userId: purpose !== 'register' && eligible ? user.id : null, sentAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
      update: { codeHash, userId: purpose !== 'register' && eligible ? user.id : null, attempts: 0, sentAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
    });
    return eligible;
  });
  if (shouldSend) {
    try {
      await sendCodeEmail(email, purpose, code, language);
    } catch (error) {
      await prisma.authEmailChallenge.deleteMany({ where: { email, purpose, codeHash } });
      throw error;
    }
  }
}

async function withVerifiedEmailCode(email, purpose, code, action, { consume = true } = {}) {
  const candidate = hashCode(email, purpose, code);
  return prisma.$transaction(async (tx) => {
    await lockChallenge(tx, email, purpose);
    const challenge = await tx.authEmailChallenge.findUnique({ where: { email_purpose: { email, purpose } } });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= MAX_ATTEMPTS) {
      return { error: 'invalid_or_expired_code' };
    }
    if (!crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(challenge.codeHash, 'hex'))) {
      await tx.authEmailChallenge.update({
        where: { email_purpose: { email, purpose } },
        data: { attempts: { increment: 1 } },
      });
      return { error: 'invalid_or_expired_code' };
    }
    if (purpose !== 'register' && !challenge.userId) return { error: 'invalid_or_expired_code' };
    const value = await action(tx, challenge);
    if (value === null) return { error: 'invalid_or_expired_code' };
    if (consume) await tx.authEmailChallenge.delete({ where: { email_purpose: { email, purpose } } });
    return { value };
  });
}

module.exports = { requestEmailCode, withVerifiedEmailCode };
