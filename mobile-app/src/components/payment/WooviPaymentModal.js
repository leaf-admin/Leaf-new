import Logger from '../../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    Dimensions,
    Image,
    Linking
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Icon } from 'react-native-elements';
import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WooviService, PaymentBypassService } from '../../services/canonical/paymentService';
import WebSocketManager from '../../services/WebSocketManager';
import QRCode from 'react-native-qrcode-svg';
import { fonts } from '../../theme/runtimeTokens';
import { allowForcedPaymentBypass } from '../../config/runtimeAccessPolicy';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';
import { formatCurrencyBRL } from '../../screens/prototype/tripFinancialSummary';
import SecurePaymentBadge from './SecurePaymentBadge';
import {
    buildRidePaymentContextKey,
    clearRidePaymentSession,
    getOrCreateRidePaymentSession,
    saveRidePaymentSessionData,
} from '../../services/RidePaymentSessionService';


const { width, height } = Dimensions.get('window');
const { color, typography, radius, spacing, elevation } = robotaxiPrototypeTokens;

// Tempo de expiração: 5 minutos (300 segundos)
const PAYMENT_TIMEOUT = 300;
const PAYMENT_CREATE_MAX_ATTEMPTS = 3;
const PAYMENT_CREATE_RETRY_DELAYS_MS = [700, 1400];
const TEST_MODE_STORAGE_KEY = '@test_mode';
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = '@qa_socket_id_token';
const CONFIRMED_PAYMENT_STATUSES = new Set(['completed', 'confirmed', 'paid', 'in_holding']);
const TERMINAL_PAYMENT_STATUSES = new Set(['cancelled', 'canceled', 'expired', 'refunded']);
const PAYMENT_ERROR_DIAGNOSTIC_PREFIX = 'payment-error:';
const PIX_SURFACE = {
    bg: '#F8FBF9',
    sheet: 'rgba(255,255,255,0.97)',
    text: '#101C14',
    secondary: '#66756B',
    muted: '#5F6B62',
    line: '#DFE8E1',
    leaf: '#0F3B16',
    leafLight: '#EAF6EE',
    soft: '#F3F8F4',
    danger: '#B5533E',
    progress: '#1FA76F'
};

function isSandboxPaymentRuntimeProfile(runtimeProfile) {
    const effectiveProfile = runtimeProfile?.effectiveProfile || {};
    const environment = String(
        effectiveProfile.environment ||
        runtimeProfile?.providerEnvironment ||
        runtimeProfile?.defaultEnvironment ||
        '',
    ).trim().toLowerCase();
    return environment === 'sandbox';
}

function sanitizePaymentDiagnosticValue(value) {
    if (value === null || value === undefined) return null;
    const text = String(value)
        .replace(/[;\n\r\t]/g, '_')
        .replace(/\s+/g, '_')
        .trim();
    return text ? text.slice(0, 120) : null;
}

function buildPaymentErrorDiagnostics(error) {
    const response = error?.response || error?.originalError?.response || null;
    const responseData = response?.data || error?.response?.data || error?.originalError?.response?.data || {};
    const providerDetails = responseData?.details && typeof responseData.details === 'object'
        ? responseData.details
        : {};
    const providerData = providerDetails?.data && typeof providerDetails.data === 'object'
        ? providerDetails.data
        : {};
    const providerFirstError = Array.isArray(providerData?.errors) && providerData.errors[0]
        ? providerData.errors[0]
        : {};
    const diagnostics = {
        status: error?.status || response?.status || null,
        code: error?.code || responseData?.code || responseData?.error?.code || null,
        provider: responseData?.provider || null,
        providerEnvironment: responseData?.providerEnvironment || null,
        paymentProfileId: responseData?.paymentProfileId || null,
        paymentIntentId: responseData?.paymentIntentId || null,
        chargeId: responseData?.chargeId || null,
        providerStatus: providerDetails?.status || providerData?.status || null,
        providerStatusText: providerDetails?.statusText || providerData?.statusText || null,
        providerCode: providerData?.code || providerFirstError?.code || providerDetails?.code || null,
        providerError: providerData?.error || providerFirstError?.error || providerDetails?.error || null,
        providerMessage: providerData?.message || providerFirstError?.message || providerDetails?.message || null,
    };

    return Object.entries(diagnostics).reduce((acc, [key, value]) => {
        const sanitized = sanitizePaymentDiagnosticValue(value);
        if (sanitized) acc[key] = sanitized;
        return acc;
    }, {});
}

function decodeBase64UrlJson(segment) {
    const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        '=',
    );

    if (typeof globalThis?.atob === 'function') {
        return JSON.parse(globalThis.atob(padded));
    }

    if (typeof Buffer !== 'undefined') {
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    }

    return null;
}

function getJwtSubject(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) {
        return '';
    }

    try {
        const payload = decodeBase64UrlJson(parts[1]);
        return String(payload?.user_id || payload?.sub || '').trim();
    } catch (_error) {
        return '';
    }
}

