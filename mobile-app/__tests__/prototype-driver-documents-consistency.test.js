const fs = require('fs');
const path = require('path');

describe('Robotaxi driver documents state consistency', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'prototype', 'RobotaxiDriverDocumentsScreen.js'),
    'utf8',
  );

  it('separates backend operational release from document approval', () => {
    expect(source).toContain('const documentsComplete = approvedCount === DRIVER_DOCS.length');
    expect(source).toContain('operationallyReleasedBeforeDocumentSync');
    expect(source).toContain('Liberação operacional');
    expect(source).toContain('Liberada pelo backend');
  });

  it('does not ask for duplicate uploads while released documents await synchronization', () => {
    expect(source).toContain('Documentos aguardando sincronização');
    expect(source).toContain('A liberação operacional veio do backend. Atualize para consultar o status de CNH e CRLV.');
    expect(source).toContain('testID="robotaxi-driver-documents-sync-state"');
  });

  it('uses semantic badge tones for approval, review and pending states', () => {
    expect(source).toContain("status === 'aprovado'");
    expect(source).toContain("status === 'revisar'");
    expect(source).toContain("? 'success'");
    expect(source).toContain("? 'danger'");
    expect(source).toContain(": 'warning'");
  });

  it('keeps simulated CNH and CRLV upload screens out of the executable app', () => {
    const retiredScreens = [
      'CNHUploadScreen.js',
      'CRLVUploadScreen.js',
      'CompleteRegistrationScreen.js',
      'DriverTermsScreen.js',
      'OTPScreen.js',
      'Registration.js',
      'ProfileSelectionScreen.js',
      'WelcomeScreen.js',
    ];
    const compatibilityRoutes = [
      'CNHUpload',
      'CNHUploadScreen',
      'CRLVUpload',
      'CRLVUploadScreen',
      'CompleteRegistration',
      'DriverTerms',
      'OTP',
      'Registration',
      'ProfileSelection',
      'ProfileSelectionScreen',
      'WelcomeScreen',
    ];
    const navigatorSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'navigation', 'AppNavigator.js'),
      'utf8',
    );
    const authFlowSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'components', 'auth', 'AuthFlow.js'),
      'utf8',
    );

    retiredScreens.forEach(file => {
      expect(fs.existsSync(path.join(__dirname, '..', 'src', 'screens', file))).toBe(false);
    });
    compatibilityRoutes.forEach(routeName => {
      expect(navigatorSource).toContain(
        `name="${routeName}" component={LegacyAuthRouteRedirectScreen}`,
      );
    });
    expect(authFlowSource).toContain("import DocumentStep from './steps/DocumentStep'");
    expect(authFlowSource).toContain('submitDriverOnboardingActivation({');
  });
});
