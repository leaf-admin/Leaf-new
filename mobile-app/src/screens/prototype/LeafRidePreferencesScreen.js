import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ONB, OnboardingShell, PrimaryButton, TextLink } from '../../components/onboarding/onboardingKit';
import leafTypography from '../../components/prototype/LeafTypography';
import { useMobilePreferences } from '../../components/MobilePreferencesProvider';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';
import { toUserFriendlyMessage } from '../../utils/friendlyErrorMessages';

// Conforto da viagem: o motorista vê depois de aceitar, a caminho do embarque.
// Só informa; não muda preço nem quem recebe a corrida.
export const RIDE_TEMPERATURE_OPTIONS = [
  { value: 'cool', label: 'Mais fresco', icon: 'snow-outline' },
  { value: 'mild', label: 'Ameno', icon: 'partly-sunny-outline' },
  { value: 'any', label: 'Tanto faz', icon: 'remove-outline' },
];

export const RIDE_SOUND_OPTIONS = [
  { value: 'quiet', label: 'Silêncio', icon: 'volume-mute-outline' },
  { value: 'music', label: 'Música', icon: 'musical-notes-outline' },
  { value: 'any', label: 'Tanto faz', icon: 'remove-outline' },
];

function ChoiceGroup({ label, options, value, onChange, testID }) {
  return (
    <View style={styles.group} testID={testID}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}: ${option.label}`}
              testID={`${testID}-${option.value}`}
            >
              <Ionicons name={option.icon} size={20} color={selected ? '#FFFFFF' : ONB.ink} />
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function LeafRidePreferencesScreen({ navigation, route }) {
  const haptic = useHapticFeedback();
  // Opened by itself on the passenger's first visit to the home.
  const firstUse = route?.params?.firstUse === true;
  const { preferences, update, saving } = useMobilePreferences();
  const [temperature, setTemperature] = useState(preferences.rideTemperature || 'any');
  const [sound, setSound] = useState(preferences.rideSound || 'any');
  const [error, setError] = useState('');

  useEffect(() => {
    setTemperature(preferences.rideTemperature || 'any');
    setSound(preferences.rideSound || 'any');
  }, [preferences.rideTemperature, preferences.rideSound]);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('RobotaxiPrototype'));

  const persist = async (patch) => {
    setError('');
    try {
      await update({ ...patch, rideComfortAsked: true });
      haptic('success');
      back();
    } catch (failure) {
      haptic('error');
      setError(toUserFriendlyMessage(failure, { fallbackMessage: 'Não foi possível salvar agora. Tente de novo.' }));
    }
  };

  const choose = (setter) => (value) => {
    haptic('selection');
    setError('');
    setter(value);
  };

  return (
    <OnboardingShell
      stepKey="ride-preferences"
      onBack={firstUse ? null : back}
      title={firstUse ? 'Como você prefere viajar?' : 'Preferências de viagem'}
      subtitle="O motorista vê depois de aceitar a corrida. Você pode mudar quando quiser no menu."
      testID="leaf-ride-preferences"
      footer={(
        <>
          <PrimaryButton
            label="Salvar"
            onPress={() => persist({ rideTemperature: temperature, rideSound: sound })}
            loading={saving}
            testID="leaf-ride-preferences-save"
          />
          {firstUse ? (
            <TextLink label="Agora não" onPress={() => persist({})} testID="leaf-ride-preferences-skip" />
          ) : null}
        </>
      )}
    >
      <ChoiceGroup
        label="Temperatura do ar"
        options={RIDE_TEMPERATURE_OPTIONS}
        value={temperature}
        onChange={choose(setTemperature)}
        testID="leaf-ride-preferences-temperature"
      />
      <ChoiceGroup
        label="Durante a viagem"
        options={RIDE_SOUND_OPTIONS}
        value={sound}
        onChange={choose(setSound)}
        testID="leaf-ride-preferences-sound"
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 28 },
  groupLabel: { ...leafTypography.semiBold, fontSize: 15, lineHeight: 20, color: ONB.ink, marginBottom: 12 },
  choices: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ONB.line,
    backgroundColor: ONB.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 6,
  },
  choiceSelected: { backgroundColor: ONB.ink, borderColor: ONB.ink },
  choiceText: { ...leafTypography.medium, fontSize: 14, lineHeight: 18, color: ONB.ink, textAlign: 'center' },
  choiceTextSelected: { color: '#FFFFFF' },
  error: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: ONB.danger },
});
