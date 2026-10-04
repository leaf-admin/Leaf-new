import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import { PrototypeMenuRow } from '../../components/prototype/PrototypeMenuSurface';
import leafTypography from '../../components/prototype/LeafTypography';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

// Account information only. This page cannot create a charge or grant a badge.
export default function LeafAccountInfoScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { activeRole } = usePrototypeRideRuntime();
  const payment = route?.params?.kind === 'payment';
  const title = payment ? 'Pagamento' : 'Conquistas';
  const back = () => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('RobotaxiPrototypeMenu');
  return <View style={[styles.page, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]} testID={`leaf-account-${payment ? 'payment' : 'achievements'}`}>
    <View style={styles.header}>
      <TouchableOpacity onPress={back} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar">
        <Ionicons name="arrow-back" size={20} color="#222222" />
      </TouchableOpacity><Text style={styles.title} accessibilityRole="header">{title}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.notice}>
        <LeafObjectIcon name={payment ? 'payment' : 'account'} size={64} />
        <View style={styles.noticeCopy}>
          <Text style={styles.section}>{payment ? 'Pix na Leaf' : 'Sua história na Leaf.'}</Text>
          <Text style={styles.support}>{payment ? 'O pagamento é confirmado antes do embarque.' : activeRole === 'driver' ? 'Trajetos e tempo de parceria.' : 'Viagens e tempo de casa.'}</Text>
        </View>
      </View>
      {payment ? <>
        <View style={styles.facts}>
          <View style={styles.fact}><Text style={styles.support}>Forma de pagamento</Text><Text style={styles.value}>Pix</Text></View>
          <View style={styles.fact}><Text style={styles.support}>Cobrança</Text><Text style={styles.value}>Por viagem</Text></View>
        </View>
        <Text style={styles.body}>Antes de confirmar, você vê o valor total. Depois, o recibo reúne o valor pago e seu detalhamento.</Text>
        <View>
          <PrototypeMenuRow icon="time-outline" title="Pagamentos e recibos" subtitle="Encontre no histórico" onPress={() => navigation.navigate('RobotaxiMenuTripHistory', { returnToAccount: true })} testID="leaf-account-payment-history" />
          <PrototypeMenuRow icon="help-circle-outline" title="Ajuda com pagamento" subtitle="Pix, comprovante ou cobrança" onPress={() => navigation.navigate('RobotaxiPrototypeSupport', { returnToAccount: true })} testID="leaf-account-payment-help" last />
        </View>
      </> : <View style={styles.facts}>
        <Text style={styles.section}>Em breve</Text>
        <Text style={styles.support}>Os emblemas ainda não estão disponíveis. Quando forem ativados, você poderá acompanhar suas conquistas aqui.</Text>
      </View>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20, minHeight: 44 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' },
  title: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, color: '#222222', flex: 1 },
  content: { gap: 24, paddingBottom: 38 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  noticeCopy: { flex: 1, gap: 8 },
  section: { ...leafTypography.semiBold, fontSize: 18, lineHeight: 24, color: '#222222' },
  support: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A' },
  body: { ...leafTypography.regular, fontSize: 16, lineHeight: 24, color: '#222222' },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5E5', paddingVertical: 20, gap: 16 },
  fact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  value: { ...leafTypography.medium, fontSize: 16, lineHeight: 22, color: '#222222' },
});
