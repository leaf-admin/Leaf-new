import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import { MAIN_COLOR, SECONDORY_COLOR } from '../../common-local/sharedFunctions';

export default function RideRequestModal({ isVisible, rideDetails, onAccept, onDecline }) {
    if (!isVisible || !rideDetails) {
        return null;
    }

    const { pickup, drop, fare } = rideDetails;

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={isVisible}
            onRequestClose={onDecline}
        >
            <View style={styles.centeredView}>
                <View style={styles.modalView}>
                    <Text style={styles.title}>Nova Solicitação de Corrida</Text>
                    
                    <View style={styles.detailRow}>
                        <Ionicons name="location" color="#888" size={20} style={styles.icon} />
                        <Text style={styles.addressText} numberOfLines={2}>{pickup?.add}</Text>
                    </View>
                    
                    <View style={styles.detailRow}>
                        <Ionicons name="location" color="#888" size={20} style={styles.icon} />
                        <Text style={styles.addressText} numberOfLines={2}>{drop?.add}</Text>
                    </View>
                    
                    <View style={styles.fareContainer}>
                        <Text style={styles.fareText}>Valor estimado:</Text>
                        <Text style={styles.fareValue}>R$ {fare?.toFixed(2).replace('.', ',')}</Text>
                    </View>

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity style={[styles.button, styles.declineButton]} onPress={onDecline}>
                            <Text style={styles.buttonText}>Recusar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.button, styles.acceptButton]} onPress={onAccept}>
                            <Text style={styles.buttonText}>Aceitar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    centeredView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    modalView: {
        margin: 20,
        backgroundColor: 'white',
        borderRadius: 20,
        padding: 25,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        width: '90%',
    },
    title: {
        fontSize: 22,
        fontFamily: fonts.Bold,
        marginBottom: 20,
        textAlign: 'center',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 15,
        width: '100%',
    },
    icon: {
        marginRight: 15,
    },
    addressText: {
        fontFamily: fonts.Regular,
        fontSize: 16,
        flex: 1,
    },
    fareContainer: {
        marginTop: 15,
        paddingTop: 15,
        borderTopWidth: 1,
        borderTopColor: '#eee',
        width: '100%',
        alignItems: 'center',
    },
    fareText: {
        fontFamily: fonts.Regular,
        fontSize: 18,
        color: '#555',
    },
    fareValue: {
        fontFamily: fonts.Bold,
        fontSize: 24,
        color: MAIN_COLOR,
        marginTop: 5,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 30,
        width: '100%',
    },
    button: {
        borderRadius: 10,
        paddingVertical: 12,
        elevation: 2,
        flex: 1,
        marginHorizontal: 10,
        alignItems: 'center',
    },
    acceptButton: {
        backgroundColor: MAIN_COLOR,
    },
    declineButton: {
        backgroundColor: SECONDORY_COLOR,
    },
    buttonText: {
        color: 'white',
        fontFamily: fonts.Bold,
        fontSize: 16,
    },
}); 