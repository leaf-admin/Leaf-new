// Utilitário multiplataforma para buscar userData

let getUserData;

if (typeof window !== 'undefined' && window.localStorage) {
  // Web
  getUserData = async () => {
    const userDataStr = localStorage.getItem('userData');
    return userDataStr ? JSON.parse(userDataStr) : null;
  };
} else {
  // React Native
  let AsyncStorage;
  try {
    AsyncStorage = require('@react-native-async-storage/async-storage').default;
  } catch (e) {
    AsyncStorage = null;
  }
  getUserData = async () => {
    if (!AsyncStorage) return null;
    const userDataStr = await AsyncStorage.getItem('userData');
    return userDataStr ? JSON.parse(userDataStr) : null;
  };
}

export default getUserData; 