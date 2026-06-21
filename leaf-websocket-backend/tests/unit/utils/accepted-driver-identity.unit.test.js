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
                vehicleColor: 'Branco',
                vehicleIdentitySource: 'crlv_pdf_ocr',
                vehicleIdentityCanonical: true
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
                vehiclePlate: 'TES8888',
                vehicleIdentitySource: 'crlv_pdf_ocr',
                vehicleIdentityCanonical: true
            }
        });

        expect(identity.name).toBe('Motorista Leaf');
        expect(identity.vehicle.model).toBe('');
        expect(identity.vehicle.plate).toBe('TES8888');
        expect(identity.vehicle.make).toBe('');
        expect(identity.vehicle.color).toBe('');
    });

    it('does not let socket payload override the canonical vehicle identity', () => {
        const identity = resolveAcceptedDriverIdentity({
            driverData: {
                vehicle: {
                    make: 'Payload Make',
                    model: 'Payload Model',
                    plate: 'FAK0000',
                    color: 'Payload Color',
                    category: 'Payload Category'
                }
            },
            eligibilityProfile: {
                carType: 'Leaf Plus',
                vehiclePlate: 'CAN1234',
                vehicleMake: 'Toyota',
                vehicleModel: 'Prius',
                vehicleColor: 'Preto',
                vehicleIdentitySource: 'crlv_pdf_ocr',
                vehicleIdentityCanonical: true
            }
        });

        expect(identity.vehicle).toEqual({
            make: 'Toyota',
            model: 'Prius',
            plate: 'CAN1234',
            color: 'Preto',
            category: 'Leaf Plus'
        });
    });

    it('does not use payload-only vehicle identity when canonical data is unavailable', () => {
        const identity = resolveAcceptedDriverIdentity({
            driverData: {
                vehicle: {
                    make: 'Payload Make',
                    model: 'Payload Model',
                    plate: 'FAK0000',
                    color: 'Payload Color'
                }
            }
        });

        expect(identity.vehicle).toEqual({
            make: '',
            model: '',
            plate: '',
            color: '',
            category: ''
        });
    });
});
