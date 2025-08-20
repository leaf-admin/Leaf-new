import {
    FETCH_CARS,
    FETCH_CARS_SUCCESS,
    FETCH_CARS_FAILED,
    EDIT_CAR
  } from "../types.js";
  import store from '../store/store';
  import { firebase } from '../config/configureFirebase';
  
  export const fetchCars = () => (dispatch) => {
  
    const {
        carsRef
    } = firebase;
  
    dispatch({
      type: FETCH_CARS,
      payload: null
    });

    const userInfo = store.getState().auth.profile;

    carsRef(userInfo.uid, userInfo.usertype).on('value', snapshot => {
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
      carAddRef, 
      carEditRef,
      carImage
    } = firebase;
    dispatch({
      type: EDIT_CAR,
      payload: { method, car }
    });
    if (method === 'Add') {
        carAddRef.push(car);
    } else if (method === 'Delete') {
        carEditRef(car.id).remove();
    } else if (method === 'UpdateImage') {
      await carImage(car.id).put(car.car_image);
      let image = await carImage(car.id).getDownloadURL();
      let data = car;
      data.car_image = image;
      carEditRef(car.id).update(data);
      if(car.active && car.driver){
        singleUserRef(car.driver).update({
          updateAt: new Date().getTime(),
          car_image: image
        });
      }   
    }
     else {
        carEditRef(car.id).update(car);
    }
  }

  export const updateUserCarWithImage = (newData, blob) => (dispatch) => {
    const {
      auth,
      carAddRef,
      singleUserRef,
      carImage
    } = firebase;

    var carId = carAddRef.push().key;

    carImage(carId).put(blob).then(() => {
      blob.close()
      return carImage(carId).getDownloadURL()
    }).then((url) => {
      newData.car_image = url;
      carAddRef.child(carId).update(newData )
      if(newData.active){
        let updateData = {
          carType: newData.carType,
          vehicleNumber: newData.vehicleNumber,
          vehicleMake: newData.vehicleMake,
          vehicleModel: newData.vehicleModel,
          other_info: newData.other_info,
          car_image:url,
          carApproved: newData.approved,
          updateAt: new Date().getTime()
        };
        singleUserRef(auth.currentUser.uid).update(updateData);
      }
    })
  };