import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    Dimensions,
    ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../common-local/font';

const { width, height } = Dimensions.get('window');

// Skeleton Loading Component
export const SkeletonLoader = ({ width: skeletonWidth, height: skeletonHeight, style }) => {
    const animatedValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(animatedValue, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                }),
                Animated.timing(animatedValue, {
                    toValue: 0,
                    duration: 1000,
                    useNativeDriver: true,
                }),
            ])
        );
        animation.start();

        return () => animation.stop();
    }, []);

    const opacity = animatedValue.interpolate({
        inputRange: [0, 1],
        outputRange: [0.3, 0.7],
    });

    return (
        <Animated.View
            style={[
                styles.skeleton,
                {
                    width: skeletonWidth,
                    height: skeletonHeight,
                    opacity,
                },
                style,
            ]}
        />
    );
};

// Skeleton Card para carros
export const CarSkeletonCard = () => (
    <View style={styles.skeletonCard}>
        <View style={styles.skeletonCardHeader}>
            <SkeletonLoader width={54} height={38} style={styles.skeletonImage} />
            <View style={styles.skeletonCardContent}>
                <SkeletonLoader width={120} height={16} style={styles.skeletonTitle} />
                <SkeletonLoader width={80} height={14} style={styles.skeletonSubtitle} />
            </View>
            <SkeletonLoader width={60} height={16} style={styles.skeletonPrice} />
        </View>
    </View>
);

// Loading Spinner com texto
export const LoadingSpinner = ({ 
    message = 'Carregando...', 
    size = 'large', 
    color = '#10B981',
    style 
}) => (
    <View style={[styles.loadingContainer, style]}>
        <ActivityIndicator size={size} color={color} />
        {message && (
            <Text style={styles.loadingText}>{message}</Text>
        )}
    </View>
);

// Progress Bar
export const ProgressBar = ({ 
    progress = 0, 
    width: barWidth = width - 40, 
    height: barHeight = 4,
    color = '#10B981',
    backgroundColor = '#E5E7EB',
    showPercentage = false,
    style 
}) => {
    const animatedProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(animatedProgress, {
            toValue: progress,
            duration: 500,
            useNativeDriver: false,
        }).start();
    }, [progress]);

    const progressWidth = animatedProgress.interpolate({
        inputRange: [0, 100],
        outputRange: ['0%', '100%'],
    });

    return (
        <View style={[styles.progressContainer, { width: barWidth, height: barHeight }, style]}>
            <View style={[styles.progressBackground, { backgroundColor, height: barHeight }]} />
            <Animated.View
                style={[
                    styles.progressFill,
                    {
                        width: progressWidth,
                        backgroundColor: color,
                        height: barHeight,
                    },
                ]}
            />
            {showPercentage && (
                <Text style={styles.progressText}>{Math.round(progress)}%</Text>
            )}
        </View>
    );
};

// Pull to Refresh Indicator
export const PullToRefreshIndicator = ({ 
    refreshing, 
    onRefresh, 
    progress = 0,
    children 
}) => {
    const rotateAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (refreshing) {
            Animated.loop(
                Animated.timing(rotateAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                })
            ).start();
        } else {
            rotateAnim.setValue(0);
        }
    }, [refreshing]);

    const rotate = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <View style={styles.pullToRefreshContainer}>
            {refreshing && (
                <View style={styles.pullToRefreshIndicator}>
                    <Animated.View style={{ transform: [{ rotate }] }}>
                        <Ionicons name="refresh" size={24} color="#10B981" />
                    </Animated.View>
                    <Text style={styles.pullToRefreshText}>Atualizando...</Text>
                </View>
            )}
            {children}
        </View>
    );
};

// Loading Overlay
export const LoadingOverlay = ({ 
    visible, 
    message = 'Carregando...',
    backgroundColor = 'rgba(0, 0, 0, 0.7)',
    spinnerColor = '#FFFFFF',
    textColor = '#FFFFFF'
}) => {
    if (!visible) return null;

    return (
        <View style={[styles.overlay, { backgroundColor }]}>
            <View style={styles.overlayContent}>
                <ActivityIndicator size="large" color={spinnerColor} />
                {message && (
                    <Text style={[styles.overlayText, { color: textColor }]}>
                        {message}
                    </Text>
                )}
            </View>
        </View>
    );
};

// Button Loading State
export const ButtonLoadingState = ({ 
    loading, 
    children, 
    loadingText = 'Carregando...',
    style 
}) => (
    <View style={[styles.buttonLoadingContainer, style]}>
        {loading ? (
            <View style={styles.buttonLoadingContent}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.buttonLoadingText}>{loadingText}</Text>
            </View>
        ) : (
            children
        )}
    </View>
);

// Loading Screen para o AppNavigator
export const LoadingScreen = () => (
    <View style={styles.loadingScreenContainer}>
        <View style={styles.loadingScreenContent}>
            <View style={styles.logoContainer}>
                <Ionicons name="leaf" size={80} color="#41D274" />
            </View>
            <Text style={styles.loadingScreenTitle}>Leaf</Text>
            <Text style={styles.loadingScreenSubtitle}>Carregando...</Text>
            <ActivityIndicator size="large" color="#41D274" style={styles.loadingScreenSpinner} />
        </View>
    </View>
);

const styles = StyleSheet.create({
    skeleton: {
        backgroundColor: '#E5E7EB',
        borderRadius: 4,
    },
    skeletonCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    skeletonCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    skeletonImage: {
        borderRadius: 8,
        marginRight: 12,
    },
    skeletonCardContent: {
        flex: 1,
        justifyContent: 'center',
    },
    skeletonTitle: {
        marginBottom: 6,
        borderRadius: 4,
    },
    skeletonSubtitle: {
        borderRadius: 4,
    },
    skeletonPrice: {
        borderRadius: 4,
    },
    loadingContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: '#6B7280',
        textAlign: 'center',
    },
    progressContainer: {
        position: 'relative',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        borderRadius: 2,
    },
    progressFill: {
        position: 'absolute',
        top: 0,
        left: 0,
        borderRadius: 2,
    },
    progressText: {
        position: 'absolute',
        right: 0,
        top: -20,
        fontSize: 12,
        fontFamily: fonts.Medium,
        color: '#6B7280',
    },
    pullToRefreshContainer: {
        flex: 1,
    },
    pullToRefreshIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        backgroundColor: '#F9FAFB',
    },
    pullToRefreshText: {
        marginLeft: 8,
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: '#6B7280',
    },
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
    },
    overlayContent: {
        alignItems: 'center',
        padding: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
    },
    overlayText: {
        marginTop: 12,
        fontSize: 16,
        fontFamily: fonts.Medium,
        textAlign: 'center',
    },
    buttonLoadingContainer: {
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonLoadingContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    buttonLoadingText: {
        marginLeft: 8,
        fontSize: 16,
        fontFamily: fonts.Medium,
        color: '#FFFFFF',
    },
    loadingScreenContainer: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingScreenContent: {
        alignItems: 'center',
        padding: 40,
    },
    logoContainer: {
        marginBottom: 20,
    },
    loadingScreenTitle: {
        fontSize: 32,
        fontWeight: '700',
        color: '#41D274',
        marginBottom: 8,
        fontFamily: fonts.Bold,
    },
    loadingScreenSubtitle: {
        fontSize: 16,
        color: '#666',
        marginBottom: 30,
        fontFamily: fonts.Medium,
    },
    loadingScreenSpinner: {
        marginTop: 20,
    },
}); 