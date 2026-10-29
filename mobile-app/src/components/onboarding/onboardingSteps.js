import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Reanimated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import leafTypography from '../prototype/LeafTypography';
import { LeafAnimatedPressable } from '../prototype/LeafRideUI';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';
import { ONB, OnboardingField, OnboardingShell, PrimaryButton, TextLink } from './onboardingKit';

// Telas do onboarding (apresentação). Recebem estado e callbacks por props: o laboratório usa
// dados de exemplo e o fluxo real liga os serviços de OTP, perfil, OCR e ativação.


export function formatBrazilPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// ── Boas-vindas ─────────────────────────────────────────────────────────────────────────────
// Foto da cidade com degradê verde, o logo da Leaf e um título só (aprovado no canvas de
// UI/UX, variação 1B). Os links de termos e privacidade continuam embaixo.
const CITY_BACKGROUND = require('../../../assets/images/onboarding-city-bg.jpg');
const WORDMARK_WHITE = require('../../../assets/images/leaf-wordmark-white.png');

export function WelcomeScreen({ onStart, onStartDriver, onOpenTerms, onOpenPrivacy }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={welcome.root} testID="onboarding-welcome">
      <Image source={CITY_BACKGROUND} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      <LinearGradient
        colors={['rgba(0,48,2,0.10)', 'rgba(0,48,2,0.35)', 'rgba(0,32,1,0.94)']}
        locations={[0, 0.4, 0.78]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Image
        source={WORDMARK_WHITE}
        style={[welcome.logo, { top: insets.top + 20 }]}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Leaf"
      />
      <Reanimated.View entering={FadeInDown.delay(250).duration(500)} style={[welcome.bottom, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>
        <Text style={welcome.headline} accessibilityRole="header">Feito no Rio.</Text>
        <PrimaryButton label="Começar" tone="lime" onPress={onStart} testID="onboarding-welcome-start" />
        {onStartDriver ? (
          <Pressable onPress={onStartDriver} hitSlop={10} accessibilityRole="button" testID="onboarding-welcome-driver">
            <Text style={welcome.driverLink}>Quero dirigir com a Leaf</Text>
          </Pressable>
        ) : null}
        <Text style={welcome.legal}>
          Ao continuar, você concorda com os{' '}
          <Text style={welcome.legalLink} onPress={onOpenTerms}>Termos de Uso</Text> e a{' '}
          <Text style={welcome.legalLink} onPress={onOpenPrivacy}>Política de Privacidade</Text>.
        </Text>
      </Reanimated.View>
    </View>
  );
}

// ── Celular ─────────────────────────────────────────────────────────────────────────────────
export function PhoneStep({ step, total, onBack, phoneDigits, onChangePhone, onSubmit, loading, error }) {
  const valid = String(phoneDigits || '').replace(/\D/g, '').length === 11;
  return (
    <OnboardingShell
      stepKey="phone" step={step} total={total} onBack={onBack}
      title="Qual é o seu celular?"
      subtitle="Vamos mandar um código pelo WhatsApp para confirmar que é você."
      testID="onboarding-phone"
      footer={<PrimaryButton label="Receber código" onPress={onSubmit} disabled={!valid} loading={loading} testID="onboarding-phone-submit" />}
    >
      <OnboardingField
        prefix="+55"
        value={formatBrazilPhone(phoneDigits)}
        onChangeText={(text) => onChangePhone?.(text.replace(/\D/g, '').slice(0, 11))}
        placeholder="(21) 99999-9999"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        error={error}
        hint="O código chega no seu WhatsApp. Se não chegar, mandamos por SMS."
        testID="onboarding-phone-input"
      />
    </OnboardingShell>
  );
}

// ── Código ──────────────────────────────────────────────────────────────────────────────────
function CodeBoxes({ code, length = 6, error, onChange, autoFocus = true }) {
  const inputRef = useRef(null);
  const shake = useRef(new Animated.Value(0)).current;
  const haptic = useHapticFeedback();
  useEffect(() => {
    if (!error) return;
    haptic('error');
    Animated.sequence([10, -10, 6, -6, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true }))).start();
  }, [error, haptic, shake]);
  const digits = String(code || '').split('');
  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel="Código de verificação">
      <Animated.View style={[codeStyles.row, { transform: [{ translateX: shake }] }]}>
        {Array.from({ length }, (_, i) => {
          const filled = Boolean(digits[i]);
          const active = i === digits.length;
          return (
            <View key={i} style={[codeStyles.box, filled && codeStyles.boxFilled, active && codeStyles.boxActive, error && codeStyles.boxError]}>
              {filled ? <Reanimated.Text entering={ZoomIn.duration(140)} style={codeStyles.digit}>{digits[i]}</Reanimated.Text> : null}
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={(text) => onChange?.(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        maxLength={length}
        style={codeStyles.hiddenInput}
        testID="onboarding-code-input"
      />
    </Pressable>
  );
}

export function CodeStep({ step, total, onBack, phoneDigits, code, onChangeCode, onResend, resendInSeconds = 0, onChangeNumber, verifying, error }) {
  return (
    <OnboardingShell
      stepKey="code" step={step} total={total} onBack={onBack}
      title="Digite o código"
      subtitle={`Enviamos 6 números para +55 ${formatBrazilPhone(phoneDigits)}.`}
      testID="onboarding-code"
    >
      <CodeBoxes code={code} onChange={onChangeCode} error={error} />
      {error ? <Text style={codeStyles.error}>{error}</Text> : null}
      {verifying ? <Text style={codeStyles.verifying}>Confirmando…</Text> : null}
      <View style={codeStyles.links}>
        {resendInSeconds > 0
          ? <Text style={codeStyles.timer}>Reenviar em 0:{String(resendInSeconds).padStart(2, '0')}</Text>
          : <TextLink label="Reenviar código" onPress={onResend} testID="onboarding-code-resend" />}
        <TextLink label="Trocar número" onPress={onChangeNumber} testID="onboarding-code-change-number" />
      </View>
    </OnboardingShell>
  );
}

// ── Perfil ──────────────────────────────────────────────────────────────────────────────────
export function RoleCard({ title, description, icon, selected, onPress, testID, accessibilityLabel }) {
  const haptic = useHapticFeedback();
  return (
    <LeafAnimatedPressable
      onPress={() => { haptic('tap'); onPress?.(); }}
      style={[roleStyles.card, selected && roleStyles.cardSelected]}
      activeScale={0.985}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel || `${title}. ${description}`}
      testID={testID}
    >
      <View style={[roleStyles.icon, selected && roleStyles.iconSelected]}>
        <Ionicons name={icon} size={22} color={ONB.ink} />
      </View>
      <View style={roleStyles.copy}>
        <Text style={roleStyles.title}>{title}</Text>
        <Text style={roleStyles.description}>{description}</Text>
      </View>
      <View style={[roleStyles.radio, selected && roleStyles.radioSelected]}>
        {selected ? <Reanimated.View entering={ZoomIn.springify().damping(14)}><Ionicons name="checkmark" size={16} color="#FFFFFF" /></Reanimated.View> : null}
      </View>
    </LeafAnimatedPressable>
  );
}

export function RoleStep({ step, total, onBack, role, onSelectRole, onSubmit }) {
  return (
    <OnboardingShell
      stepKey="role" step={step} total={total} onBack={onBack}
      title="Como você vai usar a Leaf?"
      subtitle="Dá para mudar depois no seu perfil."
      testID="onboarding-role"
      footer={<PrimaryButton label="Continuar" onPress={onSubmit} disabled={!role} testID="onboarding-role-submit" />}
    >
      <RoleCard title="Quero viajar" description="Preço fechado, pago por Pix antes da corrida. Sem motorista, o valor volta para você." icon="navigate-outline" selected={role === 'customer'} onPress={() => onSelectRole?.('customer')} testID="onboarding-role-customer" />
      <RoleCard title="Quero dirigir" description="Taxa de R$ 0,79 a R$ 1,49 por corrida até R$ 50. A corrida já chega paga." icon="car-outline" selected={role === 'driver'} onPress={() => onSelectRole?.('driver')} testID="onboarding-role-driver" />
    </OnboardingShell>
  );
}

// ── Nome (passageiro) ───────────────────────────────────────────────────────────────────────
export function PassengerNameStep({ step, total, onBack, name, email, onChangeName, onChangeEmail, onSubmit, loading, nameError, emailError }) {
  const valid = String(name || '').trim().split(/\s+/).length >= 2;
  return (
    <OnboardingShell
      stepKey="name" step={step} total={total} onBack={onBack}
      title="Como podemos te chamar?"
      subtitle="Seu nome aparece para o motorista na hora do embarque."
      testID="onboarding-name"
      footer={<PrimaryButton label="Continuar" onPress={onSubmit} disabled={!valid} loading={loading} testID="onboarding-name-submit" />}
    >
      <OnboardingField label="Nome e sobrenome" value={name} onChangeText={onChangeName} placeholder="Ana Souza" autoCapitalize="words" textContentType="name" autoComplete="name" autoFocus error={nameError} testID="onboarding-name-input" />
      <OnboardingField label="E-mail (opcional)" value={email} onChangeText={onChangeEmail} placeholder="voce@email.com" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" autoComplete="email" error={emailError} hint="Para recibos das corridas." testID="onboarding-email-input" />
    </OnboardingShell>
  );
}

// ── Localização ─────────────────────────────────────────────────────────────────────────────
function PulsingPin() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={locStyles.illustration}>
      <Svg width={260} height={180} viewBox="0 0 260 180" style={StyleSheet.absoluteFill}>
        {['M0 40 H260', 'M0 100 H260', 'M0 150 H260', 'M50 0 V180', 'M130 0 V180', 'M210 0 V180', 'M0 170 L260 10'].map((d) => (
          <Path key={d} d={d} stroke={ONB.line} strokeWidth={6} strokeLinecap="round" />
        ))}
      </Svg>
      <Animated.View style={[locStyles.ring, {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.2] }) }],
      }]} />
      <View style={locStyles.dot} />
    </View>
  );
}

