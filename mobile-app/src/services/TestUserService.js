import Logger from '../utils/Logger';
// TestUserService.js
// Serviço para gerenciar usuários de teste em desenvolvimento

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { store } from '../common-local/store';
import { FETCH_USER_SUCCESS } from '../common-local/types';


class TestUserService {
  constructor() {
        this.testUserId = 'test-user-dev';
        this.testUserData = {
            uid: this.testUserId,
            phone: '+5511999999999',
            usertype: 'driver', // ou 'passenger'
            name: 'Usuário de Teste',
            email: 'test@leafapp.com',
            isTestUser: true,
        createdAt: new Date().toISOString(),
            platform: Platform.OS
        };
    }

    // Verificar se estamos em modo de teste
    // SEMPRE permite usuários de teste (mesmo em produção)
    isTestMode() {
        return true; // Permite usuários de teste em produção
    }

    // Obter dados do usuário de teste
    getTestUserData() {
        return this.testUserData;
    }

    // Simular autenticação de usuário de teste
    async simulateTestUserAuth() {
        try {
            if (!this.isTestMode()) {
                Logger.log('⚠️ Modo de teste apenas disponível em desenvolvimento');
                return false;
            }

            Logger.log('🧪 Simulando autenticação de usuário de teste...');

            // Salvar dados do usuário de teste no AsyncStorage
            await AsyncStorage.setItem('@user_data', JSON.stringify(this.testUserData));
            await AsyncStorage.setItem('@auth_uid', this.testUserId);
            await AsyncStorage.setItem('@test_mode', 'true');

            // ✅ NÃO fazer dispatch aqui - deixar o componente fazer via useDispatch
            Logger.log('ℹ️ Redux store será atualizado pelo componente que usa useDispatch');

            Logger.log('✅ Usuário de teste autenticado:', this.testUserData);
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao simular usuário de teste:', error);
            return false;
        }
    }

    // Limpar dados de teste
    async clearTestUserData() {
        try {
            if (!this.isTestMode()) {
                return false;
            }

            Logger.log('🧹 Limpando dados de usuário de teste...');

            await AsyncStorage.removeItem('@user_data');
            await AsyncStorage.removeItem('@auth_uid');
            await AsyncStorage.removeItem('@test_mode');

            // ✅ NÃO fazer dispatch aqui - deixar o componente fazer via useDispatch
            Logger.log('ℹ️ Redux store será limpo pelo componente que usa useDispatch');

            Logger.log('✅ Dados de teste removidos');
            Logger.log('✅ Redux store limpo');
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao limpar dados de teste:', error);
            return false;
        }
    }

    // Verificar se é usuário de teste
    async isTestUser() {
        try {
            const testMode = await AsyncStorage.getItem('@test_mode');
            return testMode === 'true';
        } catch (error) {
            Logger.error('❌ Erro ao verificar modo de teste:', error);
            return false;
        }
    }

