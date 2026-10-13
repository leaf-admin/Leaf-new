import leafTypography from '../prototype/LeafTypography';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SecurePaymentBadge = ({
  label = 'Pagamento seguro',
  color = '#66756B',
  iconColor = null,
  style = null,
  textStyle = null,
}) => (
  <View style={[styles.container, style]}>
    <Ionicons
      name="shield-checkmark-outline"
      size={11}
      color={iconColor || color}
    />
    <Text style={[styles.text, { color }, textStyle]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  text: {
    ...leafTypography.medium,
    fontSize: 10,
    lineHeight: 13,
  },
});

export default SecurePaymentBadge;
