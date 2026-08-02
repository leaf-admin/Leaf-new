const fs = require('fs');
const path = require('path');

describe('vehicle sharing policy boundaries', () => {
  it('keeps account API registration and selection profile-scoped', () => {
    const accountRoutesSource = fs.readFileSync(
      path.join(__dirname, '../../../routes/account-routes.js'),
      'utf8'
    );
    const registerStart = accountRoutesSource.indexOf("router.post('/api/account/vehicles'");
    const registerEnd = accountRoutesSource.indexOf("router.patch('/api/account/vehicles/:vehicleId/active'", registerStart);
    const selectionStart = registerEnd;
    const selectionEnd = accountRoutesSource.indexOf("router.delete('/api/account/vehicles/:vehicleId'", selectionStart);
    const registrationSource = accountRoutesSource.slice(registerStart, registerEnd);
    const selectionSource = accountRoutesSource.slice(selectionStart, selectionEnd);

    expect(registerStart).toBeGreaterThan(-1);
    expect(selectionStart).toBeGreaterThan(-1);
    expect(registrationSource).toContain('requireFirebase, requireDriverAccount, requireDriverOffline');
    expect(registrationSource).toContain('readUserVehicles(userId)');
    expect(registrationSource).toContain('user_vehicles/${userId}/${userVehicleId}');
    expect(registrationSource).not.toContain('vehicle_active_assignment');
    expect(selectionSource).toContain('requireFirebase, requireDriverAccount, requireDriverOffline');
    expect(selectionSource).toContain('readUserVehicles(userId)');
    expect(selectionSource).toContain('user_vehicles/${userId}/${link.userVehicleId}/isActive');
    expect(selectionSource).not.toContain('vehicle_active_assignment');
  });

  it('keeps dashboard activation profile-scoped and online exclusivity in Redis', () => {
    const dashboardSource = fs.readFileSync(
      path.join(__dirname, '../../../routes/dashboard.js'),
      'utf8'
    );
    const driverControlSource = fs.readFileSync(
      path.join(__dirname, '../../../bootstrap/register-socket-driver-control-handlers.js'),
      'utf8'
    );
    const vehicleConfigStart = dashboardSource.indexOf("router.post('/api/drivers/:driverId/vehicle/config'");
    const vehicleConfigEnd = dashboardSource.indexOf('// 🚗 Aprovar Aplicação de Motorista', vehicleConfigStart);
    const vehicleConfigSource = dashboardSource.slice(vehicleConfigStart, vehicleConfigEnd);

    expect(vehicleConfigStart).toBeGreaterThan(-1);
    expect(vehicleConfigSource).not.toContain('vehicle_active_assignment');
    expect(vehicleConfigSource).not.toContain('VEHICLE_ALREADY_ACTIVE');
    expect(driverControlSource).toContain('vehicleLockManager.acquireLock(vehicleLockIdentifier, driverId, {');
    expect(driverControlSource).toContain('leaseToken: pendingVehicleLeaseToken');
    expect(driverControlSource).toContain("'VEHICLE_ALREADY_ONLINE'");
    expect(driverControlSource).toContain('vehicleLockManager.releaseLock(currentVehicleLockIdentifier, driverId, {');
  });
});
