import { configureStore } from '@reduxjs/toolkit';

import authreducer from "./reducers/authreducer";
import { cartypesreducer} from "./reducers/cartypesreducer";
import { settingsreducer } from './reducers/settingsreducer';
import { languagereducer } from './reducers/languagereducer';
import onboardingReducer from "../state/onboarding/onboardingReducer";

const rootReducer = {
  auth: authreducer,
  cartypes: cartypesreducer,
  settingsdata: settingsreducer,
  languagedata: languagereducer,
  onboarding: onboardingReducer,
};

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
      immutableCheck: false,
    }),
});

export { store };
export default store;
