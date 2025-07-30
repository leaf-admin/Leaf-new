import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    TouchableOpacity,
    Dimensions,
    Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../common-local/font';

const { width } = Dimensions.get('window');

const ToastTypes = {
    SUCCESS: 'success',
    ERROR: 'error',
    INFO: 'info',
    WARNING: 'warning'
};

const ToastIcons = {
    [ToastTypes.SUCCESS]: 'checkmark-circle',
    [ToastTypes.ERROR]: 'close-circle',
    [ToastTypes.INFO]: 'information-circle',
    [ToastTypes.WARNING]: 'warning'
};

const ToastColors = {
    [ToastTypes.SUCCESS]: {
        background: '#10B981',
        icon: '#FFFFFF',
        text: '#FFFFFF'
    },
    [ToastTypes.ERROR]: {
        background: '#EF4444',
        icon: '#FFFFFF',
        text: '#FFFFFF'
    },
    [ToastTypes.INFO]: {
        background: '#3B82F6',
        icon: '#FFFFFF',
        text: '#FFFFFF'
    },
    [ToastTypes.WARNING]: {
        background: '#F59E0B',
        icon: '#FFFFFF',
        text: '#FFFFFF'
    }
};

export default function ToastNotification({ 
    visible, 
    message, 
    type = ToastTypes.INFO, 
    duration = 3000, 
    onClose,
    position = 'top'
}) {
    const translateY = useRef(new Animated.Value(-100)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        if (visible) {
            // Animar entrada
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.spring(scale, {
                    toValue: 1,
                    tension: 100,
                    friction: 8,
                    useNativeDriver: true,
                })
            ]).start();

            // Auto-hide após duração
            const timer = setTimeout(() => {
                hideToast();
            }, duration);

            return () => clearTimeout(timer);
        }
    }, [visible]);

    const hideToast = () => {
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: -100,
                duration: 250,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }),
            Animated.timing(scale, {
                toValue: 0.8,
                duration: 250,
                useNativeDriver: true,
            })
        ]).start(() => {
            onClose && onClose();
        });
    };

    if (!visible) return null;

    const colors = ToastColors[type];
    const iconName = ToastIcons[type];

    return (
        <Animated.View 
            style={[
                styles.container,
                styles[position],
                {
                    transform: [
                        { translateY },
                        { scale }
                    ],
                    opacity,
                    backgroundColor: colors.background
                }
            ]}
        >
            <View style={styles.content}>
                <Ionicons 
                    name={iconName} 
                    size={24} 
                    color={colors.icon} 
                    style={styles.icon}
                />
                <Text style={[styles.message, { color: colors.text }]}>
                    {message}
                </Text>
                <TouchableOpacity 
                    onPress={hideToast}
                    style={styles.closeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="close" size={20} color={colors.icon} />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 10000,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
    },
    top: {
        top: Platform.OS === 'ios' ? 60 : 40,
    },
    bottom: {
        bottom: Platform.OS === 'ios' ? 100 : 80,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    icon: {
        marginRight: 12,
    },
    message: {
        flex: 1,
        fontSize: 15,
        fontFamily: fonts.Medium,
        lineHeight: 20,
    },
    closeButton: {
        marginLeft: 12,
        padding: 4,
    }
});

// Hook para usar o Toast
export const useToast = () => {
    const [toast, setToast] = React.useState({
        visible: false,
        message: '',
        type: ToastTypes.INFO,
        duration: 3000
    });

    const showToast = (message, type = ToastTypes.INFO, duration = 3000) => {
        setToast({
            visible: true,
            message,
            type,
            duration
        });
    };

    const hideToast = () => {
        setToast(prev => ({ ...prev, visible: false }));
    };

    const showSuccess = (message, duration) => showToast(message, ToastTypes.SUCCESS, duration);
    const showError = (message, duration) => showToast(message, ToastTypes.ERROR, duration);
    const showInfo = (message, duration) => showToast(message, ToastTypes.INFO, duration);
    const showWarning = (message, duration) => showToast(message, ToastTypes.WARNING, duration);

    return {
        toast,
        showToast,
        hideToast,
        showSuccess,
        showError,
        showInfo,
        showWarning
    };
};

export { ToastTypes }; 