import Logger from '../utils/Logger';
/**
 * 🧾 TELA DE RECIBO DE CORRIDA
 * 
 * Exibe o recibo completo de uma corrida finalizada com:
 * - Informações da viagem
 * - Breakdown financeiro
 * - Mapa do trajeto
 * - Opções de compartilhamento
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    Alert,
    Share,
    Dimensions,
    TouchableOpacity,
    ActivityIndicator,
    Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import ReceiptService from '../services/ReceiptService';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';


const { width } = Dimensions.get('window');

const ReceiptScreen = ({ route, navigation }) => {
    const { rideId } = route.params;

    const [receipt, setReceipt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapLoading, setMapLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadReceipt();
    }, [rideId]);

    const loadReceipt = async () => {
        try {
            setLoading(true);
            setError(null);

            const receiptData = await ReceiptService.getReceiptByRideId(rideId);
            setReceipt(receiptData);

        } catch (error) {
            Logger.error('Erro ao carregar recibo:', error);
            setError(error.message || 'Erro ao carregar recibo');

            Alert.alert(
                'Erro',
                'Não foi possível carregar o recibo. Tente novamente.',
                [
                    { text: 'Tentar Novamente', onPress: loadReceipt },
                    { text: 'Voltar', onPress: () => navigation.goBack() }
                ]
            );
        } finally {
            setLoading(false);
        }
    };

    const handleShare = async () => {
        if (!receipt) return;

        try {
            const shareText = ReceiptService.generateShareText(receipt);

            await Share.share({
                message: shareText,
                title: 'Recibo Leaf'
            });
        } catch (error) {
            Logger.error('Erro ao compartilhar:', error);
            Alert.alert('Erro', 'Não foi possível compartilhar o recibo');
        }
    };

    const handleDownload = async () => {
        if (!receipt) return;
        try {
            setLoading(true);
            const html = `
                <html>
                    <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                        <style>
                            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #333; }
                            .header { text-align: center; margin-bottom: 30px; }
                            h1 { color: #2c5530; margin-bottom: 5px; }
                            .receipt-id { color: #666; font-size: 14px; }
                            .section { margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
                            h2 { font-size: 16px; color: #4a7c59; margin-top: 0; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
                            .row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
                            .val { font-weight: bold; color: #2c5530; }
                            .footer { margin-top: 40px; font-size: 12px; color: #999; text-align: center; }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>🍃 Leaf</h1>
                            <div class="receipt-id">Recibo: ${receipt.receiptId}</div>
                            <div class="receipt-id">${receipt.trip.date} - ${receipt.trip.time}</div>
                        </div>

                        <div class="section">
                            <h2>Trajeto</h2>
                            <div class="row">
                                <span>Partida:</span>
                                <span>${receipt.trip.pickup.address}</span>
                            </div>
                            <div class="row">
                                <span>Destino:</span>
                                <span>${receipt.trip.dropoff.address}</span>
                            </div>
                            <div class="row">
                                <span>Distância:</span>
                                <span>${receipt.trip.distance.formatted || ReceiptService.formatDistance(receipt.trip.distance.actual)}</span>
                            </div>
                            <div class="row">
                                <span>Tempo:</span>
                                <span>${receipt.trip.durationFormatted || receipt.trip.duration + ' min'}</span>
                            </div>
                        </div>

                        <div class="section">
                            <h2>Pagamento</h2>
                            <div class="row">
                                <span>Método:</span>
                                <span>${receipt.payment.method}</span>
                            </div>
                            <div class="row">
                                <span>Total Pago:</span>
                                <span class="val" style="font-size: 18px;">${receipt.financial.totalPaid.formatted}</span>
                            </div>
                        </div>

                        <div class="section">
                            <h2>Motorista</h2>
                            <div class="row">
                                <span>Nome:</span>
                                <span>${receipt.driver.fullName || receipt.driver.name}</span>
                            </div>
                            <div class="row">
                                <span>Veículo:</span>
                                <span>${receipt.driver.vehicle.brandModel || receipt.driver.vehicle.type} (${receipt.driver.vehicle.plate})</span>
                            </div>
                        </div>

                        <div class="footer">
                            <p>${receipt.legal.companyName} | CNPJ: ${receipt.legal.cnpj}</p>
                            <p>${receipt.legal.note}</p>
                            ${receipt.hash ? `<p>Hash: ${receipt.hash}</p>` : ''}
                        </div>
                    </body>
                </html>
            `;

            const { uri } = await Print.printToFileAsync({ html });
            const isAvailable = await Sharing.isAvailableAsync();
            if (isAvailable) {
                await Sharing.shareAsync(uri, {
                    mimeType: 'application/pdf',
                    dialogTitle: 'Download Recibo Leaf',
                    UTI: 'com.adobe.pdf'
                });
            } else {
                Alert.alert('Download em PDF', 'O compartilhamento de arquivos não está disponível no seu dispositivo.');
            }
        } catch (error) {
            Logger.error('Erro ao gerar PDF', error);
            Alert.alert('Erro', 'Não foi possível gerar o PDF.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()}>
                        <Icon name="arrow-back" size={24} color="#2c5530" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Recibo</Text>
                    <View style={{ width: 24 }} />
                </View>

                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#4a7c59" />
                    <Text style={styles.loadingText}>Carregando recibo...</Text>
                </View>
            </SafeAreaView>
        );
    }

    if (error || !receipt) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()}>
                        <Icon name="arrow-back" size={24} color="#2c5530" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Recibo</Text>
                    <View style={{ width: 24 }} />
                </View>

                <View style={styles.errorContainer}>
                    <Icon name="error" size={64} color="#e74c3c" />
                    <Text style={styles.errorText}>
                        {error || 'Recibo não encontrado'}
                    </Text>
                    <TouchableOpacity style={styles.retryButton} onPress={loadReceipt}>
                        <Text style={styles.retryButtonText}>Tentar Novamente</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Icon name="arrow-back" size={24} color="#2c5530" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Recibo</Text>
                <TouchableOpacity onPress={handleShare}>
                    <Icon name="share" size={24} color="#2c5530" />
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                {/* Título do Recibo */}
                <View style={styles.receiptHeader}>
                    <View style={styles.logoContainer}>
                        <Text style={styles.logo}>🍃</Text>
                        <Text style={styles.companyName}>Leaf</Text>
                    </View>
                    <Text style={styles.receiptTitle}>{receipt.title || `Sua corrida para ${receipt.trip.dropoff.address}, em ${receipt.trip.date} ${receipt.trip.time}`}</Text>
                    <Text style={styles.receiptId}>{receipt.receiptId}</Text>
                    {receipt.hash && (
                        <Text style={styles.receiptHash}>Hash: {receipt.hash}</Text>
                    )}
                </View>

                {/* Local de Partida */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>📍 Local de Partida</Text>
                    <Text style={styles.addressText}>
                        {receipt.trip.pickup.address}
                    </Text>
                </View>

                {/* Local de Destino */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🎯 Local de Destino</Text>
                    <Text style={styles.addressText}>
                        {receipt.trip.dropoff.address}
                    </Text>
                </View>

                {/* Tempo de Viagem e Distância */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>⏱️ Tempo de Viagem e Distância</Text>
                    <View style={styles.tripMetrics}>
                        <View style={styles.metric}>
                            <Icon name="schedule" size={24} color="#4a7c59" />
                            <Text style={styles.metricValue}>
                                {receipt.trip.durationFormatted || `${receipt.trip.duration} min`}
                            </Text>
                            <Text style={styles.metricLabel}>Tempo de viagem</Text>
                        </View>

                        <View style={styles.metric}>
                            <Icon name="straighten" size={24} color="#4a7c59" />
                            <Text style={styles.metricValue}>
                                {receipt.trip.distance.formatted || ReceiptService.formatDistance(receipt.trip.distance.actual)}
                            </Text>
                            <Text style={styles.metricLabel}>Distância percorrida</Text>
                        </View>
                    </View>
                </View>

                {/* Valor Pago e Forma de Pagamento */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>💰 Valor Pago e Forma de Pagamento</Text>
                    <View style={styles.paymentInfo}>
                        <View style={styles.paymentRow}>
                            <Text style={styles.paymentLabel}>Valor Total:</Text>
                            <Text style={styles.paymentValue}>
                                {receipt.financial.totalPaid.formatted}
                            </Text>
                        </View>
                        <View style={styles.paymentRow}>
                            <Text style={styles.paymentLabel}>Forma de Pagamento:</Text>
                            <Text style={styles.paymentValue}>
                                {receipt.payment.method}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Mapa do Trajeto */}
                {receipt.trip.mapImage?.url && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>🗺️ Trajeto Percorrido</Text>
                        <View style={styles.mapContainer}>
                            <Image
                                source={{ uri: receipt.trip.mapImage.url }}
                                style={styles.mapImage}
                                onLoadStart={() => setMapLoading(true)}
                                onLoadEnd={() => setMapLoading(false)}
                                onError={() => setMapLoading(false)}
                            />
                            {mapLoading && (
                                <View style={styles.mapLoading}>
                                    <ActivityIndicator size="small" color="#4a7c59" />
                                    <Text style={styles.mapLoadingText}>Carregando mapa...</Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}


                {/* Dados do Motorista */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>👤 Dados do Motorista</Text>
                    <View style={styles.driverInfo}>
                        <Text style={styles.driverName}>
                            {receipt.driver.fullName || receipt.driver.name}
                        </Text>
                        <Text style={styles.vehicleInfo}>
                            {receipt.driver.vehicle.brandModel || receipt.driver.vehicle.type}
                            {receipt.driver.vehicle.plate !== 'N/A' &&
                                ` • ${receipt.driver.vehicle.plate}`
                            }
                        </Text>
                    </View>
                </View>

                {/* Informações Legais */}
                <View style={[styles.section, styles.legalSection]}>
                    <Text style={styles.legalTitle}>Informações Legais</Text>
                    <Text style={styles.legalText}>
                        {receipt.legal.companyName}
                    </Text>
                    <Text style={styles.legalText}>
                        CNPJ: {receipt.legal.cnpj}
                    </Text>
                    <Text style={styles.legalNote}>
                        {receipt.legal.note}
                    </Text>
                </View>

                {/* Botões de Ação */}
                <View style={styles.actionButtons}>
                    <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
                        <Icon name="share" size={20} color="white" />
                        <Text style={styles.actionButtonText}>Compartilhar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, styles.downloadButton]}
                        onPress={handleDownload}
                    >
                        <Icon name="download" size={20} color="#4a7c59" />
                        <Text style={[styles.actionButtonText, styles.downloadButtonText]}>
                            Baixar PDF
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Espaçamento final */}
                <View style={{ height: 20 }} />
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 15,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#e9ecef',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#2c5530',
    },
    scrollView: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#666',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    errorText: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        marginVertical: 20,
    },
    retryButton: {
        backgroundColor: '#4a7c59',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    receiptHeader: {
        backgroundColor: 'white',
        padding: 20,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#e9ecef',
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    logo: {
        fontSize: 32,
        marginRight: 8,
    },
    companyName: {
        fontSize: 24,
        fontWeight: '700',
        color: '#2c5530',
    },
    receiptId: {
        fontSize: 18,
        fontWeight: '600',
        color: '#4a7c59',
        marginBottom: 5,
    },
    receiptTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
        textAlign: 'center',
        marginVertical: 10,
        paddingHorizontal: 10,
    },
    receiptHash: {
        fontSize: 11,
        color: '#999',
        marginTop: 5,
        fontFamily: 'monospace',
    },
    section: {
        backgroundColor: 'white',
        margin: 15,
        padding: 20,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
        marginBottom: 15,
    },
    tripInfo: {
        marginBottom: 20,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    locationDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#4a7c59',
        marginTop: 5,
        marginRight: 15,
    },
    destinationDot: {
        backgroundColor: '#e74c3c',
    },
    locationConnector: {
        width: 2,
        height: 20,
        backgroundColor: '#ddd',
        marginLeft: 5,
        marginVertical: 8,
    },
    locationDetails: {
        flex: 1,
    },
    locationLabel: {
        fontSize: 12,
        color: '#666',
        marginBottom: 2,
    },
    locationAddress: {
        fontSize: 14,
        color: '#333',
        lineHeight: 20,
    },
    addressText: {
        fontSize: 15,
        color: '#333',
        lineHeight: 22,
    },
    paymentInfo: {
        marginTop: 10,
    },
    paymentRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    paymentLabel: {
        fontSize: 15,
        color: '#666',
        flex: 1,
    },
    paymentValue: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
    },
    tripMetrics: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    metric: {
        alignItems: 'center',
        flex: 1,
    },
    metricValue: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
        marginTop: 5,
        marginBottom: 2,
    },
    metricLabel: {
        fontSize: 12,
        color: '#666',
    },
    mapContainer: {
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#f0f0f0',
        height: 200,
        position: 'relative',
    },
    mapImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    mapLoading: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.8)',
    },
    mapLoadingText: {
        marginTop: 5,
        fontSize: 12,
        color: '#666',
    },
    financialBreakdown: {
        borderWidth: 1,
        borderColor: '#e9ecef',
        borderRadius: 8,
        overflow: 'hidden',
    },
    totalPaid: {
        backgroundColor: '#f8f9fa',
        padding: 15,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    totalLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
    },
    totalValue: {
        fontSize: 20,
        fontWeight: '700',
        color: '#2c5530',
    },
    breakdownList: {
        padding: 15,
    },
    breakdownItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    driverAmount: {
        borderBottomWidth: 0,
        marginTop: 10,
        paddingTop: 15,
        borderTopWidth: 2,
        borderTopColor: '#4a7c59',
    },
    breakdownLabel: {
        fontSize: 14,
        color: '#666',
        flex: 1,
    },
    breakdownValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    driverValue: {
        color: '#4a7c59',
        fontSize: 16,
    },
    driverInfo: {
        alignItems: 'center',
    },
    driverName: {
        fontSize: 18,
        fontWeight: '600',
        color: '#2c5530',
        marginBottom: 5,
    },
    vehicleInfo: {
        fontSize: 14,
        color: '#666',
    },
    legalSection: {
        backgroundColor: '#f8f9fa',
    },
    legalTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2c5530',
        marginBottom: 10,
    },
    legalText: {
        fontSize: 12,
        color: '#666',
        marginBottom: 3,
    },
    legalNote: {
        fontSize: 11,
        color: '#999',
        fontStyle: 'italic',
        marginTop: 10,
        lineHeight: 16,
    },
    actionButtons: {
        flexDirection: 'row',
        paddingHorizontal: 15,
        paddingBottom: 20,
        gap: 10,
    },
    actionButton: {
        flex: 1,
        backgroundColor: '#4a7c59',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 15,
        borderRadius: 8,
        gap: 8,
    },
    downloadButton: {
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#4a7c59',
    },
    actionButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    downloadButtonText: {
        color: '#4a7c59',
    },
});

export default ReceiptScreen;




