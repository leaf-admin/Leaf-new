import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import auth from '@react-native-firebase/auth';
import Reanimated, { ZoomIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ONB, OnboardingField, OnboardingShell, PrimaryButton } from '../../components/onboarding/onboardingKit';
import leafTypography from '../../components/prototype/LeafTypography';
import UserAuthService from '../../services/UserAuthService';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';
import { toUserFriendlyMessage } from '../../utils/friendlyErrorMessages';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

// Senha opcional: o cadastro não pede senha (o acesso é pelo código e a sessão fica salva).
// Quem prefere entrar sem esperar o código cria ou troca a senha aqui; a regra fica no backend.
export function validateAccountPassword(password, confirmation) {
  const value = String(password || '');
  if (value.length < 8) return 'Use pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Misture letras e números.';
  if (value !== String(confirmation || '')) return 'As senhas não conferem.';
  return '';
}

export default function LeafAccountPasswordScreen({ navigation }) {
  const haptic = useHapticFeedback();
  const { riderProfile } = usePrototypeRideRuntime();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('RobotaxiPrototypeSettings'));

  const save = async () => {
    const problem = validateAccountPassword(password, confirmation);
    if (problem) {
      setError(problem);
      haptic('error');
      return;
    }
    const phone = auth().currentUser?.phoneNumber || riderProfile?.phoneNumber || riderProfile?.mobile;
    setSaving(true);
    setError('');
    try {
      const result = await UserAuthService.setupPassword(phone, password);
      if (!result?.success) throw new Error(result?.error || 'Não foi possível salvar a senha.');
      haptic('success');
      setSaved(true);
    } catch (failure) {
      setError(toUserFriendlyMessage(failure, { fallbackMessage: 'Não foi possível salvar a senha. Tente de novo.' }));
      haptic('error');
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <OnboardingShell
        stepKey="saved"
        onBack={back}
        testID="leaf-account-password-saved"
        footer={<PrimaryButton label="Pronto" onPress={back} testID="leaf-account-password-done" />}
      >
        <View style={styles.done}>
          <Reanimated.View entering={ZoomIn.springify().damping(13)} style={styles.doneIcon}>
            <Ionicons name="checkmark" size={30} color="#FFFFFF" />
          </Reanimated.View>
          <Text style={styles.doneTitle}>Senha salva</Text>
          <Text style={styles.doneText}>Na próxima vez, toque em “Já tenho senha” depois de digitar o seu número.</Text>
        </View>
      </OnboardingShell>
    );
  }

  const toggle = (
    <Ionicons
      name={visible ? 'eye-off-outline' : 'eye-outline'}
      size={20}
      color={ONB.inkMuted}
      onPress={() => setVisible((value) => !value)}
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
      suppressHighlighting
    />
  );

  return (
    <OnboardingShell
      stepKey="form"
      onBack={back}
      title="Senha de acesso"
      subtitle="Opcional. Com ela você entra sem esperar o código pelo WhatsApp."
      testID="leaf-account-password"
      footer={<PrimaryButton label="Salvar senha" onPress={save} loading={saving} disabled={!password || !confirmation} testID="leaf-account-password-save" />}
    >
      <OnboardingField
        label="Nova senha"
        value={password}
        onChangeText={(value) => { setPassword(value); setError(''); }}
        placeholder="8 ou mais caracteres"
        autoCapitalize="none"
        textContentType="newPassword"
        autoComplete="password-new"
        secureTextEntry={!visible}
        rightAccessory={toggle}
        hint="Use letras e números."
        testID="leaf-account-password-input"
      />
      <OnboardingField
        label="Confirmar senha"
        value={confirmation}
        onChangeText={(value) => { setConfirmation(value); setError(''); }}
        placeholder="Repita a senha"
        autoCapitalize="none"
        textContentType="newPassword"
        autoComplete="password-new"
        secureTextEntry={!visible}
        error={error}
        returnKeyType="done"
        onSubmitEditing={save}
        testID="leaf-account-password-confirm-input"
      />
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  done: { alignItems: 'center', paddingTop: 48 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: ONB.ink, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...leafTypography.semiBold, fontSize: 26, lineHeight: 32, color: ONB.ink, marginTop: 20 },
  doneText: { ...leafTypography.regular, fontSize: 16, lineHeight: 23, color: ONB.inkSoft, marginTop: 8, textAlign: 'center', paddingHorizontal: 12 },
});
