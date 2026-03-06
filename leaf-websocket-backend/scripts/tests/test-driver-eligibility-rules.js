/**
 * Teste rápido das regras centrais de elegibilidade Plus/Elite.
 * Executa contra Redis local usando cache de perfil (sem depender de Firebase).
 */

const redisPool = require('../../utils/redis-pool');
const driverEligibilityService = require('../../services/driver-eligibility-service');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function seedProfile(driverId, profile) {
    const redis = redisPool.getConnection();
    await redis.hset(`driver_eligibility_profile:${driverId}`, {
        driverId,
        driverApproved: String(profile.driverApproved ?? true),
        vehicleApproved: String(profile.vehicleApproved ?? true),
        vehicleCategory: profile.vehicleCategory || '',
        carType: profile.carType || '',
        acceptsPlusWithElite: String(profile.acceptsPlusWithElite ?? true),
        rating: String(profile.rating ?? 5),
        activeVehicleId: profile.activeVehicleId || '',
        vehiclePlate: profile.vehiclePlate || ''
    });
    await redis.expire(`driver_eligibility_profile:${driverId}`, 120);
}

async function run() {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();

    const base = 'elig_test_';
    const ids = {
        plus: `${base}plus`,
        elite: `${base}elite`,
        eliteBlocked: `${base}elite_blocked`
    };

    await Promise.all([
        redis.del(`driver_eligibility_profile:${ids.plus}`),
        redis.del(`driver_eligibility_profile:${ids.elite}`),
        redis.del(`driver_eligibility_profile:${ids.eliteBlocked}`),
        redis.del(`driver_elite_recovery:${ids.eliteBlocked}`)
    ]);

    await seedProfile(ids.plus, {
        vehicleCategory: 'plus',
        carType: 'Leaf Plus',
        rating: 4.9
    });

    await seedProfile(ids.elite, {
        vehicleCategory: 'elite',
        carType: 'Leaf Elite',
        rating: 4.9,
        acceptsPlusWithElite: true
    });

    await seedProfile(ids.eliteBlocked, {
        vehicleCategory: 'elite',
        carType: 'Leaf Elite',
        rating: 4.5,
        acceptsPlusWithElite: true
    });

    const plusOnPlus = await driverEligibilityService.isDriverEligibleForRide(ids.plus, 'plus');
    assert(plusOnPlus.eligible, 'Plus deveria aceitar corrida Plus');

    const plusOnElite = await driverEligibilityService.isDriverEligibleForRide(ids.plus, 'elite');
    assert(!plusOnElite.eligible && plusOnElite.code === 'NOT_ELITE_VEHICLE', 'Plus não pode aceitar Elite');

    const eliteOnElite = await driverEligibilityService.isDriverEligibleForRide(ids.elite, 'elite');
    assert(eliteOnElite.eligible, 'Elite com nota >= 4.8 deveria aceitar Elite');

    const eliteOnPlus = await driverEligibilityService.isDriverEligibleForRide(ids.elite, 'plus');
    assert(eliteOnPlus.eligible, 'Elite com opt-in deveria aceitar Plus');

    const eliteBlockedOnElite = await driverEligibilityService.isDriverEligibleForRide(ids.eliteBlocked, 'elite');
    assert(!eliteBlockedOnElite.eligible && eliteBlockedOnElite.code === 'ELITE_RATING_BLOCKED', 'Elite bloqueado por nota deveria falhar em Elite');

    for (let i = 0; i < 10; i += 1) {
        await driverEligibilityService.recordEliteRecoveryRide(ids.eliteBlocked, 'plus', 5);
    }

    const eliteRecoveredOnElite = await driverEligibilityService.isDriverEligibleForRide(ids.eliteBlocked, 'elite');
    assert(eliteRecoveredOnElite.eligible, 'Elite deveria liberar após 10 corridas Plus bem avaliadas');

    console.log('✅ Regras de elegibilidade validadas com sucesso');
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Falha no teste de elegibilidade:', error.message);
        process.exit(1);
    });
