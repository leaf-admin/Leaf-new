import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    Platform,
    StatusBar,
    Animated,
    ActivityIndicator,
    KeyboardAvoidingView,
    ScrollView,
    Image
} from 'react-native';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { fonts } from '../common/font';

const { width, height } = Dimensions.get('window');

const ModernLoginScreen = ({ navigation, route }) => {
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [cpf, setCpf] = useState('');
    const [isExistingUser, setIsExistingUser] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(false);

    // Animações
    const [fadeAnim] = useState(new Animated.Value(0));
    const [slideAnim] = useState(new Animated.Value(50));
    const [scaleAnim] = useState(new Animated.Value(0.8));
    const [logoAnim] = useState(new Animated.Value(0));
    const [inputAnim] = useState(new Animated.Value(0));

    const currentTheme = isDarkMode ? darkTheme : lightTheme;
    const userType = route?.params?.userType;

    useEffect(() => {
        // Animação de entrada
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 1000,
                useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.timing(logoAnim, {
                toValue: 1,
                duration: 1200,
                useNativeDriver: true,
            }),
            Animated.timing(inputAnim, {
                toValue: 1,
                duration: 1000,
                delay: 300,
                useNativeDriver: true,
            })
        ]).start();
    }, []);

    const checkPhone = async () => {
        setError('');
        if (!phone) return;
        setLoading(true);
        
        // Simular verificação
        setTimeout(() => {
            setIsExistingUser(Math.random() > 0.5);
            setLoading(false);
        }, 1500);
    };

    const handleLogin = async () => {
        setError('');
        setLoading(true);
        
        // Simular login
        setTimeout(() => {
            setLoading(false);
            navigation.replace('AuthLoadingScreen');
        }, 2000);
    };

    const handleSignup = async () => {
        setError('');
        setLoading(true);
        
        // Simular cadastro
        setTimeout(() => {
            setLoading(false);
            if (userType === 'driver') {
                navigation.replace('DriverDocumentsScreen', { phone, name, cpf });
            } else {
                navigation.replace('AuthLoadingScreen');
            }
        }, 2000);
    };

    const handlePress = () => {
        Animated.sequence([
            Animated.timing(scaleAnim, {
                toValue: 0.95,
                duration: 100,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
            })
        ]).start();
    };

    const renderInput = (placeholder, value, onChangeText, options = {}) => {
        const {
            secureTextEntry = false,
            keyboardType = 'default',
            autoCapitalize = 'none',
            maxLength,
            icon
        } = options;

        return (
            <Animated.View
                style={[
                    styles.inputContainer,
                    {
                        opacity: inputAnim,
                        transform: [
                            {
                                translateY: inputAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [30, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                {icon && (
                    <MaterialCommunityIcons
                        name={icon}
                        size={20}
                        color={currentTheme.textSecondary}
                        style={styles.inputIcon}
                    />
                )}
                <TextInput
                    style={[
                        styles.input,
                        { 
                            color: currentTheme.text,
                            borderColor: currentTheme.divider
                        }
                    ]}
                    placeholder={placeholder}
                    placeholderTextColor={currentTheme.placeholder}
                    value={value}
                    onChangeText={onChangeText}
                    secureTextEntry={secureTextEntry}
                    keyboardType={keyboardType}
                    autoCapitalize={autoCapitalize}
                    maxLength={maxLength}
                />
                {secureTextEntry && (
                    <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.eyeIcon}
                    >
                        <Feather
                            name={showPassword ? 'eye' : 'eye-off'}
                            size={20}
                            color={currentTheme.textSecondary}
                        />
                    </TouchableOpacity>
                )}
            </Animated.View>
        );
    };

    const renderButton = (text, onPress, loading = false, disabled = false) => {
        return (
            <Animated.View
                style={[
                    styles.buttonContainer,
                    {
                        transform: [{ scale: scaleAnim }],
                        opacity: inputAnim
                    }
                ]}
            >
                <TouchableOpacity
                    style={[
                        styles.button,
                        disabled && styles.buttonDisabled
                    ]}
                    onPress={() => {
                        handlePress();
                        onPress();
                    }}
                    disabled={disabled || loading}
                    activeOpacity={0.8}
                >
                    <LinearGradient
                        colors={disabled ? ['#9E9E9E', '#757575'] : ['#4CAF50', '#2E7D32']}
                        style={styles.buttonGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                    >
                        {loading ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>{text}</Text>
                        )}
                    </LinearGradient>
                </TouchableOpacity>
            </Animated.View>
        );
    };

    return (
        <KeyboardAvoidingView 
            style={[styles.container, { backgroundColor: currentTheme.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar 
                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
                backgroundColor="transparent"
                translucent
            />

            {/* Background com gradiente */}
            <LinearGradient
                colors={isDarkMode ? ['#1a1a1a', '#2d2d2d'] : ['#f8f9fa', '#e9ecef']}
                style={styles.backgroundGradient}
            />

            <ScrollView 
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Logo e título */}
                <Animated.View
                    style={[
                        styles.headerContainer,
                        {
                            opacity: logoAnim,
                            transform: [
                                {
                                    translateY: logoAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [-50, 0],
                                    })
                                }
                            ]
                        }
                    ]}
                >
                    <View style={styles.logoContainer}>
                        <MaterialCommunityIcons
                            name="leaf"
                            size={60}
                            color="#4CAF50"
                        />
                    </View>
                    <Text style={[
                        styles.title,
                        { color: currentTheme.text }
                    ]}>
                        Leaf
                    </Text>
                    <Text style={[
                        styles.subtitle,
                        { color: currentTheme.textSecondary }
                    ]}>
                        Sua viagem, nossa responsabilidade
                    </Text>
                </Animated.View>

                {/* Card principal */}
                <Animated.View
                    style={[
                        styles.card,
                        {
                            backgroundColor: currentTheme.card,
                            opacity: fadeAnim,
                            transform: [
                                {
                                    translateY: slideAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [50, 0],
                                    })
                                }
                            ]
                        }
                    ]}
                >
                    <Text style={[
                        styles.cardTitle,
                        { color: currentTheme.text }
                    ]}>
                        {isExistingUser === null ? 'Informe seu celular' : 
                         isExistingUser ? 'Entrar na conta' : 'Criar nova conta'}
                    </Text>

                    {/* Campo de telefone */}
                    {renderInput(
                        '(99) 99999-9999',
                        phone,
                        setPhone,
                        {
                            keyboardType: 'phone-pad',
                            icon: 'phone'
                        }
                    )}

                    {/* Loading do telefone */}
                    {loading && isExistingUser === null && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="small" color="#4CAF50" />
                            <Text style={[
                                styles.loadingText,
                                { color: currentTheme.textSecondary }
                            ]}>
                                Verificando número...
                            </Text>
                        </View>
                    )}

                    {/* Campos de login */}
                    {isExistingUser === true && (
                        <>
                            {renderInput(
                                'Senha',
                                password,
                                setPassword,
                                {
                                    secureTextEntry: !showPassword,
                                    icon: 'lock'
                                }
                            )}
                            {renderButton('Entrar', handleLogin, loading)}
                        </>
                    )}

                    {/* Campos de cadastro */}
                    {isExistingUser === false && (
                        <>
                            {renderInput(
                                'Nome completo',
                                name,
                                setName,
                                {
                                    autoCapitalize: 'words',
                                    icon: 'account'
                                }
                            )}
                            {renderInput(
                                'CPF',
                                cpf,
                                setCpf,
                                {
                                    keyboardType: 'numeric',
                                    maxLength: 14,
                                    icon: 'card-account-details'
                                }
                            )}
                            {renderButton('Cadastrar', handleSignup, loading)}
                        </>
                    )}

                    {/* Botão de verificar telefone */}
                    {isExistingUser === null && phone.length >= 10 && !loading && (
                        <TouchableOpacity
                            style={styles.verifyButton}
                            onPress={checkPhone}
                        >
                            <Text style={styles.verifyButtonText}>
                                Verificar número
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Erro */}
                    {error && (
                        <Animated.View
                            style={[
                                styles.errorContainer,
                                {
                                    opacity: fadeAnim,
                                    transform: [
                                        {
                                            scale: fadeAnim.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [0.8, 1],
                                            })
                                        }
                                    ]
                                }
                            ]}
                        >
                            <MaterialCommunityIcons
                                name="alert-circle"
                                size={20}
                                color="#F44336"
                            />
                            <Text style={styles.errorText}>{error}</Text>
                        </Animated.View>
                    )}
                </Animated.View>

                {/* Footer */}
                <Animated.View
                    style={[
                        styles.footer,
                        {
                            opacity: fadeAnim,
                            transform: [
                                {
                                    translateY: fadeAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [30, 0],
                                    })
                                }
                            ]
                        }
                    ]}
                >
                    <Text style={[
                        styles.footerText,
                        { color: currentTheme.textSecondary }
                    ]}>
                        Ao continuar, você concorda com nossos
                    </Text>
                    <TouchableOpacity
                        onPress={() => {
                            // ✅ Navegar para tela Legal (acessível sem login)
                            if (navigation && navigation.navigate) {
                                navigation.navigate('Legal');
                            }
                        }}
                    >
                        <Text style={styles.footerLink}>
                            Termos de Uso e Política de Privacidade
                        </Text>
                    </TouchableOpacity>
                </Animated.View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    backgroundGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 40,
    },
    headerContainer: {
        alignItems: 'center',
        marginBottom: 40,
    },
    logoContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
        shadowColor: '#4CAF50',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
    },
    title: {
        fontSize: 32,
        fontFamily: fonts.Bold,
        marginBottom: 8,
        letterSpacing: 1,
    },
    subtitle: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        textAlign: 'center',
        opacity: 0.8,
    },
    card: {
        borderRadius: 24,
        padding: 32,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
    },
    cardTitle: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        marginBottom: 32,
        letterSpacing: 0.5,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 2,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 16,
        marginBottom: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    inputIcon: {
        marginRight: 12,
    },
    input: {
        flex: 1,
        fontSize: 16,
        fontFamily: fonts.Medium,
    },
    eyeIcon: {
        padding: 4,
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    loadingText: {
        marginLeft: 8,
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
    buttonContainer: {
        marginTop: 8,
    },
    button: {
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#4CAF50',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    buttonGradient: {
        paddingVertical: 16,
        alignItems: 'center',
    },
    buttonText: {
        color: '#fff',
        fontSize: 18,
        fontFamily: fonts.Bold,
        letterSpacing: 0.5,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    verifyButton: {
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 8,
    },
    verifyButtonText: {
        color: '#4CAF50',
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(244, 67, 54, 0.1)',
        borderRadius: 12,
        padding: 12,
        marginTop: 16,
    },
    errorText: {
        color: '#F44336',
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginLeft: 8,
        flex: 1,
    },
    footer: {
        alignItems: 'center',
        marginTop: 40,
    },
    footerText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlign: 'center',
        marginBottom: 4,
    },
    footerLink: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: '#4CAF50',
        textDecorationLine: 'underline',
    },
});

export default ModernLoginScreen; 