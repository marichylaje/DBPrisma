// lib/prisma.js
const { PrismaClient } = require('@prisma/client');

// Para evitar desajustes, en local usa SIEMPRE la conexión directa a Neon.
// (Más adelante podrás volver a Accelerate cuando lo tengas bien apuntado)
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

const prisma = new PrismaClient({
  datasources: { db: { url } },
});

module.exports = { prisma };
