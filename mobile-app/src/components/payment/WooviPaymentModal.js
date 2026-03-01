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
import { useTheme } from '../../common-local/theme';
import WooviService from '../../services/WooviService';
import WebSocketManager from '../../services/WebSocketManager';
import { QRCode } from 'react-native-qrcode-svg';


const { width, height } = Dimensions.get('window');

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
    const theme = useTheme();
    
    // Estados
    const [loading, setLoading] = useState(false);
    const [paymentData, setPaymentData] = useState(null);
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
            setPaymentStatus('pending');
            paymentStatusRef.current = 'pending'; // ✅ Atualizar ref também
            setCountdown(PAYMENT_TIMEOUT);
            setLoading(false);
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
            setPaymentStatus('pending');
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
        try {
            setLoading(true);
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
            const paymentRequest = {
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
            Logger.log('📦 Payload enviado para /api/payment/advance:', paymentRequest);
            Alert.alert(
                'Erro ao Gerar Pagamento',
                error.message || 'Não foi possível gerar o pagamento. Tente novamente.',
                [
                    { text: 'Cancelar', onPress: onClose },
                    { text: 'Tentar Novamente', onPress: generatePayment }
                ]
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
                await WooviService.cancelPayment(paymentData.chargeId);
                Logger.log('✅ Cobrança cancelada na Woovi');
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
                                    await WooviService.cancelPayment(paymentData.chargeId);
                                    Logger.log('✅ [WooviPaymentModal] Cobrança cancelada na Woovi');
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
                    <ActivityIndicator size="large" color={theme.primary} />
                    <Text style={[styles.loadingText, { color: theme.text }]}>
                        Processando pagamento...
                    </Text>
                </View>
            );
        }

        if (!paymentData) {
            return (
                <View style={styles.generateContainer}>
                    <Icon 
                        name="payment" 
                        type="material" 
                        color={theme.primary} 
                        size={64} 
                    />
                    <Text style={[styles.generateTitle, { color: theme.text }]}>
                        Gerar Pagamento PIX
                    </Text>
                    <Text style={[styles.generateSubtitle, { color: theme.textSecondary }]}>
                        Clique no botão abaixo para gerar o QR Code do PIX
                    </Text>
                    
                    <TouchableOpacity
                        style={[styles.generateButton, { backgroundColor: theme.primary }]}
                        onPress={generatePayment}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.generateButtonText}>
                            Gerar PIX
                        </Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <View style={styles.paymentContainer}>
                {/* Header */}
                <View style={styles.paymentHeader}>
                    <Text style={[styles.paymentTitle, { color: theme.text }]}>
                        Pagamento PIX
                    </Text>
                    <Text style={[styles.paymentAmount, { color: theme.primary }]}>
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
                    <Text style={[styles.pixCodeLabel, { color: theme.textSecondary }]}>
                        Código PIX:
                    </Text>
                    <TouchableOpacity
                        style={[styles.pixCodeButton, { backgroundColor: theme.card }]}
                        onPress={copyPixCode}
                        activeOpacity={0.8}
                    >
                        <Text style={[styles.pixCodeText, { color: theme.text }]}>
                            {paymentData.qrCodeText}
                        </Text>
                        <Icon name="content-copy" type="material" color={theme.icon} size={20} />
                    </TouchableOpacity>
                </View>

                {/* Countdown */}
                <View style={styles.countdownContainer}>
                    {paymentStatus === 'pending' && (
                        <>
                            <Text style={[styles.countdownLabel, { color: theme.textSecondary }]}>
                                Expira em:
                            </Text>
                            <Text style={[
                                styles.countdownText, 
                                { 
                                    color: countdown <= 60 ? '#FF3B30' : theme.primary 
                                }
                            ]}>
                                {formatTime(countdown)}
                            </Text>
                        </>
                    )}
                    {paymentStatus === 'expired' && (
                        <Text style={[styles.countdownLabel, { color: theme.error }]}>
                            Tempo esgotado
                        </Text>
                    )}
                    {paymentStatus === 'confirmed' && (
                        <View style={styles.confirmedContainer}>
                            <Icon name="check-circle" type="material" color="#4CAF50" size={32} />
                            <Text style={[styles.confirmedText, { color: '#4CAF50' }]}>
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
                <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
                    {/* Header do modal */}
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalHeaderTitle, { color: theme.text }]}>
                            Realize seu pagamento
                        </Text>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={handleCancel}
                            activeOpacity={0.7}
                        >
                            <Icon name="close" type="material" color={theme.icon} size={24} />
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: width * 0.9,
        maxHeight: height * 0.8,
        borderRadius: 20,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    
    // Header do modal
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        paddingBottom: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    modalHeaderTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    closeButton: {
        padding: 5,
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

    // Container de pagamento
    paymentContainer: {
        alignItems: 'center',
    },
    paymentHeader: {
        alignItems: 'center',
        marginBottom: 20,
    },
    paymentTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 5,
    },
    paymentAmount: {
        fontSize: 32,
        fontWeight: 'bold',
    },

    // QR Code
    qrContainer: {
        marginBottom: 20,
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
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
        textAlign: 'center',
    },
    pixCodeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    pixCodeText: {
        fontSize: 14,
        fontFamily: 'monospace',
        flex: 1,
        marginRight: 10,
    },

    // Countdown
    countdownContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    countdownLabel: {
        fontSize: 16,
        marginBottom: 5,
    },
    countdownText: {
        fontSize: 24,
        fontWeight: 'bold',
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
        fontSize: 16,
        marginTop: 15,
        textAlign: 'center',
    },
    
    // QR Code Image
    qrCodeImage: {
        width: 200,
        height: 200,
        borderRadius: 12,
    },
    
    // Confirmed
    confirmedContainer: {
        alignItems: 'center',
        marginTop: 10,
    },
    confirmedText: {
        fontSize: 18,
        fontWeight: 'bold',
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