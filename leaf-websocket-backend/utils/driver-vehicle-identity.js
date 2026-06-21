'use strict';

const CANONICAL_IDENTITY_SOURCES = new Set([
    'crlv_pdf_ocr',
    'qa_crlv_fixture',
    'vehicles_catalog',
    'user_vehicles'
]);

function firstText(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }
    return '';
}

function resolveVehicleIdentitySource({ vehicle = {}, activeUserVehicle = {}, user = {} } = {}) {
    const ocrSource = firstText(
        vehicle?.ocrData?.source,
        activeUserVehicle?.ocrData?.source
    ).toLowerCase();
    if (ocrSource === 'crlv_pdf_ocr' || ocrSource === 'qa_crlv_fixture') {
        return ocrSource;
    }

    const vehicleHasIdentity = Boolean(
        firstText(vehicle?.plate, vehicle?.vehiclePlate, vehicle?.vehicleNumber) ||
        firstText(vehicle?.model, vehicle?.vehicleModel, vehicle?.carModel) ||
        firstText(vehicle?.color, vehicle?.vehicleColor, vehicle?.carColor)
    );
    if (vehicleHasIdentity) {
        return 'vehicles_catalog';
    }

    const userVehicleHasIdentity = Boolean(
        firstText(activeUserVehicle?.plate, activeUserVehicle?.vehiclePlate, activeUserVehicle?.vehicleNumber) ||
        firstText(activeUserVehicle?.model, activeUserVehicle?.vehicleModel, activeUserVehicle?.carModel) ||
        firstText(activeUserVehicle?.color, activeUserVehicle?.vehicleColor, activeUserVehicle?.carColor)
    );
    if (userVehicleHasIdentity) {
        return 'user_vehicles';
    }

    const userHasLegacyIdentity = Boolean(
        firstText(user?.carPlate, user?.vehiclePlate, user?.vehicleNumber) ||
        firstText(user?.carModel, user?.vehicleModel) ||
        firstText(user?.carColor, user?.vehicleColor)
    );
    return userHasLegacyIdentity ? 'user_profile_legacy' : 'unavailable';
}

function buildDriverVehicleIdentity(profile = {}) {
    const source = firstText(profile.vehicleIdentitySource, 'unavailable').toLowerCase();
    const plate = firstText(profile.vehiclePlate, profile.plate);
    const make = firstText(profile.vehicleMake, profile.make);
    const model = firstText(profile.vehicleModel, profile.model);
    const color = firstText(profile.vehicleColor, profile.color, profile.carColor);
    const complete = Boolean(plate && model && color);
    const canonical = profile.vehicleIdentityCanonical === true ||
        profile.vehicleIdentityCanonical === 'true' ||
        CANONICAL_IDENTITY_SOURCES.has(source);

    return {
        activeVehicleId: firstText(profile.activeVehicleId) || null,
        plate: plate || null,
        make: make || null,
        model: model || null,
        color: color || null,
        source,
        canonical,
        complete
    };
}

module.exports = {
    CANONICAL_IDENTITY_SOURCES,
    buildDriverVehicleIdentity,
    resolveVehicleIdentitySource
};
