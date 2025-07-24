import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { colors } from '../common/theme';
import { MAIN_COLOR } from '../common/sharedFunctions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';

const { width } = Dimensions.get('window');

const POPUP_STORAGE_KEY = 'dont_show_driver_partner_popup';

export default function DriverPartnerPopupManager() {
    const { t } = i18n;
    const [isVisible, setIsVisible] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    useEffect(() => {
        checkPopupVisibility();
    }, []);

    const checkPopupVisibility = async () => {
        try {
            const shouldNotShow = await AsyncStorage.getItem(POPUP_STORAGE_KEY);
            if (!shouldNotShow) {
                // Adiciona um pequeno delay para garantir que a tela esteja carregada
                setTimeout(() => {
                    setIsVisible(true);
                }, 1000);
            }
        } catch (error) {
            console.error('Erro ao verificar estado do popup:', error);
        }
    };

    const handleDontShowAgain = async () => {
        setDontShowAgain(true);
        try {
            await AsyncStorage.setItem(POPUP_STORAGE_KEY, 'true');
            setIsVisible(false);
        } catch (error) {
            console.error('Erro ao salvar preferência:', error);
        }
    };

    const handleStartNow = () => {
        setIsVisible(false);
        // Aqui você pode adicionar a navegação para a tela de cadastro de motorista
        // ou qualquer outra ação necessária
    };

    return (
        <Modal
            visible={isVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setIsVisible(false)}
        >
            <View style={styles.overlay}>
                <View style={styles.popupContainer}>
                    <Text style={styles.title}>{t('become_partner')}</Text>
                    <Text style={styles.message}>
                        {t('partner_message')}
                    </Text>
                    
                    <TouchableOpacity 
                        style={styles.startButton}
                        onPress={handleStartNow}
                    >
                        <Text style={styles.startButtonText}>{t('start_now')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={styles.dontShowButton}
                        onPress={handleDontShowAgain}
                    >
                        <Text style={styles.dontShowText}>{t('dont_show_again')}</Text>
                    </TouchableOpacity>
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
    popupContainer: {
        width: width * 0.85,
        backgroundColor: colors.WHITE,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        elevation: 5,
        shadowColor: colors.BLACK,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.BLACK,
        marginBottom: 16,
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        color: colors.GRAY,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 22,
    },
    startButton: {
        backgroundColor: MAIN_COLOR,
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 8,
        marginBottom: 16,
        width: '100%',
    },
    startButtonText: {
        color: colors.WHITE,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    dontShowButton: {
        padding: 8,
    },
    dontShowText: {
        color: colors.GRAY,
        fontSize: 14,
    },
}); 