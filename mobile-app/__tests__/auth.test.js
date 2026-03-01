import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import ProfileToggle from '../src/components/ProfileToggle';

// Mock dependencies
jest.mock('../src/services/ProfileToggleService', () => ({
    getCurrentMode: jest.fn().mockResolvedValue('passenger'),
    canSwitchToMode: jest.fn().mockResolvedValue(true),
    switchMode: jest.fn().mockResolvedValue({
        success: true,
        newMode: 'driver',
        profileData: {},
        message: 'Modo alterado para Motorista'
    }),
    getModeDisplayName: (mode) => (mode === 'passenger' ? 'Passageiro' : 'Motorista'),
    getModeIcon: () => 'person'
}));

const mockStore = configureStore([]);

describe('Integração: Fluxo de Alternância de Role (App Único)', () => {
    let store;

    beforeEach(() => {
        store = mockStore({
            auth: { profile: { id: 'test-user-123', usertype: 'passenger' } },
        });
    });

    it('deve renderizar o modo Passageiro inicialmente e permitir clique para Motorista', async () => {
        const { getByText, findByText } = render(
            <Provider store={store}>
                <ProfileToggle userId="test-user-123" />
            </Provider>
        );

        // O Mock inicial diz passenger, então o texto Passageiro deve aparecer
        const btn = await findByText('Passageiro');
        expect(btn).toBeTruthy();

        // Simula o clique
        fireEvent.press(btn);

        // Como o switchMode retorna Driver, ele deve atualizar na tela virtualmente
        const novoBtn = await findByText('Motorista');
        expect(novoBtn).toBeTruthy();
    });
});
