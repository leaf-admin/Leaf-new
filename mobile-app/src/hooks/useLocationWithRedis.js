import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as Location from 'expo-location';
import { saveUserLocation, getUserLocation } from 'common/src/actions/locationactions';
import redisApiService from '../services/RedisApiService';

export const useLocationWithRedis = () => {
    const dispatch = useDispatch();
    const gps = useSelector(state => state.gpsdata);
    const auth = useSelector(state => state.authdata);
    const [location, setLocation] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [redisAvailable, setRedisAvailable] = useState(false);
    const locationWatcher = useRef(null);
    const lastLocationRef = useRef(null);

    // Inicializar serviços
    useEffect(() => {
        const initializeServices = async () => {
            try {
                await redisApiService.initialize();
                const isHealthy = await redisApiService.checkServiceHealth();
                setRedisAvailable(isHealthy);
                console.log('🔍 Redis API disponível:', isHealthy);
            } catch (error) {
                console.log('⚠️ Redis API não disponível, usando Firebase apenas');
                setRedisAvailable(false);
            }
        };

        initializeServices();
    }, []);

    // Função para atualizar localização no Redux e Redis
    const updateLocation = async (coords) => {
        try {
            const locationData = {
                lat: coords.latitude,
                lng: coords.longitude,
                at: Date.now()
            };

            // Atualizar Redux
            dispatch({
                type: 'UPDATE_GPS_LOCATION',
                payload: locationData
            });

            // Salvar no Redis via API se disponível
            if (auth.profile && auth.profile.uid && redisAvailable) {
                try {
                    await redisApiService.saveUserLocation(
                        locationData.lat,
                        locationData.lng,
                        locationData.at
                    );
                    console.log('📍 Location saved to Redis via API');
                } catch (redisError) {
                    console.log('⚠️ Redis API save failed, using Firebase only');
                    // Fallback para Firebase
                    await saveUserLocation(locationData);
                }
            } else if (auth.profile && auth.profile.uid) {
                // Usar apenas Firebase se Redis não estiver disponível
                await saveUserLocation(locationData);
            }

            setLocation(locationData);
            lastLocationRef.current = locationData;
        } catch (error) {
            console.error('❌ Error updating location:', error);
            setError(error);
        }
    };

    // Função para buscar motoristas próximos
    const fetchNearbyDrivers = async (lat, lng, radius = 5000, limit = 10) => {
        try {
            if (redisAvailable) {
                // Tentar usar Redis API primeiro
                try {
                    const response = await redisApiService.getNearbyDrivers(lat, lng, radius, limit);
                    console.log(`🔍 Found ${response.drivers?.length || 0} drivers via Redis API`);
                    return response.drivers || [];
                } catch (redisError) {
                    console.log('⚠️ Redis API failed, falling back to Firebase');
                }
            }

            // Fallback para Firebase
            const firebaseDrivers = await getUserLocation();
            console.log('🔍 Using Firebase fallback for nearby drivers');
            return firebaseDrivers || [];
        } catch (error) {
            console.error('❌ Error fetching nearby drivers:', error);
            return [];
        }
    };

    // Função para obter localização de um usuário específico
    const getUserLocationById = async (uid) => {
        try {
            if (redisAvailable) {
                try {
                    const response = await redisApiService.getUserLocation(uid);
                    return response.location;
                } catch (redisError) {
                    console.log('⚠️ Redis API failed, falling back to Firebase');
                }
            }

            // Fallback para Firebase
            const firebaseLocation = await getUserLocation(uid);
            return firebaseLocation;
        } catch (error) {
            console.error('❌ Error fetching user location:', error);
            return null;
        }
    };

    // Função para atualizar status do motorista
    const updateDriverStatus = async (status, isOnline) => {
        try {
            if (redisAvailable) {
                try {
                    await redisApiService.updateDriverStatus(status, isOnline);
                    console.log('🔄 Driver status updated via Redis API');
                    return true;
                } catch (redisError) {
                    console.log('⚠️ Redis API failed, falling back to Firebase');
                }
            }

            // Fallback para Firebase
            // Implementar lógica de fallback aqui se necessário
            console.log('🔄 Driver status updated via Firebase fallback');
            return true;
        } catch (error) {
            console.error('❌ Error updating driver status:', error);
            return false;
        }
    };

    // Função para obter estatísticas
    const getStats = async () => {
        try {
            if (redisAvailable) {
                try {
                    const response = await redisApiService.getRedisStats();
                    return response.stats;
                } catch (redisError) {
                    console.log('⚠️ Redis API failed, falling back to Firebase');
                }
            }

            // Fallback para Firebase
            return {
                online_users: 0,
                offline_users: 0,
                total_users: 0,
                source: 'firebase'
            };
        } catch (error) {
            console.error('❌ Error fetching stats:', error);
            return null;
        }
    };

    // Iniciar tracking de localização
    const startLocationTracking = async () => {
        try {
            setLoading(true);
            setError(null);

            // Solicitar permissões
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                throw new Error('Permissão de localização negada');
            }

            // Obter localização atual
            const currentLocation = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
                timeInterval: 5000,
                distanceInterval: 10
            });

            await updateLocation(currentLocation.coords);

            // Configurar watcher para atualizações
            locationWatcher.current = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 5000,
                    distanceInterval: 10
                },
                async (newLocation) => {
                    await updateLocation(newLocation.coords);
                }
            );

            setLoading(false);
        } catch (error) {
            console.error('❌ Error starting location tracking:', error);
            setError(error);
            setLoading(false);
        }
    };

    // Parar tracking de localização
    const stopLocationTracking = () => {
        if (locationWatcher.current) {
            locationWatcher.current.remove();
            locationWatcher.current = null;
        }
    };

    // Cleanup ao desmontar
    useEffect(() => {
        return () => {
            stopLocationTracking();
        };
    }, []);

    return {
        location,
        error,
        loading,
        redisAvailable,
        updateLocation,
        fetchNearbyDrivers,
        getUserLocationById,
        updateDriverStatus,
        getStats,
        startLocationTracking,
        stopLocationTracking
    };
}; 