import { configureStore } from '@reduxjs/toolkit';

import authreducer from "./reducers/authreducer";
import { cartypesreducer} from "./reducers/cartypesreducer";
import { bookingslistreducer } from "./reducers/bookingslistreducer";
import { estimatereducer } from "./reducers/estimatereducer";
import { bookingreducer } from "./reducers/bookingreducer";
import { cancelreasonreducer } from "./reducers/cancelreasonreducer";
import { promoreducer } from "./reducers/promoreducer";
import { usersreducer } from "./reducers/usersreducer";
import { notificationreducer } from "./reducers/notificationreducer";
import { driverearningreducer } from './reducers/driverearningreducer';
import { earningreportsreducer } from './reducers/earningreportsreducer';
import { settingsreducer } from './reducers/settingsreducer';
import { paymentreducer } from './reducers/paymentreducer';
import { tripreducer } from './reducers/tripreducer';
import { tasklistreducer } from './reducers/tasklistreducer';
import { locationreducer } from './reducers/locationreducer';
import { chatreducer } from './reducers/chatreducer';
import { withdrawreducer } from './reducers/withdrawreducer';
import { gpsreducer } from './reducers/gpsreducer';
import { addresslistreducer } from './reducers/addressreducer';
import { languagereducer } from './reducers/languagereducer';
import { carlistreducer } from './reducers/carlistreducer';
import { smtpreducer } from './reducers/smtpreducer';
import { smsreducer } from './reducers/smsreducer';
import { sosreducer } from './reducers/sosreducer';
import { complainreducer } from './reducers/complainreducer';
import { usedreferralreducer } from "./reducers/usedreferralreducer";
import { fleetadminearningreducer } from "./reducers/fleetadminearningreducer";
import profileToggleReducer from "./reducers/profileToggleReducer";

const rootReducer = {
  auth: authreducer,
  cartypes: cartypesreducer,
  bookinglistdata: bookingslistreducer,
  estimatedata: estimatereducer,
  bookingdata: bookingreducer,
  cancelreasondata: cancelreasonreducer,
  promodata: promoreducer,
  usersdata: usersreducer,
  notificationdata: notificationreducer,
  driverearningdata: driverearningreducer,
  earningreportsdata: earningreportsreducer,
  settingsdata: settingsreducer,
  paymentmethods: paymentreducer,
  tripdata: tripreducer,
  taskdata: tasklistreducer,
  locationdata: locationreducer,
  chatdata: chatreducer,
  withdrawdata: withdrawreducer,
  addressdata : addresslistreducer,
  gpsdata: gpsreducer,
  languagedata: languagereducer,
  carlistdata: carlistreducer,
  smtpdata: smtpreducer,
  smsconfigdata: smsreducer,
  sosdata: sosreducer,
  complaindata: complainreducer,
  usedreferralid:usedreferralreducer,
  fleetadminearningdata: fleetadminearningreducer,
  profileToggle: profileToggleReducer,
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
