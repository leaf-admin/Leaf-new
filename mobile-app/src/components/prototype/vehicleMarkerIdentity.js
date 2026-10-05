function colorFrom(record) {
  return [record?.vehicle?.color, record?.vehicleColor, record?.carColor, record?.color, record?.driver?.vehicle?.color];
}

// Ride identity takes precedence while a trip is active. Away from a trip, the
// driver's canonical active vehicle takes precedence over legacy profile data.
export function resolveRegisteredVehicleColor({
  role = 'customer', operationalDriverInfo, activeBooking, driverActiveRide,
  driverTripMeta, driverInfo, driverActivationRemote, profile, routeParams,
} = {}) {
  const rideRecords = [driverActiveRide, activeBooking].filter(record => record &&
    !['completed', 'cancelled', 'canceled', 'failed'].includes(String(record.status || record.bookingStatus || '').toLowerCase()));
  const records = role === 'driver'
    ? [...rideRecords, ...(rideRecords.length ? [driverTripMeta] : []),
        { vehicle: driverActivationRemote?.vehicle },
        { vehicle: profile?.activeVehicle }, profile, { vehicle: profile?.car }, routeParams, driverTripMeta]
    : [operationalDriverInfo, activeBooking, driverInfo, driverActiveRide, routeParams];
  return records.flatMap(colorFrom).map(value => String(value || '').trim())
    .find(value => value && !['—', '-', '--', 'n/a', 'unknown'].includes(value.toLowerCase())) || '';
}
