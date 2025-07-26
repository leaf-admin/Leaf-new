import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Dimensions,
  Platform
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

const { width, height } = Dimensions.get('window');

const LEAF_GREEN = '#1A330E';
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const DARK_GRAY = '#333333';

export default function DriverDocumentsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  
  const [cnhUploaded, setCnhUploaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const { userData } = route.params;

  const requestPermissions = async () => {
    if (Platform.OS === 'ios') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão Necessária', 'Precisamos de permissão para acessar sua galeria de fotos.');
        return false;
      }
    }
    return true;
  };

  const handleDocumentUpload = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    Alert.alert(
      'Escolher CNH',
      'Como você gostaria de enviar sua CNH?',
      [
        {
          text: 'Tirar Foto',
          onPress: () => takePhoto()
        },
        {
          text: 'Escolher da Galeria',
          onPress: () => pickFromGallery()
        },
        {
          text: 'Escolher Arquivo',
          onPress: () => pickDocument()
        },
        {
          text: 'Cancelar',
          style: 'cancel'
        }
      ]
    );
  };

  const takePhoto = async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await processDocument(result.assets[0].uri, 'photo');
      }
    } catch (error) {
      console.error('Erro ao tirar foto:', error);
      Alert.alert('Erro', 'Não foi possível tirar a foto. Tente novamente.');
    }
  };

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await processDocument(result.assets[0].uri, 'gallery');
      }
    } catch (error) {
      console.error('Erro ao escolher da galeria:', error);
      Alert.alert('Erro', 'Não foi possível escolher a imagem. Tente novamente.');
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        await processDocument(result.assets[0].uri, 'document');
      }
    } catch (error) {
      console.error('Erro ao escolher documento:', error);
      Alert.alert('Erro', 'Não foi possível escolher o documento. Tente novamente.');
    }
  };

  const processDocument = async (uri, source) => {
    setIsLoading(true);
    
    try {
      console.log('DriverDocumentsScreen - Processando CNH:', uri);
      
      // Simular upload do documento
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setCnhUploaded(true);
      console.log('DriverDocumentsScreen - CNH enviada com sucesso');
      
      Alert.alert('Sucesso', 'CNH enviada com sucesso!');
      
    } catch (error) {
      console.error('DriverDocumentsScreen - Erro ao processar CNH:', error);
      Alert.alert('Erro', 'Não foi possível enviar a CNH. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!cnhUploaded) {
      Alert.alert('CNH Obrigatória', 'Você precisa enviar uma foto da sua CNH para continuar.');
      return;
    }

    try {
      console.log('DriverDocumentsScreen - CNH enviada, salvando dados');
      
      const updatedUserData = {
        ...userData,
        cnhUploaded: true,
        cnhUploadedAt: new Date().toISOString()
      };
      
      await AsyncStorage.setItem('@temp_user_data', JSON.stringify(updatedUserData));
      
      console.log('DriverDocumentsScreen - Navegando para finalização');
      navigation.navigate('CompleteRegistration', { userData: updatedUserData });
      
    } catch (error) {
      console.error('DriverDocumentsScreen - Erro ao salvar dados:', error);
      Alert.alert('Erro', 'Não foi possível salvar os dados. Tente novamente.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Envie uma foto da sua CNH</Text>
        <Text style={styles.subtitle}>Carteira Nacional de Habilitação</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.documentContainer}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🚗</Text>
          </View>
          
          <Text style={styles.description}>
            Tire uma foto clara da sua CNH ou escolha uma imagem da galeria. 
            Certifique-se de que todos os dados estejam legíveis.
          </Text>
          
          <View style={styles.uploadArea}>
            {cnhUploaded ? (
              <View style={styles.uploadedContainer}>
                <Text style={styles.uploadedIcon}>✅</Text>
                <Text style={styles.uploadedText}>CNH enviada com sucesso!</Text>
                <TouchableOpacity
                  style={styles.changeButton}
                  onPress={handleDocumentUpload}
                >
                  <Text style={styles.changeButtonText}>Alterar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={handleDocumentUpload}
                disabled={isLoading}
              >
                <Text style={styles.uploadIcon}>📷</Text>
                <Text style={styles.uploadText}>Escolher CNH</Text>
                <Text style={styles.uploadSubtext}>Foto ou arquivo</Text>
              </TouchableOpacity>
            )}
          </View>
          
          <View style={styles.requirementsContainer}>
            <Text style={styles.requirementsTitle}>Requisitos:</Text>
            <Text style={styles.requirement}>• CNH deve estar legível</Text>
            <Text style={styles.requirement}>• Todos os dados devem estar visíveis</Text>
            <Text style={styles.requirement}>• Aceitamos fotos ou arquivos PDF</Text>
            <Text style={styles.requirement}>• Tamanho máximo: 10MB</Text>
          </View>

          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>Próximos Passos:</Text>
            <Text style={styles.infoText}>
              Após enviar sua CNH, você será direcionado para o app. 
              Lá você poderá cadastrar seu veículo (CRLV, placa, cor, ano) 
              e começar a dirigir assim que sua conta for aprovada.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueButton, !cnhUploaded && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!cnhUploaded || isLoading}
        >
          <Text style={styles.continueButtonText}>
            {isLoading ? 'Enviando...' : 'Continuar'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },
  
  header: {
    backgroundColor: LEAF_GREEN,
    padding: 30,
    alignItems: 'center',
  },
  
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: WHITE,
    textAlign: 'center',
    marginBottom: 5,
  },
  
  subtitle: {
    fontSize: 16,
    color: WHITE,
    opacity: 0.9,
    textAlign: 'center',
  },
  
  content: {
    flex: 1,
    padding: 20,
  },
  
  documentContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: LIGHT_GRAY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  
  icon: {
    fontSize: 40,
  },
  
  description: {
    fontSize: 16,
    color: GRAY,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  
  uploadArea: {
    width: '100%',
    marginBottom: 30,
  },
  
  uploadButton: {
    backgroundColor: LIGHT_GRAY,
    borderWidth: 2,
    borderColor: GRAY,
    borderStyle: 'dashed',
    borderRadius: 15,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  uploadIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  
  uploadText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: DARK_GRAY,
    marginBottom: 5,
  },
  
  uploadSubtext: {
    fontSize: 14,
    color: GRAY,
  },
  
  uploadedContainer: {
    backgroundColor: '#E8F5E8',
    borderWidth: 2,
    borderColor: LEAF_GREEN,
    borderRadius: 15,
    padding: 30,
    alignItems: 'center',
  },
  
  uploadedIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  
  uploadedText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: LEAF_GREEN,
    marginBottom: 15,
  },
  
  changeButton: {
    backgroundColor: LEAF_GREEN,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  
  changeButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: WHITE,
  },
  
  requirementsContainer: {
    backgroundColor: LIGHT_GRAY,
    borderRadius: 10,
    padding: 20,
    width: '100%',
    marginBottom: 20,
  },
  
  requirementsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: DARK_GRAY,
    marginBottom: 10,
  },
  
  requirement: {
    fontSize: 14,
    color: GRAY,
    marginBottom: 5,
  },

  infoContainer: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: LEAF_GREEN,
    borderRadius: 10,
    padding: 20,
    width: '100%',
  },
  
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: LEAF_GREEN,
    marginBottom: 10,
  },
  
  infoText: {
    fontSize: 14,
    color: GRAY,
    lineHeight: 20,
  },
  
  footer: {
    padding: 20,
    backgroundColor: WHITE,
    borderTopWidth: 1,
    borderTopColor: LIGHT_GRAY,
  },
  
  continueButton: {
    backgroundColor: LEAF_GREEN,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  
  continueButtonDisabled: {
    backgroundColor: LIGHT_GRAY,
  },
  
  continueButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: WHITE,
  },
}); 