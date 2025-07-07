import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from './theme';

export const PrivacyPolicy = () => {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Política de Privacidade</Text>
      
      <Text style={styles.section}>1. Coleta de Informações</Text>
      <Text style={styles.text}>
        O Leaf coleta informações necessárias para fornecer nossos serviços, incluindo:
        - Informações de perfil (nome, email, telefone)
        - Localização (para melhorar pickups e dropoffs)
        - Dados de pagamento (processados de forma segura)
      </Text>

      <Text style={styles.section}>2. Uso das Informações</Text>
      <Text style={styles.text}>
        Utilizamos suas informações para:
        - Fornecer e melhorar nossos serviços
        - Processar pagamentos
        - Enviar notificações importantes
        - Melhorar a segurança
      </Text>

      <Text style={styles.section}>3. Compartilhamento de Dados</Text>
      <Text style={styles.text}>
        Não compartilhamos suas informações pessoais com terceiros, exceto quando:
        - Necessário para fornecer nossos serviços
        - Exigido por lei
        - Com seu consentimento explícito
      </Text>

      <Text style={styles.section}>4. Segurança</Text>
      <Text style={styles.text}>
        Implementamos medidas de segurança para proteger suas informações, incluindo:
        - Criptografia de dados
        - Autenticação segura
        - Monitoramento de segurança
      </Text>

      <Text style={styles.section}>5. Seus Direitos</Text>
      <Text style={styles.text}>
        Você tem direito a:
        - Acessar suas informações
        - Corrigir dados imprecisos
        - Solicitar exclusão de dados
        - Optar por não receber comunicações
      </Text>

      <Text style={styles.section}>6. Contato</Text>
      <Text style={styles.text}>
        Para questões sobre privacidade, entre em contato:
        Email: admin@leaf.app.br
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: colors.text,
  },
  section: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    color: colors.text,
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    marginBottom: 16,
  },
});

export default PrivacyPolicy; 