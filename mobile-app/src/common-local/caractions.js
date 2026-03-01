import {
    FETCH_CARS,
    FETCH_CARS_SUCCESS,
    FETCH_CARS_FAILED,
    EDIT_CAR
  } from "../types";
  import store from '../store/store';
  import { firebase } from './config/configureFirebase';
  
  export const fetchCars = () => (dispatch) => {
  
    const {
        vehiclesRef
    } = firebase;
  
    dispatch({
      type: FETCH_CARS,
      payload: null
    });

    const userInfo = store.getState().auth.profile;

    // Buscar todos os veículos onde driver == userInfo.uid
    vehiclesRef().orderByChild('driver').equalTo(userInfo.uid).on('value', snapshot => {
      if (snapshot.val()) {
        let data = snapshot.val();
        const arr = Object.keys(data).map(i => {
          data[i].id = i;
          return data[i]
        });
        dispatch({
          type: FETCH_CARS_SUCCESS,
          payload: arr
        });
      } else {
        dispatch({
          type: FETCH_CARS_FAILED,
          payload: store.getState().languagedata.defaultLanguage.no_cars
        });
      }
    });
  };
  
  export const editCar = (car, method) => async (dispatch) => {
    const {
      singleUserRef,
      vehicleAddRef, 
      vehicleEditRef,
      vehicleImage
    } = firebase;
    dispatch({
      type: EDIT_CAR,
      payload: { method, car }
    });
    if (method === 'Add') {
        // Garante que o campo driver está presente
        const carWithDriver = { ...car, driver: car.driver || store.getState().auth.profile.uid };
        vehicleAddRef.push(carWithDriver);
    } else if (method === 'Delete') {
        vehicleEditRef(car.id).remove();
    } else if (method === 'UpdateImage') {
      await vehicleImage(car.id).put(car.car_image);
      let image = await vehicleImage(car.id).getDownloadURL();
      let data = car;
      data.car_image = image;
      vehicleEditRef(car.id).update(data);
      if(car.active && car.driver){
        singleUserRef(car.driver).update({
          updateAt: new Date().getTime(),
          car_image: image
        });
      }   
    }
     else {
        vehicleEditRef(car.id).update(car);
    }
  }

  // Atualizar updateUserCarWithImage para aceitar crlvBlob
  export const updateUserCarWithImage = (newData, blob, crlvBlob) => (dispatch) => {
    const {
      auth,
      vehicleAddRef,
      singleUserRef,
      vehicleImage
    } = firebase;

    var carId = vehicleAddRef.push().key;

    // Upload da imagem do carro
    const uploadCarImage = () => vehicleImage(carId).put(blob).then(() => {
      blob.close();
      return vehicleImage(carId).getDownloadURL();
    });

    // Upload da imagem do CRLV
    const uploadCrlvImage = () => crlvBlob ? vehicleImage(`${carId}_crlv`).put(crlvBlob).then(() => {
      crlvBlob.close && crlvBlob.close();
      return vehicleImage(`${carId}_crlv`).getDownloadURL();
    }) : Promise.resolve(null);

    Promise.all([uploadCarImage(), uploadCrlvImage()]).then(([carUrl, crlvUrl]) => {
      newData.car_image = carUrl;
      newData.crlv_image = crlvUrl;
      newData.driver = newData.driver || auth.currentUser.uid;
      vehicleAddRef.child(carId).update(newData)
      if(newData.active){
        let updateData = {
          carType: newData.carType,
          vehicleNumber: newData.vehicleNumber,
          vehicleMake: newData.vehicleMake,
          vehicleModel: newData.vehicleModel,
          other_info: newData.other_info,
          car_image: carUrl,
          crlv_image: crlvUrl,
          carApproved: newData.approved,
          updateAt: new Date().getTime()
        };
        singleUserRef(auth.currentUser.uid).update(updateData);
      }
    })
  };