export function LocationPrimingStep({ step, total, onBack, onEnable, onSkip, role = 'customer', disclosure = '', loading = false }) {
  return (
    <OnboardingShell
      stepKey="location" step={step} total={total} onBack={onBack}
      title="Ative sua localização"
      subtitle={role === 'driver'
        ? 'Para receber corridas perto de você e navegar até o passageiro. Enquanto você estiver online, a localização segue ativa mesmo com o app em segundo plano.'
        : 'Para achar seu ponto de embarque e mostrar os carros perto de você.'}
      testID="onboarding-location"
      footer={(
        <>
          <PrimaryButton
            label={disclosure ? 'Concordo e ativar' : 'Ativar localização'}
            onPress={onEnable}
            loading={loading}
            testID="onboarding-location-enable"
          />
          <TextLink label="Agora não" onPress={onSkip} testID="onboarding-location-skip" />
        </>
      )}
    >
      <PulsingPin />
      {disclosure ? <Text style={locStyles.disclosure} testID="onboarding-location-disclosure">{disclosure}</Text> : null}
    </OnboardingShell>
  );
}

// ── CNH (motorista) ─────────────────────────────────────────────────────────────────────────
function UploadCard({ title, subtitle, icon = 'document-text-outline', state = 'empty', onPress, testID }) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'reading') return undefined;
    const loop = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [shimmer, state]);
  return (
    <LeafAnimatedPressable onPress={state === 'reading' ? undefined : onPress} style={[upload.card, state === 'error' && upload.cardError]} testID={testID}>
      <View style={upload.icon}><Ionicons name={state === 'reading' ? 'scan-outline' : icon} size={21} color={ONB.ink} /></View>
      <View style={upload.copy}>
        <Text style={upload.title}>{state === 'reading' ? 'Lendo seu documento…' : title}</Text>
        <Text style={[upload.subtitle, state === 'error' && { color: ONB.danger }]}>{subtitle}</Text>
        {state === 'reading' ? (
          <View style={upload.bar}>
            <Animated.View style={[upload.barFill, { transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-120, 260] }) }] }]} />
          </View>
        ) : null}
      </View>
      {state === 'reading' ? null : <Ionicons name="chevron-forward" size={18} color={ONB.inkMuted} />}
    </LeafAnimatedPressable>
  );
}

