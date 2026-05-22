// test_tournament_platform.js
require('dotenv').config();

const { prisma } = require('./lib/prisma');

// Importar los controladores de la API directamente
const createTournamentHandler = require('./api/tournaments/create');
const enrollTournamentHandler = require('./api/tournaments/enroll');
const checkInTournamentHandler = require('./api/tournaments/check-in');
const generateRoundHandler = require('./api/tournaments/generate-round');
const activeMatchHandler = require('./api/tournaments/active-match');
const reportMatchHandler = require('./api/matches/report');
const createInfractionHandler = require('./api/reports/create');
const finalizeTournamentHandler = require('./api/tournaments/finalize');
const userDashboardHandler = require('./api/user/dashboard');

// Helper para mockear peticiones/respuestas HTTP
async function callAPI(handler, method, params = {}) {
  const req = {
    method,
    headers: {
      'x-app-secret': process.env.APP_BACKEND_SECRET || 'pon_una_clave_larga_y_unica_mariarri30_db_prisma',
    },
  };

  if (method === 'GET') {
    req.query = params;
  } else {
    req.body = params;
  }

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: this.statusCode, data });
        return this;
      },
      end() {
        resolve({ status: this.statusCode, data: null });
        return this;
      },
    };

    handler(req, res).catch((err) => {
      console.error('💥 Excepción no controlada en handler:', err);
      reject(err);
    });
  });
}

