import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Modal explicativo de permissões
 * Exibe antes de solicitar permissões para aumentar aprovação nas lojas
 * Segue padrão Apple/Google-safe com textos claros e não coercitivos
 */
const PermissionExplanationModal = ({
  visible,
  onClose,
  onAccept,
  permissionType = 'location', // 'location', 'camera', 'photos', 'notifications'
  userType = 'customer', // 'driver' ou 'customer'
  locationType = 'foreground', // 'foreground' ou 'background' (apenas para location)
}) => {
  const getPermissionInfo = () => {
    // Localização - Motorista
    if (permissionType === 'location' && userType === 'driver') {
      if (locationType === 'background') {
        return {
          title: '🚗 Receba corridas mesmo com o app em segundo plano',
          text: 'Para receber solicitações de corrida enquanto você estiver online como motorista, a Leaf precisa acessar sua localização mesmo quando o app estiver em segundo plano.\n\nA localização é utilizada apenas enquanto você estiver online e nunca fora desse contexto.',
          acceptButton: 'Permitir enquanto estiver online',
          cancelButton: 'Agora não',
        };
      } else {
        return {
          title: '📍 Navegação e coleta no local correto',
          text: 'A Leaf usa sua localização para ajudar você a navegar até o passageiro, calcular rotas e registrar o início e o fim das viagens.\n\nSem essa permissão, você ainda poderá acessar o app, mas não conseguirá realizar viagens.',
          acceptButton: 'Permitir localização',
          cancelButton: 'Agora não',
        };
      }
    }

    // Localização - Passageiro
    if (permissionType === 'location' && userType === 'customer') {
      return {
        title: '📍 Encontre motoristas próximos',
        text: 'A Leaf usa sua localização para encontrar motoristas próximos, calcular rotas e estimar o valor da corrida.\n\nVocê pode continuar usando o app sem ativar a localização, mas não será possível solicitar corridas.',
        acceptButton: 'Ativar localização',
        cancelButton: 'Agora não',
      };
    }

    // Câmera - Motorista
    if (permissionType === 'camera' && userType === 'driver') {
      return {
        title: '📷 Verificação de identidade',
        text: 'A câmera é usada para capturar sua foto de perfil e realizar a verificação de identidade, garantindo mais segurança para passageiros e motoristas.',
        acceptButton: 'Permitir câmera',
        cancelButton: 'Agora não',
      };
    }

    // Câmera - Passageiro
    if (permissionType === 'camera' && userType === 'customer') {
      return {
        title: '📷 Foto de perfil',
        text: 'A câmera é usada para tirar sua foto de perfil e ajudar na identificação durante a viagem.',
        acceptButton: 'Permitir câmera',
        cancelButton: 'Agora não',
      };
    }

    // Galeria - Motorista
    if (permissionType === 'photos' && userType === 'driver') {
      return {
        title: '🖼️ Envio de documentos',
        text: 'A Leaf precisa acessar suas fotos para que você possa enviar documentos do veículo e escolher uma foto de perfil.',
        acceptButton: 'Permitir acesso',
        cancelButton: 'Agora não',
      };
    }

    // Galeria - Passageiro
    if (permissionType === 'photos' && userType === 'customer') {
      return {
        title: '🖼️ Escolha sua foto',
        text: 'A Leaf precisa acessar suas fotos para que você possa escolher uma imagem de perfil.',
        acceptButton: 'Permitir acesso',
        cancelButton: 'Agora não',
      };
    }

    // Notificações - Motorista
    if (permissionType === 'notifications' && userType === 'driver') {
      return {
        title: '🔔 Receba novas corridas',
        text: 'Ative as notificações para receber alertas de novas corridas, atualizações de viagem e mensagens importantes enquanto estiver online.',
        acceptButton: 'Ativar notificações',
        cancelButton: 'Agora não',
      };
    }

    // Notificações - Passageiro
    if (permissionType === 'notifications' && userType === 'customer') {
      return {
        title: '🔔 Acompanhe sua corrida',
        text: 'Ative as notificações para receber atualizações importantes, como confirmação da corrida, chegada do motorista e mensagens durante a viagem.',
        acceptButton: 'Ativar notificações',
        cancelButton: 'Agora não',
      };
    }

    // Fallback padrão
    return {
      title: 'Permissão Necessária',
      text: 'Esta permissão é necessária para o funcionamento do aplicativo.',
      acceptButton: 'Permitir',
      cancelButton: 'Agora não',
    };
  };

  const info = getPermissionInfo();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>{info.title}</Text>
          
          <Text style={styles.text}>{info.text}</Text>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>{info.cancelButton}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.acceptButton}
              onPress={onAccept}
              activeOpacity={0.8}
            >
              <Text style={styles.acceptButtonText}>{info.acceptButton}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 16,
    lineHeight: 20,
  },
  text: {
    fontSize: 12,
    fontWeight: 'normal',
    color: '#333',
    lineHeight: 18,
    marginBottom: 24,
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  acceptButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#003002',
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});

export default PermissionExplanationModal;