function ExtractedCard({ title, rows, onReplace }) {
  return (
    <Reanimated.View entering={FadeInDown.duration(320)} style={extracted.card}>
      <View style={extracted.head}>
        <View style={extracted.badge}><Ionicons name="checkmark" size={14} color="#FFFFFF" /></View>
        <Text style={extracted.title}>{title}</Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={extracted.row}>
          <Text style={extracted.label}>{label}</Text>
          <Text style={extracted.value}>{value}</Text>
        </View>
      ))}
      <View style={extracted.footer}><TextLink label="Enviar outro arquivo" onPress={onReplace} /></View>
    </Reanimated.View>
  );
}

export function CnhStep({ step, total, onBack, state = 'empty', data, error, onPick, onSubmit }) {
  return (
    <OnboardingShell
      stepKey="cnh" step={step} total={total} onBack={onBack}
      title="Sua CNH Digital"
      subtitle="Envie o PDF da CNH Digital. A gente lê os dados para você não precisar digitar."
      testID="onboarding-cnh"
      footer={<PrimaryButton label="Confirmar dados" onPress={onSubmit} disabled={state !== 'extracted'} testID="onboarding-cnh-submit" />}
    >
      {state === 'extracted' && data ? (
        <ExtractedCard
          title="CNH lida com sucesso"
          rows={[['Nome', data.name], ['CPF', data.cpf], ['Nascimento', data.birthDate], ['Categoria', data.category], ['Validade', data.validUntil]]}
          onReplace={onPick}
        />
      ) : (
        <UploadCard
          title="Enviar CNH Digital (PDF)"
          subtitle={error || 'No app Carteira Digital de Trânsito: CNH → Exportar → PDF.'}
          state={error ? 'error' : state}
          onPress={onPick}
          testID="onboarding-cnh-pick"
        />
      )}
    </OnboardingShell>
  );
}

