const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
// Hash ficticio para igualar el tiempo de respuesta cuando el usuario no existe.
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(KEY_LENGTH * 2)}`;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, KEY_LENGTH)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const candidate = await scrypt(password, salt, KEY_LENGTH);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

module.exports = { DUMMY_HASH, hashPassword, verifyPassword };
