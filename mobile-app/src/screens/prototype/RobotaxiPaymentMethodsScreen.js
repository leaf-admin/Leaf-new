import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import SecurePaymentBadge from '../../components/payment/SecurePaymentBadge';
import { getPaymentMethods } from '../../services/runtime/paymentMethodsService';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

function formatMethodTitle(method) {
  const type = String(method?.type || method?.brand || method?.method || 'PIX').toUpperCase();
  if (type.includes('PIX')) return 'PIX';
  if (method?.last4) return `${type} final ${method.last4}`;
  return type;
}

function formatMethodSubtitle(method) {
  if (!method) {
    return 'Método padrão para o piloto Leaf';
  }
  if (method?.pixKey) {
    return `Chave ${method.pixKey}`;
  }
  if (method?.isDefault || method?.default) {
    return 'Padrão para novas corridas';
  }
  if (method?.createdAt) {
    return 'Cadastrado no app';
  }
  return 'Disponível para pagamentos';
}

export default function RobotaxiPaymentMethodsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const authProfile = useSelector(state => state?.auth?.profile);
  const runtime = usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState([]);
  const uid = authProfile?.uid || runtime.profileUid || runtime.profile?.uid || '';

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-payment-methods',
    occludedBottom: panelHeight,
  });

  useEffect(() => {
    let mounted = true;
    if (!uid) {
      setMethods([]);
      return () => {
        mounted = false;
      };
    }

    setLoading(true);
    setError('');
    getPaymentMethods(uid, { suppressErrorLog: true })
      .then(nextMethods => {
        if (mounted) {
          setMethods(Array.isArray(nextMethods) ? nextMethods : []);
        }
      })
      .catch(fetchError => {
        if (mounted) {
          setError('Não foi possível sincronizar os métodos agora. O PIX segue ativo para este pedido.');
          setMethods([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [uid]);

  const visibleMethods = useMemo(() => {
    if (methods.length > 0) {
      return methods;
    }
    return [
      {
        id: 'leaf-pix-default',
        type: 'PIX',
        isDefault: true,
        subtitle: 'Método ativo no fluxo atual',
      },
    ];
  }, [methods]);

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleAddMethod = useCallback(() => {
    Alert.alert(
      'Método de pagamento',
      'Nesta fase o PIX fica como método principal. Cartão e carteira serão reativados quando o fluxo financeiro sair do piloto controlado.',
    );
  }, []);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-payment-methods-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Conta"
            title="Métodos de pagamento"
            subtitle="Veja como a corrida será paga antes de confirmar a solicitação."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-payment-methods-close-button"
                accessibilityLabel="robotaxi-payment-methods-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <PrototypeMenuSection title="Ativo agora">
                {visibleMethods.map((method, index) => (
                  <PrototypeMenuRow
                    key={method.id || `${method.type}-${index}`}
                    icon="card-outline"
                    title={formatMethodTitle(method)}
                    subtitle={method.subtitle || formatMethodSubtitle(method)}
                    badge={method.isDefault || method.default ? 'padrão' : undefined}
                    active={index === 0}
                    last={index === visibleMethods.length - 1}
                    trailing={null}
                  />
                ))}
                <SecurePaymentBadge style={styles.securePaymentBadge} />
              </PrototypeMenuSection>

              {loading ? (
                <View style={styles.feedbackRow}>
                  <ActivityIndicator size="small" color={leafRideColors.leaf} />
                  <Text style={styles.feedbackText}>Carregando métodos...</Text>
                </View>
              ) : null}
              {error ? <Text style={styles.feedbackText}>{error}</Text> : null}

              {methods.length === 0 && !loading ? (
                <LeafEmptyState
                  icon="qr-code-outline"
                  title="PIX é o padrão do piloto"
                  message="A tela dedicada já fica pronta para cartão e carteira, mas hoje o fluxo seguro passa pelo PIX."
                  testID="robotaxi-payment-methods-empty-state"
                />
              ) : null}

              <PrototypeMenuSection title="Transparência">
                <PrototypeMenuInfoRow label="Cobrança" value="Antes da busca" />
                <PrototypeMenuInfoRow label="Estorno" value="Automático quando não há motorista" />
                <PrototypeMenuInfoRow label="Recibo" value="Disponível ao final da viagem" last />
              </PrototypeMenuSection>

              <LeafButton
                label="Adicionar método"
                icon="add-outline"
                tone="primary"
                onPress={handleAddMethod}
                style={styles.doneButton}
                testID="robotaxi-payment-methods-add"
                accessibilityLabel="robotaxi-payment-methods-add"
              />
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
  content: {
    paddingTop: 18,
    paddingBottom: 30,
    gap: 18,
  },
  feedbackRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  securePaymentBadge: {
    marginTop: -4,
  },
  errorText: {
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 17,
  },
  doneButton: {
    alignSelf: 'stretch',
  },
});
