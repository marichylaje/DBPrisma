// test_user_profile.js
require('dotenv').config();

const { prisma } = require('./lib/prisma');

async function main() {
  console.log('🔄 Iniciando pruebas de Base de Datos para el Perfil de Usuario...');

  try {
    const testUserId = 'dkb_test_user_key_12345';
    const testNickname = 'AlexGuerrero';
    const testEmail = 'alex.guerrero@planeswalker.com';

    console.log(`👤 Upserteando usuario de prueba: ${testUserId}`);

    const upserted = await prisma.user.upsert({
      where: { id: testUserId },
      create: {
        id: testUserId,
        nickname: testNickname,
        email: testEmail,
        role: 'player',
        xp: 0,
        level: 1,
      },
      update: {
        nickname: testNickname,
        email: testEmail,
      },
    });

    console.log('✅ Usuario upsertado con éxito en DB:', upserted);

    console.log(`🔍 Buscando usuario de prueba por ID: ${testUserId}`);
    const foundUser = await prisma.user.findUnique({
      where: { id: testUserId },
    });

    console.log('✅ Usuario encontrado en DB:', foundUser);

    if (foundUser && foundUser.nickname === testNickname && foundUser.email === testEmail) {
      console.log('🎉 ¡Prueba de integración exitosa! Base de datos sincronizando correctamente.');
    } else {
      console.error('❌ Error de validación: Los datos del usuario no coinciden.');
    }

  } catch (err) {
    console.error('❌ Error durante la ejecución de pruebas:', err);
  } finally {
    await prisma.$disconnect();
    console.log('🔌 Conexión a Base de Datos cerrada.');
  }
}

main();