async function main() {
  console.log('🚀 === INICIANDO PRUEBAS DE INTEGRACIÓN E2E DE LA PLATAFORMA DE TORNEOS ===\n');

  const storeId = 'test-store-e2e-id';
  const playerIds = [
    'test-player-e2e-1',
    'test-player-e2e-2',
    'test-player-e2e-3',
    'test-player-e2e-4',
  ];

  try {
    // ==========================================
    // FASE 0: LIMPIEZA DE BASE DE DATOS DE PRUEBA
    // ==========================================
    console.log('🧹 Fase 0: Limpiando ejecuciones y datos de prueba anteriores...');

    // A. Reportes de árbitros
    await prisma.judgeReport.deleteMany({
      where: {
        OR: [
          { playerId: { in: playerIds } },
          { judgeId: storeId },
        ],
      },
    });

    // B. Enfrentamientos (Matches)
    await prisma.tournamentMatch.deleteMany({
      where: {
        tournament: { storeId },
      },
    });

    // C. Inscripciones/Participantes (TournamentParticipant)
    await prisma.tournamentParticipant.deleteMany({
      where: {
        OR: [
          { userId: { in: playerIds } },
          { tournament: { storeId } },
        ],
      },
    });

    // D. Torneos
    await prisma.tournament.deleteMany({
      where: { storeId },
    });

    // E. Usuarios
    await prisma.user.deleteMany({
      where: {
        id: { in: [storeId, ...playerIds] },
      },
    });

    console.log('✅ Base de datos limpia de registros de prueba.');

    // ==========================================
    // FASE 1: CREAR TIENDA Y JUGADORES
    // ==========================================
    console.log('\n👤 Fase 1: Creando perfiles del Organizador (Tienda) y Jugadores...');

    const storeUser = await prisma.user.create({
      data: {
        id: storeId,
        name: 'Magic Paradise Málaga',
        surname: 'Store Admin',
        email: 'malaga@magicparadise.com',
        role: 'store',
        storeName: 'Magic Paradise Málaga',
        storeAddress: 'Calle Larios 15, Málaga',
      },
    });
    console.log(`🏠 Tienda creada: "${storeUser.storeName}" [ID: ${storeUser.id}]`);

    const players = [];
    for (let i = 0; i < playerIds.length; i++) {
      const p = await prisma.user.create({
        data: {
          id: playerIds[i],
          name: `Jugador ${i + 1}`,
          surname: `Prueba E2E`,
          username: `player_e2e_${i + 1}`,
          email: `player_e2e_${i + 1}@planeswalker.com`,
          role: 'player',
          xp: 0,
          level: 1,
        },
      });
      players.push(p);
      console.log(`   🎮 Jugador registrado: @${p.username} (Level ${p.level}, XP ${p.xp})`);
    }

    // ==========================================
    // FASE 2: CREAR TORNEO DE COMMANDER
    // ==========================================
    console.log('\n🏆 Fase 2: Creando un Torneo de Commander Multiplayer...');

    const tournamentData = {
      title: 'Torneo del Sol Naciente - Commander cEDH',
      description: 'Clasificatorio oficial con soporte completo de proxies y decklists validadas.',
      format: 'commander_multiplayer',
      powerLevel: 'cedh',
      locationName: 'Magic Paradise Málaga',
      latitude: 36.721261,
      longitude: -4.421265,
      entryFee: 1500, // 15.00 EUR
      maxPlayers: 4,
      startDate: new Date(Date.now() + 86400000).toISOString(), // Mañana
      storeId,
      allowProxies: true,
      proxyLimit: 15,
      requireDecklist: true,
      rulesEnforcement: 'Competitive',
      roundType: 'Swiss',
      prizePool: '150 EUR en vales de tienda',
      prizeDetail: '1º: 70 EUR, 2º: 40 EUR, 3º-4º: 20 EUR',
    };

    const createRes = await callAPI(createTournamentHandler, 'POST', tournamentData);
    if (createRes.status !== 200 || !createRes.data.ok) {
      throw new Error(`Error creando torneo: ${JSON.stringify(createRes.data)}`);
    }

    const tournament = createRes.data.tournament;
    console.log(`✅ Torneo creado con éxito: "${tournament.title}"`);
    console.log(`   Código de Sala Autogenerado: [ ${tournament.roomCode} ]`);
    console.log(`   Premios: ${tournament.prizePool}`);

    // ==========================================
    // FASE 3: INSCRIBIR A LOS 4 JUGADORES CON DECKLISTS
    // ==========================================
    console.log('\n📝 Fase 3: Inscribiendo a los participantes y realizando copias de seguridad de sus mazos...');

    const commanders = [
      'Urza, Lord High Artificer',
      'Krenko, Mob Boss',
      'Thrasios, Triton Hero',
      'Tymna the Weaver',
    ];

    for (let i = 0; i < playerIds.length; i++) {
      const pId = playerIds[i];
      const cmdName = commanders[i];

      const deck = {
        name: `Mi Mazo Competitivo de ${cmdName}`,
        commander: {
          name: cmdName,
          id: `scryfall-id-${i + 1}`,
          image_url: `https://c1.scryfall.com/file/scryfall-cards/normal/front/cmd-${i + 1}.jpg`,
        },
        cards: [
          { name: 'Sol Ring', count: 1, id: 'sol-ring-scryfall', image_url: '...' },
          { name: 'Mana Crypt', count: 1, id: 'mana-crypt-scryfall', image_url: '...' },
          { name: 'Command Tower', count: 1, id: 'command-tower-scryfall', image_url: '...' },
        ],
      };

      const enrollRes = await callAPI(enrollTournamentHandler, 'POST', {
        tournamentId: tournament.id,
        userId: pId,
        deck,
        openToTrade: i % 2 === 0,
        decklistUrl: `https://moxfield.com/decks/e2e-deck-${i + 1}`,
      });

      if (enrollRes.status !== 200 || !enrollRes.data.ok) {
        throw new Error(`Inscripción fallida para ${pId}: ${JSON.stringify(enrollRes.data)}`);
      }

      console.log(`   ✅ Inscripto: Jugador ${i + 1} con comandante "${cmdName}" (Moxfield snapshot guardado)`);
    }

    // ==========================================
    // FASE 4: CHECK-IN Y VALIDACIÓN FINANCIERA
    // ==========================================
    console.log('\n💳 Fase 4: Realizando Check-In del Organizador (Pago recibido y Mazos confirmados)...');

    for (const pId of playerIds) {
      const checkInRes = await callAPI(checkInTournamentHandler, 'PUT', {
        tournamentId: tournament.id,
        userId: pId,
        paymentStatus: 'Paid',
        paymentMethod: 'Cash',
        decklistValidated: true,
      });

      if (checkInRes.status !== 200 || !checkInRes.data.ok) {
        throw new Error(`Check-in fallido para ${pId}: ${JSON.stringify(checkInRes.data)}`);
      }
    }
    console.log('✅ Todos los jugadores han pagado y sus decklists están oficialmente validadas.');

    // ==========================================
    // FASE 5: GENERAR RONDA 1
    // ==========================================
    console.log('\n🎲 Fase 5: Generando emparejamientos de la Ronda 1 (Swiss)...');

    const round1Res = await callAPI(generateRoundHandler, 'POST', {
      tournamentId: tournament.id,
    });

    if (round1Res.status !== 200 || !round1Res.data.ok) {
      throw new Error(`Error en Ronda 1: ${JSON.stringify(round1Res.data)}`);
    }

    const r1 = round1Res.data.round;
    const matches1 = round1Res.data.matches;

    console.log(`✅ ¡Ronda ${r1} iniciada exitosamente!`);
    console.log(`   Número de mesas generadas: ${matches1.length}`);
    
    const mesa1 = matches1[0];
    console.log(`   👉 Mesa ${mesa1.tableNumber} asignada con jugadores:`);
    mesa1.players.forEach(p => console.log(`      - ${p.name} [ID: ${p.userId}]`));

    // ==========================================
    // FASE 6: CONSULTAR ESTADO ACTIVO DEL JUGADOR
    // ==========================================
    console.log('\n🔍 Fase 6: Simulando vista móvil de Jugador 1 (Active Match)...');

    const activeMatchRes = await callAPI(activeMatchHandler, 'GET', {
      tournamentId: tournament.id,
      userId: playerIds[0],
    });

    if (activeMatchRes.status !== 200 || !activeMatchRes.data.ok) {
      throw new Error(`Error active-match: ${JSON.stringify(activeMatchRes.data)}`);
    }

    const am = activeMatchRes.data;
    console.log(`   📱 Pantalla de @player_e2e_1:`);
    console.log(`      Mesa Asignada: Mesa ${am.tableNumber}`);
    console.log(`      Ronda Actual: Ronda ${am.round}`);
    console.log(`      Tus Oponentes de Mesa:`);
    am.opponents.forEach(op => console.log(`         • ${op.name}`));

    // ==========================================
    // FASE 7: REPORTAR RESULTADO DE LA MESA (PLAYER A WINS)
    // ==========================================
    console.log('\n📣 Fase 7: Reportando resultado de la Mesa 1 (Jugador 1 gana la ronda)...');

    // Reportamos victoria para Jugador 1
    const report1Res = await callAPI(reportMatchHandler, 'POST', {
      matchId: mesa1.id,
      winnerId: playerIds[0], // Jugador 1 gana
      score: '2-0',
      reportedBy: playerIds[0],
    });

    if (report1Res.status !== 200 || !report1Res.data.ok) {
      throw new Error(`Error al reportar mesa: ${JSON.stringify(report1Res.data)}`);
    }

    console.log('✅ Reporte de Mesa 1 guardado correctamente.');

    // ==========================================
    // FASE 8: REPORTAR INFRACCIÓN (JUDGE WARNING)
    // ==========================================
    console.log('\n⚖️ Fase 8: El Juez emite una advertencia formal (Slow Play) a Jugador 2...');

    const reportInfractionRes = await callAPI(createInfractionHandler, 'POST', {
      tournamentId: tournament.id,
      round: 1,
      tableNumber: 1,
      playerId: playerIds[1], // Jugador 2
      infractionType: 'Warning',
      reason: 'Slow Play: Tomó más de 4 minutos en su fase de mantenimiento en el turno 4 de manera reiterada.',
      judgeId: storeId,
      privateNotes: 'Jugador se mostró cooperativo pero un poco distraído.',
    });

    if (reportInfractionRes.status !== 200 || !reportInfractionRes.data.ok) {
      throw new Error(`Error registrando reporte de juez: ${JSON.stringify(reportInfractionRes.data)}`);
    }

    const infraction = reportInfractionRes.data.report;
    console.log(`✅ Infracción registrada en DB con éxito:`);
    console.log(`   Jugador sancionado: ${infraction.playerId}`);
    console.log(`   Tipo de penalización: [ ${infraction.infractionType} ]`);
    console.log(`   Razón de la advertencia: "${infraction.reason}"`);

    // ==========================================
    // FASE 9: GENERAR RONDA 2 (Swiss pairings)
    // ==========================================
    console.log('\n🎲 Fase 9: Generando emparejamientos de la Ronda 2...');

    const round2Res = await callAPI(generateRoundHandler, 'POST', {
      tournamentId: tournament.id,
    });

    if (round2Res.status !== 200 || !round2Res.data.ok) {
      throw new Error(`Error en Ronda 2: ${JSON.stringify(round2Res.data)}`);
    }

    const r2 = round2Res.data.round;
    const matches2 = round2Res.data.matches;
    console.log(`✅ ¡Ronda ${r2} iniciada exitosamente!`);
    console.log(`   Mesa ${matches2[0].tableNumber} emparejada.`);

    // ==========================================
    // FASE 10: REPORTAR RESULTADO DE LA MESA EN RONDA 2
    // ==========================================
    console.log('\n📣 Fase 10: Reportando resultados de la Ronda 2 (Jugador 2 gana la ronda)...');

    const report2Res = await callAPI(reportMatchHandler, 'POST', {
      matchId: matches2[0].id,
      winnerId: playerIds[1], // Jugador 2 gana
      score: '2-1',
      reportedBy: storeId,
    });

    if (report2Res.status !== 200 || !report2Res.data.ok) {
      throw new Error(`Error al reportar mesa 2: ${JSON.stringify(report2Res.data)}`);
    }
    console.log('✅ Reporte de Ronda 2 guardado correctamente.');

    // ==========================================
    // FASE 11: FINALIZAR TORNEO Y ASIGNAR XP
    // ==========================================
    console.log('\n🎁 Fase 11: Finalizando Torneo, procesando posiciones y repartiendo XP de Gamificación...');

    const finalizeRes = await callAPI(finalizeTournamentHandler, 'POST', {
      tournamentId: tournament.id,
    });

    if (finalizeRes.status !== 200 || !finalizeRes.data.ok) {
      throw new Error(`Error finalizando torneo: ${JSON.stringify(finalizeRes.data)}`);
    }

    const resultsSummary = finalizeRes.data.result.userUpdates;
    console.log('✅ ¡Torneo finalizado e XP procesado exitosamente!');
    console.log('   Actualizaciones de nivel transaccionales:');
    resultsSummary.forEach(u => {
      console.log(`      🎮 ${u.userName} -> XP ganado: +${u.xpEarned} | Total XP: ${u.totalXp} | Nivel Actual: ${u.level}`);
    });

    // ==========================================
    // FASE 12: VALIDAR PANEL (DASHBOARD) DEL JUGADOR
    // ==========================================
    console.log('\n📊 Fase 12: Consultando Dashboard Estadístico de Jugador 1...');

    const dashboardRes = await callAPI(userDashboardHandler, 'GET', {
      userId: playerIds[0],
    });

    if (dashboardRes.status !== 200 || !dashboardRes.data.ok) {
      throw new Error(`Error consultando dashboard: ${JSON.stringify(dashboardRes.data)}`);
    }

    const dbData = dashboardRes.data;
    console.log(`   ✅ Datos dinámicos devueltos para ${dbData.user.name}:`);
    console.log(`      Nombre de usuario: @${dbData.user.username}`);
    console.log(`      Nivel: ${dbData.user.level} (XP Total: ${dbData.user.xp})`);
    console.log(`      Estadísticas Globales:`);
    console.log(`         • Torneos Jugados: ${dbData.estadisticas_globales.torneos_jugados}`);
    console.log(`         • Win Rate General: ${dbData.estadisticas_globales.win_rate_general}%`);
    console.log(`         • Comandante Favorito: ${dbData.estadisticas_globales.comandante_favorito}`);
    console.log(`      Historial de Torneos:`);
    dbData.historico_torneos.forEach(h => {
      console.log(`         🏆 "${h.nombre_evento}" | Comandante: ${h.comandante_usado} | Resultados: [${h.resultado_rondas.join(', ')}]`);
    });

    console.log('\n🎉 ========================================================');
    console.log('🎉 ¡TODAS LAS PRUEBAS DE INTEGRACIÓN E2E COMPLETADAS CON ÉXITO! 🎉');
    console.log('🎉 ========================================================');

  } catch (error) {
    console.error('\n❌ ERROR EN LA EJECUCIÓN DE PRUEBAS DE INTEGRACIÓN E2E:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('\n🔌 Conexión con base de datos cerrada.');
  }
}

main();
