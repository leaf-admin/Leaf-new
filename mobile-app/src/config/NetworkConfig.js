import Logger from '../utils/Logger';
// NetworkConfig.js
// Configuração centralizada de rede para desenvolvimento

import { Platform } from 'react-native';


// Configurações de rede
const NETWORK_CONFIG = {
    // IP do servidor (VPS)
    LOCAL_IP: 'api.leaf.app.br', // VPS - API

    // Portas dos serviços
    PORTS: {
        WEBSOCKET: 3001,
        API: 3001,
        NOTIFICATIONS: 3001
    },

    // URLs de desenvolvimento (VPS)
    DEV_URLS: {
        WEBSOCKET: `https://api.leaf.app.br`, // VPS - WebSocket (mesmo domínio da API)
        API: `https://api.leaf.app.br`,
        NOTIFICATIONS: `https://api.leaf.app.br`
    },

    // URLs de produção (VPS - IP DIRETO)
    PROD_URLS: {
        WEBSOCKET: process.env.EXPO_PUBLIC_WS_URL || 'https://api.leaf.app.br',
        API: process.env.EXPO_PUBLIC_API_URL || 'https://api.leaf.app.br',
        NOTIFICATIONS: process.env.EXPO_PUBLIC_API_URL || 'https://api.leaf.app.br'
    }
};

// Função para obter URL baseada no ambiente
export const getWebSocketURL = () => {
    return process.env.EXPO_PUBLIC_WS_URL || NETWORK_CONFIG.PROD_URLS.WEBSOCKET;
};

export const getApiURL = () => {
    // ✅ SEMPRE usar VPS
    return NETWORK_CONFIG.PROD_URLS.API; // https://api.leaf.app.br
};

export const getNotificationsURL = () => {
    // ✅ SEMPRE usar VPS
    return NETWORK_CONFIG.PROD_URLS.NOTIFICATIONS; // https://api.leaf.app.br
};

// Função para obter IP local automaticamente (futuro)
export const getLocalIP = async () => {
    try {
        // TODO: Implementar detecção automática de IP
        return NETWORK_CONFIG.LOCAL_IP;
    } catch (error) {
        Logger.error('Erro ao obter IP local:', error);
        return NETWORK_CONFIG.LOCAL_IP;
    }
};

// Função para validar configuração
export const validateNetworkConfig = () => {
    const issues = [];

    if (__DEV__) {
        if (NETWORK_CONFIG.LOCAL_IP === 'localhost' || NETWORK_CONFIG.LOCAL_IP === '127.0.0.1') {
            Logger.log('✅ Configurado para servidor local: localhost');
        }
    }

    return {
        isValid: issues.length === 0,
        issues,
        config: NETWORK_CONFIG
    };
};

export default NETWORK_CONFIG;

// Instruções para configurar o IP:
/*
Para desenvolvimento local:
- Use 'localhost' ou '127.0.0.1' para emuladores/simuladores
- Para dispositivos físicos, use o IP da sua máquina na rede local

1. No Windows, abra o CMD e digite: ipconfig
2. No Linux/Mac, abra o terminal e digite: ifconfig ou ip addr
3. Procure por "IPv4 Address" na sua rede Wi-Fi
4. Copie o IP (exemplo: 192.168.1.100)
5. Substitua no arquivo acima na linha: LOCAL_IP: '192.168.1.100'

IMPORTANTE:
- Para emuladores/simuladores: use 'localhost' ou '127.0.0.1'
- Para dispositivos físicos: use o IP da sua máquina na rede local
- Certifique-se que o backend está rodando na porta 3001
- Ambos (PC e dispositivo) devem estar na mesma rede Wi-Fi
*/


