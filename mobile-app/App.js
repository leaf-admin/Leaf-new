import React from 'react';
import { Provider } from 'react-redux';
import { store } from './src/common-local/store';
import AppNavigator from './src/navigation/AppNavigator';
import AuthProvider from './src/components/AuthProvider';
import './src/i18n'; // Inicializar i18n

export default function App() {
  return (
    <Provider store={store}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </Provider>
  );
}
