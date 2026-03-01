import Logger from '../utils/Logger';
import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { getUserTripHistory, getTripStatistics } from '../common-local/src/actions/locationactions';


export const useTripHistory = (userType = 'passenger') => {
    const auth = useSelector(state => state.authdata);
    const [tripHistory, setTripHistory] = useState([]);
    const [statistics, setStatistics] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Carregar histórico de viagens
    const loadTripHistory = async (limit = 50) => {
        if (!auth.profile?.uid) {
            Logger.log('⚠️ Usuário não autenticado');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const history = await getUserTripHistory(auth.profile.uid, userType, limit);
            setTripHistory(history);
            
            Logger.log('📊 Trip history loaded:', history.length, 'trips');
        } catch (error) {
            Logger.error('❌ Error loading trip history:', error);
            setError(error);
        } finally {
            setLoading(false);
        }
    };

    // Carregar estatísticas
    const loadStatistics = async (period = 'month') => {
        if (!auth.profile?.uid) {
            Logger.log('⚠️ Usuário não autenticado');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const stats = await getTripStatistics(auth.profile.uid, userType, period);
            setStatistics(stats);
            
            Logger.log('📊 Trip statistics loaded:', stats);
        } catch (error) {
            Logger.error('❌ Error loading trip statistics:', error);
            setError(error);
        } finally {
            setLoading(false);
        }
    };

    // Carregar dados iniciais
    useEffect(() => {
        if (auth.profile?.uid) {
            loadTripHistory();
            loadStatistics();
        }
    }, [auth.profile?.uid, userType]);

    // Função para filtrar viagens por status
    const getTripsByStatus = (status) => {
        return tripHistory.filter(trip => trip.status === status);
    };

    // Função para obter viagens recentes
    const getRecentTrips = (days = 7) => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        return tripHistory.filter(trip => {
            const tripDate = new Date(trip.createdAt);
            return tripDate >= cutoffDate;
        });
    };

    // Função para obter viagens por período
    const getTripsByPeriod = (startDate, endDate) => {
        return tripHistory.filter(trip => {
            const tripDate = new Date(trip.createdAt);
            return tripDate >= startDate && tripDate <= endDate;
        });
    };

    // Função para calcular métricas
    const calculateMetrics = () => {
        if (!tripHistory.length) return null;

        const totalTrips = tripHistory.length;
        const completedTrips = tripHistory.filter(trip => trip.status === 'COMPLETED').length;
        const cancelledTrips = tripHistory.filter(trip => trip.status === 'CANCELLED').length;
        const totalDistance = tripHistory.reduce((sum, trip) => sum + (trip.distance || 0), 0);
        const totalFare = tripHistory.reduce((sum, trip) => sum + (trip.fare || 0), 0);
        const averageFare = totalTrips > 0 ? totalFare / totalTrips : 0;
        const completionRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 0;

        return {
            totalTrips,
            completedTrips,
            cancelledTrips,
            totalDistance,
            totalFare,
            averageFare,
            completionRate
        };
    };

    return {
        tripHistory,
        statistics,
        loading,
        error,
        loadTripHistory,
        loadStatistics,
        getTripsByStatus,
        getRecentTrips,
        getTripsByPeriod,
        calculateMetrics,
        refresh: () => {
            loadTripHistory();
            loadStatistics();
        }
    };
}; 