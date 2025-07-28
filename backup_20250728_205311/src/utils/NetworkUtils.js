import { Platform } from 'react-native';

// Função para obter o IP da máquina local
export const getLocalIP = async () => {
  try {
    // Para desenvolvimento, tentar descobrir o IP automaticamente
    if (__DEV__) {
      // Em React Native, não podemos usar APIs nativas do Node.js
      // Então vamos usar uma abordagem diferente
      
      if (Platform.OS === 'android') {
        // Para Android, verificar se está no emulador
        // Se estiver no emulador, usar 10.0.2.2
        // Se estiver em dispositivo físico, precisamos do IP da máquina
        return '10.0.2.2'; // Emulador Android
      } else if (Platform.OS === 'ios') {
        // Para iOS, usar localhost se estiver no simulador
        return 'localhost'; // Simulador iOS
      }
    }
    
    // Fallback para produção ou quando não conseguimos detectar
    return '192.168.1.100'; // IP padrão - ALTERE PARA SEU IP
  } catch (error) {
    console.error('Erro ao obter IP local:', error);
    return '192.168.1.100'; // IP padrão - ALTERE PARA SEU IP
  }
};

// Função para verificar se um IP é válido
export const isValidIP = (ip) => {
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(ip);
};

// Função para testar conectividade com um servidor
export const testServerConnection = async (url, timeout = 5000) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    console.error('Erro ao testar conexão:', error);
    return false;
  }
};

// Função para obter IPs comuns da rede local
export const getCommonLocalIPs = () => {
  const baseIPs = [
    '192.168.1.100',
    '192.168.1.101',
    '192.168.1.102',
    '192.168.0.100',
    '192.168.0.101',
    '192.168.0.102',
    '10.0.0.100',
    '10.0.0.101',
    '10.0.0.102',
  ];

  return baseIPs;
};

// Função para descobrir IP automaticamente testando conexões
export const discoverLocalIP = async (port = 3001) => {
  const commonIPs = getCommonLocalIPs();
  
  for (const ip of commonIPs) {
    const url = `http://${ip}:${port}`;
    console.log(`Testando conexão com: ${url}`);
    
    const isConnected = await testServerConnection(url, 2000);
    if (isConnected) {
      console.log(`✅ IP descoberto: ${ip}`);
      return ip;
    }
  }
  
  console.log('❌ Nenhum IP válido encontrado');
  return null;
};

// Função para obter informações de rede
export const getNetworkInfo = () => {
  return {
    platform: Platform.OS,
    isDev: __DEV__,
    isEmulator: Platform.OS === 'android' ? true : false, // Simplificado
    commonIPs: getCommonLocalIPs(),
  };
};

export default {
  getLocalIP,
  isValidIP,
  testServerConnection,
  getCommonLocalIPs,
  discoverLocalIP,
  getNetworkInfo,
}; 