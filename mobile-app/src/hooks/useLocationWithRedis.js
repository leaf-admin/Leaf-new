import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as Location from 'expo-location';
import { saveUserLocation, getUserLocation } from 'common/src/actions/locationactions';

export const useLocationWithRedis = () => {
    const dispatch = useDispatch();
    const gps = useSelector(state => state.gpsdata);
    const auth = useSelector(state => state.authdata);
    const [location, setLocation] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const locationWatcher = useRef(null);
    const lastLocationRef = useRef(null);

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

            // Salvar no Redis se habilitado
            if (auth.profile && auth.profile.uid) {
                try {
                    await saveUserLocation(locationData);
                    console.log('📍 Location saved to Redis');
                } catch (redisError) {
                    console.log('⚠️ Redis location save failed, using Firebase only');
                }
            }

            setLocation(locationData);
            lastLocationRef.current = locationData;
        } catch (error) {
            console.error('❌ Error updating location:', error);
            setError(error);
        }
    };

    // Função para obter localização atual
    const getCurrentLocation = async () => {
        try {
            setLoading(true);
            setError(null);

            // Verificar permissões
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                throw new Error('Location permission denied');
            }

            // Obter localização atual
            const currentLocation = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced
            });

            await updateLocation(currentLocation.coords);
            setLoading(false);
        } catch (error) {
            console.error('❌ Error getting current location:', error);
            setError(error);
            setLoading(false);
        }
    };

    // Função para iniciar monitoramento de localização
    const startLocationTracking = async (options = {}) => {
        try {
            setError(null);

            // Verificar permissões
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                throw new Error('Location permission denied');
            }

            // Parar watcher anterior se existir
            if (locationWatcher.current) {
                locationWatcher.current.remove();
            }

            // Configurações padrão
            const defaultOptions = {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 10000, // 10 segundos
                distanceInterval: 10, // 10 metros
                ...options
            };

            // Iniciar novo watcher
            locationWatcher.current = await Location.watchPositionAsync(
                defaultOptions,
                (newLocation) => {
                    updateLocation(newLocation.coords);
                }
            );

            console.log('📍 Location tracking started');
        } catch (error) {
            console.error('❌ Error starting location tracking:', error);
            setError(error);
        }
    };

    // Função para parar monitoramento
    const stopLocationTracking = () => {
        if (locationWatcher.current) {
            locationWatcher.current.remove();
            locationWatcher.current = null;
            console.log('📍 Location tracking stopped');
        }
    };

    // Função para obter localização do usuário (com fallback Redis/Firebase)
    const getUserLocationData = async (userId) => {
        try {
            const userLocation = await getUserLocation(userId);
            if (userLocation) {
                console.log('📍 User location retrieved:', userLocation);
                return userLocation;
            }
        } catch (error) {
            console.error('❌ Error getting user location:', error);
        }
        return null;
    };

    // Função para verificar se a localização mudou significativamente
    const hasLocationChanged = (newLocation, threshold = 0.01) => {
        if (!lastLocationRef.current) return true;

        const latDiff = Math.abs(newLocation.lat - lastLocationRef.current.lat);
        const lngDiff = Math.abs(newLocation.lng - lastLocationRef.current.lng);

        return latDiff > threshold || lngDiff > threshold;
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
        getCurrentLocation,
        startLocationTracking,
        stopLocationTracking,
        getUserLocationData,
        hasLocationChanged,
        updateLocation
    };
}; 