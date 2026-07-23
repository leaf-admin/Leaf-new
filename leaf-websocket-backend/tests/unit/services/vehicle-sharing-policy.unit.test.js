const fs = require('fs');
const path = require('path');

describe('vehicle sharing policy boundaries', () => {
  it('keeps registration and selection profile-scoped', () => {
    const mobileSource = fs.readFileSync(
      path.join(__dirname, '../../../../mobile-app/src/services/VehicleService.js'),
      'utf8'
    );
    const registerStart = mobileSource.indexOf('async registerVehicleForUser');
    const registerEnd = mobileSource.indexOf('async createVehicle', registerStart);
    const selectionStart = mobileSource.indexOf('async setActiveVehicle');
    const selectionEnd = mobileSource.indexOf('async setElitePlusPreference', selectionStart);
    const registrationSource = mobileSource.slice(registerStart, registerEnd);
    const selectionSource = mobileSource.slice(selectionStart, selectionEnd);

    expect(registerStart).toBeGreaterThan(-1);
    expect(selectionStart).toBeGreaterThan(-1);
    expect(registrationSource).not.toContain('getActiveUserVehicleByVehicle');
    expect(registrationSource).not.toContain('Veículo já está ativo com motorista');
    expect(selectionSource).not.toContain('VEHICLE_ACTIVE_ASSIGNMENT_PATH');
    expect(selectionSource).not.toContain('activeDriverId');
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
