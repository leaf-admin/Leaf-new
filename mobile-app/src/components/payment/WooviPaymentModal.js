import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useTheme } from '../../common-local/theme';

const { width, height } = Dimensions.get('window');

export default function WooviPaymentModal({ visible, onClose, tripData, estimates }) {
    const theme = useTheme();
    
    // Estados
    const [loading, setLoading] = useState(false);
    const [paymentData, setPaymentData] = useState(null);
    const [countdown, setCountdown] = useState(300); // 5 minutos

    // Efeito para countdown
    useEffect(() => {
        let interval;
        if (visible && countdown > 0) {
            interval = setInterval(() => {
                setCountdown(prev => prev - 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [visible, countdown]);

    // Formatar tempo
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Função para gerar pagamento
    const generatePayment = async () => {
        try {
            setLoading(true);
            
            // TODO: Implementar chamada para API do Woovi
            // Por enquanto, simulamos um delay
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Dados simulados do pagamento
            const mockPaymentData = {
                qrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=PIX_SIMULADO',
                qrCodeText: 'PIX_SIMULADO_123456789',
                expiresAt: new Date(Date.now() + 300000), // 5 minutos
                amount: estimates ? Object.values(estimates)[0]?.estimateFare || '25.00' : '25.00'
            };
            
            setPaymentData(mockPaymentData);
            setCountdown(300);
            
        } catch (error) {
            console.error('❌ Erro ao gerar pagamento:', error);
            Alert.alert('Erro', 'Não foi possível gerar o pagamento. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    // Função para copiar código PIX
    const copyPixCode = () => {
        if (paymentData?.qrCodeText) {
            // TODO: Implementar copiar para clipboard
            Alert.alert('Código PIX Copiado!', 'Cole no seu app de pagamentos.');
        }
    };

    // Função para verificar pagamento
    const checkPayment = async () => {
        try {
            setLoading(true);
            
            // TODO: Implementar verificação de pagamento
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            Alert.alert('Pagamento Confirmado!', 'Sua corrida foi confirmada.');
            onClose();
            
        } catch (error) {
            console.error('❌ Erro ao verificar pagamento:', error);
            Alert.alert('Erro', 'Não foi possível verificar o pagamento.');
        } finally {
            setLoading(false);
        }
    };

    // Função para cancelar
    const handleCancel = () => {
        if (countdown > 0) {
            Alert.alert(
                'Cancelar Pagamento',
                'Tem certeza que deseja cancelar?',
                [
                    { text: 'Não', style: 'cancel' },
                    { text: 'Sim', onPress: onClose }
                ]
            );
        } else {
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
                    <View style={[styles.qrCode, { backgroundColor: '#FFFFFF' }]}>
                        <Text style={styles.qrCodeText}>QR Code</Text>
                        <Text style={styles.qrCodeSubtext}>200x200px</Text>
                    </View>
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
                    <Text style={[styles.countdownLabel, { color: theme.textSecondary }]}>
                        Expira em:
                    </Text>
                    <Text style={[styles.countdownText, { color: theme.primary }]}>
                        {formatTime(countdown)}
                    </Text>
                </View>

                {/* Botões */}
                <View style={styles.actionButtons}>
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: theme.primary }]}
                        onPress={checkPayment}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.actionButtonText}>
                            Verificar Pagamento
                        </Text>
                    </TouchableOpacity>
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
                            Pagamento Woovi
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
}); 