function serializePaymentErrorDiagnostics(diagnostics) {
    const entries = Object.entries(diagnostics || {});
    if (!entries.length) return null;
    return `${PAYMENT_ERROR_DIAGNOSTIC_PREFIX}${entries
        .map(([key, value]) => `${key}=${value}`)
        .join(';')}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPaymentErrorStatus(error) {
    return Number(
        error?.status ||
        error?.response?.status ||
        error?.originalError?.status ||
        error?.originalError?.response?.status ||
        0
    );
}

function getPaymentErrorCode(error) {
    return String(
        error?.code ||
        error?.response?.data?.code ||
        error?.response?.data?.error?.code ||
        error?.originalError?.code ||
        error?.originalError?.response?.data?.code ||
        ''
    ).trim().toUpperCase();
}

function isTransientPaymentCreationError(error) {
    const status = getPaymentErrorStatus(error);
    const code = getPaymentErrorCode(error);
    if (
        code.startsWith('PAYMENT_AUTH_') ||
        code.startsWith('QUOTE_LOCK_') ||
        code === 'NO_DRIVERS_AVAILABLE' ||
        code === 'PAYMENT_PASSENGER_SCOPE_MISMATCH' ||
        code === 'PAYMENT_SESSION_CONSUMED' ||
        code === 'PAYMENT_INTENT_CONFLICT'
    ) {
        return false;
    }

    return (
        code === 'ERR_NETWORK' ||
        code === 'ECONNABORTED' ||
        status === 408 ||
        status === 429 ||
        (status >= 500 && status <= 599)
    );
}

export default function WooviPaymentModal({ 
    visible, 
    onClose, 
    tripData, 
    estimates,
    onPaymentConfirmed,
    passengerId,
    passengerName,
    passengerEmail,
    passengerPhone,
    prefilledPaymentData = null,
    preserveChargeOnClose = false,
    paymentTitle = 'Pagamento PIX',
    qaAutoConfirm = false,
    discountBenefit = null,
    grossEstimatedFare = null,
    quoteSessionId = null,
    quoteLockId = null,
    onPaymentExpired = null,
    onPaymentAborted = null
}) {
    const qaAutoConfirmEnabled = Boolean(qaAutoConfirm);
    // Estados
    const [loading, setLoading] = useState(false);
    const [paymentData, setPaymentData] = useState(null);
    const [paymentGenerationError, setPaymentGenerationError] = useState(null);
    const [paymentGenerationDiagnostics, setPaymentGenerationDiagnostics] = useState(null);
    const [countdown, setCountdown] = useState(PAYMENT_TIMEOUT); // 5 minutos
    const [isCheckingPayment, setIsCheckingPayment] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState('pending'); // pending, confirmed, expired, cancelled
    const [qaDebugStatus, setQaDebugStatus] = useState('idle');
    const normalizedQuoteLockId = String(quoteLockId || '').trim();
    
    // Refs
    const countdownIntervalRef = useRef(null);
    const paymentCheckIntervalRef = useRef(null);
    const timeoutRef = useRef(null);
    const paymentDataRef = useRef(null);
    const paymentStatusRef = useRef(paymentStatus); // ✅ Ref para acessar status atualizado no intervalo
    const paymentConfirmedRef = useRef(false);
    const autoConfirmTimerRef = useRef(null);
    const qaAutoConfirmStartedRef = useRef(false);
    const isCheckingPaymentRef = useRef(false);
    const visibleRef = useRef(Boolean(visible));
    const paymentLifecycleRef = useRef(0);
    const timeoutHandledRef = useRef(false);
    const terminalClosePendingRef = useRef(false);
    const timeoutExpiredNotifiedRef = useRef(false);

    visibleRef.current = Boolean(visible);

    const beginPaymentLifecycle = () => {
        paymentLifecycleRef.current += 1;
        timeoutHandledRef.current = false;
        timeoutExpiredNotifiedRef.current = false;
        return paymentLifecycleRef.current;
    };

    const invalidatePaymentLifecycle = () => {
        paymentLifecycleRef.current += 1;
        timeoutHandledRef.current = true;
        return paymentLifecycleRef.current;
    };

    const isPaymentLifecycleCurrent = (lifecycleToken) => (
        visibleRef.current && lifecycleToken === paymentLifecycleRef.current
    );

    const closeWithoutConfirmation = (payload = {}) => {
        invalidatePaymentLifecycle();
        cleanup();
        if (typeof onPaymentAborted === 'function') {
            onPaymentAborted(payload);
            return;
        }
        onClose(payload);
    };

    const notifyPaymentExpired = (timedOutPaymentData = null) => {
        if (timeoutExpiredNotifiedRef.current) {
            return;
        }

        timeoutExpiredNotifiedRef.current = true;
        const payload = {
            reason: 'timeout',
            chargeId: timedOutPaymentData?.chargeId || null
        };

        if (typeof onPaymentExpired === 'function') {
            onPaymentExpired(payload);
            return;
        }

        closeWithoutConfirmation(payload);
    };

    // ✅ Sincronizar ref com estado
    useEffect(() => {
        paymentStatusRef.current = paymentStatus;
    }, [paymentStatus]);

    useEffect(() => {
        paymentDataRef.current = paymentData;
    }, [paymentData]);

    const clearAutoConfirmTimer = () => {
        if (autoConfirmTimerRef.current) {
            clearTimeout(autoConfirmTimerRef.current);
            autoConfirmTimerRef.current = null;
        }
    };

    const cleanup = () => {
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        if (paymentCheckIntervalRef.current) {
            clearInterval(paymentCheckIntervalRef.current);
            paymentCheckIntervalRef.current = null;
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        clearAutoConfirmTimer();
    };

    const shouldBypassPayment = async (runtimeProfile = null) => {
        if (isSandboxPaymentRuntimeProfile(runtimeProfile)) {
            Logger.log('✅ [WooviPaymentModal] Bypass desativado: perfil de pagamento sandbox deve usar Woovi sandbox.');
            return false;
        }

        if (allowForcedPaymentBypass()) {
            return true;
        }

        if (qaAutoConfirmEnabled) {
            return false;
        }

        try {
            return await PaymentBypassService.shouldUseBypass();
        } catch (_error) {
            return false;
        }
    };

    const isQaTestModeEnabled = async () => {
        try {
            const testModeRaw = await AsyncStorage.getItem(TEST_MODE_STORAGE_KEY);
            return String(testModeRaw || '').trim().toLowerCase() === 'true';
        } catch (_error) {
            return false;
        }
    };

    const assertQaSandboxPaymentRuntime = async ({ resolvedPassengerId, passengerPhone }) => {
        if (!(await isQaTestModeEnabled())) {
            return null;
        }

        const runtimeProfile = await WooviService.resolvePaymentRuntimeProfile({
            passengerId: resolvedPassengerId,
            phone: passengerPhone,
            phoneNumber: passengerPhone,
        });
        const effectiveProfile = runtimeProfile?.effectiveProfile || {};
        const effectiveEnvironment = String(effectiveProfile.environment || '').trim().toLowerCase();

        if (effectiveEnvironment === 'sandbox') {
            Logger.log('✅ [WooviPaymentModal] Perfil de pagamento QA confirmado em sandbox', {
                passengerId: resolvedPassengerId,
                paymentProfileId: effectiveProfile.profileId || null,
            });
            return runtimeProfile;
        }

        const paymentProfileId = effectiveProfile.profileId || null;
        const error = new Error(
            'Ambiente de pagamento QA não está em sandbox para este usuário. Verifique o perfil de pagamento antes de gerar o Pix.',
        );
        error.code = 'PAYMENT_QA_SANDBOX_PROFILE_REQUIRED';
        error.response = {
            status: 503,
            data: {
                success: false,
                code: 'PAYMENT_QA_SANDBOX_PROFILE_REQUIRED',
                error: error.message,
                message: error.message,
                provider: runtimeProfile?.provider || 'woovi',
                providerEnvironment: effectiveEnvironment || runtimeProfile?.defaultEnvironment || 'unknown',
                paymentProfileId,
            },
        };
        throw error;
    };

    const resolveAuthenticatedPassengerId = async () => {
        const directPassengerId = String(passengerId || '').trim();
        let firebasePassengerId = '';
        try {
            firebasePassengerId = String(auth()?.currentUser?.uid || '').trim();
        } catch (_error) {
            firebasePassengerId = '';
        }

        if (directPassengerId && firebasePassengerId && directPassengerId !== firebasePassengerId) {
            try {
                const [testModeRaw, qaSocketIdTokenRaw, persistedUidRaw] = await Promise.all([
                    AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
                    AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY),
                    AsyncStorage.getItem(AUTH_UID_STORAGE_KEY),
                ]);
                const qaModeEnabled = String(testModeRaw || '').trim().toLowerCase() === 'true';
                const qaTokenSubject = getJwtSubject(qaSocketIdTokenRaw);
                const persistedUid = String(persistedUidRaw || '').trim();
                const qaIdentityMatchesPassenger =
                    qaModeEnabled &&
                    qaTokenSubject === directPassengerId &&
                    (!persistedUid || persistedUid === directPassengerId);

                if (qaIdentityMatchesPassenger) {
                    Logger.warn(
                        '⚠️ [WooviPaymentModal] Firebase currentUser diverge, mas token QA assinado corresponde ao passageiro; usando identidade QA.',
                    );
                    return directPassengerId;
                }
            } catch (qaIdentityError) {
                Logger.warn('⚠️ [WooviPaymentModal] Falha ao validar identidade QA:', qaIdentityError);
            }

            const mismatchError = new Error('Sua sessão mudou. Entre novamente para gerar o Pix desta corrida.');
            mismatchError.code = 'PAYMENT_PASSENGER_SCOPE_MISMATCH';
            mismatchError.response = {
                status: 403,
                data: {
                    success: false,
                    code: 'PAYMENT_PASSENGER_SCOPE_MISMATCH',
                    error: 'Passageiro não autorizado para esta operação',
                    message: 'Sua sessão mudou. Entre novamente para gerar o Pix desta corrida.',
                    passengerId: directPassengerId,
                    authenticatedPassengerId: firebasePassengerId,
                },
            };
            throw mismatchError;
        }

        return directPassengerId || firebasePassengerId;
    };

    const confirmPaymentOnce = (confirmationPayload = null, source = 'unknown') => {
        if (paymentConfirmedRef.current) {
            Logger.log(`ℹ️ [WooviPaymentModal] Confirmação duplicada ignorada (${source})`);
            return false;
        }

        const normalizedPayload =
            confirmationPayload && typeof confirmationPayload === 'object'
                ? confirmationPayload
                : paymentData;

        if (!normalizedPayload?.chargeId || !normalizedPayload?.rideId) {
            Logger.warn(`⚠️ [WooviPaymentModal] confirmação sem payload válido (${source})`, normalizedPayload);
            return false;
        }

        paymentConfirmedRef.current = true;
        paymentStatusRef.current = 'confirmed';
        timeoutHandledRef.current = true;

        cleanup();
        setPaymentStatus('confirmed');
        setQaDebugStatus('confirmed');

        const confirmationResult = {
            chargeId: normalizedPayload.chargeId,
            rideId: normalizedPayload.rideId,
            amount: normalizedPayload.amount,
            amountInCents: normalizedPayload.amountInCents,
            grossAmount: normalizedPayload.grossAmount,
            grossAmountInCents: normalizedPayload.grossAmountInCents,
            tollFee: normalizedPayload.tollFee ?? paymentData?.tollFee ?? 0,
            tollFeeCents: normalizedPayload.tollFeeCents ?? paymentData?.tollFeeCents ?? 0,
            discountBenefit: normalizedPayload.discountBenefit || null,
            paymentSessionId:
                normalizedPayload.paymentSessionId ||
                paymentData?.paymentSessionId ||
                null,
            paymentContextKey:
                normalizedPayload.paymentContextKey ||
                paymentData?.paymentContextKey ||
                null,
            quoteSessionId:
                normalizedPayload.quoteSessionId ||
                paymentData?.quoteSessionId ||
                quoteSessionId ||
                null,
            quoteLockId:
                normalizedPayload.quoteLockId ||
                paymentData?.quoteLockId ||
                normalizedQuoteLockId ||
                null,
            bypassed: normalizedPayload.bypassed === true,
            mockPayment:
                normalizedPayload.mockPayment === true ||
                normalizedPayload.bypassed === true ||
                String(normalizedPayload.chargeId || '').startsWith('qa_bypass_')
        };

        const notifyDelay = String(source || '').includes('qa') || source === 'bypass'
            ? 900
            : 350;

        setTimeout(() => {
            if (onPaymentConfirmed) {
                onPaymentConfirmed(confirmationResult);
            }
        }, notifyDelay);

        setTimeout(() => {
            onClose();
        }, notifyDelay + 1200);

        return true;
    };

    const buildConfirmationPayload = (sourcePaymentData = null, statusResult = null) => {
        const resolvedPaymentData = sourcePaymentData || paymentData || {};
        return {
            ...resolvedPaymentData,
            amount: resolvedPaymentData.amount,
            amountInCents: resolvedPaymentData.amountInCents,
            grossAmount: resolvedPaymentData.grossAmount,
            grossAmountInCents: resolvedPaymentData.grossAmountInCents,
            discountBenefit: resolvedPaymentData.discountBenefit || null,
            providerStatus: statusResult?.status || null,
            providerSource: statusResult?.source || null,
        };
    };

    const resolvePaymentStatus = async (sourcePaymentData = null, source = 'chargeId') => {
        const resolvedPaymentData = sourcePaymentData || paymentData;
        const reference = resolvedPaymentData?.chargeId;
        if (!reference) {
            return null;
        }

        Logger.log(`🔍 [Woovi] Verificando status do pagamento via ${source}:`, reference);
        const statusResult = await WooviService.getPaymentStatus(reference);
        const normalizedStatus = String(statusResult?.status || '').trim().toLowerCase();

        Logger.log('📊 [Woovi] Status recebido:', {
            source,
            reference,
            statusResult,
        });

        return {
            source,
            reference,
            statusResult,
            normalizedStatus,
            isPaymentCompleted:
                statusResult?.success === true &&
                CONFIRMED_PAYMENT_STATUSES.has(normalizedStatus),
        };
    };

    const confirmIfPaymentAlreadyCompleted = async (
        sourcePaymentData = null,
        source = 'status_check',
    ) => {
        const statusEntry = await resolvePaymentStatus(sourcePaymentData, source);
        if (!statusEntry?.isPaymentCompleted) {
            return false;
        }

        Logger.log('✅ [WooviPaymentModal] Pagamento confirmado por leitura autoritativa', {
            status: statusEntry.normalizedStatus,
            source: statusEntry.source,
            chargeId: sourcePaymentData?.chargeId || paymentData?.chargeId,
            rideId: sourcePaymentData?.rideId || paymentData?.rideId,
        });

        return confirmPaymentOnce(
            buildConfirmationPayload(sourcePaymentData, statusEntry.statusResult),
            source,
        );
    };

    // Reabre a sessão canônica antes de considerar uma nova cobrança.
    useEffect(() => {
        if (visible) {
            if (terminalClosePendingRef.current) {
                Logger.log('ℹ️ [WooviPaymentModal] Modal em expiração terminal; aguardando fechamento do pai');
                cleanup();
                setLoading(false);
                return undefined;
            }

            beginPaymentLifecycle();
            Logger.log('🔄 [WooviPaymentModal] Modal aberto, recuperando sessão de pagamento...');
            // ✅ Limpar estado anterior completamente
            cleanup();
            paymentConfirmedRef.current = false;
            qaAutoConfirmStartedRef.current = false;
            setQaDebugStatus(qaAutoConfirmEnabled ? 'opening' : 'disabled');
            setPaymentData(null);
            setPaymentGenerationError(null);
            setPaymentStatus('pending');
            paymentStatusRef.current = 'pending'; // ✅ Atualizar ref também
            setCountdown(PAYMENT_TIMEOUT);
            setLoading(true);
            setIsCheckingPayment(false);

            if (prefilledPaymentData?.chargeId) {
                const amountValue = Number(prefilledPaymentData?.amount ?? estimates?.estimateFare ?? tripData?.estimatedFare ?? 0);
                const amountInCentsValue = Number(prefilledPaymentData?.amountInCents);
                const normalizedPaymentInfo = {
                    chargeId: prefilledPaymentData.chargeId,
                    paymentIntentId: prefilledPaymentData.paymentIntentId || null,
                    rideId: prefilledPaymentData.rideId || tripData?.rideId || `prefilled-${Date.now()}`,
                    qrCodeImage: prefilledPaymentData.qrCodeImage || null,
                    qrCodeText:
                        prefilledPaymentData.qrCodeText ||
                        prefilledPaymentData.brCode ||
                        prefilledPaymentData.pixQRCode ||
                        prefilledPaymentData.paymentLink ||
                        '',
                    paymentLink: prefilledPaymentData.paymentLink || null,
                    amount: Number.isFinite(amountValue) ? amountValue : 0,
                    amountInCents:
                        Number.isFinite(amountInCentsValue) && amountInCentsValue > 0
                            ? Math.round(amountInCentsValue)
                            : Math.round((Number.isFinite(amountValue) ? amountValue : 0) * 100),
                    grossAmount: Number(prefilledPaymentData.grossAmount || prefilledPaymentData.grossAmountInCents / 100 || amountValue || 0),
                    grossAmountInCents:
                        Number.isFinite(Number(prefilledPaymentData.grossAmountInCents)) &&
                        Number(prefilledPaymentData.grossAmountInCents) > 0
                            ? Math.round(Number(prefilledPaymentData.grossAmountInCents))
                            : Math.round(Number(prefilledPaymentData.grossAmount || amountValue || 0) * 100),
                    discountBenefit: prefilledPaymentData.discountBenefit || null,
                    passengerId: prefilledPaymentData.passengerId || passengerId || null,
                    paymentSessionId: prefilledPaymentData.paymentSessionId || null,
                    paymentContextKey: prefilledPaymentData.paymentContextKey || null,
                    quoteSessionId: prefilledPaymentData.quoteSessionId || quoteSessionId || null,
                    quoteLockId: prefilledPaymentData.quoteLockId || normalizedQuoteLockId || null,
                    expiresAt:
                        prefilledPaymentData.expiresAt ||
                        new Date(Date.now() + PAYMENT_TIMEOUT * 1000)
                };

                Logger.log('💳 [WooviPaymentModal] Usando cobrança PIX pré-gerada:', normalizedPaymentInfo.chargeId);
                setPaymentData(normalizedPaymentInfo);
                setCountdown(PAYMENT_TIMEOUT);
                setPaymentStatus('pending');
                setLoading(false);
                return undefined;
            }

            // Delay para garantir que o estado foi limpo antes de recuperar/criar o pagamento.
            const generateTimer = setTimeout(() => {
                Logger.log('💳 [WooviPaymentModal] Recuperando ou criando pagamento PIX...');
                generatePayment();
            }, 150);
            
            return () => {
                clearTimeout(generateTimer);
            };
        } else {
            // Limpar tudo quando modal fecha
            Logger.log('🔄 [WooviPaymentModal] Modal fechado, limpando recursos...');
            invalidatePaymentLifecycle();
            terminalClosePendingRef.current = false;
            timeoutExpiredNotifiedRef.current = false;
            cleanup();
            paymentConfirmedRef.current = false;
            qaAutoConfirmStartedRef.current = false;
            setQaDebugStatus('closed');
            setPaymentData(null);
            setPaymentGenerationError(null);
            setPaymentStatus('pending');
            setLoading(false);
        }
        
        return () => {
            cleanup();
        };
    }, [
        estimates?.estimateFare,
        prefilledPaymentData?.amount,
        prefilledPaymentData?.amountInCents,
        prefilledPaymentData?.brCode,
        prefilledPaymentData?.chargeId,
        prefilledPaymentData?.expiresAt,
        prefilledPaymentData?.paymentLink,
        prefilledPaymentData?.pixQRCode,
        prefilledPaymentData?.qrCodeImage,
        prefilledPaymentData?.qrCodeText,
        prefilledPaymentData?.rideId,
        discountBenefit?.benefitId,
        discountBenefit?.discountAmountInCents,
        grossEstimatedFare,
        tripData?.estimatedFare,
        tripData?.grossEstimatedFare,
	        tripData?.rideId,
	        normalizedQuoteLockId,
	        quoteSessionId,
	        visible
	    ]);

    // Countdown timer
    useEffect(() => {
        // ✅ Parar timer imediatamente se pagamento foi confirmado, expirado ou cancelado
        if (paymentStatus !== 'pending') {
            Logger.log('🛑 [Timer] Parando timer - status:', paymentStatus);
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            return;
        }
        
        // ✅ Só iniciar timer se modal está visível, tem paymentData, countdown > 0 e status é pending
        if (visible && paymentData && countdown > 0 && paymentStatus === 'pending') {
            Logger.log('⏱️ [Timer] Iniciando timer de pagamento, countdown:', countdown);
            const lifecycleToken = paymentLifecycleRef.current;
            
            // Limpar intervalo anterior se existir
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            
            countdownIntervalRef.current = setInterval(() => {
                setCountdown(prev => {
                    // ✅ Verificar se status ainda é pending antes de decrementar (usar ref para valor atualizado)
                    if (paymentStatusRef.current !== 'pending') {
                        Logger.log('🛑 [Timer] Status mudou durante contagem, parando timer. Status atual:', paymentStatusRef.current);
                        if (countdownIntervalRef.current) {
                            clearInterval(countdownIntervalRef.current);
                            countdownIntervalRef.current = null;
                        }
                        return prev;
                    }
                    
                    if (prev <= 1) {
                        Logger.log('⏰ [Timer] Countdown chegou a zero, chamando handleTimeout');
                        handleTimeout(lifecycleToken);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            // Parar timer se condições não forem atendidas
            if (countdownIntervalRef.current) {
                Logger.log('🛑 [Timer] Parando timer - condições não atendidas');
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        }
        
        return () => {
            if (countdownIntervalRef.current) {
                Logger.log('🧹 [Timer] Cleanup: limpando intervalo');
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, [visible, paymentData, countdown, paymentStatus]);

    // Verificação automática de pagamento a cada 3 segundos
    useEffect(() => {
        if (visible && paymentData && paymentStatus === 'pending') {
            checkPaymentStatus(paymentData);
            paymentCheckIntervalRef.current = setInterval(() => {
                checkPaymentStatus(paymentData);
            }, 3000); // Verificar a cada 3 segundos
        } else {
            if (paymentCheckIntervalRef.current) {
                clearInterval(paymentCheckIntervalRef.current);
                paymentCheckIntervalRef.current = null;
            }
        }
        
        return () => {
            if (paymentCheckIntervalRef.current) {
                clearInterval(paymentCheckIntervalRef.current);
            }
        };
    }, [visible, paymentData, paymentStatus]);

    useEffect(() => {
        if (
            !qaAutoConfirmEnabled ||
            !visible ||
            !paymentData?.chargeId ||
            !paymentData?.rideId ||
            paymentStatus !== 'pending' ||
            qaAutoConfirmStartedRef.current
        ) {
            return;
        }

        qaAutoConfirmStartedRef.current = true;
        setQaDebugStatus('scheduled');

        autoConfirmTimerRef.current = setTimeout(async () => {
            if (
                String(paymentData.chargeId || '').startsWith('mock_review_') ||
                String(paymentData.chargeId || '').startsWith('qa_bypass_')
            ) {
                return;
            }

            try {
                setQaDebugStatus('confirming');
                await WooviService.simulateTestWebhook({
                    chargeId: paymentData.chargeId,
                    paymentIntentId: paymentData.paymentIntentId,
                    rideId: paymentData.rideId,
                    passengerId: paymentData.passengerId || passengerId,
                    amountInCents: paymentData.amountInCents
                });
                setQaDebugStatus('awaiting_backend');
                await checkPaymentStatus();
            } catch (error) {
                qaAutoConfirmStartedRef.current = false;
                setQaDebugStatus('webhook_error');
                Logger.warn('⚠️ [WooviPaymentModal] qaAutoConfirm webhook falhou:', error?.message || error);
            }
        }, 900);

        return () => {
            clearAutoConfirmTimer();
        };
    }, [passengerId, paymentData, paymentStatus, qaAutoConfirmEnabled, visible]);

    // WebSocket listener para confirmação server-side
    useEffect(() => {
        if (!visible || !paymentData) {
            return;
        }

        const webSocketManager = WebSocketManager.getInstance();
        const handleServerPaymentConfirmed = (payload) => {
            if (!payload || paymentStatusRef.current === 'confirmed') {
                return;
            }

            const matchesRide =
                payload.rideId === paymentData.rideId ||
                payload.bookingId === paymentData.rideId;
            const matchesCharge =
                payload.chargeId && payload.chargeId === paymentData.chargeId;

            if (!matchesRide && !matchesCharge) {
                return;
            }

            Logger.log('⚡️ [WooviPaymentModal] Evento paymentConfirmed recebido via WebSocket:', payload);
            confirmPaymentOnce(
                {
                    chargeId: paymentData.chargeId,
                    rideId: paymentData.rideId,
                    amount: paymentData.amount,
                    amountInCents: paymentData.amountInCents,
                    grossAmount: paymentData.grossAmount,
                    grossAmountInCents: paymentData.grossAmountInCents,
                    tollFee: paymentData.tollFee || 0,
                    tollFeeCents: paymentData.tollFeeCents || 0,
                    quoteSessionId: paymentData.quoteSessionId || quoteSessionId || null,
                    quoteLockId: paymentData.quoteLockId || normalizedQuoteLockId || null
                },
                'websocket'
            );
        };

        webSocketManager.on('paymentConfirmed', handleServerPaymentConfirmed);
        return () => {
            webSocketManager.off('paymentConfirmed', handleServerPaymentConfirmed);
        };
    }, [visible, paymentData, onPaymentConfirmed, onClose]);

    // Formatar tempo
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getPixSnippet = () => {
        const pixCode = String(paymentData?.qrCodeText || '').trim();
        if (!pixCode) {
            return 'Codigo PIX indisponivel';
        }

        if (pixCode.length <= 18) {
            return pixCode;
        }

        return `${pixCode.slice(0, 8)}...${pixCode.slice(-4)}`;
    };

    const openPaymentLink = async () => {
        const targetUrl = String(paymentData?.paymentLink || '').trim();
        if (!targetUrl) {
            Alert.alert('Abrir banco', 'Copie o código PIX e cole no app do seu banco.');
            return;
        }

        try {
            const canOpen = await Linking.canOpenURL(targetUrl);
            if (canOpen) {
                await Linking.openURL(targetUrl);
                return;
            }
        } catch (error) {
            Logger.warn('⚠️ [WooviPaymentModal] Falha ao abrir link de pagamento:', error?.message || error);
        }

        Alert.alert('Abrir banco', 'Não foi possível abrir o link automaticamente. Copie o código PIX e cole no app do banco.');
    };

    // Recupera a sessão persistida antes de criar uma cobrança no backend.
    const generatePayment = async () => {
        if (terminalClosePendingRef.current || !visibleRef.current) {
            Logger.log('ℹ️ [WooviPaymentModal] Geração de PIX ignorada por ciclo terminal/fechado');
            return;
        }

        let paymentRequest = null;
        try {
            setLoading(true);
            setPaymentGenerationError(null);
            setPaymentGenerationDiagnostics(null);
            Logger.log('💳 Preparando sessão de pagamento PIX...');

            const resolvedPassengerId = await resolveAuthenticatedPassengerId();
            if (!resolvedPassengerId) {
                throw new Error('Sessão de pagamento ainda não está pronta. Tente novamente em alguns segundos.');
            }
            if (!normalizedQuoteLockId) {
                throw new Error('Cotação expirada ou ausente. Recalcule a tarifa antes de pagar.');
            }
            const qaPaymentRuntimeProfile = await assertQaSandboxPaymentRuntime({
                resolvedPassengerId,
                passengerPhone,
            });
            
            // Calcular valor em centavos - usar apenas a cotação travada enviada pelo fluxo.
            const amount = Number(estimates?.estimateFare ?? tripData?.estimatedFare);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error('Valor da cotação indisponível. Recalcule a tarifa antes de pagar.');
            }
            const amountInCents = Math.round(amount * 100);
            const tollFee = Number(estimates?.tollFee ?? tripData?.tollFee ?? 0);
            const tollFeeCents = Number.isFinite(tollFee) && tollFee > 0
                ? Math.round(tollFee * 100)
                : 0;
            const grossAmount = Number(
                grossEstimatedFare ||
                discountBenefit?.grossFare ||
                tripData?.grossEstimatedFare ||
                amount
            );
            const grossAmountInCents = Number.isFinite(Number(discountBenefit?.grossAmountInCents))
                ? Math.round(Number(discountBenefit.grossAmountInCents))
                : Math.round((Number.isFinite(grossAmount) && grossAmount > 0 ? grossAmount : amount) * 100);
            const paymentContextKey = buildRidePaymentContextKey({
                tripData,
                amountInCents,
                grossAmountInCents,
            });
            let paymentSession = await getOrCreateRidePaymentSession({
                passengerId: resolvedPassengerId,
                contextKey: paymentContextKey,
            });

            Logger.log('💰 [Woovi] Valor calculado:', { 
                amount, 
                amountInCents, 
                fromEstimates: estimates?.estimateFare,
                fromTripData: tripData?.estimatedFare
            });

            if (paymentSession?.paymentData?.chargeId) {
                const restoredPaymentData = {
                    ...paymentSession.paymentData,
                    paymentSessionId: paymentSession.paymentSessionId,
                    paymentContextKey,
                    passengerId: resolvedPassengerId,
                };
                let restoredStatus = '';
                try {
                    const statusResult = await WooviService.getPaymentStatus(restoredPaymentData.chargeId);
                    restoredStatus = String(statusResult?.status || '').trim().toLowerCase();
                } catch (statusError) {
                    Logger.warn(
                        '⚠️ [WooviPaymentModal] Status indisponível durante recuperação; preservando cobrança:',
                        statusError?.message || statusError,
                    );
                }

                if (CONFIRMED_PAYMENT_STATUSES.has(restoredStatus)) {
                    Logger.log('✅ [WooviPaymentModal] Pagamento confirmado recuperado da sessão persistida');
                    setPaymentData(restoredPaymentData);
                    setLoading(false);
                    confirmPaymentOnce(restoredPaymentData, 'storage_recovery');
                    return;
                }

                const expiresAtMs = Date.parse(restoredPaymentData.expiresAt || '');
                const remainingSeconds = Number.isFinite(expiresAtMs)
                    ? Math.ceil((expiresAtMs - Date.now()) / 1000)
                    : PAYMENT_TIMEOUT;

                if (!TERMINAL_PAYMENT_STATUSES.has(restoredStatus) && remainingSeconds > 0) {
                    setPaymentData(restoredPaymentData);
                    setCountdown(remainingSeconds);
                    setPaymentStatus('pending');
                    setLoading(false);
                    return;
                }

                await clearRidePaymentSession({
                    passengerId: resolvedPassengerId,
                    paymentSessionId: paymentSession.paymentSessionId,
                    chargeId: restoredPaymentData.chargeId,
                });
                if (!TERMINAL_PAYMENT_STATUSES.has(restoredStatus) && remainingSeconds <= 0) {
                    Logger.log('ℹ️ [WooviPaymentModal] Cobrança local expirada descartada antes de gerar novo PIX:', restoredPaymentData.chargeId);
                }
                paymentSession = await getOrCreateRidePaymentSession({
                    passengerId: resolvedPassengerId,
                    contextKey: paymentContextKey,
                });
            }

            const tempRideId = `temp_ride_session_${paymentSession.paymentSessionId}`;
            Logger.log('🆔 [WooviPaymentModal] Sessão canônica preparada:', paymentSession.paymentSessionId);

            const bypassEnabled = await shouldBypassPayment(qaPaymentRuntimeProfile);
            if (bypassEnabled) {
                const timestamp = Date.now();
                const bypassPaymentInfo = {
                    chargeId: `qa_bypass_${timestamp}_${paymentSession.paymentSessionId}`,
                    rideId: tempRideId,
                    qrCodeImage: null,
                    qrCodeText: 'BYPASS_PAYMENT_ENABLED',
                    paymentLink: null,
                    amount: amount,
                    amountInCents: amountInCents,
                    grossAmount: grossAmountInCents / 100,
                    grossAmountInCents,
                    tollFee: tollFeeCents / 100,
                    tollFeeCents,
                    discountBenefit,
                    expiresAt: new Date(Date.now() + (PAYMENT_TIMEOUT * 1000)),
                    passengerId: resolvedPassengerId,
                    paymentSessionId: paymentSession.paymentSessionId,
                    paymentContextKey,
                    quoteSessionId,
                    quoteLockId: normalizedQuoteLockId,
                    bypassed: true,
                    mockPayment: true
                };

                Logger.log('🧪 [WooviPaymentModal] BYPASS de pagamento habilitado para teste E2E.');
                await saveRidePaymentSessionData({
                    passengerId: resolvedPassengerId,
                    contextKey: paymentContextKey,
                    paymentSessionId: paymentSession.paymentSessionId,
                    paymentData: bypassPaymentInfo,
                });
                setPaymentData(bypassPaymentInfo);
                setCountdown(PAYMENT_TIMEOUT);
                setPaymentStatus('pending');

                autoConfirmTimerRef.current = setTimeout(() => {
                    confirmPaymentOnce(bypassPaymentInfo, 'bypass');
                }, 900);
                return;
            }
            
            // Preparar dados do pagamento
            paymentRequest = {
                passengerId: resolvedPassengerId,
                passengerPhone,
                phone: passengerPhone,
                phoneNumber: passengerPhone,
                amount: amountInCents,
                grossAmountInCents,
                grossAmount: grossAmountInCents / 100,
                tollFee: tollFeeCents / 100,
                tollFeeCents,
                discountBenefit,
                rideId: tempRideId,
                paymentSessionId: paymentSession.paymentSessionId,
                paymentContextKey,
                quoteSessionId,
                quoteLockId: normalizedQuoteLockId,
                rideDetails: {
                    origin: tripData?.pickup?.add || 'Origem',
                    destination: tripData?.drop?.add || 'Destino',
                    pickupLocation: tripData?.pickup || null,
                    destinationLocation: tripData?.drop || null,
                    carType: tripData?.carType || null,
                    quoteLockId: normalizedQuoteLockId,
                    tollFee: tollFeeCents / 100,
                    tollFeeCents,
                    preferences: tripData?.preferences || {}
                },
                pickupLocation: tripData?.pickup || null,
                destinationLocation: tripData?.drop || null,
                carType: tripData?.carType || null,
                vehicle: tripData?.carType || null,
                preferences: tripData?.preferences || {},
                passengerName: passengerName || 'Passageiro',
                passengerEmail: passengerEmail || 'passenger@leaf.com'
            };
            
            // Chamar API do backend para criar cobrança PIX. O payload é idempotente
            // por paymentSessionId/rideId; repetir cobre falhas transitórias de rede.
            let result = null;
            let lastPaymentError = null;
            for (let attempt = 1; attempt <= PAYMENT_CREATE_MAX_ATTEMPTS; attempt += 1) {
                try {
                    result = await WooviService.processAdvancePayment(paymentRequest);
                    lastPaymentError = null;
                    break;
                } catch (attemptError) {
                    lastPaymentError = attemptError;
                    const canRetry =
                        attempt < PAYMENT_CREATE_MAX_ATTEMPTS &&
                        isTransientPaymentCreationError(attemptError);

                    if (!canRetry) {
                        throw attemptError;
                    }

                    const retryDelay =
                        PAYMENT_CREATE_RETRY_DELAYS_MS[attempt - 1] ||
                        PAYMENT_CREATE_RETRY_DELAYS_MS[PAYMENT_CREATE_RETRY_DELAYS_MS.length - 1];
                    Logger.warn('⚠️ [WooviPaymentModal] Falha transitória ao criar PIX; tentando novamente', {
                        attempt,
                        nextAttempt: attempt + 1,
                        retryDelay,
                        code: getPaymentErrorCode(attemptError) || null,
                        status: getPaymentErrorStatus(attemptError) || null,
                    });
                    await sleep(retryDelay);
                }
            }

            if (!result && lastPaymentError) {
                throw lastPaymentError;
            }

            if (terminalClosePendingRef.current || !visibleRef.current) {
                Logger.log('ℹ️ [WooviPaymentModal] Resultado de PIX descartado por ciclo terminal/fechado');
                return;
            }

            if (!result.success) {
                const resultError = new Error(result.error || 'Falha ao gerar pagamento');
                resultError.code = result.code || null;
                resultError.response = { status: result.status || 400, data: result };
                throw resultError;
            }
            
            Logger.log('✅ Pagamento gerado com sucesso:', result.chargeId);
            
            // Salvar dados do pagamento
            const paymentInfo = {
                chargeId: result.chargeId,
                paymentIntentId: result.paymentIntentId || null,
                rideId: result.rideId || tempRideId,
                qrCodeImage: result.qrCode,
                qrCodeText: result.qrCodeText || result.paymentLink,
                paymentLink: result.paymentLink,
                amount: amount,
                amountInCents: amountInCents,
                grossAmount: grossAmountInCents / 100,
                grossAmountInCents,
                tollFee: tollFeeCents / 100,
                tollFeeCents,
                discountBenefit: result.discountBenefit || discountBenefit || null,
                expiresAt: new Date(Date.now() + (PAYMENT_TIMEOUT * 1000)).toISOString(),
                passengerId: resolvedPassengerId,
                paymentSessionId: paymentSession.paymentSessionId,
                paymentContextKey: result.paymentContextKey || paymentContextKey,
                quoteSessionId: result.quoteSessionId || quoteSessionId || null,
                quoteLockId: result.quoteLockId || normalizedQuoteLockId || null,
            };

            await saveRidePaymentSessionData({
                passengerId: resolvedPassengerId,
                contextKey: paymentContextKey,
                paymentSessionId: paymentSession.paymentSessionId,
                paymentData: paymentInfo,
            });
            
            setPaymentData(paymentInfo);
            setCountdown(PAYMENT_TIMEOUT);
            setPaymentStatus('pending');

            // Agendar timeout automático
            const lifecycleToken = paymentLifecycleRef.current;
            timeoutRef.current = setTimeout(() => {
                handleTimeout(lifecycleToken);
            }, PAYMENT_TIMEOUT * 1000);
            
        } catch (error) {
            const serverResponse = error?.response?.data;
            const diagnostics = buildPaymentErrorDiagnostics(error);
            Logger.error('❌ Erro ao gerar pagamento:', serverResponse || error);
            if (paymentRequest) {
                Logger.log('📦 Payload enviado para /api/payment/advance:', paymentRequest);
            }
            setPaymentData(null);
            setPaymentGenerationDiagnostics(diagnostics);
            setPaymentGenerationError(
                error?.message || 'Não foi possível gerar o pagamento PIX no momento.'
            );
        } finally {
            setLoading(false);
        }
    };

    // Função para copiar código PIX
    const copyPixCode = async () => {
        if (paymentData?.qrCodeText) {
            try {
                await Clipboard.setStringAsync(paymentData.qrCodeText);
                // Mostra o código em um Alert para o usuário copiar manualmente
                Alert.alert(
                    '📋 Código PIX',
                    `Copie o código abaixo:\n\n${paymentData.qrCodeText}\n\nCole no seu app de pagamentos.`,
                    [{ text: 'OK' }]
                );
            } catch (error) {
                Logger.error('❌ Erro ao copiar código PIX:', error);
                // Fallback: mostra o código mesmo em caso de erro
                Alert.alert(
                    '📋 Código PIX',
                    `Copie o código abaixo:\n\n${paymentData.qrCodeText}\n\nCole no seu app de pagamentos.`,
                    [{ text: 'OK' }]
                );
            }
        }
    };

    // Função para verificar status do pagamento
    const checkPaymentStatus = async (sourcePaymentData = paymentData) => {
        const activePaymentData = sourcePaymentData || paymentData;
        if ((!activePaymentData?.chargeId && !activePaymentData?.rideId) || isCheckingPaymentRef.current || paymentStatusRef.current !== 'pending') {
            return;
        }
        
        try {
            isCheckingPaymentRef.current = true;
            setIsCheckingPayment(true);
            
            const chargeStatus = await resolvePaymentStatus(activePaymentData, 'chargeId');
            const confirmedStatus = [chargeStatus].find(
                (entry) => entry?.isPaymentCompleted,
            );

            if (confirmedStatus) {
                // Pagamento confirmado!
                Logger.log('✅ [WooviPaymentModal] Pagamento confirmado via checkPaymentStatus!', {
                    status: confirmedStatus.normalizedStatus,
                    source: confirmedStatus.source,
                    chargeId: activePaymentData.chargeId,
                    rideId: activePaymentData.rideId,
                });

                confirmPaymentOnce(
                    buildConfirmationPayload(activePaymentData, confirmedStatus.statusResult),
                    'polling'
                );
            } else if (qaAutoConfirmEnabled) {
                setQaDebugStatus('awaiting_backend');
            }
            
        } catch (error) {
            const serverResponse = error?.response?.data;
            Logger.debug('ℹ️ [WooviPaymentModal] Verificação silenciosa indisponível:', {
                error: serverResponse || error?.message || error,
                chargeId: activePaymentData?.chargeId,
                rideId: activePaymentData?.rideId,
                lifecycleActive: visibleRef.current,
                paymentStatus: paymentStatusRef.current,
            });
            // Não mostrar erro para o usuário (verificação silenciosa)
        } finally {
            isCheckingPaymentRef.current = false;
            setIsCheckingPayment(false);
        }
    };

    // Função para lidar com timeout (5 minutos)
    const handleTimeout = async (lifecycleToken = paymentLifecycleRef.current) => {
        if (
            !isPaymentLifecycleCurrent(lifecycleToken) ||
            timeoutHandledRef.current ||
            paymentStatusRef.current !== 'pending'
        ) {
            Logger.log('ℹ️ [WooviPaymentModal] Timeout ignorado por ciclo inativo ou já tratado');
            return;
        }

        timeoutHandledRef.current = true;
        terminalClosePendingRef.current = true;
        Logger.log('⏰ Tempo de pagamento expirado');
        const currentPaymentData = paymentDataRef.current || paymentData;
        const timedOutPaymentData = currentPaymentData ? { ...currentPaymentData } : null;
        if (timedOutPaymentData?.chargeId) {
            try {
                const confirmed = await confirmIfPaymentAlreadyCompleted(
                    timedOutPaymentData,
                    'timeout_final_status',
                );
                if (confirmed) {
                    return;
                }
            } catch (statusError) {
                Logger.warn(
                    '⚠️ [WooviPaymentModal] Status final indisponível no timeout:',
                    statusError?.message || statusError,
                );
            }
        }

        if (!isPaymentLifecycleCurrent(lifecycleToken) || paymentStatusRef.current !== 'pending') {
            Logger.log('ℹ️ [WooviPaymentModal] Timeout abandonado após checagem final de status');
            return;
        }

        paymentStatusRef.current = 'expired';
        setPaymentStatus('expired');
        setCountdown(0);
        
        if (timedOutPaymentData?.chargeId) {
            if (preserveChargeOnClose) {
                Logger.log('ℹ️ [WooviPaymentModal] Preservando cobrança ao expirar:', timedOutPaymentData.chargeId);
            } else {
                Logger.log('ℹ️ [WooviPaymentModal] Pagamento expirou; cobrança será abandonada sem chamada administrativa.', timedOutPaymentData.chargeId);
            }
        }
        
        // ✅ Limpar estado completamente antes de fechar
        cleanup();
        setLoading(false);

        if (timedOutPaymentData?.chargeId) {
            try {
                await clearRidePaymentSession({
                    passengerId: timedOutPaymentData.passengerId,
                    paymentSessionId: timedOutPaymentData.paymentSessionId,
                    contextKey: timedOutPaymentData.paymentContextKey,
                    chargeId: timedOutPaymentData.chargeId,
                });
            } catch (clearError) {
                Logger.warn(
                    '⚠️ [WooviPaymentModal] Falha ao limpar sessão PIX expirada:',
                    clearError?.message || clearError,
                );
            }
        }

        notifyPaymentExpired(timedOutPaymentData);
        
        Alert.alert(
            '⏰ Tempo Esgotado',
            'O tempo para realizar o pagamento expirou. Faça uma nova cotação para continuar.',
            [{ 
                text: 'OK', 
                onPress: () => {
                    if (!isPaymentLifecycleCurrent(lifecycleToken)) {
                        return;
                    }
                    terminalClosePendingRef.current = true;
                    paymentStatusRef.current = 'expired';
                    setPaymentData(null);
                    setLoading(false);
                }
            }]
        );
    };

    // Função para cancelar manualmente
    const handleCancel = async () => {
        Logger.log('🚫 [WooviPaymentModal] handleCancel chamado, status:', paymentStatus);
        
        if (paymentStatus === 'confirmed') {
            Alert.alert(
                'Pagamento confirmado',
                'Já estamos procurando um motorista parceiro. Aguarde um instante.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (paymentStatus === 'pending' && paymentData?.chargeId) {
            try {
                const confirmed = await confirmIfPaymentAlreadyCompleted(
                    { ...paymentData },
                    'manual_close_status',
                );
                if (confirmed) {
                    return;
                }
            } catch (statusError) {
                Logger.warn(
                    '⚠️ [WooviPaymentModal] Status indisponível antes de fechar:',
                    statusError?.message || statusError,
                );
            }
        }
        
        if (countdown > 0 && paymentStatus === 'pending') {
            if (preserveChargeOnClose) {
                Logger.log('🚪 [WooviPaymentModal] Fechando modal e preservando cobrança ativa');
                closeWithoutConfirmation({
                    reason: 'dismissed_preserving_charge',
                    chargeId: paymentData?.chargeId || null
                });
                return;
            }
            Alert.alert(
                'Cancelar Pagamento',
                'Tem certeza que deseja cancelar o pagamento?',
                [
                    { text: 'Não', style: 'cancel' },
                    { 
                        text: 'Sim, Cancelar', 
                        style: 'destructive',
                        onPress: async () => {
	                            Logger.log('🚫 [WooviPaymentModal] Usuário confirmou cancelamento');
	                            timeoutHandledRef.current = true;
	                            paymentStatusRef.current = 'cancelled';
	                            setPaymentStatus('cancelled');
	                            cleanup();
                            
                            Logger.log('ℹ️ [WooviPaymentModal] Cancelamento local; cobrança ativa não chama rota administrativa.', {
                                chargeId: paymentData?.chargeId || null
                            });
                            
                            Logger.log('🚪 [WooviPaymentModal] Fechando modal após cancelamento');
                            closeWithoutConfirmation({
                                reason: 'cancelled',
                                chargeId: paymentData?.chargeId || null
                            });
                        }
                    }
                ]
            );
        } else {
            Logger.log('🚪 [WooviPaymentModal] Fechando modal sem confirmação (countdown:', countdown, ', status:', paymentStatus + ')');
            closeWithoutConfirmation({
                reason: paymentGenerationError ? 'generation_failed' : 'dismissed',
                error: paymentGenerationError || null,
                diagnostics: paymentGenerationDiagnostics || null,
                chargeId: paymentData?.chargeId || null
            });
        }
    };

    // Renderizar conteúdo do modal
    const renderContent = () => {
        const paymentErrorDiagnosticsLabel = serializePaymentErrorDiagnostics(paymentGenerationDiagnostics);

        if (terminalClosePendingRef.current && paymentStatus === 'expired') {
            return (
                <View
                    style={styles.loadingContainer}
                    testID="payment-modal-expired-terminal"
                    accessibilityLabel="Pagamento PIX expirado"
                >
                    <Text style={[styles.loadingText, { color: color.text.primary }]}>
                        Tempo esgotado
                    </Text>
                    <Text style={[styles.loadingSubtext, { color: color.text.secondary }]}>
                        Faça uma nova cotação para continuar.
                    </Text>
                </View>
            );
        }

        if (loading) {
            return (
                <View
                    style={styles.loadingContainer}
                    testID="payment-modal-loading"
                    accessibilityLabel="payment-modal-loading"
                >
                    <ActivityIndicator size="large" color={color.accent.primary} />
                    <Text style={[styles.loadingText, { color: color.text.primary }]}>
                        Processando pagamento...
                    </Text>
                </View>
            );
        }

        if (!paymentData) {
            if (paymentGenerationError) {
                return (
                    <View style={styles.errorContainer}>
                        <Icon 
                            name="error-outline" 
                            type="material" 
                            color={color.feedback.danger} 
                            size={56} 
                        />
                        <Text style={[styles.errorTitle, { color: color.text.primary }]}>
                            Falha ao gerar pagamento
                        </Text>
                        <Text style={[styles.errorSubtitle, { color: color.text.secondary }]}>
                            {paymentGenerationError}
                        </Text>
                        {paymentErrorDiagnosticsLabel ? (
                            <Text
                                style={styles.qaHiddenText}
                                testID="payment-modal-error-diagnostics"
                                accessibilityLabel={paymentErrorDiagnosticsLabel}
                            >
                                {paymentErrorDiagnosticsLabel}
                            </Text>
                        ) : null}

                        <View style={styles.errorActions}>
                            <TouchableOpacity
                                style={[styles.retryButton, { backgroundColor: color.accent.primary }]}
                                onPress={generatePayment}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.retryButtonText}>
                                    Tentar novamente
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.dismissButton}
                                onPress={() => closeWithoutConfirmation({
                                    reason: 'generation_failed',
                                    error: paymentGenerationError,
                                    diagnostics: paymentGenerationDiagnostics || null,
                                    chargeId: null
                                })}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.dismissButtonText, { color: color.text.secondary }]}>
                                    Fechar
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                );
            }

            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={color.accent.primary} />
                    <Text style={[styles.loadingText, { color: color.text.primary }]}>
                        Gerando cobrança PIX...
                    </Text>
                    <Text style={[styles.loadingSubtext, { color: color.text.secondary }]}>
                        Aguarde um instante, já vamos abrir o QR Code.
                    </Text>
                </View>
            );
        }

        return (
            <View
                style={styles.paymentContainer}
                testID="payment-modal-content"
                accessibilityLabel="Modal de pagamento PIX"
                accessibilityViewIsModal
            >
                <View style={styles.paymentHeader}>
                    <View>
                        <Text
                            style={styles.paymentTitle}
                            testID="payment-modal-title"
                            accessibilityLabel="Pague com PIX"
                        >
                            Pague com PIX
                        </Text>
                        <SecurePaymentBadge style={styles.securePaymentBadge} color={PIX_SURFACE.muted} />
                        <View
                            style={styles.statusChip}
                            testID="payment-modal-status"
                            accessibilityLabel={
                                paymentStatus === 'confirmed'
                                    ? 'PIX confirmado'
                                    : paymentStatus === 'expired'
                                        ? 'Tempo esgotado'
                                        : 'Aguardando PIX'
                            }
                        >
                            <Text style={styles.statusChipText}>
                                {paymentStatus === 'confirmed'
                                    ? 'PIX confirmado'
                                    : paymentStatus === 'expired'
                                        ? 'Tempo esgotado'
                                        : 'Aguardando PIX'}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.paymentRightColumn}>
                        <Text
                            style={styles.paymentAmount}
                            testID="payment-modal-amount"
                            accessibilityLabel={`Valor PIX ${formatCurrencyBRL(paymentData.amount)}`}
                        >
                            {formatCurrencyBRL(paymentData.amount)}
                        </Text>
                        <Text
                            style={[
                                styles.expiryText,
                                countdown <= 60 && paymentStatus === 'pending' && styles.expiryTextDanger,
                            ]}
                            testID="payment-modal-expiry"
                            accessibilityLabel={
                                paymentStatus === 'pending'
                                    ? `PIX expira em ${formatTime(countdown)}`
                                    : paymentStatus === 'confirmed'
                                        ? 'PIX confirmado'
                                        : 'PIX expirado'
                            }
                        >
                            {paymentStatus === 'pending'
                                ? `Expira em ${formatTime(countdown)}`
                                : paymentStatus === 'confirmed'
                                    ? 'Confirmado'
                                    : 'Expirado'}
                        </Text>
                    </View>
                </View>

                <View style={styles.timerRail}>
                    <View
                        style={[
                            styles.timerFill,
                            {
                                width: `${Math.max(
                                    6,
                                    Math.min(100, (countdown / PAYMENT_TIMEOUT) * 100),
                                )}%`,
                            },
                        ]}
                    />
                </View>

                <View
                    style={styles.qrContainer}
                    testID="payment-modal-qr-container"
                    accessibilityLabel="QR Code PIX"
                >
                    {paymentData?.qrCodeImage ? (
                        <Image
                            source={{ uri: paymentData.qrCodeImage }}
                            style={styles.qrCodeImage}
                            resizeMode="contain"
                        />
                    ) : paymentData?.qrCodeText ? (
                        <QRCode
                            value={paymentData.qrCodeText}
                            size={145}
                            backgroundColor="#FFFFFF"
                            color="#080A09"
                        />
                    ) : (
                        <View style={styles.qrCode}>
                            <Text style={styles.qrCodeText}>QR Code</Text>
                            <Text style={styles.qrCodeSubtext}>145px</Text>
                        </View>
                    )}
                </View>

                <Text style={styles.qrInstruction}>
                    Escaneie o QR Code ou copie o código PIX abaixo.
                </Text>

                <View
                    style={styles.pixCopyField}
                    testID="payment-modal-pix-code"
                    accessibilityLabel="Código PIX pronto para copiar"
                >
                    <Text style={styles.pixCodeText} numberOfLines={1}>
                        {getPixSnippet()}
                    </Text>
                </View>

                <View style={styles.actionButtons}>
                    <TouchableOpacity
                        style={styles.primaryAction}
                        onPress={copyPixCode}
                        activeOpacity={0.88}
                        testID="payment-modal-copy-code-button"
                        accessibilityLabel="Copiar código PIX"
                    >
                        <Text style={styles.primaryActionText}>Copiar código</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.secondaryAction}
                        onPress={openPaymentLink}
                        activeOpacity={0.88}
                        testID="payment-modal-open-bank-button"
                        accessibilityLabel="Abrir banco"
                    >
                        <Text style={styles.secondaryActionText}>Abrir banco</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.countdownContainer}>
                    {paymentStatus === 'confirmed' && (
                        <View
                            style={styles.confirmedContainer}
                            testID="payment-modal-confirmed"
                            accessibilityLabel="payment-modal-confirmed"
                        >
                            <Icon name="check-circle" type="material" color={color.feedback.success} size={32} />
                            <Text style={[styles.confirmedText, { color: color.feedback.success }]}>
                                Pagamento confirmado!
                            </Text>
                        </View>
                    )}
                    {paymentStatus !== 'confirmed' ? (
                        <Text style={styles.automaticText}>
                            A confirmação é automática.
                        </Text>
                    ) : null}
                </View>
            </View>
        );
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={handleCancel}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.handle} />
                    <View style={styles.modalHeader}>
                        {qaAutoConfirmEnabled ? (
                            <Text
                                style={[styles.qaDebugBadge, { color: color.feedback.success }]}
                                testID="payment-modal-qa-debug"
                                accessibilityLabel="payment-modal-qa-debug"
                            >
                                QA {qaDebugStatus}
                            </Text>
                        ) : null}
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={handleCancel}
                            activeOpacity={0.7}
                            testID="payment-modal-close-button"
                            accessibilityLabel="payment-modal-close-button"
                        >
                            <Icon name="close" type="material" color={color.text.secondary} size={22} />
                        </TouchableOpacity>
                    </View>

                    {renderContent()}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(248,251,249,0.42)',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    modalContent: {
        width: Math.min(width - 32, 358),
        minHeight: 506,
        maxHeight: Math.min(height - 64, 560),
        borderRadius: 28,
        paddingHorizontal: 27,
        paddingTop: 17,
        paddingBottom: 12,
        marginBottom: 32,
        backgroundColor: PIX_SURFACE.sheet,
        borderWidth: 1,
        borderColor: PIX_SURFACE.line,
        shadowColor: '#12261A',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.1,
        shadowRadius: 42,
        elevation: 8,
    },
    handle: {
        width: 54,
        height: 4,
        borderRadius: 2,
        backgroundColor: PIX_SURFACE.line,
    },
    modalHeader: {
        position: 'absolute',
        top: 11,
        right: 11,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        zIndex: 3,
    },
    modalHeaderTitle: {
        fontFamily: fonts.SemiBold,
        fontSize: typography.subtitle.size,
        lineHeight: typography.subtitle.lineHeight
    },
    qaDebugBadge: {
        marginLeft: spacing.sm,
        fontFamily: fonts.Medium,
        fontSize: typography.micro.size,
        lineHeight: typography.micro.lineHeight,
    },
    qaHiddenText: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0.01,
        overflow: 'hidden',
    },
    closeButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 0,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent'
    },

    // Container de geração
    generateContainer: {
        alignItems: 'center',
        paddingVertical: 30,
    },
    generateTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginTop: 20,
        marginBottom: 10,
        textAlign: 'center',
    },
    generateSubtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 30,
        paddingHorizontal: 20,
        lineHeight: 22,
    },
    generateButton: {
        paddingVertical: 15,
        paddingHorizontal: 40,
        borderRadius: 25,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 5,
    },
    generateButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    errorContainer: {
        alignItems: 'center',
        paddingVertical: 24,
    },
    errorTitle: {
        fontFamily: fonts.SemiBold,
        fontSize: typography.subtitle.size,
        lineHeight: typography.subtitle.lineHeight,
        marginTop: 12,
        marginBottom: 8,
        textAlign: 'center',
    },
    errorSubtitle: {
        fontFamily: fonts.Regular,
        fontSize: typography.body.size,
        lineHeight: typography.body.lineHeight,
        textAlign: 'center',
        marginBottom: 20,
        paddingHorizontal: 20,
    },
    errorActions: {
        width: '100%',
        alignItems: 'center',
    },
    retryButton: {
        paddingVertical: 14,
        paddingHorizontal: 30,
        borderRadius: radius.pill,
        shadowColor: color.shadow.base,
        shadowOffset: elevation.soft.shadowOffset,
        shadowOpacity: elevation.soft.shadowOpacity,
        shadowRadius: elevation.soft.shadowRadius,
        elevation: elevation.soft.elevation,
    },
    retryButtonText: {
        color: '#FFFFFF',
        fontFamily: fonts.SemiBold,
        fontSize: typography.body.size,
        lineHeight: typography.body.lineHeight
    },
    dismissButton: {
        marginTop: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    dismissButtonText: {
        fontFamily: fonts.Medium,
        fontSize: typography.body.size,
        lineHeight: typography.body.lineHeight
    },

    // Container de pagamento
    paymentContainer: {
        alignItems: 'stretch',
    },
    paymentHeader: {
        marginTop: 22,
        minHeight: 66,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
    },
    paymentTitle: {
        color: PIX_SURFACE.text,
        fontFamily: fonts.Medium,
        fontSize: 20,
        lineHeight: 31,
    },
    securePaymentBadge: {
        marginTop: 1,
    },
    statusChip: {
        width: 150,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 6,
        backgroundColor: PIX_SURFACE.leafLight,
    },
    statusChipText: {
        color: PIX_SURFACE.leaf,
        fontFamily: fonts.Medium,
        fontSize: 10,
        lineHeight: 15,
        textAlign: 'center',
    },
    paymentRightColumn: {
        alignItems: 'flex-end',
        paddingRight: 2,
    },
    paymentAmount: {
        color: PIX_SURFACE.text,
        fontFamily: fonts.Medium,
        fontSize: 20,
        lineHeight: 31,
        textAlign: 'right',
    },
    expiryText: {
        marginTop: 8,
        color: PIX_SURFACE.danger,
        fontFamily: fonts.Medium,
        fontSize: 11,
        lineHeight: 18,
        textAlign: 'right',
    },
    expiryTextDanger: {
        color: color.feedback.danger,
    },
    timerRail: {
        width: '100%',
        height: 5,
        borderRadius: 2.5,
        backgroundColor: PIX_SURFACE.line,
        overflow: 'hidden',
        marginTop: 10,
    },
    timerFill: {
        height: 5,
        borderRadius: 2.5,
        backgroundColor: PIX_SURFACE.progress,
    },

    qrContainer: {
        alignSelf: 'center',
        width: 174,
        height: 174,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: PIX_SURFACE.line,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 26,
    },
    qrCode: {
        width: 145,
        height: 145,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#E0E0E0',
        borderStyle: 'dashed',
    },
    qrCodeText: {
        fontFamily: fonts.SemiBold,
        fontSize: 15,
        color: '#666',
    },
    qrCodeSubtext: {
        fontSize: 14,
        color: '#999',
        marginTop: 5,
    },

    qrInstruction: {
        alignSelf: 'center',
        marginTop: 14,
        width: 294,
        color: PIX_SURFACE.secondary,
        fontFamily: fonts.Regular,
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
    },
    pixCopyField: {
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: PIX_SURFACE.line,
        backgroundColor: PIX_SURFACE.soft,
        marginTop: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
    },
    pixCodeText: {
        color: PIX_SURFACE.text,
        fontFamily: fonts.Medium,
        fontSize: 12,
        lineHeight: 19,
        flex: 1,
        marginRight: 12,
    },
    countdownContainer: {
        alignItems: 'center',
        marginTop: 8,
        width: '100%',
        minHeight: 18,
        justifyContent: 'center',
        paddingVertical: 0,
    },
    countdownLabel: {
        fontFamily: fonts.Medium,
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        marginBottom: 5,
    },
    countdownText: {
        fontFamily: fonts.Bold,
        fontSize: 28,
        lineHeight: 32
    },

    // Botões de ação
    actionButtons: {
        width: '100%',
        marginTop: 18,
        flexDirection: 'row',
        gap: 14,
    },
    primaryAction: {
        flex: 1,
        height: 46,
        borderRadius: 23,
        backgroundColor: PIX_SURFACE.leaf,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryActionText: {
        color: '#FFFFFF',
        fontFamily: fonts.Medium,
        fontSize: 12,
        lineHeight: 19,
        textAlign: 'center',
    },
    secondaryAction: {
        flex: 1,
        height: 46,
        borderRadius: 23,
        borderWidth: 1,
        borderColor: PIX_SURFACE.line,
        backgroundColor: PIX_SURFACE.soft,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryActionText: {
        color: PIX_SURFACE.leaf,
        fontFamily: fonts.Medium,
        fontSize: 12,
        lineHeight: 19,
        textAlign: 'center',
    },

    // Loading
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        fontFamily: fonts.Medium,
        fontSize: typography.body.size,
        lineHeight: typography.body.lineHeight,
        marginTop: 15,
        textAlign: 'center',
    },
    loadingSubtext: {
        fontFamily: fonts.Regular,
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        marginTop: 8,
        textAlign: 'center',
    },
    
    // QR Code Image
    qrCodeImage: {
        width: 145,
        height: 145,
        borderRadius: 8,
    },
    
    // Confirmed
    confirmedContainer: {
        alignItems: 'center',
        marginTop: 0,
    },
    confirmedText: {
        fontFamily: fonts.SemiBold,
        fontSize: typography.body.size,
        lineHeight: typography.body.lineHeight,
        marginTop: 8,
    },
    automaticText: {
        color: PIX_SURFACE.muted,
        fontFamily: fonts.Regular,
        fontSize: 11,
        lineHeight: 18,
        textAlign: 'center',
    },
    searchingContainer: {
        marginTop: 12,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchingText: {
        fontSize: 16,
        marginTop: 8,
        textAlign: 'center',
    },
    
    // Checking
    checkingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 15,
    },
    checkingText: {
        fontSize: 14,
        marginLeft: 8,
    },
    
    // Cancel Button
    cancelButton: {
        marginTop: 10,
        paddingVertical: 12,
        borderRadius: 25,
        alignItems: 'center',
        borderWidth: 2,
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: 'bold',
    },
}); 
