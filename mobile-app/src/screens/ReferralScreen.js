import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
  Share,
  Dimensions,
  TextInput
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from 'common';

const { width } = Dimensions.get('window');

const ReferralScreen = ({ navigation, route }) => {
  const [referralData, setReferralData] = useState({
    used_invites: 0,
    max_invites: 3,
    free_months: 0,
    max_free_months: 12,
    total_invites: 0,
    successful_invites: 0
  });
  
  const [invites, setInvites] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [inviteePhone, setInviteePhone] = useState('');
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  useEffect(() => {
    loadReferralData();
  }, []);

  const loadReferralData = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/baas/referral/${currentUser.id}`);
      setReferralData(response.data);
      
      // Carregar convites existentes
      const invitesResponse = await api.get(`/api/baas/referral/${currentUser.id}/invites`);
      setInvites(invitesResponse.data.invites || []);
      
    } catch (error) {
      console.error('Erro ao carregar dados de convites:', error);
      Alert.alert('Erro', 'Não foi possível carregar os dados de convites');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!inviteeEmail && !inviteePhone) {
      Alert.alert('Erro', 'Informe o email ou telefone do convidado');
      return;
    }

    if (referralData.used_invites >= referralData.max_invites) {
      Alert.alert('Limite Atingido', 'Você já usou todos os seus convites disponíveis');
      return;
    }

    try {
      setIsCreatingInvite(true);
      
      const response = await api.post('/api/baas/referral/create-invite', {
        inviter_id: currentUser.id,
        invitee_email: inviteeEmail,
        invitee_phone: inviteePhone
      });
      
      const newInvite = response.data.invite;
      setInvites([newInvite, ...invites]);
      setInviteCode(newInvite.invite_code);
      
      // Atualizar dados de convites
      setReferralData(prev => ({
        ...prev,
        used_invites: prev.used_invites + 1,
        total_invites: prev.total_invites + 1
      }));
      
      // Limpar campos
      setInviteeEmail('');
      setInviteePhone('');
      
      Alert.alert(
        'Convite Criado!',
        `Convite criado com sucesso!\nCódigo: ${newInvite.invite_code}`,
        [
          { text: 'Compartilhar', onPress: () => shareInvite(newInvite) },
          { text: 'OK' }
        ]
      );
      
    } catch (error) {
      console.error('Erro ao criar convite:', error);
      Alert.alert('Erro', 'Não foi possível criar o convite');
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const shareInvite = async (invite) => {
    try {
      const message = `🎫 Convite Leaf App!\n\n` +
        `Olá! Você foi convidado para usar o Leaf App!\n\n` +
        `Código do convite: ${invite.invite_code}\n\n` +
        `Benefícios:\n` +
        `✅ 100% das corridas ficam com você\n` +
        `✅ Taxa fixa semanal (sem surpresas)\n` +
        `✅ 1 mês grátis ao aceitar o convite\n\n` +
        `Baixe o app e use o código para se cadastrar!`;
      
      await Share.share({
        message,
        title: 'Convite Leaf App'
      });
    } catch (error) {
      console.error('Erro ao compartilhar convite:', error);
    }
  };

  const handleAcceptInvite = async () => {
    if (!inviteCode.trim()) {
      Alert.alert('Erro', 'Informe o código do convite');
      return;
    }

    try {
      setIsLoading(true);
      
      const response = await api.post('/api/baas/referral/accept-invite', {
        inviter_id: currentUser.id, // Será obtido do convite
        invitee_id: currentUser.id,
        invite_code: inviteCode.trim()
      });
      
      Alert.alert(
        'Convite Aceito!',
        `Parabéns! Você ganhou ${response.data.free_months} mês(es) grátis!\n\n` +
        `Seu convidador também ganhou ${response.data.free_months} mês(es) grátis.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
      
    } catch (error) {
      console.error('Erro ao aceitar convite:', error);
      Alert.alert('Erro', 'Não foi possível aceitar o convite. Verifique se o código está correto.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
      
      <Text style={styles.headerTitle}>Sistema de Convites</Text>
      
      <TouchableOpacity style={styles.helpButton}>
        <Icon name="help" type="material" color="#2c3e50" size={24} />
      </TouchableOpacity>
    </View>
  );

  const renderStats = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{referralData.used_invites}/{referralData.max_invites}</Text>
        <Text style={styles.statLabel}>Convites Usados</Text>
      </View>
      
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{referralData.free_months}/{referralData.max_free_months}</Text>
        <Text style={styles.statLabel}>Meses Grátis</Text>
      </View>
      
      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{referralData.successful_invites}</Text>
        <Text style={styles.statLabel}>Convites Aceitos</Text>
      </View>
    </View>
  );

  const renderCreateInvite = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Criar Novo Convite</Text>
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Email do convidado"
          value={inviteeEmail}
          onChangeText={setInviteeEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Telefone do convidado"
          value={inviteePhone}
          onChangeText={setInviteePhone}
          keyboardType="phone-pad"
        />
      </View>
      
      <TouchableOpacity
        style={[
          styles.createButton,
          (referralData.used_invites >= referralData.max_invites) && styles.disabledButton
        ]}
        onPress={handleCreateInvite}
        disabled={referralData.used_invites >= referralData.max_invites || isCreatingInvite}
      >
        {isCreatingInvite ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.createButtonText}>Criar Convite</Text>
        )}
      </TouchableOpacity>
      
      {referralData.used_invites >= referralData.max_invites && (
        <Text style={styles.limitWarning}>
          Você atingiu o limite de convites (3 por motorista)
        </Text>
      )}
    </View>
  );

  const renderAcceptInvite = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Aceitar Convite</Text>
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Código do convite"
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
        />
      </View>
      
      <TouchableOpacity
        style={styles.acceptButton}
        onPress={handleAcceptInvite}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.acceptButtonText}>Aceitar Convite</Text>
        )}
      </TouchableOpacity>
      
      <Text style={styles.acceptInfo}>
        Ao aceitar um convite, você e seu convidador ganham 1 mês grátis!
      </Text>
    </View>
  );

  const renderInvitesList = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Seus Convites</Text>
      
      {invites.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="email" type="material" color="#bdc3c7" size={48} />
          <Text style={styles.emptyText}>Nenhum convite criado ainda</Text>
        </View>
      ) : (
        <ScrollView style={styles.invitesList}>
          {invites.map((invite, index) => (
            <View key={index} style={styles.inviteCard}>
              <View style={styles.inviteHeader}>
                <Text style={styles.inviteCode}>{invite.invite_code}</Text>
                <View style={[
                  styles.statusBadge,
                  invite.status === 'accepted' ? styles.acceptedBadge : styles.pendingBadge
                ]}>
                  <Text style={styles.statusText}>
                    {invite.status === 'accepted' ? 'Aceito' : 'Pendente'}
                  </Text>
                </View>
              </View>
              
              <Text style={styles.inviteInfo}>
                Para: {invite.invitee_email || invite.invitee_phone}
              </Text>
              
              <Text style={styles.inviteDate}>
                Criado em: {new Date(invite.created_at).toLocaleDateString()}
              </Text>
              
              {invite.status === 'pending' && (
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={() => shareInvite(invite)}
                >
                  <Icon name="share" type="material" color="#3498db" size={20} />
                  <Text style={styles.shareText}>Compartilhar</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderBenefits = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Como Funciona</Text>
      
      <View style={styles.benefitCard}>
        <Icon name="star" type="material" color="#f39c12" size={24} />
        <View style={styles.benefitContent}>
          <Text style={styles.benefitTitle}>Convite Amigos</Text>
          <Text style={styles.benefitDescription}>
            Convide até 3 amigos para usar o Leaf App
          </Text>
        </View>
      </View>
      
      <View style={styles.benefitCard}>
        <Icon name="directions-car" type="material" color="#e74c3c" size={24} />
        <View style={styles.benefitContent}>
          <Text style={styles.benefitTitle}>10 Corridas Mínimas</Text>
          <Text style={styles.benefitDescription}>
            Seu convidado precisa fazer pelo menos 10 corridas
          </Text>
        </View>
      </View>
      
      <View style={styles.benefitCard}>
        <Icon name="card-giftcard" type="material" color="#9b59b6" size={24} />
        <View style={styles.benefitContent}>
          <Text style={styles.benefitTitle}>1 Mês Grátis</Text>
          <Text style={styles.benefitDescription}>
            Ambos ganham 1 mês grátis quando o convite é aceito
          </Text>
        </View>
      </View>
      
      <View style={styles.benefitCard}>
        <Icon name="security" type="material" color="#27ae60" size={24} />
        <View style={styles.benefitContent}>
          <Text style={styles.benefitTitle}>Máximo 12 Meses</Text>
          <Text style={styles.benefitDescription}>
            Limite máximo de 12 meses grátis por motorista
          </Text>
        </View>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando dados de convites...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8f9fa" />
      
      {renderHeader()}
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {renderStats()}
        {renderCreateInvite()}
        {renderAcceptInvite()}
        {renderInvitesList()}
        {renderBenefits()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  helpButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E8B57',
  },
  statLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 10,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  createButton: {
    backgroundColor: '#2E8B57',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  disabledButton: {
    backgroundColor: '#bdc3c7',
  },
  limitWarning: {
    color: '#e74c3c',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  acceptButton: {
    backgroundColor: '#3498db',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  acceptInfo: {
    color: '#7f8c8d',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#7f8c8d',
    fontSize: 16,
    marginTop: 12,
  },
  invitesList: {
    maxHeight: 300,
  },
  inviteCard: {
    borderWidth: 1,
    borderColor: '#e9ecef',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  inviteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inviteCode: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  acceptedBadge: {
    backgroundColor: '#d5f4e6',
  },
  pendingBadge: {
    backgroundColor: '#fff3cd',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  inviteInfo: {
    color: '#7f8c8d',
    fontSize: 14,
    marginBottom: 4,
  },
  inviteDate: {
    color: '#95a5a6',
    fontSize: 12,
    marginBottom: 8,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  shareText: {
    color: '#3498db',
    fontSize: 14,
    marginLeft: 4,
  },
  benefitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  benefitContent: {
    flex: 1,
    marginLeft: 12,
  },
  benefitTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  benefitDescription: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 20,
  },
});

export default ReferralScreen; 