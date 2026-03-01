import Logger from '../utils/Logger';
/**
 * Serviço para monitorar disponibilidade de motoristas em tempo real
 * Atualiza automaticamente a lista de motoristas disponíveis na região
 */

import { fetchNearbyDrivers } from '../common-local/usersactions';


class DriverAvailabilityService {
    constructor() {
        this.subscribers = new Set();
        this.updateInterval = null;
        this.isRunning = false;
        this.currentLocation = null;
        this.radius = 10; // Raio padrão de 10km
        this.updateFrequency = 10000; // Atualizar a cada 10 segundos
        this.lastDrivers = [];
    }

    /**
     * Iniciar monitoramento de motoristas disponíveis
     * @param {Object} location - { lat, lng }
     * @param {number} radius - Raio em km (padrão: 10)
     * @param {number} frequency - Frequência de atualização em ms (padrão: 10000)
     */
    startMonitoring(location, radius = 10, frequency = 10000) {
        if (!location || !location.lat || !location.lng) {
            Logger.warn('⚠️ [DriverAvailabilityService] Localização inválida para monitoramento');
            return;
        }

        this.currentLocation = location;
        this.radius = radius;
        this.updateFrequency = frequency;

        if (this.isRunning) {
            Logger.log('🔄 [DriverAvailabilityService] Monitoramento já está rodando, reiniciando...');
            this.stopMonitoring();
        }

        Logger.log(`🚀 [DriverAvailabilityService] Iniciando monitoramento de motoristas disponíveis`);
        Logger.log(`   📍 Localização: ${location.lat}, ${location.lng}`);
        Logger.log(`   📏 Raio: ${radius}km`);
        Logger.log(`   ⏱️  Frequência: ${frequency / 1000}s`);

        this.isRunning = true;
        this.updateDrivers(); // Atualizar imediatamente
        this.updateInterval = setInterval(() => {
            this.updateDrivers();
        }, this.updateFrequency);
    }

