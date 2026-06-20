'use strict';

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
    const driverVehicle = driverData?.driver?.vehicle || {};
    const payloadVehicle = driverData?.vehicle || {};

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
                driverVehicle?.make,
                driverVehicle?.brand,
                payloadVehicle?.make,
                payloadVehicle?.brand,
                eligibilityProfile?.vehicleMake,
                redisProfile?.vehicleMake,
                redisProfile?.make,
                redisProfile?.carMake
            ),
            model: firstText(
                driverVehicle?.model,
                payloadVehicle?.model,
                driverVehicle?.type,
                payloadVehicle?.type,
                driverData?.carType,
                eligibilityProfile?.vehicleModel,
                eligibilityProfile?.carType,
                redisProfile?.vehicleModel,
                redisProfile?.model,
                redisProfile?.carModel,
                redisProfile?.carType,
                redisProfile?.vehicleType,
                redisProfile?.vehicleCategory,
                socket?.vehicleModel
            ),
            plate: firstText(
                driverVehicle?.plate,
                payloadVehicle?.plate,
                driverData?.vehiclePlate,
                driverData?.carPlate,
                eligibilityProfile?.vehiclePlate,
                redisProfile?.vehiclePlate,
                redisProfile?.vehicleNumber,
                redisProfile?.carPlate,
                socket?.vehiclePlate
            ),
            color: firstText(
                driverVehicle?.color,
                payloadVehicle?.color,
                driverData?.vehicleColor,
                driverData?.carColor,
                eligibilityProfile?.vehicleColor,
                redisProfile?.vehicleColor,
                redisProfile?.color,
                redisProfile?.carColor
            ),
            category: firstText(
                driverVehicle?.category,
                payloadVehicle?.category,
                eligibilityProfile?.carType,
                eligibilityProfile?.vehicleCategory,
                redisProfile?.carType,
                redisProfile?.vehicleCategory
            )
        }
    };
}

module.exports = { resolveAcceptedDriverIdentity };
