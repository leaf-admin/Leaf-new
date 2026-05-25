import React from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../theme/runtimeTokens';

const color = {
  background: '#F6FAF6',
  card: '#FFFFFF',
  text: '#101C14',
  muted: '#66756B',
  line: '#DFE8E1',
  leaf: '#1A330E',
  softLeaf: '#EDF5EC',
};

function formatCurrency(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numberValue);
}

export default function PaymentDetails({ navigation, route }) {
  const booking = route?.params?.booking || route?.params?.tripData || {};
  const amount =
    booking?.totalAmount ??
    booking?.amount ??
    booking?.price ??
    booking?.fare ??
    booking?.selectedBid?.price;
  const formattedAmount = formatCurrency(amount);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={color.background} />
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          activeOpacity={0.78}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={22} color={color.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pagamento via PIX</Text>
        <View style={styles.iconButtonPlaceholder} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroIcon}>
          <Ionicons name="qr-code-outline" size={32} color={color.leaf} />
        </View>

        <Text style={styles.title}>PIX é o pagamento da Leaf</Text>
        <Text style={styles.copy}>
          A corrida é paga por PIX antes da busca pelo motorista. Isso mantém a cobrança simples,
          segura e transparente para passageiro e motorista.
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Forma de pagamento</Text>
            <Text style={styles.rowValue}>PIX</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Quando cobra</Text>
            <Text style={styles.rowValue}>Antes da busca</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Valor</Text>
            <Text style={styles.rowValue}>{formattedAmount || 'Definido na corrida'}</Text>
          </View>
        </View>

        <View style={styles.note}>
          <Ionicons name="shield-checkmark-outline" size={16} color={color.leaf} />
          <Text style={styles.noteText}>
            Se a corrida não seguir, o fluxo de estorno ou liberação do pagamento acontece pelo
            próprio processo da Leaf.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'android' ? 18 : 8,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
  },
  iconButtonPlaceholder: {
    width: 42,
    height: 42,
  },
  headerTitle: {
    color: color.text,
    fontFamily: fonts.Medium,
    fontSize: 17,
    lineHeight: 22,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 34,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.softLeaf,
    marginBottom: 18,
  },
  title: {
    color: color.text,
    fontFamily: fonts.Medium,
    fontSize: 24,
    lineHeight: 30,
  },
  copy: {
    marginTop: 10,
    color: color.muted,
    fontFamily: fonts.Regular,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    marginTop: 28,
    borderRadius: 24,
    paddingHorizontal: 18,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
  },
  rowLabel: {
    flex: 1,
    color: color.muted,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  rowValue: {
    color: color.text,
    fontFamily: fonts.Medium,
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
  },
  note: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 18,
    backgroundColor: color.softLeaf,
  },
  noteText: {
    flex: 1,
    color: color.muted,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
