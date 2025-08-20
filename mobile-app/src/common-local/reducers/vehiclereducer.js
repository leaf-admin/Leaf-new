import {
    FETCH_VEHICLES,
    FETCH_VEHICLES_SUCCESS,
    FETCH_VEHICLES_FAILED,
    ADD_VEHICLE,
    ADD_VEHICLE_SUCCESS,
    ADD_VEHICLE_FAILED,
    UPDATE_VEHICLE,
    UPDATE_VEHICLE_SUCCESS,
    UPDATE_VEHICLE_FAILED,
    DELETE_VEHICLE,
    DELETE_VEHICLE_SUCCESS,
    DELETE_VEHICLE_FAILED,
    SET_VEHICLE_LOADING,
    CLEAR_VEHICLE_ERRORS,
} from '../types';

const INITIAL_STATE = {
    vehicles: [],
    loading: false,
    error: null,
    errors: {},
    success: false,
    successMessage: '',
};

export default function vehicleReducer(state = INITIAL_STATE, action) {
    switch (action.type) {
        case FETCH_VEHICLES:
            return {
                ...state,
                loading: true,
                error: null,
                errors: {},
            };

        case FETCH_VEHICLES_SUCCESS:
            return {
                ...state,
                vehicles: action.payload || [],
                loading: false,
                error: null,
                errors: {},
            };

        case FETCH_VEHICLES_FAILED:
            return {
                ...state,
                loading: false,
                error: action.payload,
                errors: {},
            };

        case ADD_VEHICLE:
            return {
                ...state,
                loading: true,
                error: null,
                errors: {},
                success: false,
                successMessage: '',
            };

        case ADD_VEHICLE_SUCCESS:
            return {
                ...state,
                vehicles: [action.payload, ...state.vehicles],
                loading: false,
                error: null,
                errors: {},
                success: true,
                successMessage: 'Veículo adicionado com sucesso!',
            };

        case ADD_VEHICLE_FAILED:
            return {
                ...state,
                loading: false,
                error: typeof action.payload === 'string' ? action.payload : null,
                errors: typeof action.payload === 'object' ? action.payload : {},
                success: false,
                successMessage: '',
            };

        case UPDATE_VEHICLE:
            return {
                ...state,
                loading: true,
                error: null,
                errors: {},
                success: false,
                successMessage: '',
            };

        case UPDATE_VEHICLE_SUCCESS:
            const updatedVehicles = state.vehicles.map(vehicle =>
                vehicle.id === action.payload.id
                    ? { ...vehicle, ...action.payload }
                    : vehicle
            );
            
            return {
                ...state,
                vehicles: updatedVehicles,
                loading: false,
                error: null,
                errors: {},
                success: true,
                successMessage: 'Veículo atualizado com sucesso!',
            };

        case UPDATE_VEHICLE_FAILED:
            return {
                ...state,
                loading: false,
                error: typeof action.payload === 'string' ? action.payload : null,
                errors: typeof action.payload === 'object' ? action.payload : {},
                success: false,
                successMessage: '',
            };

        case DELETE_VEHICLE:
            return {
                ...state,
                loading: true,
                error: null,
                errors: {},
                success: false,
                successMessage: '',
            };

        case DELETE_VEHICLE_SUCCESS:
            const filteredVehicles = state.vehicles.filter(
                vehicle => vehicle.id !== action.payload
            );
            
            return {
                ...state,
                vehicles: filteredVehicles,
                loading: false,
                error: null,
                errors: {},
                success: true,
                successMessage: 'Veículo removido com sucesso!',
            };

        case DELETE_VEHICLE_FAILED:
            return {
                ...state,
                loading: false,
                error: action.payload,
                errors: {},
                success: false,
                successMessage: '',
            };

        case SET_VEHICLE_LOADING:
            return {
                ...state,
                loading: action.payload,
            };

        case CLEAR_VEHICLE_ERRORS:
            return {
                ...state,
                error: null,
                errors: {},
                success: false,
                successMessage: '',
            };

        default:
            return state;
    }
} 