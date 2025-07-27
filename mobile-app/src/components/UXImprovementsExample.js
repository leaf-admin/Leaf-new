import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Alert
} from 'react-native';
import { useToast, ToastTypes } from './ToastNotification';
import { 
    LoadingSpinner, 
    CarSkeletonCard, 
    ProgressBar,
    ButtonLoadingState 
} from './LoadingStates';
import { 
    useResponsiveLayout, 
    ResponsiveGrid, 
    ResponsiveContainer,
    ResponsiveCard 
} from './ResponsiveLayout';
import { 
    ModernButton, 
    BookNowButton, 
    CancelButton,
    CallButton,
    ChatButton,
    ButtonVariants,
    ButtonSizes 
} from './ModernButton';

// Exemplo de como aplicar as melhorias de UX na tela do mapa
export const UXImprovementsExample = () => {
    const { toast, showSuccess, showError, showInfo, showWarning } = useToast();
    const { config, isTablet, isMobile } = useResponsiveLayout();
    
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [showSkeleton, setShowSkeleton] = useState(true);

    // Simular carregamento
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowSkeleton(false);
        }, 2000);

        return () => clearTimeout(timer);
    }, []);

    // Simular progresso
    useEffect(() => {
        if (loading) {
            const interval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 100) {
                        setLoading(false);
                        showSuccess('Corrida agendada com sucesso!');
                        return 0;
                    }
                    return prev + 10;
                });
            }, 200);

            return () => clearInterval(interval);
        }
    }, [loading]);

    const handleBookNow = () => {
        setLoading(true);
        setProgress(0);
        showInfo('Buscando motoristas próximos...');
    };

    const handleCancel = () => {
        showWarning('Tem certeza que deseja cancelar?');
        // Aqui você pode mostrar um modal de confirmação
    };

    const handleCall = () => {
        showSuccess('Ligando para o motorista...');
    };

    const handleChat = () => {
        showInfo('Abrindo chat...');
    };

    const handleError = () => {
        showError('Erro ao conectar. Verifique sua internet.');
    };

    return (
        <ResponsiveContainer>
            {/* Toast Notification */}
            <ToastNotification {...toast} />

            <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
                
                {/* Header com feedback visual */}
                <ResponsiveCard style={styles.headerCard}>
                    <Text style={[styles.title, { fontSize: config.fontSize.large }]}>
                        Melhorias de UX/UI
                    </Text>
                    <Text style={[styles.subtitle, { fontSize: config.fontSize.regular }]}>
                        Exemplos de feedback visual e responsividade
                    </Text>
                </ResponsiveCard>

                {/* Seção de Toast Notifications */}
                <ResponsiveCard style={styles.sectionCard}>
                    <Text style={[styles.sectionTitle, { fontSize: config.fontSize.medium }]}>
                        Toast Notifications
                    </Text>
                    <Text style={[styles.sectionDescription, { fontSize: config.fontSize.small }]}>
                        Feedback instantâneo para ações do usuário
                    </Text>
                    
                    <ResponsiveGrid columns={isTablet ? 2 : 1} gap={config.spacing.md}>
                        <ModernButton
                            title="Sucesso"
                            onPress={() => showSuccess('Operação realizada com sucesso!')}
                            variant={ButtonVariants.SUCCESS}
                            size={ButtonSizes.SMALL}
                        />
                        <ModernButton
                            title="Erro"
                            onPress={() => showError('Algo deu errado. Tente novamente.')}
                            variant={ButtonVariants.DANGER}
                            size={ButtonSizes.SMALL}
                        />
                        <ModernButton
                            title="Info"
                            onPress={() => showInfo('Informação importante para você.')}
                            variant={ButtonVariants.PRIMARY}
                            size={ButtonSizes.SMALL}
                        />
                        <ModernButton
                            title="Aviso"
                            onPress={() => showWarning('Atenção: verifique os dados.')}
                            variant={ButtonVariants.SECONDARY}
                            size={ButtonSizes.SMALL}
                        />
                    </ResponsiveGrid>
                </ResponsiveCard>

                {/* Seção de Loading States */}
                <ResponsiveCard style={styles.sectionCard}>
                    <Text style={[styles.sectionTitle, { fontSize: config.fontSize.medium }]}>
                        Estados de Loading
                    </Text>
                    
                    {/* Skeleton Loading */}
                    {showSkeleton ? (
                        <View style={styles.skeletonContainer}>
                            <Text style={[styles.skeletonTitle, { fontSize: config.fontSize.small }]}>
                                Carregando opções de carro...
                            </Text>
                            <CarSkeletonCard />
                            <CarSkeletonCard />
                            <CarSkeletonCard />
                        </View>
                    ) : (
                        <View style={styles.loadedContent}>
                            <Text style={[styles.loadedTitle, { fontSize: config.fontSize.small }]}>
                                Opções carregadas!
                            </Text>
                        </View>
                    )}

                    {/* Progress Bar */}
                    {loading && (
                        <View style={styles.progressContainer}>
                            <Text style={[styles.progressTitle, { fontSize: config.fontSize.small }]}>
                                Agendando corrida...
                            </Text>
                            <ProgressBar 
                                progress={progress} 
                                showPercentage 
                                style={styles.progressBar}
                            />
                        </View>
                    )}

                    {/* Loading Spinner */}
                    <View style={styles.spinnerContainer}>
                        <LoadingSpinner 
                            message="Carregando mapa..." 
                            size="small"
                        />
                    </View>
                </ResponsiveCard>

                {/* Seção de Botões Modernos */}
                <ResponsiveCard style={styles.sectionCard}>
                    <Text style={[styles.sectionTitle, { fontSize: config.fontSize.medium }]}>
                        Botões Modernos
                    </Text>
                    
                    {/* Botão principal de agendamento */}
                    <View style={styles.bookButtonContainer}>
                        <BookNowButton
                            onPress={handleBookNow}
                            loading={loading}
                            disabled={loading}
                            price="R$ 25,00"
                        />
                    </View>

                    {/* Botões de ação */}
                    <ResponsiveGrid columns={isTablet ? 3 : 2} gap={config.spacing.md}>
                        <CancelButton onPress={handleCancel} />
                        <CallButton onPress={handleCall} />
                        <ChatButton onPress={handleChat} />
                        <ModernButton
                            title="Teste Erro"
                            onPress={handleError}
                            variant={ButtonVariants.DANGER}
                            size={ButtonSizes.SMALL}
                        />
                    </ResponsiveGrid>
                </ResponsiveCard>

                {/* Seção de Responsividade */}
                <ResponsiveCard style={styles.sectionCard}>
                    <Text style={[styles.sectionTitle, { fontSize: config.fontSize.medium }]}>
                        Responsividade
                    </Text>
                    <Text style={[styles.deviceInfo, { fontSize: config.fontSize.small }]}>
                        Dispositivo: {isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop'}
                    </Text>
                    <Text style={[styles.deviceInfo, { fontSize: config.fontSize.small }]}>
                        Padding: {config.padding}px
                    </Text>
                    <Text style={[styles.deviceInfo, { fontSize: config.fontSize.small }]}>
                        Border Radius: {config.borderRadius}px
                    </Text>
                </ResponsiveCard>

                {/* Seção de Micro-interações */}
                <ResponsiveCard style={styles.sectionCard}>
                    <Text style={[styles.sectionTitle, { fontSize: config.fontSize.medium }]}>
                        Micro-interações
                    </Text>
                    <Text style={[styles.sectionDescription, { fontSize: config.fontSize.small }]}>
                        Toque nos botões para ver as animações
                    </Text>
                    
                    <ResponsiveGrid columns={isTablet ? 3 : 2} gap={config.spacing.md}>
                        <ModernButton
                            title="Ripple Effect"
                            variant={ButtonVariants.PRIMARY}
                            size={ButtonSizes.MEDIUM}
                            onPress={() => showInfo('Animações suaves!')}
                        />
                        <ModernButton
                            title="Haptic Feedback"
                            variant={ButtonVariants.OUTLINE}
                            size={ButtonSizes.MEDIUM}
                            onPress={() => showInfo('Vibração no iOS!')}
                        />
                        <ModernButton
                            title="Scale Animation"
                            variant={ButtonVariants.GHOST}
                            size={ButtonSizes.MEDIUM}
                            onPress={() => showInfo('Escala animada!')}
                        />
                    </ResponsiveGrid>
                </ResponsiveCard>
            </ScrollView>
        </ResponsiveContainer>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    headerCard: {
        marginBottom: 16,
        backgroundColor: '#FFFFFF',
    },
    title: {
        fontFamily: 'System',
        fontWeight: '700',
        color: '#1F2937',
        marginBottom: 8,
    },
    subtitle: {
        fontFamily: 'System',
        color: '#6B7280',
        lineHeight: 20,
    },
    sectionCard: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontFamily: 'System',
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 8,
    },
    sectionDescription: {
        fontFamily: 'System',
        color: '#6B7280',
        marginBottom: 16,
        lineHeight: 18,
    },
    skeletonContainer: {
        marginBottom: 16,
    },
    skeletonTitle: {
        fontFamily: 'System',
        color: '#6B7280',
        marginBottom: 12,
        textAlign: 'center',
    },
    loadedContent: {
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#F0FDF4',
        borderRadius: 8,
        marginBottom: 16,
    },
    loadedTitle: {
        fontFamily: 'System',
        color: '#059669',
        fontWeight: '600',
    },
    progressContainer: {
        marginBottom: 16,
    },
    progressTitle: {
        fontFamily: 'System',
        color: '#6B7280',
        marginBottom: 8,
        textAlign: 'center',
    },
    progressBar: {
        marginBottom: 8,
    },
    spinnerContainer: {
        alignItems: 'center',
        padding: 20,
    },
    bookButtonContainer: {
        marginBottom: 16,
    },
    deviceInfo: {
        fontFamily: 'System',
        color: '#6B7280',
        marginBottom: 4,
    },
});

