/**
 * 🧾 PREVIEW VISUAL DO RECIBO
 * 
 * Componente para visualizar como o recibo aparece na tela
 * Usado para demonstração e testes
 */

import React from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const ReceiptPreview = ({ receiptData = null }) => {
    // Dados de exemplo se não for fornecido
    const receipt = receiptData || {
        receiptId: 'LEAF-booking_1234567890',
        hash: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6',
        title: 'Sua corrida para Copacabana, em 18/12/2025 15:30',
        trip: {
            date: '18/12/2025',
            time: '15:30',
            pickup: {
                address: 'Praça Mauá, Rio de Janeiro - RJ'
            },
            dropoff: {
                address: 'Copacabana, Rio de Janeiro - RJ'
            },
            duration: 30,
            durationFormatted: '30 min',
            distance: {
                actual: 12.5,
                formatted: '12.5 km'
            }
        },
        financial: {
            totalPaid: {
                formatted: 'R$ 45,50'
            },
            breakdown: {
                tripFare: {
                    formatted: 'R$ 45,50'
                },
                operationalCost: {
                    formatted: 'R$ 0,79'
                },
                wooviFee: {
                    formatted: 'R$ 0,36'
                },
                driverAmount: {
                    formatted: 'R$ 44,35'
                }
            }
        },
        driver: {
            fullName: 'João Silva',
            vehicle: {
                brandModel: 'Honda Civic 2020',
                plate: 'ABC-1234'
            }
        },
        customer: {
            name: 'Maria Santos'
        },
        payment: {
            method: 'PIX'
        },
        legal: {
            companyName: 'LEAF - Freedom Tecnologia e Serviços LTDA',
            cnpj: '54.027.374/0001-20',
            note: 'Este documento não é uma nota fiscal. Para solicitar nota fiscal, entre em contato conosco.'
        }
    };

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            {/* Header do Recibo */}
            <View style={styles.receiptHeader}>
                <View style={styles.logoContainer}>
                    <Text style={styles.logo}>🍃</Text>
                    <Text style={styles.companyName}>Leaf</Text>
                </View>
                <Text style={styles.receiptTitle}>{receipt.title}</Text>
                <Text style={styles.receiptId}>{receipt.receiptId}</Text>
                {receipt.hash && (
                    <Text style={styles.receiptHash}>Hash: {receipt.hash}</Text>
                )}
            </View>

            {/* Local de Partida */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="location" size={20} color="#4a7c59" />
                    <Text style={styles.sectionTitle}>Local de Partida</Text>
                </View>
                <Text style={styles.addressText}>
                    {receipt.trip.pickup.address}
                </Text>
            </View>

            {/* Local de Destino */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="location" size={20} color="#e74c3c" />
                    <Text style={styles.sectionTitle}>Local de Destino</Text>
                </View>
                <Text style={styles.addressText}>
                    {receipt.trip.dropoff.address}
                </Text>
            </View>

            {/* Tempo e Distância */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Tempo de Viagem e Distância</Text>
                <View style={styles.metricsContainer}>
                    <View style={styles.metric}>
                        <Ionicons name="time-outline" size={24} color="#4a7c59" />
                        <Text style={styles.metricValue}>
                            {receipt.trip.durationFormatted}
                        </Text>
                        <Text style={styles.metricLabel}>Tempo de viagem</Text>
                    </View>
                    
                    <View style={styles.metric}>
                        <Ionicons name="resize-outline" size={24} color="#4a7c59" />
                        <Text style={styles.metricValue}>
                            {receipt.trip.distance.formatted}
                        </Text>
                        <Text style={styles.metricLabel}>Distância percorrida</Text>
                    </View>
                </View>
            </View>

            {/* Valor Pago */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Valor Pago e Forma de Pagamento</Text>
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

            {/* Breakdown Financeiro (Motorista) */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>💸 Detalhamento Financeiro (Motorista)</Text>
                <View style={styles.breakdownContainer}>
                    <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Valor da Corrida:</Text>
                        <Text style={styles.breakdownValue}>
                            {receipt.financial.breakdown.tripFare.formatted}
                        </Text>
                    </View>
                    <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Custo Operacional:</Text>
                        <Text style={styles.breakdownValue}>
                            {receipt.financial.breakdown.operationalCost.formatted}
                        </Text>
                    </View>
                    <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Taxa PIX (Woovi):</Text>
                        <Text style={styles.breakdownValue}>
                            {receipt.financial.breakdown.wooviFee.formatted}
                        </Text>
                    </View>
                    <View style={[styles.breakdownRow, styles.driverAmountRow]}>
                        <Text style={[styles.breakdownLabel, styles.driverAmountLabel]}>
                            🚗 VOCÊ RECEBERÁ:
                        </Text>
                        <Text style={[styles.breakdownValue, styles.driverAmountValue]}>
                            {receipt.financial.breakdown.driverAmount.formatted}
                        </Text>
                    </View>
                </View>
            </View>

            {/* Dados do Motorista */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="person" size={20} color="#4a7c59" />
                    <Text style={styles.sectionTitle}>Dados do Motorista</Text>
                </View>
                <View style={styles.driverInfo}>
                    <Text style={styles.driverName}>
                        {receipt.driver.fullName}
                    </Text>
                    <Text style={styles.vehicleInfo}>
                        {receipt.driver.vehicle.brandModel}
                        {receipt.driver.vehicle.plate !== 'N/A' && 
                            ` • ${receipt.driver.vehicle.plate}`
                        }
                    </Text>
                </View>
            </View>

            {/* Dados do Passageiro */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="person-outline" size={20} color="#4a7c59" />
                    <Text style={styles.sectionTitle}>Dados do Passageiro</Text>
                </View>
                <Text style={styles.customerName}>
                    {receipt.customer.name}
                </Text>
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

            {/* Footer */}
            <View style={styles.footer}>
                <Text style={styles.footerText}>
                    Obrigado por usar a Leaf! 🍃
                </Text>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
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
    receiptTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
        textAlign: 'center',
        marginVertical: 10,
        paddingHorizontal: 10,
    },
    receiptId: {
        fontSize: 18,
        fontWeight: '600',
        color: '#4a7c59',
        marginBottom: 5,
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
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 15,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2c5530',
    },
    addressText: {
        fontSize: 15,
        color: '#333',
        lineHeight: 22,
    },
    metricsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 10,
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
    breakdownContainer: {
        marginTop: 10,
    },
    breakdownRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
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
    driverAmountRow: {
        borderBottomWidth: 0,
        marginTop: 10,
        paddingTop: 15,
        borderTopWidth: 2,
        borderTopColor: '#4a7c59',
    },
    driverAmountLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: '#2c5530',
    },
    driverAmountValue: {
        fontSize: 18,
        fontWeight: '700',
        color: '#4a7c59',
    },
    driverInfo: {
        alignItems: 'center',
        marginTop: 10,
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
    customerName: {
        fontSize: 16,
        color: '#333',
        marginTop: 10,
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
    footer: {
        padding: 20,
        alignItems: 'center',
    },
    footerText: {
        fontSize: 14,
        color: '#4a7c59',
        fontWeight: '600',
    },
});

export default ReceiptPreview;

