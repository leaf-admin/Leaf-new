import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import kycService from '../../services/KYCService';
import Logger from '../../utils/Logger';
import { getSelfHostedApiUrl } from '../../config/ApiConfig';
import { resolveKycLivenessErrorPresentation } from './kycLivenessErrorPresentation';

const STATUS = {
  CREATING_SESSION: 'creating_session',
  READY: 'ready',
  ERROR: 'error',
  VERIFYING: 'verifying',
};

const LIVENESS_VERSION = '3.6.3';

function escapeHtmlString(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonScript(value) {
  return JSON.stringify(value || {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildWebViewHtml({ sessionId, region, credentials }) {
  const safeSessionId = escapeHtmlString(sessionId);
  const safeRegion = escapeHtmlString(region || 'us-east-1');
  const credentialsJson = safeJsonScript(credentials);

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>AWS Liveness</title>
  <style>
    html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; background: #0f0f0f; color: #ffffff; }
    .fallback { display: flex; align-items: center; justify-content: center; height: 100%; font-family: Inter, Arial, sans-serif; }
  </style>
</head>
<body>
  <div id="root">
    <div class="fallback">Loading liveness...</div>
  </div>

  <script type="module">
    const SESSION_ID = '${safeSessionId}';
    const REGION = '${safeRegion}';
    const TEMPORARY_CREDENTIALS = ${credentialsJson};

    const postMessage = (payload) => {
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify(payload));
      } catch (error) {
        console.error('postMessage error', error);
      }
    };

    const getCredentialProvider = async () => {
      if (!TEMPORARY_CREDENTIALS?.accessKeyId || !TEMPORARY_CREDENTIALS?.secretAccessKey) {
        throw new Error('AWS temporary credentials are not available');
      }
      return {
        accessKeyId: TEMPORARY_CREDENTIALS.accessKeyId,
        secretAccessKey: TEMPORARY_CREDENTIALS.secretAccessKey,
        sessionToken: TEMPORARY_CREDENTIALS.sessionToken,
        expiration: TEMPORARY_CREDENTIALS.expiration,
      };
    };

    const handleAnalysisComplete = async () => {
      postMessage({
        type: 'analysis_complete'
      });
    };

    const bootstrap = async () => {
      try {
        const ReactModule = await import('https://esm.sh/react@19.1.0?bundle');
        const ReactDOMModule = await import('https://esm.sh/react-dom@19.1.0/client?bundle');
        const LivenessModule = await import('https://esm.sh/@aws-amplify/ui-react-liveness@${LIVENESS_VERSION}?bundle');

        const React = ReactModule.default || ReactModule;
        const { createRoot } = ReactDOMModule;
        const { FaceLivenessDetectorCore } = LivenessModule;

        const App = () => React.createElement(FaceLivenessDetectorCore, {
          sessionId: SESSION_ID,
          region: REGION,
          onAnalysisComplete: handleAnalysisComplete,
          onUserCancel: () => postMessage({ type: 'user_cancel' }),
          onError: (error) => {
            postMessage({
              type: 'analysis_error',
              error: {
                message: error?.error?.message || error?.message || 'Liveness error',
                state: error?.state || null,
              },
            });
          },
          config: {
            credentialProvider: getCredentialProvider,
          },
        });

        const root = createRoot(document.getElementById('root'));
        root.render(React.createElement(App));
        postMessage({ type: 'initialized' });
      } catch (error) {
        postMessage({
          type: 'init_error',
          error: {
            message: error?.message || 'Failed to initialize AWS liveness web view',
          },
        });
      }
    };

    bootstrap();
  </script>
</body>
</html>
`;
}

export default function AWSLivenessWebViewScreen({
  driverId,
  challengeId,
  requirement,
  onSuccess,
  onCancel,
  onFallbackLocal,
}) {
  const [status, setStatus] = useState(STATUS.CREATING_SESSION);
  const [errorPresentation, setErrorPresentation] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [credentialsData, setCredentialsData] = useState(null);
  const webViewRef = useRef(null);

  const apiBaseUrl = useMemo(() => {
    const probe = getSelfHostedApiUrl('/health');
    return probe.replace(/\/health$/, '');
  }, []);

  const webViewHtml = useMemo(() => {
    if (!sessionData?.sessionId || !credentialsData?.credentials) return null;
    return buildWebViewHtml({
      sessionId: sessionData.sessionId,
      region: sessionData.region || credentialsData.region || 'us-east-1',
      credentials: credentialsData.credentials,
    });
  }, [credentialsData, sessionData]);

  const initializeSession = async () => {
    setStatus(STATUS.CREATING_SESSION);
    setErrorPresentation(null);
    setSessionData(null);
    setCredentialsData(null);

    const createResult = await kycService.createAwsLivenessSession(driverId, {
      challengeId,
      requirement,
    });

    if (!createResult.success || !createResult.data?.sessionId) {
      setStatus(STATUS.ERROR);
      setErrorPresentation(resolveKycLivenessErrorPresentation(createResult));
      return;
    }

    const sessionId = createResult.data.sessionId;
    const credentialsResult = await kycService.getAwsLivenessCredentials(driverId, sessionId);
    if (!credentialsResult.success || !credentialsResult.data?.credentials) {
      setStatus(STATUS.ERROR);
      setErrorPresentation(resolveKycLivenessErrorPresentation(credentialsResult));
      return;
    }

    setSessionData(createResult.data);
    setCredentialsData(credentialsResult.data);
    setStatus(STATUS.READY);
  };

  useEffect(() => {
    initializeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, challengeId, requirement]);

  const handleWebViewMessage = async (event) => {
    try {
      const payload = JSON.parse(event?.nativeEvent?.data || '{}');
      const type = payload?.type;

      if (type === 'initialized') {
        Logger.log('✅ [AWS LIVENESS] WebView initialized');
        return;
      }

      if (type === 'user_cancel') {
        onCancel?.();
        return;
      }

      if (type === 'init_error' || type === 'analysis_error') {
        setStatus(STATUS.ERROR);
        setErrorPresentation(resolveKycLivenessErrorPresentation(payload?.error || payload));
        return;
      }

      if (type === 'analysis_complete') {
        setStatus(STATUS.VERIFYING);

        const resultResponse = await kycService.getAwsLivenessSessionResult(driverId, sessionData?.sessionId);
        if (!resultResponse.success) {
          setStatus(STATUS.ERROR);
          setErrorPresentation(resolveKycLivenessErrorPresentation(resultResponse));
          return;
        }

        const livenessData = resultResponse.data || {};
        if (livenessData?.livenessPassed !== true) {
          setStatus(STATUS.ERROR);
          setErrorPresentation(resolveKycLivenessErrorPresentation({
            message: 'Validação facial não aprovada.',
          }));
          return;
        }

        await onSuccess?.({
          sessionId: sessionData?.sessionId,
          result: livenessData,
        });
        return;
      }
    } catch (error) {
      setStatus(STATUS.ERROR);
      setErrorPresentation(resolveKycLivenessErrorPresentation(error));
    }
  };

  if (status === STATUS.CREATING_SESSION) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#1A330E" />
        <Text style={styles.statusText}>Preparando validação segura...</Text>
      </View>
    );
  }

  if (status === STATUS.ERROR) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorTitle}>
          {errorPresentation?.title || 'Não foi possível continuar'}
        </Text>
        <Text style={styles.errorText}>
          {errorPresentation?.message || 'Não foi possível iniciar a validação agora.'}
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={initializeSession}>
          <Text style={styles.primaryButtonText}>Tentar novamente</Text>
        </TouchableOpacity>

        {errorPresentation?.allowLocalFallback && typeof onFallbackLocal === 'function' ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={onFallbackLocal}>
            <Text style={styles.secondaryButtonText}>Continuar com selfie</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={styles.ghostButton} onPress={onCancel}>
          <Text style={styles.ghostButtonText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {webViewHtml ? (
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: webViewHtml, baseUrl: apiBaseUrl }}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType={Platform.OS === 'android' ? 'grantIfSameHostElsePrompt' : undefined}
          onMessage={handleWebViewMessage}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1A330E" />
              <Text style={styles.statusText}>Preparando câmera...</Text>
            </View>
          )}
        />
      ) : null}

      {status === STATUS.VERIFYING ? (
        <View style={styles.verifyingOverlay}>
          <ActivityIndicator size="large" color="#1A330E" />
          <Text style={styles.statusText}>Confirmando resultado...</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  verifyingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  statusText: {
    marginTop: 12,
    color: '#111111',
    fontSize: 15,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  errorText: {
    color: '#444444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 22,
  },
  primaryButton: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1A330E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    width: '100%',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D0D0D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  ghostButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  ghostButtonText: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '600',
  },
});
