import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../common/theme';

export const TermsOfService = () => {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Termos de Serviço</Text>
      
      <Text style={styles.section}>1. Aceitação dos Termos</Text>
      <Text style={styles.text}>
        Ao usar o aplicativo Leaf, você concorda com estes termos de serviço. Se você não concordar com qualquer parte destes termos, não poderá usar nossos serviços.
      </Text>

      <Text style={styles.section}>2. Descrição do Serviço</Text>
      <Text style={styles.text}>
        O Leaf é um aplicativo de transporte que conecta passageiros a motoristas. Nossos serviços incluem:
        - Agendamento de corridas
        - Processamento de pagamentos
        - Comunicação entre usuários
        - Suporte ao cliente
      </Text>

      <Text style={styles.section}>3. Responsabilidades do Usuário</Text>
      <Text style={styles.text}>
        Como usuário do Leaf, você concorda em:
        - Fornecer informações precisas e atualizadas
        - Manter a confidencialidade de sua conta
        - Usar o serviço de acordo com as leis aplicáveis
        - Não usar o serviço para fins ilegais
      </Text>

      <Text style={styles.section}>4. Pagamentos e Taxas</Text>
      <Text style={styles.text}>
        - As tarifas são calculadas com base na distância e tempo
        - Pagamentos são processados de forma segura
        - Taxas de serviço podem ser aplicadas
        - Reembolsos são processados de acordo com nossa política
      </Text>

      <Text style={styles.section}>5. Limitações de Responsabilidade</Text>
      <Text style={styles.text}>
        O Leaf não é responsável por:
        - Atrasos ou cancelamentos
        - Danos a propriedades
        - Problemas de comunicação
        - Ações de terceiros
      </Text>

      <Text style={styles.section}>6. Modificações</Text>
      <Text style={styles.text}>
        Reservamo-nos o direito de modificar estes termos a qualquer momento. Alterações significativas serão notificadas aos usuários.
      </Text>

      <Text style={styles.section}>7. Contato</Text>
      <Text style={styles.text}>
        Para questões sobre os termos de serviço:
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

export default TermsOfService; 