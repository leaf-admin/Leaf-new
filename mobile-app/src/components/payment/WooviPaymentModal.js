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
    Image
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Icon } from 'react-native-elements';
import WooviService from '../../services/WooviService';
import WebSocketManager from '../../services/WebSocketManager';
import QRCode from 'react-native-qrcode-svg';
import { fonts } from '../../common-local/font';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';


const { width, height } = Dimensions.get('window');
const { color, typography, radius, spacing, elevation } = robotaxiPrototypeTokens;

// Tempo de expiração: 5 minutos (300 segundos)
const PAYMENT_TIMEOUT = 300;

export default function WooviPaymentModal({ 
    visible, 
    onClose, 
    tripData, 
    estimates,
    onPaymentConfirmed,
    passengerId,
    passengerName,
    passengerEmail
}) {
    // Estados
    const [loading, setLoading] = useState(false);
    const [paymentData, setPaymentData] = useState(null);
    const [paymentGenerationError, setPaymentGenerationError] = useState(null);
    const [countdown, setCountdown] = useState(PAYMENT_TIMEOUT); // 5 minutos
    const [isCheckingPayment, setIsCheckingPayment] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState('pending'); // pending, confirmed, expired, cancelled
    
    // Refs
    const countdownIntervalRef = useRef(null);
    const paymentCheckIntervalRef = useRef(null);
    const timeoutRef = useRef(null);
    const paymentStatusRef = useRef(paymentStatus); // ✅ Ref para acessar status atualizado no intervalo

    // ✅ Sincronizar ref com estado
    useEffect(() => {
        paymentStatusRef.current = paymentStatus;
    }, [paymentStatus]);

    // Resetar quando modal abre - SEMPRE gerar novo QR code
    useEffect(() => {
        if (visible) {
            Logger.log('🔄 [WooviPaymentModal] Modal aberto, resetando estado e gerando NOVO pagamento...');
            // ✅ Limpar estado anterior completamente
            cleanup();
            setPaymentData(null);
            setPaymentGenerationError(null);
            setPaymentStatus('pending');
            paymentStatusRef.current = 'pending'; // ✅ Atualizar ref também
            setCountdown(PAYMENT_TIMEOUT);
            setLoading(true);
            setIsCheckingPayment(false);
            
            // ✅ SEMPRE gerar novo pagamento quando modal abre
            // Delay para garantir que o estado foi limpo antes de gerar novo pagamento
            const generateTimer = setTimeout(() => {
                Logger.log('💳 [WooviPaymentModal] Gerando NOVO pagamento PIX...');
                generatePayment();
            }, 150);
            
            return () => {
                clearTimeout(generateTimer);
            };
        } else {
            // Limpar tudo quando modal fecha
            Logger.log('🔄 [WooviPaymentModal] Modal fechado, limpando recursos...');
            cleanup();
            setPaymentData(null);
            setPaymentGenerationError(null);
            setPaymentStatus('pending');
            setLoading(false);
        }
        
        return () => {
            cleanup();
        };
    }, [visible]);

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

    // WebSocket listener para confirmação server-side
    useEffect(() => {
        if (!visible || !paymentData) {
            return;
        }

        const webSocketManager = WebSocketManager.getInstance();
        const handleServerPaymentConfirmed = (payload) => {
            if (!payload || paymentStatus === 'confirmed') {
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
            
            // ✅ PARAR TIMER IMEDIATAMENTE
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
                Logger.log('🛑 [Timer] Timer parado após confirmação via WebSocket');
            }
            
            setPaymentStatus('confirmed');
            cleanup();

            if (onPaymentConfirmed) {
                onPaymentConfirmed({
                    chargeId: paymentData.chargeId,
                    rideId: paymentData.rideId,
                    amount: paymentData.amount,
                    amountInCents: paymentData.amountInCents
                });
            }

            setTimeout(() => {
                onClose();
            }, 3000);
        };

        webSocketManager.on('paymentConfirmed', handleServerPaymentConfirmed);
        return () => {
            webSocketManager.off('paymentConfirmed', handleServerPaymentConfirmed);
        };
    }, [visible, paymentData, paymentStatus, onPaymentConfirmed, onClose]);

    // Limpar recursos
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
    };

    // Formatar tempo
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Função para gerar pagamento via Woovi Sandbox
    const generatePayment = async () => {
        let paymentRequest = null;
        try {
            setLoading(true);
            setPaymentGenerationError(null);
            Logger.log('💳 Gerando pagamento PIX via Woovi Sandbox...');
            
            // Calcular valor em centavos - usar o mesmo valor do card selecionado
            const amount = estimates?.estimateFare || tripData?.estimatedFare || 25.00;
            const amountInCents = Math.round(amount * 100);
            
            Logger.log('💰 [Woovi] Valor calculado:', { 
                amount, 
                amountInCents, 
                fromEstimates: estimates?.estimateFare,
                fromTripData: tripData?.estimatedFare
            });
            
            // ✅ Criar ID temporário da corrida ÚNICO (inclui timestamp + random para evitar duplicatas)
            // Será usado para criar a reserva após pagamento
            // ✅ GARANTIR que cada chamada gera um ID completamente novo
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substring(2, 9);
            const nanoRandom = Math.random().toString(36).substring(2, 7); // Segundo random para garantir unicidade
            const tempRideId = `temp_ride_${timestamp}_${randomSuffix}_${nanoRandom}_${passengerId}`;
            
            Logger.log('🆔 [WooviPaymentModal] Gerando NOVO tempRideId único:', tempRideId);
            Logger.log('🆔 [WooviPaymentModal] Timestamp:', timestamp, '| Random:', randomSuffix, nanoRandom);
            
            // Preparar dados do pagamento
            paymentRequest = {
                passengerId: passengerId,
                amount: amountInCents,
                rideId: tempRideId,
                rideDetails: {
                    origin: tripData?.pickup?.add || 'Origem',
                    destination: tripData?.drop?.add || 'Destino'
                },
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
                rideId: tempRideId,
                qrCodeImage: result.qrCode,
                qrCodeText: result.qrCodeText || result.paymentLink,
                paymentLink: result.paymentLink,
                amount: amount,
                amountInCents: amountInCents,
                expiresAt: new Date(Date.now() + (PAYMENT_TIMEOUT * 1000))
            };
            
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
        if (!paymentData?.chargeId || isCheckingPayment || paymentStatus !== 'pending') {
            return;
        }
        
        try {
            setIsCheckingPayment(true);
            
            Logger.log('🔍 [Woovi] Verificando status do pagamento:', paymentData.chargeId);
            
            // Verificar status via backend usando chargeId
            const statusResult = await WooviService.getPaymentStatus(paymentData.chargeId);
            
            Logger.log('📊 [Woovi] Status recebido:', statusResult);
            
            // ✅ CORREÇÃO: Aceitar tanto 'COMPLETED' quanto 'in_holding' como pagamento confirmado
            // O backend retorna 'in_holding' quando o status na Woovi é 'COMPLETED'
            const isPaymentCompleted = statusResult.success && (
                statusResult.status === 'COMPLETED' || 
                statusResult.status === 'in_holding' ||
                statusResult.status === 'IN_HOLDING'
            );
            
            if (isPaymentCompleted) {
                // Pagamento confirmado!
                Logger.log('✅ [WooviPaymentModal] Pagamento confirmado via checkPaymentStatus!', {
                    status: statusResult.status,
                    chargeId: paymentData.chargeId
                });
                
                // ✅ PARAR TIMER IMEDIATAMENTE
                if (countdownIntervalRef.current) {
                    clearInterval(countdownIntervalRef.current);
                    countdownIntervalRef.current = null;
                    Logger.log('🛑 [Timer] Timer parado após confirmação de pagamento');
                }
                
                setPaymentStatus('confirmed');
                cleanup();
                
                // Chamar callback de confirmação (vai iniciar busca e abrir bottomsheet)
                if (onPaymentConfirmed) {
                    onPaymentConfirmed({
                        chargeId: paymentData.chargeId,
                        rideId: paymentData.rideId,
                        amount: paymentData.amount,
                        amountInCents: paymentData.amountInCents
                    });
                }
                
                // Fechar modal após 3 segundos mostrando "Pagamento confirmado"
                setTimeout(() => {
                    onClose();
                }, 3000);
            }
            
        } catch (error) {
            const serverResponse = error?.response?.data;
            Logger.error('❌ Erro ao verificar pagamento:', serverResponse || error);
            Logger.log('🔍 [Woovi] ChargeId usado:', paymentData.chargeId);
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
        
        // Tentar cancelar cobrança na Woovi
        if (paymentData?.chargeId) {
            try {
                Logger.log('🚫 Cancelando cobrança na Woovi:', paymentData.chargeId);
                const cancelResult = await WooviService.cancelPayment(paymentData.chargeId);
                if (cancelResult?.success) {
                    if (cancelResult?.alreadyFinalized) {
                        Logger.log('ℹ️ Cobrança já finalizada/indisponível para cancelamento na Woovi');
                    } else {
                        Logger.log('✅ Cobrança cancelada na Woovi');
                    }
                } else {
                    Logger.warn('⚠️ Falha ao cancelar cobrança na Woovi:', cancelResult?.error || cancelResult);
                }
            } catch (error) {
                Logger.error('⚠️ Erro ao cancelar cobrança na Woovi:', error);
            }
        }
        
        // ✅ Limpar estado completamente antes de fechar
        cleanup();
        setPaymentData(null);
        setLoading(false);
        
        Alert.alert(
            '⏰ Tempo Esgotado',
            'O tempo para realizar o pagamento expirou. A cobrança foi cancelada.',
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
                            
                            // Cancelar cobrança na Woovi
                            if (paymentData?.chargeId) {
                                try {
                                    Logger.log('🔄 [WooviPaymentModal] Cancelando cobrança na Woovi:', paymentData.chargeId);
                                    const cancelResult = await WooviService.cancelPayment(paymentData.chargeId);
                                    if (cancelResult?.success) {
                                        if (cancelResult?.alreadyFinalized) {
                                            Logger.log('ℹ️ [WooviPaymentModal] Cobrança já finalizada/indisponível para cancelamento');
                                        } else {
                                            Logger.log('✅ [WooviPaymentModal] Cobrança cancelada na Woovi');
                                        }
                                    } else {
                                        Logger.warn('⚠️ [WooviPaymentModal] Falha ao cancelar cobrança:', cancelResult?.error || cancelResult);
                                    }
                                } catch (error) {
                                    Logger.error('⚠️ [WooviPaymentModal] Erro ao cancelar cobrança:', error);
                                    Logger.error('⚠️ [WooviPaymentModal] Detalhes do erro:', error?.response?.data || error.message);
                                }
                            } else {
                                Logger.warn('⚠️ [WooviPaymentModal] Nenhum chargeId disponível para cancelar');
                            }
                            
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
                <View style={styles.loadingContainer}>
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
            <View style={styles.paymentContainer}>
                {/* Header */}
                <View style={styles.paymentHeader}>
                    <Text style={[styles.paymentTitle, { color: color.text.primary }]}>
                        Pagamento PIX
                    </Text>
                    <Text style={[styles.paymentAmount, { color: color.accent.primary }]}>
                        R$ {paymentData.amount}
                    </Text>
                </View>

                {/* QR Code */}
                <View style={styles.qrContainer}>
                    {paymentData?.qrCodeImage ? (
                        <Image 
                            source={{ uri: paymentData.qrCodeImage }} 
                            style={styles.qrCodeImage}
                            resizeMode="contain"
                        />
                    ) : paymentData?.qrCodeText ? (
                        <QRCode
                            value={paymentData.qrCodeText}
                            size={200}
                            backgroundColor="#FFFFFF"
                            color="#000000"
                        />
                    ) : (
                        <View style={[styles.qrCode, { backgroundColor: '#FFFFFF' }]}>
                            <Text style={styles.qrCodeText}>QR Code</Text>
                            <Text style={styles.qrCodeSubtext}>200x200px</Text>
                        </View>
                    )}
                </View>

                {/* Código PIX */}
                <View style={styles.pixCodeContainer}>
                    <Text style={[styles.pixCodeLabel, { color: color.text.secondary }]}>
                        Código PIX:
                    </Text>
                    <TouchableOpacity
                        style={[styles.pixCodeButton, { backgroundColor: color.surface.secondary }]}
                        onPress={copyPixCode}
                        activeOpacity={0.8}
                    >
                        <Text style={[styles.pixCodeText, { color: color.text.primary }]}>
                            {paymentData.qrCodeText}
                        </Text>
                        <Icon name="content-copy" type="material" color={color.text.secondary} size={20} />
                    </TouchableOpacity>
                </View>

                {/* Countdown */}
                <View style={styles.countdownContainer}>
                    {paymentStatus === 'pending' && (
                        <>
                            <Text style={[styles.countdownLabel, { color: color.text.secondary }]}>
                                Expira em:
                            </Text>
                            <Text style={[
                                styles.countdownText, 
                                { 
                                    color: countdown <= 60 ? color.feedback.danger : color.accent.primary 
                                }
                            ]}>
                                {formatTime(countdown)}
                            </Text>
                        </>
                    )}
                    {paymentStatus === 'expired' && (
                        <Text style={[styles.countdownLabel, { color: color.feedback.danger }]}>
                            Tempo esgotado
                        </Text>
                    )}
                    {paymentStatus === 'confirmed' && (
                        <View style={styles.confirmedContainer}>
                            <Icon name="check-circle" type="material" color={color.feedback.success} size={32} />
                            <Text style={[styles.confirmedText, { color: color.feedback.success }]}>
                                Pagamento confirmado!
                            </Text>
                        </View>
                    )}
                </View>

                {/* Botões */}
                <View style={styles.actionButtons}>
                    {/* ✅ Botão Cancelar removido - usuário pode fechar pelo X no header */}
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
                    {/* Header do modal */}
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalHeaderTitle, { color: color.text.primary }]}>
                            Realize seu pagamento
                        </Text>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={handleCancel}
                            activeOpacity={0.7}
                        >
                            <Icon name="close" type="material" color={color.text.secondary} size={22} />
                        </TouchableOpacity>
                    </View>

                    {/* Conteúdo */}
                    {renderContent()}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(17,26,39,0.26)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: width * 0.92,
        maxHeight: height * 0.8,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        backgroundColor: color.bg.panel,
        borderWidth: 1,
        borderColor: color.border.subtle,
        shadowColor: color.shadow.base,
        shadowOffset: elevation.panel.shadowOffset,
        shadowOpacity: elevation.panel.shadowOpacity,
        shadowRadius: elevation.panel.shadowRadius,
        elevation: elevation.panel.elevation,
    },
    
    // Header do modal
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.md,
        paddingBottom: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.border.separator,
    },
    modalHeaderTitle: {
        fontFamily: fonts.SemiBold,
        fontSize: typography.subtitle.size,
        lineHeight: typography.subtitle.lineHeight
    },
    closeButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        borderColor: color.border.subtle,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.surface.primary
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
        alignItems: 'center',
    },
    paymentHeader: {
        alignItems: 'center',
        marginBottom: 20,
    },
    paymentTitle: {
        fontFamily: fonts.SemiBold,
        fontSize: typography.subtitle.size,
        lineHeight: typography.subtitle.lineHeight,
        marginBottom: 5,
    },
    paymentAmount: {
        fontFamily: fonts.Bold,
        fontSize: 34,
        lineHeight: 40
    },

    // QR Code
    qrContainer: {
        marginBottom: 20,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.border.subtle,
        backgroundColor: color.surface.primary,
        padding: 12
    },
    qrCode: {
        width: 200,
        height: 200,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#E0E0E0',
        borderStyle: 'dashed',
    },
    qrCodeText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#666',
    },
    qrCodeSubtext: {
        fontSize: 14,
        color: '#999',
        marginTop: 5,
    },

    // Código PIX
    pixCodeContainer: {
        width: '100%',
        marginBottom: 20,
    },
    pixCodeLabel: {
        fontFamily: fonts.Medium,
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        marginBottom: 8,
        textAlign: 'left',
    },
    pixCodeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.border.subtle,
    },
    pixCodeText: {
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        fontFamily: 'monospace',
        flex: 1,
        marginRight: 10,
    },

    // Countdown
    countdownContainer: {
        alignItems: 'center',
        marginBottom: 20,
        width: '100%',
        minHeight: 54,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.border.subtle,
        backgroundColor: color.surface.primary,
        justifyContent: 'center',
        paddingVertical: 10,
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
    },
    actionButton: {
        paddingVertical: 15,
        borderRadius: 25,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 5,
    },
    actionButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
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
        width: 200,
        height: 200,
        borderRadius: radius.sm,
    },
    
    // Confirmed
    confirmedContainer: {
        alignItems: 'center',
        marginTop: 10,
    },
    confirmedText: {
        fontFamily: fonts.SemiBold,
        fontSize: typography.body.size,
        lineHeight: typography.body.lineHeight,
        marginTop: 8,
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
