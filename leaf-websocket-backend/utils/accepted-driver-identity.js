'use strict';

const { CANONICAL_IDENTITY_SOURCES } = require('./driver-vehicle-identity');

function firstText(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }
    return '';
}

function resolveAcceptedDriverIdentity({
    driverData = {},
    redisProfile = {},
    eligibilityProfile = {},
    socket = {}
} = {}) {
    const canonicalProfile = (profile) => {
        const source = String(profile?.vehicleIdentitySource || '').trim().toLowerCase();
        const canonical = profile?.vehicleIdentityCanonical === true ||
            profile?.vehicleIdentityCanonical === 'true' ||
            CANONICAL_IDENTITY_SOURCES.has(source);
        return canonical ? profile : {};
    };
    const eligibilityVehicle = canonicalProfile(eligibilityProfile);
    const cachedVehicle = canonicalProfile(redisProfile);

    return {
        name: firstText(
            driverData?.driver?.name,
            driverData?.driverName,
            redisProfile?.name,
            redisProfile?.driverName,
            redisProfile?.displayName,
            socket?.driverName,
            'Motorista Leaf'
        ),
        vehicle: {
            make: firstText(
                eligibilityVehicle?.vehicleMake,
                cachedVehicle?.vehicleMake,
                cachedVehicle?.make,
                cachedVehicle?.carMake
            ),
            model: firstText(
                eligibilityVehicle?.vehicleModel,
                cachedVehicle?.vehicleModel,
                cachedVehicle?.model,
                cachedVehicle?.carModel
            ),
            plate: firstText(
                eligibilityVehicle?.vehiclePlate,
                cachedVehicle?.vehiclePlate,
                cachedVehicle?.vehicleNumber,
                cachedVehicle?.carPlate
            ),
            color: firstText(
                eligibilityVehicle?.vehicleColor,
                cachedVehicle?.vehicleColor,
                cachedVehicle?.color,
                cachedVehicle?.carColor
            ),
            category: firstText(
                eligibilityProfile?.carType,
                eligibilityProfile?.vehicleCategory,
                redisProfile?.carType,
                redisProfile?.vehicleCategory
            )
        }
    };
}

module.exports = { resolveAcceptedDriverIdentity };
