import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  setAndroidPermissionDisclosurePresenter,
} from '../services/AndroidPermissionDisclosure';

function getDetailItems(kind) {
  if (kind === 'background-location') {
    return [
      'Coletamos localização precisa somente enquanto você estiver online como motorista ou durante uma corrida.',
      'Usada para receber corridas próximas, manter navegação ativa e compartilhar sua posição com o passageiro.',
      'Pode continuar em segundo plano, mesmo quando o app estiver fechado ou não estiver em uso.',
      'A Leaf não usa sua localização para anúncios.',
    ];
  }

  if (kind === 'foreground-location') {
    return [
      'Coletamos localização precisa para definir partida, mostrar sua posição no mapa e calcular rota, preço e tempo.',
      'Durante a corrida, a localização pode ser compartilhada entre passageiro e motorista para embarque e segurança.',
      'A Leaf não usa sua localização para anúncios.',
    ];
  }

  if (kind === 'notifications') {
    return [
      'Usadas para avisar sobre corridas, pagamentos, segurança e suporte.',
      'Você pode ajustar as notificações depois nas configurações do aparelho.',
    ];
  }

  if (kind === 'phone-state') {
    return [
      'Usada somente quando você escolhe detectar seu número automaticamente.',
      'Você também pode digitar o número manualmente.',
      'A Leaf não usa essa permissão para anúncios.',
    ];
  }

  return ['A permissão será solicitada pelo Android no próximo passo.'];
}

export default function AndroidPermissionDisclosureHost() {
  const queueRef = useRef([]);
  const activeRequestRef = useRef(null);
  const [activeRequest, setActiveRequest] = useState(null);

  const pumpQueue = useCallback(() => {
    if (activeRequestRef.current || queueRef.current.length === 0) {
      return;
    }

    const nextRequest = queueRef.current.shift();
    activeRequestRef.current = nextRequest;
    setActiveRequest(nextRequest);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const unregister = setAndroidPermissionDisclosurePresenter((config) => (
      new Promise((resolve) => {
        queueRef.current.push({ config, resolve });
        pumpQueue();
      })
    ));

    return unregister;
  }, [pumpQueue]);

  const finish = useCallback((accepted) => {
    const request = activeRequestRef.current;
    activeRequestRef.current = null;
    setActiveRequest(null);
    request?.resolve(Boolean(accepted));
    setTimeout(pumpQueue, 0);
  }, [pumpQueue]);

  if (Platform.OS !== 'android' || !activeRequest) {
    return null;
  }

  const { config } = activeRequest;
  const title = config?.title || 'Permissão da Leaf';
  const message = config?.message || 'A Leaf precisa explicar esta permissão antes de solicitar o acesso pelo Android.';
  const confirmText = config?.confirmText || 'Entendi e continuar';
  const cancelText = config?.cancelText || 'Agora não';
  const detailItems = getDetailItems(config?.kind);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => finish(false)}
    >
      <View style={styles.overlay} testID="android-permission-disclosure-overlay">
        <View style={styles.card} testID="android-permission-disclosure-card">
          <View style={styles.handle} />
          <Text style={styles.eyebrow}>Permissão do Android</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.details}>
            {detailItems.map((item) => (
              <View key={item} style={styles.detailRow}>
                <View style={styles.dot} />
                <Text style={styles.detailText}>{item}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.nextStep}>
            Ao continuar, o Android abrirá a solicitação de permissão.
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              testID="android-permission-disclosure-cancel"
              style={styles.secondaryButton}
              onPress={() => finish(false)}
              activeOpacity={0.75}
            >
              <Text style={styles.secondaryButtonText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="android-permission-disclosure-accept"
              style={styles.primaryButton}
              onPress={() => finish(true)}
              activeOpacity={0.82}
            >
              <Text style={styles.primaryButtonText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 19, 16, 0.44)',
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingBottom: 96,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: 'rgba(26, 51, 14, 0.10)',
    shadowColor: '#101810',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D8D2CA',
    marginBottom: 18,
  },
  eyebrow: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#7C8276',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 24,
    lineHeight: 29,
    color: '#111410',
    marginBottom: 10,
  },
  message: {
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    lineHeight: 21,
    color: '#4B5148',
  },
  details: {
    marginTop: 18,
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#1A330E',
    marginTop: 7,
  },
  detailText: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#555C52',
  },
  nextStep: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: '#7C8276',
    marginTop: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  secondaryButton: {
    flex: 0.86,
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F6F3',
    borderWidth: 1,
    borderColor: '#E1E2DD',
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: '#4D544A',
  },
  primaryButton: {
    flex: 1.22,
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A330E',
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },
});
