import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    Dimensions,
    Linking
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const PixPaymentModal = ({ 
    visible, 
    onClose, 
    amount, 
    customerName, 
    customerId, 
    bookingId, 
    driverId 
}) => {
    const [qrCodeData, setQrCodeData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [timeLeft, setTimeLeft] = useState(3600); // 1 hora em segundos

    // Timer para expiração
    useEffect(() => {
        if (visible && qrCodeData) {
            const timer = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        onClose();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [visible, qrCodeData]);

    // Criar cobrança PIX quando modal abrir
    useEffect(() => {
        if (visible && !qrCodeData) {
            createPixCharge();
        }
    }, [visible]);

    const createPixCharge = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch('https://us-central1-leaf-reactnative.cloudfunctions.net/woovi_create_charge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: amount,
                    customerName: customerName,
                    customerId: customerId,
                    bookingId: bookingId,
                    driverId: driverId,
                    comment: `Pagamento LEAF - ${customerName}`
                })
            });

            const result = await response.json();

            if (result.success) {
                setQrCodeData(result.data);
            } else {
                setError(result.error || 'Erro ao gerar PIX');
            }
        } catch (error) {
            setError('Erro de conexão. Tente novamente.');
            console.error('Erro ao criar PIX:', error);
        } finally {
            setLoading(false);
        }
    };

    const copyPixCode = () => {
        if (qrCodeData?.pixCopyPaste) {
            // Aqui você pode usar uma biblioteca de clipboard
            Alert.alert('PIX Copiado', 'Código PIX copiado para a área de transferência!');
        }
    };

    const openPixApp = () => {
        if (qrCodeData?.pixCopyPaste) {
            // Tentar abrir app do banco
            Linking.openURL(`pix://${qrCodeData.pixCopyPaste}`);
        }
    };

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.modalContainer}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Pagamento PIX</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color="#333" />
                        </TouchableOpacity>
                    </View>

                    {/* Loading */}
                    {loading && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="#00D4AA" />
                            <Text style={styles.loadingText}>Gerando PIX...</Text>
                        </View>
                    )}

                    {/* Error */}
                    {error && (
                        <View style={styles.errorContainer}>
                            <Ionicons name="alert-circle" size={48} color="#DC3545" />
                            <Text style={styles.errorText}>{error}</Text>
                            <TouchableOpacity 
                                style={styles.retryButton}
                                onPress={createPixCharge}
                            >
                                <Text style={styles.retryButtonText}>Tentar Novamente</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* QR Code */}
                    {qrCodeData && !loading && !error && (
                        <View style={styles.qrContainer}>
                            {/* Informações do pagamento */}
                            <View style={styles.paymentInfo}>
                                <Text style={styles.amountText}>
                                    {formatCurrency(amount)}
                                </Text>
                                <Text style={styles.customerText}>{customerName}</Text>
                                <Text style={styles.timerText}>
                                    Expira em: {formatTime(timeLeft)}
                                </Text>
                            </View>

                            {/* QR Code */}
                            <View style={styles.qrCodeContainer}>
                                <QRCode
                                    value={qrCodeData.qrCode}
                                    size={width * 0.6}
                                    color="#000"
                                    backgroundColor="#FFF"
                                />
                            </View>

                            {/* Botões de ação */}
                            <View style={styles.actionButtons}>
                                <TouchableOpacity 
                                    style={styles.actionButton}
                                    onPress={copyPixCode}
                                >
                                    <Ionicons name="copy" size={20} color="#00D4AA" />
                                    <Text style={styles.actionButtonText}>Copiar PIX</Text>
                                </TouchableOpacity>

                                <TouchableOpacity 
                                    style={styles.actionButton}
                                    onPress={openPixApp}
                                >
                                    <Ionicons name="phone-portrait" size={20} color="#00D4AA" />
                                    <Text style={styles.actionButtonText}>Abrir App</Text>
                                </TouchableOpacity>
                            </View>

                            {/* Instruções */}
                            <View style={styles.instructions}>
                                <Text style={styles.instructionsTitle}>Como pagar:</Text>
                                <Text style={styles.instructionsText}>
                                    1. Abra o app do seu banco{'\n'}
                                    2. Escaneie o QR Code ou cole o PIX{'\n'}
                                    3. Confirme o pagamento{'\n'}
                                    4. Aguarde a confirmação automática
                                </Text>
                            </View>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 20,
        width: width * 0.9,
        maxHeight: '80%',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
    },
    closeButton: {
        padding: 5,
    },
    loadingContainer: {
        alignItems: 'center',
        padding: 40,
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#666',
    },
    errorContainer: {
        alignItems: 'center',
        padding: 40,
    },
    errorText: {
        marginTop: 10,
        fontSize: 16,
        color: '#DC3545',
        textAlign: 'center',
    },
    retryButton: {
        marginTop: 20,
        backgroundColor: '#00D4AA',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    retryButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    qrContainer: {
        alignItems: 'center',
    },
    paymentInfo: {
        alignItems: 'center',
        marginBottom: 20,
    },
    amountText: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#00D4AA',
    },
    customerText: {
        fontSize: 18,
        color: '#333',
        marginTop: 5,
    },
    timerText: {
        fontSize: 14,
        color: '#666',
        marginTop: 5,
    },
    qrCodeContainer: {
        backgroundColor: '#FFF',
        padding: 20,
        borderRadius: 15,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
        marginBottom: 20,
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
        marginBottom: 20,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8F9FA',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#00D4AA',
    },
    actionButtonText: {
        marginLeft: 5,
        color: '#00D4AA',
        fontSize: 14,
        fontWeight: 'bold',
    },
    instructions: {
        backgroundColor: '#F8F9FA',
        padding: 15,
        borderRadius: 10,
        width: '100%',
    },
    instructionsTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 10,
    },
    instructionsText: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
});

export default PixPaymentModal; 