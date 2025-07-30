import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
    Alert
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import WooviService from '../services/WooviService';
import i18n from '../i18n';

const PixPayment = ({ amount, description, onPaymentComplete, onCancel }) => {
    const [qrCode, setQrCode] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paymentId, setPaymentId] = useState(null);
    const [paymentStatus, setPaymentStatus] = useState('pending');

    const { t } = i18n;

    useEffect(() => {
        generateQRCode();
        const interval = setInterval(checkPaymentStatus, 5000); // Verificar a cada 5 segundos
        return () => clearInterval(interval);
    }, []);

    const generateQRCode = async () => {
        try {
            setLoading(true);
            const response = await WooviService.generatePixQRCode(amount, description);
            setQrCode(response.qrCode);
            setPaymentId(response.paymentId);
        } catch (error) {
            setError(t('error_generating_qr'));
            Alert.alert(t('error'), t('error_generating_qr'));
        } finally {
            setLoading(false);
        }
    };

    const checkPaymentStatus = async () => {
        if (!paymentId) return;

        try {
            const response = await WooviService.checkPaymentStatus(paymentId);
            setPaymentStatus(response.status);

            if (response.status === 'completed') {
                onPaymentComplete(response);
            }
        } catch (error) {
            console.error('Erro ao verificar status:', error);
        }
    };

    const handleCancel = async () => {
        try {
            if (paymentId) {
                await WooviService.cancelPayment(paymentId);
            }
            onCancel();
        } catch (error) {
            Alert.alert(t('error'), t('error_canceling_payment'));
        }
    };

    if (loading) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color={colors.HEADER} />
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={generateQRCode}>
                    <Text style={styles.retryButtonText}>{t('retry')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('pix_payment')}</Text>
            <Text style={styles.amount}>{t('amount')}: R$ {amount.toFixed(2)}</Text>
            
            {qrCode && (
                <View style={styles.qrContainer}>
                    <QRCode
                        value={qrCode}
                        size={200}
                        backgroundColor="white"
                    />
                </View>
            )}

            <Text style={styles.instructions}>
                {t('pix_instructions')}
            </Text>

            <View style={styles.statusContainer}>
                <Text style={styles.statusText}>
                    {t('payment_status')}: {t(paymentStatus)}
                </Text>
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        alignItems: 'center',
        backgroundColor: colors.WHITE,
    },
    title: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        color: colors.text,
        marginBottom: 20,
    },
    amount: {
        fontSize: 20,
        fontFamily: fonts.Regular,
        color: colors.text,
        marginBottom: 30,
    },
    qrContainer: {
        padding: 20,
        backgroundColor: colors.WHITE,
        borderRadius: 10,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    instructions: {
        fontSize: 16,
        fontFamily: fonts.Regular,
        color: colors.text,
        textAlign: 'center',
        marginTop: 30,
        marginBottom: 20,
    },
    statusContainer: {
        marginTop: 20,
        padding: 10,
        backgroundColor: colors.background,
        borderRadius: 5,
    },
    statusText: {
        fontSize: 16,
        fontFamily: fonts.Regular,
        color: colors.text,
    },
    cancelButton: {
        marginTop: 30,
        padding: 15,
        backgroundColor: colors.HEADER,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center',
    },
    cancelButtonText: {
        color: colors.WHITE,
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    retryButton: {
        marginTop: 20,
        padding: 15,
        backgroundColor: colors.HEADER,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center',
    },
    retryButtonText: {
        color: colors.WHITE,
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    errorText: {
        color: 'red',
        fontSize: 16,
        fontFamily: fonts.Regular,
        textAlign: 'center',
        marginBottom: 20,
    },
});

export default PixPayment; 