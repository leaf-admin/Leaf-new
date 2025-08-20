import {
    ADD_RATING,
    UPDATE_RATING,
    DELETE_RATING,
    SET_RATINGS,
    SET_RATING_LOADING,
    SET_RATING_ERROR
} from '../actions/ratingactions';

const initialState = {
    ratings: [],
    loading: false,
    error: null
};

export default function ratingReducer(state = initialState, action) {
    switch (action.type) {
        case ADD_RATING:
            return {
                ...state,
                ratings: [...state.ratings, action.payload],
                error: null
            };
            
        case UPDATE_RATING:
            return {
                ...state,
                ratings: state.ratings.map(rating => 
                    rating.id === action.payload.ratingId
                        ? { ...rating, ...action.payload.updates }
                        : rating
                ),
                error: null
            };
            
        case DELETE_RATING:
            return {
                ...state,
                ratings: state.ratings.filter(rating => 
                    rating.id !== action.payload
                ),
                error: null
            };
            
        case SET_RATINGS:
            return {
                ...state,
                ratings: action.payload,
                error: null
            };
            
        case SET_RATING_LOADING:
            return {
                ...state,
                loading: action.payload
            };
            
        case SET_RATING_ERROR:
            return {
                ...state,
                error: action.payload
            };
            
        default:
            return state;
    }
}
