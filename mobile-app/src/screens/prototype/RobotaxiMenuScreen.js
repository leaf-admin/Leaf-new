import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { getMenuSectionsByRole, resolveMenuTargetRoute } from './robotaxiMenuConfig';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

export default function RobotaxiMenuScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { activeRole } = usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const isDriverRole = activeRole === 'driver';

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-menu',
    occludedBottom: panelHeight,
  });

  const roleMenuSections = useMemo(() => getMenuSectionsByRole(activeRole), [activeRole]);

  const handleDismiss = useCallback(() => {
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleOpenItem = useCallback(
    item => {
      const targetRoute = resolveMenuTargetRoute(item);
      if (targetRoute === 'EarningsReport') {
        navigation.navigate(targetRoute, {
          source: 'driver-menu',
          defaultRangeDays: 1,
          maxRangeDays: 30,
        });
        return;
      }

      navigation.replace(targetRoute);
    },
    [navigation]
  );

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-menu-screen"
        accessibilityLabel="robotaxi-menu-screen"
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow={isDriverRole ? 'Conta do motorista' : 'Conta do passageiro'}
            title="Menu"
            subtitle={
              isDriverRole
                ? 'Ganhos, corridas, ativacao e suporte em uma navegação direta.'
                : 'Perfil, viagens, suporte e ajustes em uma navegação direta.'
            }
            badgeLabel={isDriverRole ? 'Motorista' : 'Passageiro'}
            fullScreen
            style={[
              styles.panel,
              {
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              },
            ]}
            bodyStyle={styles.body}
            footer={
              <Text style={styles.footerNote}>
                {isDriverRole ? 'Leaf motorista' : 'Leaf passageiro'}
              </Text>
            }
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-menu-close-button"
                accessibilityLabel="robotaxi-menu-close-button"
              />
            )}
          >
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {roleMenuSections.map(section => (
                <PrototypeMenuSection key={section.key} title={section.title}>
                  {section.items.map((item, index) => (
                    <PrototypeMenuRow
                      key={item.key}
                      icon={item.icon}
                      title={item.title}
                      last={index === section.items.length - 1}
                      onPress={() => handleOpenItem(item)}
                      testID={`robotaxi-menu-item-${item.key}`}
                      accessibilityLabel={`robotaxi-menu-item-${item.key}`}
                    />
                  ))}
                </PrototypeMenuSection>
              ))}
            </ScrollView>
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    paddingBottom: 10,
  },
  body: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 18,
  },
  footerNote: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
});