    // Criar usuário de teste completo (método que estava faltando)
    async createTestUser(userData = null) {
        try {
            if (!this.isTestMode()) {
                Logger.log('⚠️ Modo de teste apenas disponível em desenvolvimento');
                return false;
            }

            Logger.log('🧪 Criando usuário de teste completo...');
            Logger.log('📊 Dados recebidos:', userData);

            // Usar dados fornecidos ou dados padrão
            const finalUserData = userData ? {
                ...this.testUserData,
                uid: userData.uid || 'test-user-dev-' + Date.now(),
                phone: userData.phoneNumber || userData.phone || this.testUserData.phone,
                usertype: userData.usertype || userData.userType || 'driver', // ✅ Aceitar ambos
                userType: userData.userType || userData.usertype || 'driver', // ✅ Compatibilidade
                name: userData.name || 'Usuário de Teste',
                email: userData.email || 'test@leafapp.com',
                isTestUser: true,
                isTestCustomer: userData.isTestCustomer || false,
                approved: true,
                walletBalance: 1000,
                rating: 4.8,
                carType: userData.usertype === 'customer' || userData.userType === 'customer' ? null : 'standard',
                carModel: userData.usertype === 'customer' || userData.userType === 'customer' ? null : 'Test Car',
                carPlate: userData.usertype === 'customer' || userData.userType === 'customer' ? null : 'TEST1234',
                createdAt: new Date().toISOString(),
                platform: Platform.OS,
                // Permissões para bypass de database
                permissions: {
                    canAccessDatabase: true,
                    canReadAll: true,
                    canWriteAll: true,
                    bypassSecurity: true,
                    bypassPayment: userData.isTestCustomer || false,
                    bypassKYC: userData.isTestCustomer || false
                }
            } : {
                ...this.testUserData,
                uid: 'test-user-dev-' + Date.now(),
                phone: this.testUserData.phone,
                usertype: 'driver',
                name: 'Usuário de Teste',
                email: 'test@leafapp.com',
                isTestUser: true,
                approved: true,
                walletBalance: 1000,
                rating: 4.8,
                carType: 'standard',
                carModel: 'Test Car',
                carPlate: 'TEST1234',
                createdAt: new Date().toISOString(),
                platform: Platform.OS,
                // Permissões para bypass de database
                permissions: {
                    canAccessDatabase: true,
                    canReadAll: true,
                    canWriteAll: true,
                    bypassSecurity: true
                }
            };

            // Validar dados antes de salvar
            if (!finalUserData.uid) {
                Logger.error('❌ UID não pode ser undefined!');
                return false;
            }

            Logger.log('💾 Salvando dados do usuário:', finalUserData);

            // Preparar dados no formato esperado pelo Redux (com profile)
            const userDataForRedux = {
                ...finalUserData,
                profile: {
                    ...finalUserData,
                    usertype: finalUserData.usertype || finalUserData.userType, // ✅ Garantir que está correto
                    userType: finalUserData.userType || finalUserData.usertype  // ✅ Compatibilidade
                }
            };

            // Salvar dados do usuário de teste no AsyncStorage
            await AsyncStorage.setItem('@user_data', JSON.stringify(userDataForRedux));
            await AsyncStorage.setItem('@auth_uid', finalUserData.uid);
            await AsyncStorage.setItem('@test_mode', 'true');

            // ✅ NÃO fazer dispatch aqui - deixar o componente fazer via useDispatch
            Logger.log('ℹ️ Redux store será atualizado pelo componente que usa useDispatch');

            Logger.log('✅ Usuário de teste criado:', finalUserData);
            Logger.log('✅ Redux store atualizado com dados do usuário de teste');
            return finalUserData;

        } catch (error) {
            Logger.error('❌ Erro ao criar usuário de teste:', error);
            return false;
        }
    }

    // Obter ID do usuário (real ou teste)
    async getUserId() {
        try {
            const isTest = await this.isTestUser();
            if (isTest) {
                return this.testUserId;
            }

            // Tentar obter UID real do AsyncStorage
            const uid = await AsyncStorage.getItem('@auth_uid');
            return uid || 'anonymous';

    } catch (error) {
            Logger.error('❌ Erro ao obter ID do usuário:', error);
            return 'anonymous';
        }
    }

    // Obter dados do usuário (reais ou teste)
    async getUserData() {
        try {
            const isTest = await this.isTestUser();
            if (isTest) {
                return this.testUserData;
            }

            // Tentar obter dados reais do AsyncStorage
            const userData = await AsyncStorage.getItem('@user_data');
            return userData ? JSON.parse(userData) : null;

        } catch (error) {
            Logger.error('❌ Erro ao obter dados do usuário:', error);
            return null;
        }
    }

    // Configurar usuário de teste como driver
    async setTestUserAsDriver() {
        try {
            this.testUserData.usertype = 'driver';
            this.testUserData.name = 'Driver de Teste';
            await this.simulateTestUserAuth();
            Logger.log('🚗 Usuário de teste configurado como driver');
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao configurar como driver:', error);
            return false;
        }
    }

    // Configurar usuário de teste como passageiro/customer
    async setTestUserAsPassenger() {
        try {
            this.testUserData.usertype = 'customer'; // ✅ Corrigido para 'customer'
            this.testUserData.userType = 'customer'; // ✅ Compatibilidade
            this.testUserData.name = 'Customer de Teste';
            await this.simulateTestUserAuth();
            Logger.log('👤 Usuário de teste configurado como customer');
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao configurar como customer:', error);
            return false;
        }
    }