// Exemplo de como integrar na tela do mapa
export const MapScreenUXImprovements = () => {
    const { toast, showSuccess, showError, showInfo } = useToast();
    const { config } = useResponsiveLayout();

    // Exemplo de como usar na tela do mapa
    const handleBookNowImproved = async () => {
        try {
            showInfo('Buscando motoristas próximos...');
            
            // Simular busca de motoristas
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            showSuccess('Motorista encontrado! Agendando corrida...');
            
            // Simular agendamento
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            showSuccess('Corrida agendada com sucesso!');
            
        } catch (error) {
            showError('Erro ao agendar corrida. Tente novamente.');
        }
    };

    const handleLocationError = () => {
        showError('Erro ao obter localização. Verifique as permissões.');
    };

    const handleNetworkError = () => {
        showError('Sem conexão com a internet. Verifique sua rede.');
    };

    return (
        <View style={{ flex: 1 }}>
            {/* Toast Notification */}
            <ToastNotification {...toast} />
            
            {/* Conteúdo da tela do mapa com melhorias */}
            <View style={styles.mapContainer}>
                {/* Aqui viria o conteúdo da tela do mapa */}
                <Text style={[styles.mapText, { fontSize: config.fontSize.medium }]}>
                    Tela do Mapa com Melhorias UX
                </Text>
                
                {/* Botões de exemplo */}
                <View style={styles.mapButtons}>
                    <ModernButton
                        title="Agendar Corrida"
                        onPress={handleBookNowImproved}
                        variant={ButtonVariants.PRIMARY}
                        size={ButtonSizes.LARGE}
                        fullWidth
                    />
                    
                    <ResponsiveGrid columns={2} gap={12}>
                        <ModernButton
                            title="Erro Localização"
                            onPress={handleLocationError}
                            variant={ButtonVariants.DANGER}
                            size={ButtonSizes.SMALL}
                        />
                        <ModernButton
                            title="Erro Rede"
                            onPress={handleNetworkError}
                            variant={ButtonVariants.SECONDARY}
                            size={ButtonSizes.SMALL}
                        />
                    </ResponsiveGrid>
                </View>
            </View>
        </View>
    );
};

const mapStyles = StyleSheet.create({
    mapContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#F9FAFB',
    },
    mapText: {
        fontFamily: 'System',
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 32,
        textAlign: 'center',
    },
    mapButtons: {
        width: '100%',
        gap: 16,
    },
}); 