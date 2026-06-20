'use strict';

const { resolveAcceptedDriverIdentity } = require('../../../utils/accepted-driver-identity');

describe('accepted-driver-identity', () => {
    it('hydrates the accepted ride from the authoritative eligibility profile', () => {
        const identity = resolveAcceptedDriverIdentity({
            driverData: {},
            redisProfile: { name: 'Motorista Teste' },
            eligibilityProfile: {
                carType: 'Leaf Plus',
                vehiclePlate: 'TES8888',
                vehicleMake: 'Nissan',
                vehicleModel: 'Leaf',
                vehicleColor: 'Branco'
            }
        });

        expect(identity).toEqual({
            name: 'Motorista Teste',
            vehicle: {
                make: 'Nissan',
                model: 'Leaf',
                plate: 'TES8888',
                color: 'Branco',
                category: 'Leaf Plus'
            }
        });
    });

    it('uses the operational category without fabricating missing vehicle details', () => {
        const identity = resolveAcceptedDriverIdentity({
            eligibilityProfile: {
                carType: 'Leaf Plus',
                vehiclePlate: 'TES8888'
            }
        });

        expect(identity.name).toBe('Motorista Leaf');
        expect(identity.vehicle.model).toBe('Leaf Plus');
        expect(identity.vehicle.plate).toBe('TES8888');
        expect(identity.vehicle.make).toBe('');
        expect(identity.vehicle.color).toBe('');
    });
});
