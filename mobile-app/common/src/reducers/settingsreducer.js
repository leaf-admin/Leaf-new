import {
  FETCH_SETTINGS,
  FETCH_SETTINGS_SUCCESS,
  FETCH_SETTINGS_FAILED,
  EDIT_SETTINGS,
  CLEAR_SETTINGS_ERROR
} from "../store/types";

const INITIAL_STATE = {
  settings: null,
  loading: false,
  isDarkMode: false,
  error: {
    flag: false,
    msg: null
  }
}

export const settingsreducer = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case FETCH_SETTINGS:
      return {
        ...state,
        loading:true
      };
    case FETCH_SETTINGS_SUCCESS:
      return {
        ...state,
        settings:action.payload,
        loading:false
      };
    case FETCH_SETTINGS_FAILED:
      return {
        ...state,
        settings:null,
        loading:false,
        error:{
          flag:true,
          msg:action.payload
        }
      };
    case EDIT_SETTINGS:
      return state;
    case CLEAR_SETTINGS_ERROR:
      return {
          ...state,
          error:{
              flag:false,
              msg:null
          }            
      };
    case 'TOGGLE_DARK_MODE':
      return {
        ...state,
        isDarkMode: !state.isDarkMode
      };
    default:
      return state;
  }
};