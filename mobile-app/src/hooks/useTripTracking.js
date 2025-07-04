import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
    saveTracking, 
    startTripTracking, 
    endTripTracking, 
    getTripData 
} from 'common/src/actions/locationactions';

export const useTripTracking = (tripId) => {
    const dispatch = useDispatch();
    const gps = useSelector(state => state.gpsdata);
    const auth = useSelector(state => state.authdata);
    const [tripData, setTripData] = useState(null);
    const [isTracking, setIsTracking] = useState(false);
    const [error, setError] = useState(null);
    const trackingInterval = useRef(null);
    const lastTrackingPoint = useRef(null);

    // Função para iniciar tracking de uma viagem
    const startTracking = async (driverId, passengerId, initialLocation) => {
        try {
            setError(null);
            
            if (!tripId) {
                throw new Error('Trip ID is required');
            }

            // Iniciar tracking no Redis
            await startTripTracking(tripId, driverId, passengerId, initialLocation);
            
            setIsTracking(true);
            console.log('🚗 Trip tracking started:', tripId);

            // Carregar dados da viagem
            await loadTripData();

        } catch (error) {
            console.error('❌ Error starting trip tracking:', error);
            setError(error);
        }
    };

    // Função para parar tracking
    const stopTracking = async (endLocation) => {
        try {
            if (!tripId) return;

            // Parar intervalo de tracking
            if (trackingInterval.current) {
                clearInterval(trackingInterval.current);
                trackingInterval.current = null;
            }

            // Finalizar tracking no Redis
            await endTripTracking(tripId, endLocation);
            
            setIsTracking(false);
            console.log('✅ Trip tracking stopped:', tripId);

        } catch (error) {
            console.error('❌ Error stopping trip tracking:', error);
            setError(error);
        }
    };

    // Função para salvar ponto de tracking
    const saveTrackingPoint = async (location, status = 'TRACKING') => {
        try {
            if (!tripId || !location) return;

            const trackingData = {
                lat: location.lat,
                lng: location.lng,
                at: Date.now(),
                status: status
            };

            // Salvar no Redis e Firebase
            await saveTracking(tripId, trackingData);
            
            lastTrackingPoint.current = trackingData;
            console.log('📍 Tracking point saved:', tripId);

        } catch (error) {
            console.error('❌ Error saving tracking point:', error);
            setError(error);
        }
    };

    // Função para carregar dados da viagem
    const loadTripData = async () => {
        try {
            if (!tripId) return;

            const data = await getTripData(tripId);
            if (data) {
                setTripData(data);
                console.log('📍 Trip data loaded:', data);
            }
        } catch (error) {
            console.error('❌ Error loading trip data:', error);
            setError(error);
        }
    };

    // Função para iniciar tracking automático
    const startAutoTracking = (driverId, passengerId, options = {}) => {
        const {
            interval = 10000, // 10 segundos
            distanceThreshold = 0.01, // 10 metros
            initialLocation = null
        } = options;

        // Usar localização atual se não fornecida
        const startLocation = initialLocation || (gps.location ? {
            lat: gps.location.lat,
            lng: gps.location.lng
        } : null);

        if (!startLocation) {
            console.error('❌ No initial location available');
            return;
        }

        // Iniciar tracking
        startTracking(driverId, passengerId, startLocation);

        // Configurar intervalo de tracking
        trackingInterval.current = setInterval(() => {
            if (gps.location && gps.location.lat && gps.location.lng) {
                // Verificar se a localização mudou significativamente
                const hasChanged = !lastTrackingPoint.current || 
                    Math.abs(gps.location.lat - lastTrackingPoint.current.lat) > distanceThreshold ||
                    Math.abs(gps.location.lng - lastTrackingPoint.current.lng) > distanceThreshold;

                if (hasChanged) {
                    saveTrackingPoint(gps.location);
                }
            }
        }, interval);

        console.log('🚗 Auto tracking started with interval:', interval);
    };

    // Função para parar tracking automático
    const stopAutoTracking = (endLocation = null) => {
        // Usar localização atual se não fornecida
        const finalLocation = endLocation || (gps.location ? {
            lat: gps.location.lat,
            lng: gps.location.lng
        } : null);

        stopTracking(finalLocation);
        console.log('🛑 Auto tracking stopped');
    };

    // Função para atualizar status da viagem
    const updateTripStatus = async (status, location = null) => {
        try {
            const trackingLocation = location || (gps.location ? {
                lat: gps.location.lat,
                lng: gps.location.lng
            } : null);

            if (trackingLocation) {
                await saveTrackingPoint(trackingLocation, status);
                console.log('📍 Trip status updated:', status);
            }
        } catch (error) {
            console.error('❌ Error updating trip status:', error);
            setError(error);
        }
    };

    // Carregar dados da viagem ao montar
    useEffect(() => {
        if (tripId) {
            loadTripData();
        }
    }, [tripId]);

    // Cleanup ao desmontar
    useEffect(() => {
        return () => {
            if (trackingInterval.current) {
                clearInterval(trackingInterval.current);
            }
        };
    }, []);

    return {
        tripData,
        isTracking,
        error,
        startTracking,
        stopTracking,
        saveTrackingPoint,
        startAutoTracking,
        stopAutoTracking,
        updateTripStatus,
        loadTripData
    };
}; 