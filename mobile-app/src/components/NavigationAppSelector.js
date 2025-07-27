import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Platform,
  Linking
} from 'react-native';
import { Icon } from 'react-native-elements';
import navigationService from '../services/NavigationService';

/**
 * Componente para seleção de app de navegação preferido
 * Permite ao usuário escolher entre Waze, Google Maps, Apple Maps
 */

const NavigationAppSelector = ({ visible, onClose, onAppSelected }) => {
  const [availableApps, setAvailableApps] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      checkAvailableApps();
    }
  }, [visible]);

  /**
   * Verifica quais apps de navegação estão disponíveis
   */
  const checkAvailableApps = async () => {
    setLoading(true);
    
    try {
      const apps = [];
      
      // Verificar Waze
      const wazeSupported = await Linking.canOpenURL('waze://');
      if (wazeSupported) {
        apps.push({
          id: 'waze',
          name: 'Waze',
          icon: 'car',
          color: '#33CCFF',
          description: 'Navegação com trânsito em tempo real'
        });
      }
      
      // Verificar Google Maps
      const googleMapsUrl = Platform.OS === 'ios' ? 'comgooglemaps://' : 'google.navigation:q=';
      const googleMapsSupported = await Linking.canOpenURL(googleMapsUrl);
      if (googleMapsSupported) {
        apps.push({
          id: 'googleMaps',
          name: 'Google Maps',
          icon: 'map',
          color: '#4285F4',
          description: 'Mapas e navegação do Google'
        });
      }
      
      // Verificar Apple Maps (apenas iOS)
      if (Platform.OS === 'ios') {
        const appleMapsSupported = await Linking.canOpenURL('http://maps.apple.com/');
        if (appleMapsSupported) {
          apps.push({
            id: 'appleMaps',
            name: 'Apple Maps',
            icon: 'location',
            color: '#007AFF',
            description: 'Mapas nativos do iOS'
          });
        }
      }
      
      // Sempre incluir browser como opção
      apps.push({
        id: 'browser',
        name: 'Google Maps Web',
        icon: 'web',
        color: '#34A853',
        description: 'Navegação no navegador'
      });
      
      setAvailableApps(apps);
      
    } catch (error) {
      console.error('❌ NavigationAppSelector - Erro ao verificar apps:', error);
      // Fallback para apps básicos
      setAvailableApps([
        {
          id: 'waze',
          name: 'Waze',
          icon: 'car',
          color: '#33CCFF',
          description: 'Navegação com trânsito em tempo real'
        },
        {
          id: 'googleMaps',
          name: 'Google Maps',
          icon: 'map',
          color: '#4285F4',
          description: 'Mapas e navegação do Google'
        },
        {
          id: 'browser',
          name: 'Google Maps Web',
          icon: 'web',
          color: '#34A853',
          description: 'Navegação no navegador'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Seleciona um app de navegação
   */
  const selectApp = async (app) => {
    try {
      // Definir como app preferido
      await navigationService.setPreferredApp(app.id);
      
      // Fechar modal
      onClose();
      
      // Notificar componente pai
      if (onAppSelected) {
        onAppSelected(app);
      }
      
      // Mostrar confirmação
      Alert.alert(
        'App Definido',
        `${app.name} foi definido como seu app de navegação preferido.`,
        [{ text: 'OK' }]
      );
      
    } catch (error) {
      console.error('❌ NavigationAppSelector - Erro ao selecionar app:', error);
      Alert.alert('Erro', 'Não foi possível definir o app preferido.');
    }
  };

  /**
   * Abre loja para instalar app
   */
  const installApp = (appId) => {
    const storeUrls = {
      waze: Platform.OS === 'ios' 
        ? 'https://apps.apple.com/app/waze/id323229106'
        : 'https://play.google.com/store/apps/details?id=com.waze',
      googleMaps: Platform.OS === 'ios'
        ? 'https://apps.apple.com/app/google-maps/id585027354'
        : 'https://play.google.com/store/apps/details?id=com.google.android.apps.maps'
    };
    
    const url = storeUrls[appId];
    if (url) {
      Linking.openURL(url);
    }
  };

  /**
   * Renderiza um app de navegação
   */
  const renderApp = (app) => {
    const isInstalled = app.id !== 'browser' && availableApps.find(a => a.id === app.id);
    
    return (
      <TouchableOpacity
        key={app.id}
        style={[styles.appItem, isInstalled ? styles.appInstalled : styles.appNotInstalled]}
        onPress={() => isInstalled ? selectApp(app) : installApp(app.id)}
      >
        <View style={styles.appIconContainer}>
          <Icon
            name={app.icon}
            type="ionicon"
            size={24}
            color={isInstalled ? app.color : '#999'}
          />
        </View>
        
        <View style={styles.appInfo}>
          <Text style={[styles.appName, isInstalled ? styles.appNameInstalled : styles.appNameNotInstalled]}>
            {app.name}
          </Text>
          <Text style={styles.appDescription}>
            {app.description}
          </Text>
        </View>
        
        <View style={styles.appAction}>
          {isInstalled ? (
            <Icon
              name="checkmark-circle"
              type="ionicon"
              size={20}
              color="#4CAF50"
            />
          ) : (
            <Icon
              name="download"
              type="ionicon"
              size={20}
              color="#999"
            />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Escolha seu App de Navegação</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" type="ionicon" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          
          {/* Apps disponíveis */}
          <View style={styles.appsContainer}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Verificando apps disponíveis...</Text>
              </View>
            ) : (
              availableApps.map(renderApp)
            )}
          </View>
          
          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              O app selecionado será usado para navegação automática nas suas corridas.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '90%',
    maxHeight: '80%',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 5,
  },
  appsContainer: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  appItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  appInstalled: {
    backgroundColor: '#F8F9FA',
    borderColor: '#E0E0E0',
  },
  appNotInstalled: {
    backgroundColor: '#F5F5F5',
    borderColor: '#D0D0D0',
  },
  appIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  appInfo: {
    flex: 1,
  },
  appName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  appNameInstalled: {
    color: '#333',
  },
  appNameNotInstalled: {
    color: '#999',
  },
  appDescription: {
    fontSize: 14,
    color: '#666',
  },
  appAction: {
    marginLeft: 10,
  },
  footer: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  footerText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default NavigationAppSelector; 