import Logger from '../utils/Logger';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';


export default function AppCommon({ children }) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [authState, setAuthState] = useState({ profile: null });

    useEffect(() => {
        const initializeAuth = async () => {
            try {
                Logger.log('AppCommon - Iniciando renderização');
                
                // Carregar dados do AsyncStorage
                const userData = await AsyncStorage.getItem('@user_data');
                const uid = await AsyncStorage.getItem('@auth_uid');

                Logger.log('AppCommon - Estado de autenticação:', {
                    hasUserData: !!userData,
                    hasUid: !!uid,
                    loading: isLoading
                });

                if (userData) {
                    const profile = JSON.parse(userData);
                    setAuthState({ profile });
                    setIsLoading(false);
                } else {
                    setError({ 
                        flag: true, 
                        msg: !uid ? 'UID não encontrado' : 'Dados do usuário não encontrados' 
                    });
                    setIsLoading(false);
                }
            } catch (error) {
                Logger.error('AppCommon - Erro ao inicializar:', error);
                setError({ 
                    flag: true, 
                    msg: error.message || 'Erro ao inicializar autenticação' 
                });
                setIsLoading(false);
            }
        };

        initializeAuth();
    }, []);

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#0000ff" />
            </View>
        );
    }

    if (error && error.flag) {
        Logger.log('AppCommon - Erro de autenticação:', error.msg);
        return children;
    }

    Logger.log('AppCommon - Renderizando children');
    return children;
} 