    // Criar usuário de teste específico para customer/passageiro
    async createTestCustomer(phoneNumber = '11999999999') {
        try {
            if (!this.isTestMode()) {
                Logger.log('⚠️ Modo de teste apenas disponível em desenvolvimento');
                return false;
            }

            Logger.log('🧪 Criando usuário de teste CUSTOMER/PASSAGEIRO...');

            const customerData = {
                uid: 'test-customer-dev-' + Date.now(),
                phone: `+55${phoneNumber}`,
                phoneNumber: `+55${phoneNumber}`,
                usertype: 'customer', // ✅ Corrigido para 'customer'
                userType: 'customer', // ✅ Compatibilidade
                name: 'Customer de Teste',
                firstName: 'Customer',
                lastName: 'de Teste',
                email: 'customer@leafapp.com',
                isTestUser: true,
                isTestCustomer: true,
                approved: true, // Customer sempre aprovado
                walletBalance: 500, // Saldo inicial para testes
                rating: 4.9, // Rating do customer
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                platform: Platform.OS,
                // Dados específicos de customer
                customerData: {
                    preferredPaymentMethod: 'credit_card',
                    hasValidPayment: true,
                    totalRides: 0,
                    totalSpent: 0,
                    favoriteLocations: [],
                    emergencyContact: {
                        name: 'Contato de Emergência',
                        phone: '+5511999999998'
                    }
                },
                // Permissões para bypass de database
                permissions: {
                    canAccessDatabase: true,
                    canReadAll: true,
                    canWriteAll: true,
                    bypassSecurity: true,
                    bypassPayment: true, // Bypass para pagamentos
                    bypassKYC: true    // Bypass para KYC
                }
            };

            Logger.log('💾 Salvando dados do customer:', customerData);

            // Preparar dados no formato esperado pelo Redux (com profile)
            const customerDataForRedux = {
                ...customerData,
                profile: {
                    ...customerData,
                    usertype: 'customer', // ✅ Garantir que está correto
                    userType: 'customer'  // ✅ Compatibilidade
                }
            };

            // Salvar dados do customer de teste no AsyncStorage
            await AsyncStorage.setItem('@user_data', JSON.stringify(customerDataForRedux));
            await AsyncStorage.setItem('@auth_uid', customerData.uid);
            await AsyncStorage.setItem('@test_mode', 'true');
            await AsyncStorage.setItem('@test_customer', 'true');

            // ✅ NÃO fazer dispatch aqui - deixar o componente fazer via useDispatch
            // Isso evita problemas com hooks sendo chamados durante atualização do store
            Logger.log('✅ Customer de teste criado:', customerDataForRedux);
            Logger.log('ℹ️ Redux store será atualizado pelo componente que usa useDispatch');
            return customerDataForRedux;

        } catch (error) {
            Logger.error('❌ Erro ao criar customer de teste:', error);
            return false;
        }
    }

    // Verificar se é customer de teste
    async isTestCustomer() {
        try {
            const isTestCustomer = await AsyncStorage.getItem('@test_customer');
            return isTestCustomer === 'true';
        } catch (error) {
            Logger.error('❌ Erro ao verificar customer de teste:', error);
            return false;
        }
    }

    // Obter informações de debug
    async getDebugInfo() {
        try {
            const isTest = await this.isTestUser();
            const userId = await this.getUserId();
            const userData = await this.getUserData();

            return {
                isTestMode: this.isTestMode(),
                isTestUser: isTest,
                userId,
                userData,
                testUserData: this.testUserData
            };
    } catch (error) {
            Logger.error('❌ Erro ao obter informações de debug:', error);
            return null;
        }
    }

    // Logar informações de debug
    async logDebugInfo() {
        try {
            const debugInfo = await this.getDebugInfo();
            Logger.log('🔍 DEBUG - Informações do usuário:');
            Logger.log('  Modo de teste:', debugInfo.isTestMode);
            Logger.log('  É usuário de teste:', debugInfo.isTestUser);
            Logger.log('  ID do usuário:', debugInfo.userId);
            Logger.log('  Dados do usuário:', debugInfo.userData);
            
            if (debugInfo.isTestUser) {
                Logger.log('  Dados de teste:', debugInfo.testUserData);
            }
        } catch (error) {
            Logger.error('❌ Erro ao logar informações de debug:', error);
        }
    }
}

// Exportar instância singleton
export default new TestUserService();