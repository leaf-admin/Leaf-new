import React, { useEffect, useState } from 'react';
import { StatusBar, View } from 'react-native';
import {
  CnhStep,
  CodeStep,
  ConsentStep,
  FaceIntroStep,
  LocationPrimingStep,
  PassengerNameStep,
  PhoneStep,
  ReviewStatusStep,
  RoleStep,
  VehicleStep,
  WelcomeScreen,
} from '../../../components/onboarding/onboardingSteps';

// Laboratório do novo onboarding (dev): as duas jornadas completas com dados de exemplo, para
// aprovar visual e ritmo no celular antes de ligar ao fluxo real. Código "000000" simula erro.

const PASSENGER = ['welcome', 'phone', 'code', 'role', 'name', 'location', 'done'];
const DRIVER = ['welcome', 'phone', 'code', 'role', 'cnh', 'vehicle', 'face', 'consent', 'location', 'review'];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function LeafOnboardingLab({ navigation }) {
  const [role, setRole] = useState(null);
  const [index, setIndex] = useState(0);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cnhState, setCnhState] = useState('empty');
  const [vehicleState, setVehicleState] = useState('empty');
  const [consents, setConsents] = useState({ terms: false, privacy: false, background: false, marketing: false });

  const flow = role === 'driver' ? DRIVER : PASSENGER;
  const current = flow[index];
  const counted = flow.filter((s) => !['welcome', 'done', 'review'].includes(s));
  const stepNumber = counted.indexOf(current) + 1;
  const total = counted.length;
  const next = () => setIndex((i) => Math.min(flow.length - 1, i + 1));
  const back = () => (index === 0 ? navigation?.goBack?.() : setIndex((i) => i - 1));

  useEffect(() => {
    if (current !== 'code' || resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [current, resendIn]);

  const onChangeCode = async (value) => {
    setCode(value);
    setCodeError('');
    if (value.length < 6) return;
    setVerifying(true);
    await wait(700);
    setVerifying(false);
    if (value === '000000') {
      setCodeError('Código incorreto. Confira e tente de novo.');
      setCode('');
      return;
    }
    next();
  };

  const common = { step: stepNumber, total, onBack: back };
  let screen = null;
  switch (current) {
    case 'welcome':
      screen = <WelcomeScreen onStart={next} />;
      break;
    case 'phone':
      screen = (
        <PhoneStep {...common} phoneDigits={phone} onChangePhone={setPhone} loading={loading}
          onSubmit={async () => { setLoading(true); await wait(900); setLoading(false); setResendIn(30); next(); }} />
      );
      break;
    case 'code':
      screen = (
        <CodeStep {...common} phoneDigits={phone} code={code} onChangeCode={onChangeCode} error={codeError}
          verifying={verifying} resendInSeconds={resendIn} onResend={() => setResendIn(30)} onChangeNumber={() => setIndex(1)} />
      );
      break;
    case 'role':
      screen = <RoleStep {...common} role={role} onSelectRole={setRole} onSubmit={next} />;
      break;
    case 'name':
      screen = (
        <PassengerNameStep {...common} name={name} email={email} onChangeName={setName} onChangeEmail={setEmail} loading={loading}
          onSubmit={async () => { setLoading(true); await wait(700); setLoading(false); next(); }} />
      );
      break;
    case 'location':
      screen = <LocationPrimingStep {...common} role={role || 'customer'} onEnable={next} onSkip={next} />;
      break;
    case 'cnh':
      screen = (
        <CnhStep {...common} state={cnhState}
          data={{ name: 'Maria Souza Lima', cpf: '•••.456.789-••', birthDate: '12/04/1990', category: 'B', validUntil: '03/2031' }}
          onPick={async () => { setCnhState('reading'); await wait(1800); setCnhState('extracted'); }} onSubmit={next} />
      );
      break;
    case 'vehicle':
      screen = (
        <VehicleStep {...common} state={vehicleState}
          data={{ model: 'VW Nova Saveiro', plate: 'QQO0G16', color: 'Branco', year: '2021' }}
          onPick={async () => { setVehicleState('reading'); await wait(1600); setVehicleState('extracted'); }} onSubmit={next} onSkip={next} />
      );
      break;
    case 'face':
      screen = <FaceIntroStep {...common} onStart={next} />;
      break;
    case 'consent':
      screen = (
        <ConsentStep {...common} values={consents} loading={loading}
          onToggle={(key) => setConsents((v) => ({ ...v, [key]: !v[key] }))}
          onSubmit={async () => { setLoading(true); await wait(900); setLoading(false); next(); }} />
      );
      break;
    case 'review':
      screen = (
        <ReviewStatusStep
          items={[
            { key: 'cnh', title: 'CNH', status: 'approved' },
            { key: 'vehicle', title: 'Veículo', status: 'review', detail: 'Em análise · VW Nova Saveiro' },
            { key: 'face', title: 'Verificação facial', status: 'approved' },
            { key: 'background', title: 'Antecedentes', status: 'review' },
            { key: 'activation', title: 'Liberação para dirigir', status: 'pending', detail: 'Assim que tudo acima for aprovado' },
          ]}
          onDone={() => { setIndex(0); setRole(null); }}
        />
      );
      break;
    default:
      screen = <WelcomeScreen onStart={() => { setIndex(0); setRole(null); }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle={current === 'welcome' ? 'light-content' : 'dark-content'} />
      {screen}
    </View>
  );
}