    /**
     * Parar monitoramento
     */
    stopMonitoring() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.isRunning = false;
        Logger.log('🛑 [DriverAvailabilityService] Monitoramento parado');
    }

    /**
     * Atualizar lista de motoristas disponíveis
     */
    async updateDrivers() {
        if (!this.currentLocation || !this.isRunning) {
            return;
        }

        try {
            // Fazer fetch direto via API
            let drivers = [];
            
            try {
                const { getSelfHostedApiUrl } = require('../config/ApiConfig');
                const backendUrl = getSelfHostedApiUrl('/api/drivers/nearby');
                const response = await fetch(
                    `${backendUrl}?lat=${this.currentLocation.lat}&lng=${this.currentLocation.lng}&radius=${this.radius}&limit=50`,
                    {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    Logger.log(`📡 [DriverAvailabilityService] Resposta da API:`, {
                        status: response.status,
                        driversCount: data.drivers?.length || 0,
                        totalInRedis: data.debug?.totalDriversInRedis || 'N/A',
                        searchRadius: data.debug?.searchRadius || 'N/A'
                    });
                    
                    drivers = (data.drivers || []).map(driver => ({
                        id: driver.id,
                        location: {
                            lat: driver.location.lat,
                            lng: driver.location.lng
                        },
                        distance: driver.distance,
                        firstName: driver.firstName || '',
                        lastName: driver.lastName || '',
                        carType: driver.carType || null,
                        vehicleNumber: driver.vehicleNumber || null,
                        rating: driver.rating || 5.0,
                        source: 'redis_geo'
                    }));
                    
                    if (drivers.length === 0 && data.debug?.totalDriversInRedis > 0) {
                        Logger.warn(`⚠️ [DriverAvailabilityService] Nenhum motorista encontrado no raio, mas há ${data.debug.totalDriversInRedis} no Redis`);
                        Logger.warn(`   💡 Verifique se o raio de busca (${this.radius}km) está adequado`);
                    }
                } else {
                    // ✅ Se resposta não é OK, tratar como ausência de motoristas (não erro)
                    const errorText = await response.text().catch(() => '');
                    Logger.log(`ℹ️ [DriverAvailabilityService] Resposta não OK (${response.status}), tratando como ausência de motoristas`);
                    drivers = []; // Array vazio = nenhum motorista disponível
                }
            } catch (error) {
                // ✅ Distinguir entre erro de rede e ausência de motoristas
                if (error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch')) {
                    // Erro de rede real - não mostrar erro, apenas logar e tratar como ausência de motoristas
                    Logger.log(`ℹ️ [DriverAvailabilityService] Erro de rede ao buscar motoristas (servidor pode estar offline ou sem motoristas):`, error.message);
                    drivers = []; // Tratar como ausência de motoristas
                } else {
                    // Outro tipo de erro - logar mas não quebrar o serviço
                    Logger.warn(`⚠️ [DriverAvailabilityService] Erro ao buscar motoristas:`, error.message);
                    drivers = []; // Tratar como ausência de motoristas
                }
            }

            // Verificar se houve mudança
            const driversChanged = JSON.stringify(drivers) !== JSON.stringify(this.lastDrivers);
            
            // ✅ SEMPRE notificar, mesmo se não mudou (para garantir que o estado está atualizado)
            if (drivers.length > 0) {
                Logger.log(`📊 [DriverAvailabilityService] Motoristas encontrados: ${drivers.length} disponíveis`);
                Logger.log(`   📋 Primeiros 3 motoristas:`, drivers.slice(0, 3).map(d => ({
                    id: d.id?.substring(0, 8),
                    carType: d.carType,
                    distance: d.distance?.toFixed(2) + ' km',
                    hasLocation: !!(d.location?.lat && d.location?.lng)
                })));
            } else {
                // ✅ Não há motoristas na região - informar de forma amigável (não é erro)
                Logger.log(`ℹ️ [DriverAvailabilityService] Não há motoristas disponíveis na região (raio: ${this.radius}km)`);
            }
            
            this.lastDrivers = drivers;
            
            // Notificar todos os subscribers (sempre, para garantir estado atualizado)
            this.notifySubscribers(drivers);
        } catch (error) {
            Logger.error('❌ [DriverAvailabilityService] Erro ao atualizar motoristas:', error);
        }
    }

    /**
     * Inscrever-se para receber atualizações
     * @param {Function} callback - Função que recebe a lista de motoristas
     * @returns {Function} Função para cancelar inscrição
     */
    subscribe(callback) {
        if (typeof callback !== 'function') {
            Logger.warn('⚠️ [DriverAvailabilityService] Callback deve ser uma função');
            return () => {};
        }

        this.subscribers.add(callback);
        Logger.log(`📝 [DriverAvailabilityService] Novo subscriber adicionado (total: ${this.subscribers.size})`);

        // Enviar estado atual imediatamente
        if (this.lastDrivers.length > 0) {
            callback(this.lastDrivers);
        }

        // Retornar função de unsubscribe
        return () => {
            this.subscribers.delete(callback);
            Logger.log(`📝 [DriverAvailabilityService] Subscriber removido (total: ${this.subscribers.size})`);
        };
    }

    /**
     * Notificar todos os subscribers
     * @param {Array} drivers - Lista de motoristas disponíveis
     */
    notifySubscribers(drivers) {
        this.subscribers.forEach(callback => {
            try {
                callback(drivers);
            } catch (error) {
                Logger.error('❌ [DriverAvailabilityService] Erro ao notificar subscriber:', error);
            }
        });
    }

    /**
     * Obter motoristas atuais (sem esperar atualização)
     */
    getCurrentDrivers() {
        return this.lastDrivers;
    }

    /**
     * Atualizar localização de monitoramento
     */
    updateLocation(location, radius = null) {
        if (!location || !location.lat || !location.lng) {
            return;
        }

        const locationChanged = 
            !this.currentLocation ||
            this.currentLocation.lat !== location.lat ||
            this.currentLocation.lng !== location.lng;

        if (locationChanged || radius !== null) {
            Logger.log(`📍 [DriverAvailabilityService] Localização atualizada: ${location.lat}, ${location.lng}`);
            
            if (this.isRunning) {
                // Reiniciar monitoramento com nova localização
                this.startMonitoring(location, radius || this.radius, this.updateFrequency);
            } else {
                this.currentLocation = location;
                if (radius !== null) {
                    this.radius = radius;
                }
            }
        }
    }
}

// Singleton
const driverAvailabilityService = new DriverAvailabilityService();

export default driverAvailabilityService;

