import Logger from '../utils/Logger';
// TestUserManager.js
// Componente para gerenciar usuários de teste (driver e customer)

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ScrollView,
    Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TestUserService from '../services/TestUserService';
import PaymentBypassService from '../services/PaymentBypassService';

const TestUserManager = ({ visible, onClose }) => {
    const [isTestMode, setIsTestMode] = useState(false);
    const [isTestCustomer, setIsTestCustomer] = useState(false);
    const [debugInfo, setDebugInfo] = useState(null);

    useEffect(() => {
        if (visible) {
            loadDebugInfo();
        }
    }, [visible]);

    const loadDebugInfo = async () => {
        try {
            const testDebugInfo = await TestUserService.getDebugInfo();
            const isCustomer = await TestUserService.isTestCustomer();
            
            setDebugInfo(testDebugInfo);
            setIsTestMode(testDebugInfo?.isTestMode || false);
            setIsTestCustomer(isCustomer);
        } catch (error) {
            Logger.error('Erro ao carregar informações de debug:', error);
        }
    };

    const activateTestDriver = async () => {
        try {
            Alert.alert(
                'Ativar Driver de Teste',
                'Isso irá criar um usuário de teste como motorista. Continuar?',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Confirmar',
                        onPress: async () => {
                            const result = await TestUserService.createTestUser({
                                phoneNumber: '+5511999999999',
                                usertype: 'driver',
                                name: 'Driver de Teste'
                            });
                            
                            if (result) {
                                Alert.alert('Sucesso', 'Driver de teste ativado!');
                                loadDebugInfo();
                            } else {
                                Alert.alert('Erro', 'Falha ao ativar driver de teste');
                            }
                        }
                    }
                ]
            );
        } catch (error) {
            Alert.alert('Erro', 'Erro ao ativar driver de teste');
        }
    };

    const activateTestCustomer = async () => {
        try {
            Alert.alert(
                'Ativar Customer de Teste',
                'Isso irá criar um usuário de teste como passageiro. Continuar?',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Confirmar',
                        onPress: async () => {
                            const result = await TestUserService.createTestCustomer('11888888888');
                            
                            if (result) {
                                Alert.alert('Sucesso', 'Customer de teste ativado!');
                                loadDebugInfo();
                            } else {
                                Alert.alert('Erro', 'Falha ao ativar customer de teste');
                            }
                        }
                    }
                ]
            );
        } catch (error) {
            Alert.alert('Erro', 'Erro ao ativar customer de teste');
        }
    };

    const clearTestData = async () => {
        try {
            Alert.alert(
                'Limpar Dados de Teste',
                'Isso irá remover todos os dados de teste. Continuar?',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Confirmar',
                        onPress: async () => {
                            await TestUserService.clearTestUserData();
                            Alert.alert('Sucesso', 'Dados de teste removidos!');
                            loadDebugInfo();
                        }
                    }
                ]
            );
        } catch (error) {
            Alert.alert('Erro', 'Erro ao limpar dados de teste');
        }
    };

    const logDebugInfo = async () => {
        try {
            await TestUserService.logDebugInfo();
            await PaymentBypassService.logDebugInfo();
            Alert.alert('Debug', 'Informações de debug logadas no console');
        } catch (error) {
            Alert.alert('Erro', 'Erro ao logar informações de debug');
        }
    };

    if (!visible) return null;

    return (
        <View style={styles.overlay}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>Gerenciador de Usuários de Teste</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color="#333" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.content}>
                    {/* Status */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Status Atual</Text>
                        <View style={styles.statusRow}>
                            <Text style={styles.statusLabel}>Modo de Teste:</Text>
                            <Switch
                                value={isTestMode}
                                disabled={true}
                                trackColor={{ false: '#ccc', true: '#4CAF50' }}
                            />
                        </View>
                        <View style={styles.statusRow}>
                            <Text style={styles.statusLabel}>Customer de Teste:</Text>
                            <Switch
                                value={isTestCustomer}
                                disabled={true}
                                trackColor={{ false: '#ccc', true: '#2196F3' }}
                            />
                        </View>
                    </View>

                    {/* Ações */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Ações</Text>
                        
                        <TouchableOpacity
                            style={[styles.button, styles.driverButton]}
                            onPress={activateTestDriver}
                        >
                            <Ionicons name="car" size={20} color="#fff" />
                            <Text style={styles.buttonText}>Ativar Driver de Teste</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.customerButton]}
                            onPress={activateTestCustomer}
                        >
                            <Ionicons name="person" size={20} color="#fff" />
                            <Text style={styles.buttonText}>Ativar Customer de Teste</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.debugButton]}
                            onPress={logDebugInfo}
                        >
                            <Ionicons name="bug" size={20} color="#fff" />
                            <Text style={styles.buttonText}>Logar Debug Info</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.clearButton]}
                            onPress={clearTestData}
                        >
                            <Ionicons name="trash" size={20} color="#fff" />
                            <Text style={styles.buttonText}>Limpar Dados de Teste</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Informações */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Informações</Text>
                        <Text style={styles.infoText}>
                            • Driver de Teste: Use o número 11999999999
                        </Text>
                        <Text style={styles.infoText}>
                            • Customer de Teste: Use o número 11888888888
                        </Text>
                        <Text style={styles.infoText}>
                            • Todos os pagamentos serão simulados
                        </Text>
                        <Text style={styles.infoText}>
                            • Bypass de KYC e database ativado
                        </Text>
                    </View>

                    {/* Debug Info */}
                    {debugInfo && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Debug Info</Text>
                            <Text style={styles.debugText}>
                                Modo de Teste: {debugInfo.isTestMode ? 'Sim' : 'Não'}
                            </Text>
                            <Text style={styles.debugText}>
                                É Usuário de Teste: {debugInfo.isTestUser ? 'Sim' : 'Não'}
                            </Text>
                            <Text style={styles.debugText}>
                                ID do Usuário: {debugInfo.userId || 'N/A'}
                            </Text>
                            <Text style={styles.debugText}>
                                Tipo: {debugInfo.userData?.usertype || 'N/A'}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    container: {
        backgroundColor: '#fff',
        borderRadius: 12,
        width: '90%',
        maxHeight: '80%',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    closeButton: {
        padding: 4,
    },
    content: {
        padding: 16,
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 12,
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    statusLabel: {
        fontSize: 14,
        color: '#666',
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    driverButton: {
        backgroundColor: '#4CAF50',
    },
    customerButton: {
        backgroundColor: '#2196F3',
    },
    debugButton: {
        backgroundColor: '#FF9800',
    },
    clearButton: {
        backgroundColor: '#F44336',
    },
    buttonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
        marginLeft: 8,
    },
    infoText: {
        fontSize: 12,
        color: '#666',
        marginBottom: 4,
    },
    debugText: {
        fontSize: 11,
        color: '#888',
        marginBottom: 2,
        fontFamily: 'monospace',
    },
});

export default TestUserManager;