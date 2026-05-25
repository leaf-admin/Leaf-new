import Logger from '../utils/Logger';
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
  Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { fonts } from '../theme/runtimeTokens';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { logOut, updateProfileImage } from '../services/runtime/profileActionsBridge';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { color, typography } = robotaxiPrototypeTokens;

function getInitials(firstName = '', lastName = '', fallback = '') {
  const left = String(firstName || '').trim().charAt(0).toUpperCase();
  const right = String(lastName || '').trim().charAt(0).toUpperCase();
  const joined = `${left}${right}`.trim();
  if (joined) return joined;
  const fallbackInitial = String(fallback || '').trim().charAt(0).toUpperCase();
  return fallbackInitial || 'L';
}

export default function SettingsScreen({ navigation }) {
  const dispatch = useDispatch();
  const auth = useSelector(state => state.auth);
  const insets = useSafeAreaInsets();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        setIsLoading(true);
        const storedUserData = await AsyncStorage.getItem('@user_data');
        if (storedUserData) {
          setUserData(JSON.parse(storedUserData));
          return;
        }

        if (auth?.profile) {
          setUserData(auth.profile);
        }
      } catch (error) {
        Logger.error('Erro ao carregar dados do usuário:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserData();
  }, [auth?.profile]);

  const handleLogout = () => {
    Alert.alert('Sair', 'Tem certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => dispatch(logOut()) }
    ]);
  };

  const handleCameraPress = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão negada', 'É necessário permitir acesso à galeria para alterar a foto.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const image = result.assets[0];
      if (!image.uri) {
        return;
      }

      const response = await fetch(image.uri);
      const blob = await response.blob();
      const uploadResult = await updateProfileImage(blob, image.uri);

      if (uploadResult?.url) {
        setUserData(previous => ({
          ...(previous || {}),
          profile_image: uploadResult.url
        }));
      }

      Alert.alert('Sucesso', 'Foto de perfil atualizada com sucesso!');
    } catch (error) {
      Logger.error('Erro ao selecionar/atualizar imagem:', error);
      Alert.alert('Erro', String(error?.message || error));
    }
  };

  const userType = auth?.profile?.usertype || auth?.profile?.userType;
  const isDriver = userType === 'driver';

  const menuItems = useMemo(
    () => [
      ...(isDriver
        ? [
            { id: 'profile', title: 'Editar Perfil', icon: 'person-outline', screen: 'EditProfile' },
            { id: 'documents', title: 'Documentos', icon: 'document-text-outline', screen: 'DriverDocuments' },
            { id: 'earnings', title: 'Relatório de Ganhos', icon: 'cash-outline', screen: 'EarningsReport' },
            { id: 'vehicles', title: 'Meus Veículos', icon: 'car-outline', screen: 'Cars' }
          ]
        : [{ id: 'profile', title: 'Editar Perfil', icon: 'person-outline', screen: 'EditProfileScreen' }]),
      { id: 'trips', title: 'Histórico de Viagens', icon: 'time-outline', screen: 'Rides' },
      { id: 'messages', title: 'Mensagens', icon: 'chatbubbles-outline', screen: 'Chat' },
      { id: 'privacy', title: 'Privacidade', icon: 'shield-checkmark-outline', screen: 'PrivacyPolicy' },
      {
        id: 'delete-account',
        title: 'Excluir Conta',
        icon: 'trash-outline',
        screen: 'PrivacyPolicy',
        params: { initialSection: 'user-rights' }
      },
      { id: 'settings', title: 'Configurações', icon: 'settings-outline', screen: 'Settings' },
      { id: 'help', title: 'Ajuda', icon: 'help-circle-outline', screen: 'Help' }
    ],
    [isDriver]
  );

  const profileName = `${userData?.firstName || auth?.profile?.firstName || ''} ${
    userData?.lastName || auth?.profile?.lastName || ''
  }`.trim();

  const profileEmail = userData?.email || auth?.profile?.email || 'sem-email@leaf.app';
  const profileImage = userData?.profile_image || auth?.profile?.profile_image || null;

  return (
    <View style={[styles.container, isDarkMode && styles.containerDark]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: insets.top + 10 }, isDarkMode && styles.headerDark]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" color="#FFFFFF" size={20} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isDarkMode && styles.headerTitleDark]}>Configurações</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={color.accent.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.profileCard, isDarkMode && styles.cardDark]}>
            <View style={styles.profileTopRow}>
              <View style={styles.avatarWrap}>
                {profileImage ? (
                  <Image source={{ uri: profileImage }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImageFallback}>
                    <Text style={styles.profileImageInitials}>{getInitials(userData?.firstName, userData?.lastName, profileName)}</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.cameraButton} onPress={handleCameraPress} activeOpacity={0.88}>
                  <Ionicons name="camera" size={14} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.profileTextWrap}>
                <Text style={[styles.profileName, isDarkMode && styles.textLight]}>{profileName || 'Usuário Leaf'}</Text>
                <Text style={[styles.profileEmail, isDarkMode && styles.textMutedDark]}>{profileEmail}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate(isDriver ? 'EditProfile' : 'EditProfileScreen')}
              activeOpacity={0.88}
            >
              <Ionicons name="create-outline" size={16} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Editar Perfil</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.sectionCard, isDarkMode && styles.cardDark]}>
            <View style={styles.settingRow}>
              <View style={styles.settingLabelWrap}>
                <View style={styles.settingIconWrap}>
                  <Ionicons name="moon-outline" size={16} color={color.text.primary} />
                </View>
                <View style={styles.settingTextWrap}>
                  <Text style={[styles.settingTitle, isDarkMode && styles.textLight]}>Tema escuro (local)</Text>
                  <Text style={[styles.settingDescription, isDarkMode && styles.textMutedDark]}>
                    Ajuste visual desta tela no dispositivo atual.
                  </Text>
                </View>
              </View>
              <Switch
                value={isDarkMode}
                onValueChange={setIsDarkMode}
                trackColor={{ false: '#D9DFE6', true: '#9BB38E' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#D9DFE6"
                style={styles.toggleSwitch}
              />
            </View>
          </View>

          <View style={[styles.sectionCard, isDarkMode && styles.cardDark]}>
            {menuItems.map(item => {
              const isDeleteAccountItem = item.id === 'delete-account';
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.menuRow}
                  onPress={() => navigation.navigate(item.screen, item.params)}
                  activeOpacity={0.86}
                >
                  <View style={styles.menuRowLeft}>
                    <View style={styles.menuIconWrap}>
                      <Ionicons
                        name={item.icon}
                        size={16}
                        color={isDeleteAccountItem ? '#C0392B' : color.text.primary}
                      />
                    </View>
                    <Text
                      style={[
                        styles.menuRowText,
                        isDarkMode && styles.textLight,
                        isDeleteAccountItem && styles.deleteMenuText
                      ]}
                    >
                      {item.title}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={isDeleteAccountItem ? '#C0392B' : isDarkMode ? '#A6B0BE' : color.text.secondary}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.88}>
            <Ionicons name="log-out-outline" size={16} color="#8A2A2A" />
            <Text style={styles.logoutText}>Sair da conta</Text>
          </TouchableOpacity>

          <Text style={[styles.versionText, isDarkMode && styles.textMutedDark]}>Versão 1.0.0</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.app
  },
  containerDark: {
    backgroundColor: '#0E1522'
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 30,
    paddingBottom: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  headerDark: {
    backgroundColor: 'transparent'
  },
  headerButton: {
    width: 39,
    height: 39,
    borderRadius: 19.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)'
  },
  headerTitle: {
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    color: color.text.primary
  },
  headerTitleDark: {
    color: '#F3F7FC'
  },
  headerPlaceholder: {
    width: 39,
    height: 39
  },
  content: {
    flex: 1
  },
  contentContainer: {
    paddingHorizontal: 14,
    paddingBottom: 24,
    gap: 10
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  profileCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: color.surface.primary,
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  cardDark: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.14)'
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  avatarWrap: {
    position: 'relative'
  },
  profileImage: {
    width: 76,
    height: 76,
    borderRadius: 38
  },
  profileImageFallback: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DDE3EC'
  },
  profileImageInitials: {
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    color: '#445066'
  },
  cameraButton: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.accent.primary,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  profileTextWrap: {
    flex: 1,
    marginLeft: 12
  },
  profileName: {
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    color: color.text.primary
  },
  profileEmail: {
    marginTop: 2,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    color: color.text.secondary
  },
  textLight: {
    color: '#F3F7FC'
  },
  textMutedDark: {
    color: '#AAB5C5'
  },
  primaryButton: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: color.accent.strong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  sectionCard: {
    borderRadius: 20,
    backgroundColor: color.surface.primary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    overflow: 'hidden'
  },
  settingRow: {
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  settingLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
  },
  settingIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,26,38,0.08)'
  },
  settingTextWrap: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8
  },
  settingTitle: {
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    color: color.text.primary
  },
  settingDescription: {
    marginTop: 1,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    color: color.text.secondary
  },
  toggleSwitch: {
    transform: [{ scaleX: 0.82 }, { scaleY: 0.82 }]
  },
  menuRow: {
    minHeight: 52,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(18,26,38,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  menuRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
  },
  menuIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,26,38,0.08)',
    marginRight: 10
  },
  menuRowText: {
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    color: color.text.primary
  },
  deleteMenuText: {
    color: '#C0392B'
  },
  logoutButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(138,42,42,0.25)',
    backgroundColor: 'rgba(138,42,42,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  logoutText: {
    color: '#8A2A2A',
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  versionText: {
    textAlign: 'center',
    marginTop: 8,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    color: color.text.muted
  }
});