// ── Veículo ─────────────────────────────────────────────────────────────────────────────────
export function VehicleStep({ step, total, onBack, state = 'empty', data, onPick, onSubmit, onSkip }) {
  return (
    <OnboardingShell
      stepKey="vehicle" step={step} total={total} onBack={onBack}
      title="Seu carro"
      subtitle="Envie o CRLV Digital do carro que você vai usar. Lemos placa, modelo e ano."
      testID="onboarding-vehicle"
      footer={(
        <>
          <PrimaryButton label="Continuar" onPress={onSubmit} disabled={state !== 'extracted'} testID="onboarding-vehicle-submit" />
          <TextLink label="Enviar depois" onPress={onSkip} testID="onboarding-vehicle-skip" />
        </>
      )}
    >
      {state === 'extracted' && data ? (
        <ExtractedCard title="Veículo identificado" rows={[['Modelo', data.model], ['Placa', data.plate], ['Cor', data.color], ['Ano', data.year]]} onReplace={onPick} />
      ) : (
        <UploadCard title="Enviar CRLV Digital (PDF)" subtitle="No app Carteira Digital de Trânsito: Veículos → CRLV → PDF." icon="car-outline" state={state} onPress={onPick} testID="onboarding-vehicle-pick" />
      )}
    </OnboardingShell>
  );
}

