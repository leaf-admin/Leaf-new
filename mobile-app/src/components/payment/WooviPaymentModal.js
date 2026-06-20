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
const CONFIRMED_PAYMENT_STATUSES = new Set(['completed', 'confirmed', 'paid', 'in_holding']);
const TERMINAL_PAYMENT_STATUSES = new Set(['cancelled', 'canceled', 'expired', 'refunded']);
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
    quoteSessionId = null
}) {
    const qaAutoConfirmEnabled = Boolean(qaAutoConfirm);
    // Estados
    const [loading, setLoading] = useState(false);
    const [paymentData, setPaymentData] = useState(null);
    const [paymentGenerationError, setPaymentGenerationError] = useState(null);
    const [countdown, setCountdown] = useState(PAYMENT_TIMEOUT); // 5 minutos
    const [isCheckingPayment, setIsCheckingPayment] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState('pending'); // pending, confirmed, expired, cancelled
    const [qaDebugStatus, setQaDebugStatus] = useState('idle');
    
    // Refs
    const countdownIntervalRef = useRef(null);
    const paymentCheckIntervalRef = useRef(null);
    const timeoutRef = useRef(null);
    const paymentStatusRef = useRef(paymentStatus); // ✅ Ref para acessar status atualizado no intervalo
    const paymentConfirmedRef = useRef(false);
    const autoConfirmTimerRef = useRef(null);
    const qaAutoConfirmStartedRef = useRef(false);

    // ✅ Sincronizar ref com estado
    useEffect(() => {
        paymentStatusRef.current = paymentStatus;
    }, [paymentStatus]);

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

    const shouldBypassPayment = async () => {
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

    const resolveAuthenticatedPassengerId = () => {
        const directPassengerId = String(passengerId || '').trim();
        if (directPassengerId) {
            return directPassengerId;
        }

        try {
            return String(auth()?.currentUser?.uid || '').trim();
        } catch (_error) {
            return '';
        }
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
            discountBenefit: normalizedPayload.discountBenefit || null,
            paymentSessionId: normalizedPayload.paymentSessionId || null,
            paymentContextKey: normalizedPayload.paymentContextKey || null,
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

    // Reabre a sessão canônica antes de considerar uma nova cobrança.
    useEffect(() => {
        if (visible) {
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
                        handleTimeout();
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
            paymentCheckIntervalRef.current = setInterval(() => {
                checkPaymentStatus();
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
                    amountInCents: paymentData.amountInCents
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
        let paymentRequest = null;
        try {
            setLoading(true);
            setPaymentGenerationError(null);
            Logger.log('💳 Preparando sessão de pagamento PIX...');

            const resolvedPassengerId = resolveAuthenticatedPassengerId();
            if (!resolvedPassengerId) {
                throw new Error('Sessão de pagamento ainda não está pronta. Tente novamente em alguns segundos.');
            }
            
            // Calcular valor em centavos - usar o mesmo valor do card selecionado
            const amount = estimates?.estimateFare || tripData?.estimatedFare || 25.00;
            const amountInCents = Math.round(amount * 100);
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

                if (!TERMINAL_PAYMENT_STATUSES.has(restoredStatus)) {
                    const expiresAtMs = Date.parse(restoredPaymentData.expiresAt || '');
                    const remainingSeconds = Number.isFinite(expiresAtMs)
                        ? Math.ceil((expiresAtMs - Date.now()) / 1000)
                        : PAYMENT_TIMEOUT;
                    const resumedPaymentData = remainingSeconds > 0
                        ? restoredPaymentData
                        : {
                            ...restoredPaymentData,
                            expiresAt: new Date(Date.now() + PAYMENT_TIMEOUT * 1000).toISOString(),
                        };
                    setPaymentData(resumedPaymentData);
                    setCountdown(Math.max(1, remainingSeconds > 0 ? remainingSeconds : PAYMENT_TIMEOUT));
                    setPaymentStatus('pending');
                    setLoading(false);
                    return;
                }

                await clearRidePaymentSession({
                    passengerId: resolvedPassengerId,
                    paymentSessionId: paymentSession.paymentSessionId,
                    chargeId: restoredPaymentData.chargeId,
                });
                paymentSession = await getOrCreateRidePaymentSession({
                    passengerId: resolvedPassengerId,
                    contextKey: paymentContextKey,
                });
            }

            const tempRideId = `temp_ride_session_${paymentSession.paymentSessionId}`;
            Logger.log('🆔 [WooviPaymentModal] Sessão canônica preparada:', paymentSession.paymentSessionId);

            const bypassEnabled = await shouldBypassPayment();
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
                    discountBenefit,
                    expiresAt: new Date(Date.now() + (PAYMENT_TIMEOUT * 1000)),
                    passengerId: resolvedPassengerId,
                    paymentSessionId: paymentSession.paymentSessionId,
                    paymentContextKey,
                    quoteSessionId,
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
                discountBenefit,
                rideId: tempRideId,
                paymentSessionId: paymentSession.paymentSessionId,
                paymentContextKey,
                quoteSessionId,
                rideDetails: {
                    origin: tripData?.pickup?.add || 'Origem',
                    destination: tripData?.drop?.add || 'Destino',
                    pickupLocation: tripData?.pickup || null,
                    destinationLocation: tripData?.drop || null,
                    carType: tripData?.carType || null,
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
            
            // Chamar API do backend para criar cobrança PIX
            const result = await WooviService.processAdvancePayment(paymentRequest);
            
            if (!result.success) {
                throw new Error(result.error || 'Falha ao gerar pagamento');
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
                discountBenefit: result.discountBenefit || discountBenefit || null,
                expiresAt: new Date(Date.now() + (PAYMENT_TIMEOUT * 1000)).toISOString(),
                passengerId: resolvedPassengerId,
                paymentSessionId: paymentSession.paymentSessionId,
                paymentContextKey: result.paymentContextKey || paymentContextKey,
                quoteSessionId: result.quoteSessionId || quoteSessionId || null,
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
            timeoutRef.current = setTimeout(() => {
                handleTimeout();
            }, PAYMENT_TIMEOUT * 1000);
            
        } catch (error) {
            const serverResponse = error?.response?.data;
            Logger.error('❌ Erro ao gerar pagamento:', serverResponse || error);
            if (paymentRequest) {
                Logger.log('📦 Payload enviado para /api/payment/advance:', paymentRequest);
            }
            setPaymentData(null);
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
    const checkPaymentStatus = async () => {
        if ((!paymentData?.chargeId && !paymentData?.rideId) || isCheckingPayment || paymentStatus !== 'pending') {
            return;
        }
        
        try {
            setIsCheckingPayment(true);
            
            const resolveStatus = async (reference, source) => {
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

            const chargeStatus = await resolveStatus(paymentData.chargeId, 'chargeId');
            const confirmedStatus = [chargeStatus].find(
                (entry) => entry?.isPaymentCompleted,
            );

            if (confirmedStatus) {
                // Pagamento confirmado!
                Logger.log('✅ [WooviPaymentModal] Pagamento confirmado via checkPaymentStatus!', {
                    status: confirmedStatus.normalizedStatus,
                    source: confirmedStatus.source,
                    chargeId: paymentData.chargeId,
                    rideId: paymentData.rideId,
                });

                confirmPaymentOnce(
                    {
                        chargeId: paymentData.chargeId,
                        rideId: paymentData.rideId,
                        amount: paymentData.amount,
                        amountInCents: paymentData.amountInCents,
                        grossAmount: paymentData.grossAmount,
                        grossAmountInCents: paymentData.grossAmountInCents,
                        discountBenefit: paymentData.discountBenefit || null
                    },
                    'polling'
                );
            } else if (qaAutoConfirmEnabled) {
                setQaDebugStatus('awaiting_backend');
            }
            
        } catch (error) {
            const serverResponse = error?.response?.data;
            Logger.error('❌ Erro ao verificar pagamento:', serverResponse || error);
            Logger.log('🔍 [Woovi] Referências usadas:', {
                chargeId: paymentData?.chargeId,
                rideId: paymentData?.rideId,
            });
            // Não mostrar erro para o usuário (verificação silenciosa)
        } finally {
            setIsCheckingPayment(false);
        }
    };

    // Função para lidar com timeout (5 minutos)
    const handleTimeout = async () => {
        Logger.log('⏰ Tempo de pagamento expirado');
        setPaymentStatus('expired');
        setCountdown(0);
        
        if (paymentData?.chargeId) {
            if (preserveChargeOnClose) {
                Logger.log('ℹ️ [WooviPaymentModal] Preservando cobrança ao expirar:', paymentData.chargeId);
            } else {
                Logger.log('ℹ️ [WooviPaymentModal] Pagamento expirou; cobrança será abandonada sem chamada administrativa.', paymentData.chargeId);
            }
        }
        
        // ✅ Limpar estado completamente antes de fechar
        cleanup();
        setPaymentData(null);
        setLoading(false);
        
        Alert.alert(
            '⏰ Tempo Esgotado',
            'O tempo para realizar o pagamento expirou. Gere um novo PIX para continuar.',
            [{ 
                text: 'OK', 
                onPress: () => {
                    // ✅ Limpar estado ao fechar após expiração
                    setPaymentStatus('pending');
                    onClose();
                }
            }]
        );
    };

    // Função para cancelar manualmente
    const handleCancel = () => {
        Logger.log('🚫 [WooviPaymentModal] handleCancel chamado, status:', paymentStatus);
        
        if (paymentStatus === 'confirmed') {
            Alert.alert(
                'Pagamento confirmado',
                'Já estamos procurando um motorista parceiro. Aguarde um instante.',
                [{ text: 'OK' }]
            );
            return;
        }
        
        if (countdown > 0 && paymentStatus === 'pending') {
            if (preserveChargeOnClose) {
                Logger.log('🚪 [WooviPaymentModal] Fechando modal e preservando cobrança ativa');
                onClose();
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
                            setPaymentStatus('cancelled');
                            cleanup();
                            
                            Logger.log('ℹ️ [WooviPaymentModal] Cancelamento local; cobrança ativa não chama rota administrativa.', {
                                chargeId: paymentData?.chargeId || null
                            });
                            
                            Logger.log('🚪 [WooviPaymentModal] Fechando modal após cancelamento');
                            onClose();
                        }
                    }
                ]
            );
        } else {
            Logger.log('🚪 [WooviPaymentModal] Fechando modal sem confirmação (countdown:', countdown, ', status:', paymentStatus + ')');
            onClose();
        }
    };

    // Renderizar conteúdo do modal
    const renderContent = () => {
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
                                onPress={onClose}
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

                <TouchableOpacity
                    style={styles.pixCopyField}
                    onPress={copyPixCode}
                    activeOpacity={0.86}
                    testID="payment-modal-copy-pix-button"
                    accessibilityLabel="payment-modal-copy-pix-button"
                >
                    <Text style={styles.pixCodeText} numberOfLines={1}>
                        {getPixSnippet()}
                    </Text>
                    <Text style={styles.pixCopyText}>
                        Copiar
                    </Text>
                </TouchableOpacity>

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
    pixCopyText: {
        color: PIX_SURFACE.leaf,
        fontFamily: fonts.Medium,
        fontSize: 12,
        lineHeight: 19,
        textAlign: 'right',
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
