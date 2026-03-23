import React, { useCallback, useState } from 'react';
import { Image, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 100;
const FALLBACK_CARD_HEIGHT = 252;

const actions = [
  { id: 'history', label: 'Histórico de viagens', icon: 'time-outline' },
  { id: 'payment', label: 'Pagamento via PIX', icon: 'card-outline' },
  { id: 'safety', label: 'Segurança e suporte', icon: 'shield-checkmark-outline' }
];

export default function RobotaxiProfileScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const { riderProfile } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const profileName = riderProfile?.name || authProfile?.name || authProfile?.firstName || 'Usuário Leaf';
  const parsedRating = Number(authProfile?.rating || authProfile?.driverRating || 4.9);
  const profileRating = Number.isFinite(parsedRating) ? parsedRating : 4.9;
  const profileImage = authProfile?.profile_image || authProfile?.profileImage || 'https://i.pravatar.cc/128?img=47';

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-profile',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.profileCard}>
            <CardHandle />

            <View style={styles.profileHeader}>
              <Image source={{ uri: profileImage }} style={styles.avatar} />
              <View style={styles.profileTextWrap}>
                <Text style={styles.name}>{profileName}</Text>
                <Text style={styles.info}>Passageira premium • {Number(profileRating).toFixed(1)}</Text>
              </View>
            </View>

            {actions.map(item => {
              let targetRoute = null;
              if (item.id === 'history') {
                targetRoute = 'RobotaxiPrototypeReceipt';
              } else if (item.id === 'payment') {
                targetRoute = 'RobotaxiPrototypePayment';
              } else if (item.id === 'safety') {
                targetRoute = 'RobotaxiPrototypeSupport';
              }

              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.actionRow}
                  activeOpacity={0.87}
                  onPress={() => {
                    if (targetRoute) {
                      navigation.navigate(targetRoute);
                    }
                  }}
                >
                  <Ionicons name={item.icon} size={16} color={color.text.primary} />
                  <Text style={styles.actionLabel}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={color.text.secondary} />
                </TouchableOpacity>
              );
            })}
          </PrototypeCard>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  sheetWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  profileCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  profileHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center'
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: color.border.strong
  },
  profileTextWrap: {
    marginLeft: 10
  },
  name: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  info: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  actionRow: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    marginTop: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  actionLabel: {
    flex: 1,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  }
});