// ── Verificação facial (orientação) ─────────────────────────────────────────────────────────
export function FaceIntroStep({ step, total, onBack, onStart }) {
  const tips = [
    ['sunny-outline', 'Lugar bem iluminado', 'Luz no rosto, sem contraluz.'],
    ['glasses-outline', 'Rosto livre', 'Sem óculos escuros, boné ou máscara.'],
    ['phone-portrait-outline', 'Celular na altura dos olhos', 'Siga o círculo na tela até o fim.'],
  ];
  return (
    <OnboardingShell
      stepKey="face" step={step} total={total} onBack={onBack}
      title="Vamos confirmar que é você"
      subtitle="Uma verificação rápida de rosto protege você e os passageiros. Leva menos de um minuto."
      testID="onboarding-face"
      footer={<PrimaryButton label="Começar verificação" onPress={onStart} testID="onboarding-face-start" />}
    >
      {tips.map(([icon, title, text], i) => (
        <Reanimated.View key={title} entering={FadeInDown.delay(90 * i).duration(300)} style={tipStyles.row}>
          <View style={tipStyles.icon}><Ionicons name={icon} size={20} color={ONB.ink} /></View>
          <View style={tipStyles.copy}>
            <Text style={tipStyles.title}>{title}</Text>
            <Text style={tipStyles.text}>{text}</Text>
          </View>
        </Reanimated.View>
      ))}
    </OnboardingShell>
  );
}

