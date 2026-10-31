import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ContinueButton from '../common/ContinueButton';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import onboardingTheme from '../common/onboardingTheme';
import leafTypography from '../../prototype/LeafTypography';
import {
  DRIVER_FEE_POLICY,
  DRIVER_REQUIREMENTS,
  buildDriverFeeRows,
  formatCents,
  resolveDriverNetExample,
} from '../../../config/driverFeePolicy';

const { color } = onboardingTheme;
const EXAMPLE_FARE_CENTS = 3000;

// "Como funciona dirigir na Leaf": antes de pedir qualquer documento, o motorista
// vê quanto fica com ele, todas as taxas e os requisitos que podem barrar o cadastro.
const DriverIntroStep = ({ onContinue, onBack, progressMeta }) => {
  const example = resolveDriverNetExample(EXAMPLE_FARE_CENTS);
  const rows = buildDriverFeeRows();

  return (
    <EditorialOnboardingScreen
      title="Como funciona dirigir na Leaf"
      description="Antes de enviar documentos, veja quanto você ganha e o que precisa ter."
      onBack={onBack}
      backTestID="auth-driver-intro-back-btn"
      progressMeta={progressMeta}
      testID="auth-driver-intro"
      footer={(
        <ContinueButton
          onPress={onContinue}
          text="Tenho tudo, continuar"
          testID="auth-driver-intro-continue-btn"
          accessibilityLabel="Tenho tudo, continuar"
        />
      )}
    >
      <View style={styles.example} testID="auth-driver-intro-example">
        <Text style={styles.exampleLabel}>Numa corrida de {formatCents(example.fareCents)}</Text>
        <Text style={styles.exampleValue}>
          você fica com {formatCents(example.netCents)}
        </Text>
        <Text style={styles.exampleDetail}>
          {`${String(example.netPercent).replace('.', ',')}% da corrida. Taxa da Leaf ${formatCents(example.serviceFeeCents)} e processamento do Pix ${formatCents(example.processingCents)}. Nas ${DRIVER_FEE_POLICY.promoQualifyingRides} primeiras corridas, você fica com ${formatCents(example.promoNetCents)}. O passageiro paga antes, então a corrida já está paga quando você aceita.`}
        </Text>
      </View>

      <Text style={styles.sectionTitle} accessibilityRole="header">Todas as taxas</Text>
      {rows.map((row) => (
        <View key={row.key} style={styles.row} testID={`auth-driver-intro-fee-${row.key}`}>
          <View style={styles.rowHead}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={styles.rowValue}>{row.value}</Text>
          </View>
          <Text style={styles.rowDetail}>{row.detail}</Text>
        </View>
      ))}

      <Text style={[styles.sectionTitle, styles.sectionSpacing]} accessibilityRole="header">O que você precisa ter</Text>
      {DRIVER_REQUIREMENTS.map((item) => (
        <View key={item} style={styles.requirement}>
          <Ionicons name="checkmark-circle-outline" size={20} color={color.textPrimary} style={styles.requirementIcon} />
          <Text style={styles.requirementText}>{item}</Text>
        </View>
      ))}
    </EditorialOnboardingScreen>
  );
};

const styles = StyleSheet.create({
  example: {
    borderRadius: 22,
    backgroundColor: color.surfaceMuted,
    padding: 18,
    marginBottom: 24,
  },
  exampleLabel: { ...leafTypography.medium, fontSize: 14, color: color.textSecondary },
  exampleValue: { ...leafTypography.semiBold, fontSize: 24, lineHeight: 30, color: color.textPrimary, marginTop: 4 },
  exampleDetail: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: color.textSecondary, marginTop: 8 },
  sectionTitle: { ...leafTypography.semiBold, fontSize: 17, color: color.textPrimary, marginBottom: 6 },
  sectionSpacing: { marginTop: 24 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  rowTitle: { ...leafTypography.semiBold, fontSize: 15, color: color.textPrimary, flexShrink: 1 },
  rowValue: { ...leafTypography.semiBold, fontSize: 15, color: color.textPrimary },
  rowDetail: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: color.textSecondary, marginTop: 4 },
  requirement: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  requirementIcon: { marginTop: 1 },
  requirementText: { ...leafTypography.regular, fontSize: 15, lineHeight: 21, color: color.textPrimary, flex: 1 },
});

export default DriverIntroStep;
