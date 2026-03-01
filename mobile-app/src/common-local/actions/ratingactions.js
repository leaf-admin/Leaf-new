import Logger from '../../utils/Logger';
// Action Types
export const ADD_RATING = 'ADD_RATING';
export const UPDATE_RATING = 'UPDATE_RATING';
export const DELETE_RATING = 'DELETE_RATING';
export const SET_RATINGS = 'SET_RATINGS';
export const SET_RATING_LOADING = 'SET_RATING_LOADING';
export const SET_RATING_ERROR = 'SET_RATING_ERROR';

// Action Creators
export const addRating = (rating) => ({
    type: ADD_RATING,
    payload: rating
});

export const updateRating = (ratingId, updates) => ({
    type: UPDATE_RATING,
    payload: { ratingId, updates }
});

export const deleteRating = (ratingId) => ({
    type: DELETE_RATING,
    payload: ratingId
});

export const setRatings = (ratings) => ({
    type: SET_RATINGS,
    payload: ratings
});

export const setRatingLoading = (loading) => ({
    type: SET_RATING_LOADING,
    payload: loading
});

export const setRatingError = (error) => ({
    type: SET_RATING_ERROR,
    payload: error
});

// Thunk Actions
export const submitRating = (ratingData) => async (dispatch) => {
    try {
        dispatch(setRatingLoading(true));
        dispatch(setRatingError(null));
        
        // Importar RatingService
        const RatingService = require('../../services/RatingService').default;

        
        // Enviar avaliação
        const result = await RatingService.submitRating(ratingData);
        
        if (result.success) {
            // Adicionar ao store
            dispatch(addRating(ratingData));
            return { success: true };
        } else {
            throw new Error(result.error || 'Falha ao enviar avaliação');
        }
        
    } catch (error) {
        Logger.error('❌ Erro ao submeter avaliação:', error);
        dispatch(setRatingError(error.message));
        return { success: false, error: error.message };
    } finally {
        dispatch(setRatingLoading(false));
    }
};

export const loadRatings = () => async (dispatch) => {
    try {
        dispatch(setRatingLoading(true));
        
        // Importar RatingService
        const RatingService = require('../../services/RatingService').default;
        
        // Carregar avaliações locais
        const localRatings = await RatingService.getLocalRatings();
        
        // Carregar avaliações do store
        const state = store.getState();
        const storeRatings = state.ratings?.ratings || [];
        
        // Combinar e remover duplicatas
        const allRatings = [...storeRatings, ...localRatings];
        const uniqueRatings = allRatings.filter((rating, index, self) => 
            index === self.findIndex(r => r.id === rating.id)
        );
        
        dispatch(setRatings(uniqueRatings));
        
    } catch (error) {
        Logger.error('❌ Erro ao carregar avaliações:', error);
        dispatch(setRatingError(error.message));
    } finally {
        dispatch(setRatingLoading(false));
    }
};

export const sendPendingRatings = () => async (dispatch) => {
    try {
        // Importar RatingService
        const RatingService = require('../../services/RatingService').default;
        
        // Enviar avaliações pendentes
        await RatingService.sendPendingRatings();
        
        // Recarregar avaliações
        dispatch(loadRatings());
        
    } catch (error) {
        Logger.error('❌ Erro ao enviar avaliações pendentes:', error);
    }
};



export const hasUserRatedTrip = (tripId, userType) => async (dispatch) => {
    try {
        // Importar RatingService
        const RatingService = require('../../services/RatingService').default;
        
        // Verificar se usuário já avaliou
        const hasRated = await RatingService.hasUserRatedTrip(tripId, userType);
        
        return hasRated;
        
    } catch (error) {
        Logger.error('❌ Erro ao verificar se usuário já avaliou:', error);
        return false;
    }
};

export const getUserRatings = (targetUserId, userType) => async (dispatch) => {
    try {
        dispatch(setRatingLoading(true));
        
        // Importar RatingService
        const RatingService = require('../../services/RatingService').default;
        
        // Obter avaliações do usuário
        const result = await RatingService.getUserRatings(targetUserId, userType);
        
        // Atualizar store com as avaliações
        dispatch(setRatings(result.ratings));
        
        return result;
        
    } catch (error) {
        Logger.error('❌ Erro ao obter avaliações do usuário:', error);
        dispatch(setRatingError(error.message));
        return {
            ratings: [],
            total: 0,
            average: 0,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        };
    } finally {
        dispatch(setRatingLoading(false));
    }
};

export const getTripRatings = (tripId) => async (dispatch) => {
    try {
        dispatch(setRatingLoading(true));
        
        // Importar RatingService
        const RatingService = require('../../services/RatingService').default;
        
        // Obter avaliações da viagem
        const ratings = await RatingService.getTripRatings(tripId);
        
        // Atualizar store com as avaliações
        dispatch(setRatings(ratings));
        
        return ratings;
        
    } catch (error) {
        Logger.error('❌ Erro ao obter avaliações da viagem:', error);
        dispatch(setRatingError(error.message));
        return [];
    } finally {
        dispatch(setRatingLoading(false));
    }
};
