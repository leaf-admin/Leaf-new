// TestUserButton.js
// Botão rápido para ativar/desativar usuário de teste

import React from 'react';
import {
    TouchableOpacity,
    Text,
    StyleSheet,
    Alert
} from 'react-native';
import { useTestUser } from '../hooks/useTestUser';

const TestUserButton = ({ style, textStyle }) => {
    const { isTestUser, isLoading, activateTestUser, deactivateTestUser } = useTestUser();

    const handleToggle = async () => {
        try {
            if (isTestUser) {
                const success = await deactivateTestUser();
                if (success) {
                    Alert.alert('✅ Sucesso', 'Usuário de teste desativado');
                }
            } else {
                const success = await activateTestUser();
                if (success) {
                    Alert.alert('✅ Sucesso', 'Usuário de teste ativado');
                }
            }
        } catch (error) {
            Alert.alert('❌ Erro', 'Falha ao alterar modo de teste');
        }
    };

    // Só mostrar em desenvolvimento
    if (!__DEV__) {
        return null;
    }

    return (
        <TouchableOpacity
            style={[styles.button, style]}
            onPress={handleToggle}
            disabled={isLoading}
        >
            <Text style={[styles.buttonText, textStyle]}>
                {isLoading ? '⏳' : isTestUser ? '🧪 Teste ON' : '🧪 Teste OFF'}
            </Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        backgroundColor: '#FF6B6B',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        position: 'absolute',
        top: 50,
        right: 10,
        zIndex: 1000,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    buttonText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
});

export default TestUserButton;


