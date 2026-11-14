const { prisma } = require('./prisma');

async function serializable(work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt >= 3 || !['P2034', 'P2002'].includes(error?.code)) throw error;
    }
  }
}

module.exports = { serializable };
