import Logger from '../utils/Logger';
// useTestUser.js
// Hook personalizado para gerenciar usuário de teste

import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import TestUserService from '../services/TestUserService';


export const useTestUser = () => {
    const [isTestUser, setIsTestUser] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const auth = useSelector(state => state.auth);

    useEffect(() => {
        checkTestUserStatus();
    }, []);

    const checkTestUserStatus = async () => {
        try {
            const testStatus = await TestUserService.isTestUser();
            setIsTestUser(testStatus);
        } catch (error) {
            Logger.error('Erro ao verificar status do usuário de teste:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const activateTestUser = async () => {
        try {
            setIsLoading(true);
            const success = await TestUserService.simulateTestUserAuth();
            if (success) {
                setIsTestUser(true);
            }
            return success;
        } catch (error) {
            Logger.error('Erro ao ativar usuário de teste:', error);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const deactivateTestUser = async () => {
        try {
            setIsLoading(true);
            const success = await TestUserService.clearTestUserData();
            if (success) {
                setIsTestUser(false);
            }
            return success;
        } catch (error) {
            Logger.error('Erro ao desativar usuário de teste:', error);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const setAsDriver = async () => {
        try {
            setIsLoading(true);
            const success = await TestUserService.setTestUserAsDriver();
            return success;
        } catch (error) {
            Logger.error('Erro ao configurar como driver:', error);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const setAsPassenger = async () => {
        try {
            setIsLoading(true);
            const success = await TestUserService.setTestUserAsPassenger();
            return success;
        } catch (error) {
            Logger.error('Erro ao configurar como passageiro:', error);
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const getDebugInfo = async () => {
        try {
            return await TestUserService.getDebugInfo();
        } catch (error) {
            Logger.error('Erro ao obter informações de debug:', error);
            return null;
        }
    };

    return {
        isTestUser,
        isLoading,
        auth,
        activateTestUser,
        deactivateTestUser,
        setAsDriver,
        setAsPassenger,
        getDebugInfo,
        checkTestUserStatus
    };
};

export default useTestUser;