// ── Consentimentos ──────────────────────────────────────────────────────────────────────────
export function ConsentRow({ title, description, required, checked, onToggle, onOpen, testID }) {
  const haptic = useHapticFeedback();
  return (
    <Pressable
      onPress={() => { haptic('tap'); onToggle?.(); }}
      style={consent.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${title}${required ? '' : ' (opcional)'}. ${description}`}
      testID={testID}
    >
      <View style={[consent.box, checked && consent.boxChecked]}>
        {checked ? <Reanimated.View entering={ZoomIn.duration(140)}><Ionicons name="checkmark" size={15} color="#FFFFFF" /></Reanimated.View> : null}
      </View>
      <View style={consent.copy}>
        <Text style={consent.title}>{title}{required ? '' : ' (opcional)'}</Text>
        <Text style={consent.text}>{description}{onOpen ? ' ' : ''}{onOpen ? <Text style={consent.link} onPress={onOpen}>Ler</Text> : null}</Text>
      </View>
    </Pressable>
  );
}

export function ConsentStep({ step, total, onBack, values = {}, onToggle, onOpenTerms, onOpenPrivacy, onSubmit, loading }) {
  const ok = values.terms && values.privacy && values.background;
  return (
    <OnboardingShell
      stepKey="consent" step={step} total={total} onBack={onBack}
      title="Últimos combinados"
      subtitle="Para dirigir com a Leaf precisamos do seu aceite nestes pontos."
      testID="onboarding-consent"
      footer={<PrimaryButton label="Aceitar e enviar cadastro" onPress={onSubmit} disabled={!ok} loading={loading} testID="onboarding-consent-submit" />}
    >
      <ConsentRow title="Termos de Uso" description="Regras de uso da plataforma." required checked={values.terms} onToggle={() => onToggle?.('terms')} onOpen={onOpenTerms} testID="onboarding-consent-terms" />
      <ConsentRow title="Política de Privacidade" description="Como cuidamos dos seus dados." required checked={values.privacy} onToggle={() => onToggle?.('privacy')} onOpen={onOpenPrivacy} testID="onboarding-consent-privacy" />
      <ConsentRow title="Checagem de antecedentes" description="Consulta de antecedentes criminais e validação regulatória." required checked={values.background} onToggle={() => onToggle?.('background')} testID="onboarding-consent-background" />
      <ConsentRow title="Novidades e promoções" description="Avisos sobre campanhas e ganhos extras." checked={values.marketing} onToggle={() => onToggle?.('marketing')} testID="onboarding-consent-marketing" />
    </OnboardingShell>
  );
}

// ── Análise do cadastro (motorista) ─────────────────────────────────────────────────────────
const STATUS_META = {
  approved: { icon: 'checkmark', color: ONB.ink, label: 'Aprovado' },
  review: { icon: 'time-outline', color: ONB.inkSoft, label: 'Em análise' },
  pending: { icon: 'ellipse-outline', color: ONB.inkMuted, label: 'Pendente' },
  rejected: { icon: 'close', color: ONB.danger, label: 'Precisa de ajuste' },
};

export function ReviewStatusStep({ items = [], etaText = 'Avisamos por notificação a cada etapa.', onAction, onDone }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[review.root, { paddingTop: insets.top + 32, paddingBottom: Math.max(16, insets.bottom + 8) }]} testID="onboarding-review">
      <Reanimated.View entering={ZoomIn.springify().damping(13)} style={review.hero}>
        <Ionicons name="checkmark" size={30} color="#FFFFFF" />
      </Reanimated.View>
      <Text style={review.title}>Cadastro enviado</Text>
      <Text style={review.subtitle}>{etaText}</Text>
      <View style={review.timeline}>
        {items.map((item, i) => {
          const meta = STATUS_META[item.status] || STATUS_META.pending;
          const last = i === items.length - 1;
          return (
            <Reanimated.View key={item.key} entering={FadeInDown.delay(80 * i).duration(300)} style={review.item}>
              <View style={review.rail}>
                <View style={[review.node, { borderColor: meta.color, backgroundColor: item.status === 'approved' ? meta.color : '#FFFFFF' }]}>
                  <Ionicons name={meta.icon} size={12} color={item.status === 'approved' ? '#FFFFFF' : meta.color} />
                </View>
                {last ? null : <View style={[review.line, item.status === 'approved' && { backgroundColor: ONB.ink }]} />}
              </View>
              <View style={review.itemCopy}>
                <Text style={review.itemTitle}>{item.title}</Text>
                <Text style={[review.itemStatus, { color: meta.color }]}>{item.detail || meta.label}</Text>
                {item.actionLabel ? <View style={{ marginTop: 6 }}><TextLink label={item.actionLabel} onPress={() => onAction?.(item.key)} /></View> : null}
              </View>
            </Reanimated.View>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <View style={review.footer}><PrimaryButton label="Ir para o início" onPress={onDone} testID="onboarding-review-done" /></View>
    </View>
  );
}

// ── Estilos ─────────────────────────────────────────────────────────────────────────────────
const welcome = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#003002', overflow: 'hidden' },
  logo: { position: 'absolute', left: 24, width: 104, height: 27 },
  bottom: { position: 'absolute', left: 24, right: 24, bottom: 0, gap: 16, alignItems: 'center' },
  headline: { ...leafTypography.bold, alignSelf: 'stretch', fontSize: 48, lineHeight: 52, letterSpacing: -1.4, color: '#FFFFFF', marginBottom: 6 },
  driverLink: { ...leafTypography.semiBold, fontSize: 15, color: '#FFFFFF', textDecorationLine: 'underline' },
  legal: { ...leafTypography.regular, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.66)', textAlign: 'center' },
  legalLink: { ...leafTypography.medium, color: 'rgba(255,255,255,0.9)', textDecorationLine: 'underline' },
});
const codeStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  box: { width: 48, height: 60, borderRadius: 14, borderWidth: 1.5, borderColor: ONB.line, alignItems: 'center', justifyContent: 'center', backgroundColor: ONB.surface },
  boxFilled: { borderColor: ONB.lineStrong },
  boxActive: { borderColor: ONB.ink, borderWidth: 2 },
  boxError: { borderColor: ONB.danger },
  digit: { ...leafTypography.semiBold, fontSize: 26, color: ONB.ink },
  hiddenInput: { position: 'absolute', opacity: 0.01, height: 1, width: 1 },
  error: { ...leafTypography.medium, fontSize: 14, color: ONB.danger, marginTop: 14 },
  verifying: { ...leafTypography.medium, fontSize: 14, color: ONB.inkSoft, marginTop: 14 },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  timer: { ...leafTypography.medium, fontSize: 15, color: ONB.inkMuted },
});
const roleStyles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 22, borderWidth: 1.5, borderColor: ONB.line, backgroundColor: ONB.surface, marginBottom: 14, gap: 14 },
  cardSelected: { borderColor: ONB.ink, backgroundColor: ONB.surface },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: ONB.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  iconSelected: { backgroundColor: ONB.surfaceSoft },
  copy: { flex: 1 },
  title: { ...leafTypography.semiBold, fontSize: 18, color: ONB.ink },
  description: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: ONB.inkSoft, marginTop: 3 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: ONB.lineStrong, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: ONB.ink, borderColor: ONB.ink },
});
const locStyles = StyleSheet.create({
  disclosure: { ...leafTypography.regular, fontSize: 13.5, lineHeight: 20, color: ONB.inkSoft, marginTop: 20 },
  illustration: { height: 220, borderRadius: 28, backgroundColor: ONB.surfaceSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 8 },
  ring: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(17,33,12,0.14)' },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: ONB.ink, borderWidth: 4, borderColor: '#FFFFFF', shadowColor: '#0E1F12', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
});
const upload = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 22, borderWidth: 1.5, borderStyle: 'dashed', borderColor: ONB.lineStrong, backgroundColor: ONB.surface },
  cardError: { borderColor: ONB.danger, backgroundColor: ONB.dangerSoft },
  icon: { width: 46, height: 46, borderRadius: 23, backgroundColor: ONB.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...leafTypography.semiBold, fontSize: 16, color: ONB.ink },
  subtitle: { ...leafTypography.regular, fontSize: 13.5, lineHeight: 19, color: ONB.inkSoft, marginTop: 3 },
  bar: { height: 4, borderRadius: 2, backgroundColor: ONB.surfaceSoft, overflow: 'hidden', marginTop: 10 },
  barFill: { width: 100, height: 4, borderRadius: 2, backgroundColor: ONB.ink },
});
const extracted = StyleSheet.create({
  card: { borderRadius: 22, backgroundColor: ONB.surfaceSoft, padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: ONB.ink, alignItems: 'center', justifyContent: 'center' },
  title: { ...leafTypography.semiBold, fontSize: 16, color: ONB.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ONB.line },
  label: { ...leafTypography.regular, fontSize: 14, color: ONB.inkSoft },
  value: { ...leafTypography.medium, fontSize: 14, color: ONB.ink, maxWidth: '62%', textAlign: 'right' },
  footer: { marginTop: 12, alignItems: 'flex-start' },
});
const tipStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ONB.line },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: ONB.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...leafTypography.semiBold, fontSize: 16, color: ONB.ink },
  text: { ...leafTypography.regular, fontSize: 14, color: ONB.inkSoft, marginTop: 2 },
});
const consent = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ONB.line },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: ONB.lineStrong, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  boxChecked: { backgroundColor: ONB.ink, borderColor: ONB.ink },
  copy: { flex: 1 },
  title: { ...leafTypography.semiBold, fontSize: 16, color: ONB.ink },
  text: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: ONB.inkSoft, marginTop: 2 },
  link: { ...leafTypography.medium, color: ONB.ink, textDecorationLine: 'underline' },
});
const review = StyleSheet.create({
  root: { flex: 1, backgroundColor: ONB.surface, paddingHorizontal: 24 },
  hero: { width: 64, height: 64, borderRadius: 32, backgroundColor: ONB.ink, alignItems: 'center', justifyContent: 'center' },
  title: { ...leafTypography.semiBold, fontSize: 30, lineHeight: 36, color: ONB.ink, marginTop: 20 },
  subtitle: { ...leafTypography.regular, fontSize: 16, lineHeight: 23, color: ONB.inkSoft, marginTop: 8 },
  timeline: { marginTop: 28 },
  item: { flexDirection: 'row', gap: 14 },
  rail: { alignItems: 'center', width: 24 },
  node: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 26, backgroundColor: ONB.line, marginVertical: 4 },
  itemCopy: { flex: 1, paddingBottom: 18 },
  itemTitle: { ...leafTypography.semiBold, fontSize: 16, color: ONB.ink },
  itemStatus: { ...leafTypography.medium, fontSize: 14, marginTop: 2 },
  footer: { gap: 12 },
});
