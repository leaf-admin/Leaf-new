import Logger from '../utils/Logger';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, Image } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../common/theme';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import OnboardingLayout from '../components/OnboardingLayout';
import { useTranslation } from '../components/i18n/LanguageProvider';


const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

export default function CNHUploadScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const userType = route?.params?.userType || 'driver';
  const userData = route?.params?.userData || {};

  const [cnhImage, setCnhImage] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    try {
      // Solicitar permissão
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('messages.permissionRequired'), t('cnh.galleryPermissionMessage'));
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCnhImage(result.assets[0]);
      }
    } catch (error) {
      Logger.error('Erro ao selecionar imagem:', error);
      Alert.alert(t('messages.error'), t('cnh.imageSelectionError'));
    }
  };

  const takePhoto = async () => {
    try {
      // Solicitar permissão
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('messages.permissionRequired'), t('cnh.cameraPermissionMessage'));
        return;
      }

      let result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCnhImage(result.assets[0]);
      }
    } catch (error) {
      Logger.error('Erro ao tirar foto:', error);
      Alert.alert(t('messages.error'), t('cnh.photoError'));
    }
  };

  const handleContinue = async () => {
    if (!cnhImage) {
      Alert.alert(t('messages.attention'), t('cnh.pleaseUploadPhoto'));
      return;
    }

    setLoading(true);
    
    try {
      // Aqui você implementaria o upload da imagem para o servidor
      Logger.log('CNH selecionada:', cnhImage);
      
      // Simular upload
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Navegar para a próxima tela com os dados
      navigation.navigate('CRLVUploadScreen', {
        userType: userType,
        userData: {
          ...userData,
          cnhImage: cnhImage
        }
      });
      
    } catch (error) {
      Logger.error('Erro ao processar CNH:', error);
      Alert.alert(t('messages.error'), t('cnh.processingError'));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigation.goBack();
  };

  // Barra de progresso customizada
  const progressBar = (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={[styles.progressDot, styles.progressActive]} />
    </View>
  );

  return (
    <OnboardingLayout
      progress={progressBar}
      onContinue={handleContinue}
      continueLabel={loading ? "Processando..." : "Continuar"}
      continueDisabled={!cnhImage || loading}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Envie sua CNH</Text>
        <Text style={styles.subtitle}>
          Tire uma foto ou selecione da galeria a foto da sua Carteira Nacional de Habilitação
        </Text>
        
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            
            {/* Preview da imagem */}
            {cnhImage && (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: cnhImage.uri }} style={styles.imagePreview} />
                <TouchableOpacity 
                  style={styles.removeButton}
                  onPress={() => setCnhImage(null)}
                >
                  <MaterialCommunityIcons name="close-circle" size={24} color="#FF4444" />
                </TouchableOpacity>
              </View>
            )}

            {/* Opções de upload */}
            {!cnhImage && (
              <View style={styles.uploadOptions}>
                <TouchableOpacity style={styles.uploadOption} onPress={takePhoto}>
                  <View style={styles.uploadIconContainer}>
                    <MaterialCommunityIcons name="camera" size={32} color={LEAF_GREEN} />
                  </View>
                  <Text style={styles.uploadOptionTitle}>Tirar foto</Text>
                  <Text style={styles.uploadOptionSubtitle}>Use a câmera do seu celular</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.uploadOption} onPress={pickImage}>
                  <View style={styles.uploadIconContainer}>
                    <MaterialCommunityIcons name="image" size={32} color={LEAF_GREEN} />
                  </View>
                  <Text style={styles.uploadOptionTitle}>Selecionar da galeria</Text>
                  <Text style={styles.uploadOptionSubtitle}>Escolha uma foto existente</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Informações importantes */}
            <View style={styles.infoContainer}>
              <Text style={styles.infoTitle}>📋 Informações importantes:</Text>
              <Text style={styles.infoText}>• A foto deve estar nítida e legível</Text>
              <Text style={styles.infoText}>• Todos os dados devem estar visíveis</Text>
              <Text style={styles.infoText}>• Evite reflexos e sombras</Text>
              <Text style={styles.infoText}>• Certifique-se de que a CNH não está vencida</Text>
            </View>

            {/* Status do upload */}
            {cnhImage && (
              <View style={styles.statusContainer}>
                <MaterialCommunityIcons name="check-circle" size={24} color="#4CAF50" />
                <Text style={styles.statusText}>CNH selecionada com sucesso!</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: LEAF_GREEN,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: LEAF_GRAY,
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  content: {
    width: '100%',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    width: '100%',
    marginBottom: 24,
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'white',
    borderRadius: 12,
  },
  uploadOptions: {
    width: '100%',
    marginBottom: 24,
  },
  uploadOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  uploadIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: LEAF_GREEN + '10',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  uploadOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginBottom: 4,
  },
  uploadOptionSubtitle: {
    fontSize: 14,
    color: LEAF_GRAY,
  },
  infoContainer: {
    width: '100%',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: LEAF_GREEN,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: LEAF_GRAY,
    marginBottom: 4,
    lineHeight: 20,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50' + '10',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  statusText: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
    marginLeft: 8,
  },
  progressBarContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 0,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.BORDER_BACKGROUND,
    marginHorizontal: 4,
  },
  progressActive: {
    backgroundColor: colors.BIDTAXIPRIMARY,
  },
}); 