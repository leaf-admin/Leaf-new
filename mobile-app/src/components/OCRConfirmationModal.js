import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function OCRConfirmationModal({ visible, onClose, onConfirm, extractedData }) {
    if (!extractedData) return null;

    const fields = [
        { label: 'Placa', value: extractedData.placa, icon: 'car-outline' },
        { label: 'RENAVAM', value: extractedData.renavam, icon: 'document-text-outline' },
        { label: 'Marca', value: extractedData.marca, icon: 'logo-google' },
        { label: 'Modelo', value: extractedData.modelo, icon: 'car-sport-outline' },
        { label: 'Ano', value: extractedData.ano, icon: 'calendar-outline' },
        { label: 'UF', value: extractedData.uf, icon: 'location-outline' },
        { label: 'Chassi', value: extractedData.chassi, icon: 'key-outline' },
        { label: 'Tipo', value: extractedData.vehicleType === 'moto' ? 'Moto' : 'Carro', icon: 'bicycle-outline' },
    ];

    const hasMissingFields = fields.some(f => !f.value);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <Ionicons name="checkmark-circle-outline" size={32} color="#003002" />
                        <Text style={styles.title}>Confirme os dados extraídos</Text>
                        <Text style={styles.subtitle}>
                            Verifique se os dados estão corretos antes de continuar
                        </Text>
                    </View>

                    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                        {hasMissingFields && (
                            <View style={styles.warningContainer}>
                                <Ionicons name="warning-outline" size={20} color="#FF6B00" />
                                <Text style={styles.warningText}>
                                    Alguns campos não foram encontrados no documento
                                </Text>
                            </View>
                        )}

                        <View style={styles.fieldsContainer}>
                            {fields.map((field, index) => (
                                <View key={index} style={styles.fieldRow}>
                                    <View style={styles.fieldLabelContainer}>
                                        <Ionicons name={field.icon} size={20} color="#666" />
                                        <Text style={styles.fieldLabel}>{field.label}:</Text>
                                    </View>
                                    <View style={styles.fieldValueContainer}>
                                        {field.value ? (
                                            <Text style={styles.fieldValue}>{field.value}</Text>
                                        ) : (
                                            <Text style={styles.fieldValueMissing}>Não encontrado</Text>
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </ScrollView>

                    <View style={styles.buttonsContainer}>
                        <TouchableOpacity
                            style={[styles.button, styles.buttonCancel]}
                            onPress={onClose}
                        >
                            <Text style={styles.buttonCancelText}>Rejeitar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.button, styles.buttonConfirm]}
                            onPress={() => onConfirm(extractedData)}
                        >
                            <Ionicons name="checkmark" size={20} color="#FFF" />
                            <Text style={styles.buttonConfirmText}>Confirmar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        width: '90%',
        maxHeight: '80%',
        backgroundColor: '#FFF',
        borderRadius: 16,
        overflow: 'hidden',
    },
    header: {
        padding: 20,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#003002',
        marginTop: 12,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: '#666',
        marginTop: 8,
        textAlign: 'center',
    },
    content: {
        flex: 1,
    },
    warningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF3E0',
        padding: 12,
        margin: 16,
        borderRadius: 8,
    },
    warningText: {
        fontSize: 14,
        color: '#FF6B00',
        marginLeft: 8,
        flex: 1,
    },
    fieldsContainer: {
        padding: 16,
    },
    fieldRow: {
        flexDirection: 'row',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    fieldLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '35%',
    },
    fieldLabel: {
        fontSize: 14,
        color: '#666',
        marginLeft: 8,
        fontWeight: '500',
    },
    fieldValueContainer: {
        flex: 1,
        alignItems: 'flex-end',
    },
    fieldValue: {
        fontSize: 14,
        color: '#003002',
        fontWeight: '600',
    },
    fieldValueMissing: {
        fontSize: 14,
        color: '#999',
        fontStyle: 'italic',
    },
    buttonsContainer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
        gap: 12,
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    buttonCancel: {
        backgroundColor: '#F5F5F5',
    },
    buttonCancelText: {
        fontSize: 16,
        color: '#666',
        fontWeight: '600',
    },
    buttonConfirm: {
        backgroundColor: '#003002',
    },
    buttonConfirmText: {
        fontSize: 16,
        color: '#FFF',
        fontWeight: '600',
    },
});

