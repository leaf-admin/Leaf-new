import React from 'react';
import { Dimensions, Platform, View } from 'react-native';

const { width, height } = Dimensions.get('window');

// Breakpoints para diferentes tamanhos de tela
export const BREAKPOINTS = {
    MOBILE: 768,
    TABLET: 1024,
    DESKTOP: 1200,
};

// Detectar o tipo de dispositivo
export const getDeviceType = () => {
    const screenWidth = Math.min(width, height);
    
    if (screenWidth < BREAKPOINTS.MOBILE) {
        return 'mobile';
    } else if (screenWidth < BREAKPOINTS.TABLET) {
        return 'tablet';
    } else {
        return 'desktop';
    }
};

// Detectar se é tablet
export const isTablet = () => {
    return getDeviceType() === 'tablet';
};

// Detectar se é mobile
export const isMobile = () => {
    return getDeviceType() === 'mobile';
};

// Hook para usar layout responsivo
export const useResponsiveLayout = () => {
    const deviceType = getDeviceType();
    
    const isTabletDevice = deviceType === 'tablet';
    const isMobileDevice = deviceType === 'mobile';
    const isDesktopDevice = deviceType === 'desktop';
    
    // Configurações de layout baseadas no dispositivo
    const layoutConfig = {
        mobile: {
            padding: 16,
            cardPadding: 12,
            borderRadius: 12,
            fontSize: {
                small: 12,
                regular: 14,
                medium: 16,
                large: 18,
                xlarge: 20,
            },
            spacing: {
                xs: 4,
                sm: 8,
                md: 12,
                lg: 16,
                xl: 20,
                xxl: 24,
            },
            grid: {
                columns: 1,
                gap: 12,
            },
        },
        tablet: {
            padding: 24,
            cardPadding: 16,
            borderRadius: 16,
            fontSize: {
                small: 14,
                regular: 16,
                medium: 18,
                large: 20,
                xlarge: 24,
            },
            spacing: {
                xs: 6,
                sm: 12,
                md: 16,
                lg: 20,
                xl: 24,
                xxl: 32,
            },
            grid: {
                columns: 2,
                gap: 16,
            },
        },
        desktop: {
            padding: 32,
            cardPadding: 20,
            borderRadius: 20,
            fontSize: {
                small: 16,
                regular: 18,
                medium: 20,
                large: 24,
                xlarge: 28,
            },
            spacing: {
                xs: 8,
                sm: 16,
                md: 20,
                lg: 24,
                xl: 32,
                xxl: 40,
            },
            grid: {
                columns: 3,
                gap: 20,
            },
        },
    };
    
    const currentConfig = layoutConfig[deviceType];
    
    return {
        deviceType,
        isTablet: isTabletDevice,
        isMobile: isMobileDevice,
        isDesktop: isDesktopDevice,
        config: currentConfig,
        width,
        height,
    };
};

// Componente de Grid responsivo
export const ResponsiveGrid = ({ 
    children, 
    columns = null, 
    gap = null, 
    style,
    ...props 
}) => {
    const { config } = useResponsiveLayout();
    
    const gridColumns = columns || config.grid.columns;
    const gridGap = gap || config.grid.gap;
    
    const gridStyle = {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -gridGap / 2,
        ...style,
    };
    
    const itemStyle = {
        width: `${100 / gridColumns}%`,
        paddingHorizontal: gridGap / 2,
        marginBottom: gridGap,
    };
    
    return (
        <View style={gridStyle} {...props}>
            {React.Children.map(children, (child, index) => (
                <View key={index} style={itemStyle}>
                    {child}
                </View>
            ))}
        </View>
    );
};

// Componente de Container responsivo
export const ResponsiveContainer = ({ 
    children, 
    padding = null, 
    maxWidth = null,
    style,
    ...props 
}) => {
    const { config, isTablet, isDesktop } = useResponsiveLayout();
    
    const containerPadding = padding || config.padding;
    const containerMaxWidth = maxWidth || (isDesktop ? 1200 : '100%');
    
    const containerStyle = {
        paddingHorizontal: containerPadding,
        maxWidth: containerMaxWidth,
        alignSelf: 'center',
        width: '100%',
        ...style,
    };
    
    return (
        <View style={containerStyle} {...props}>
            {children}
        </View>
    );
};

// Componente de Card responsivo
export const ResponsiveCard = ({ 
    children, 
    padding = null, 
    borderRadius = null,
    style,
    ...props 
}) => {
    const { config } = useResponsiveLayout();
    
    const cardPadding = padding || config.cardPadding;
    const cardBorderRadius = borderRadius || config.borderRadius;
    
    const cardStyle = {
        padding: cardPadding,
        borderRadius: cardBorderRadius,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        ...style,
    };
    
    return (
        <View style={cardStyle} {...props}>
            {children}
        </View>
    );
};

// Hook para dimensões responsivas
export const useResponsiveDimensions = () => {
    const [dimensions, setDimensions] = React.useState({ width, height });
    
    React.useEffect(() => {
        const subscription = Dimensions.addEventListener('change', ({ window }) => {
            setDimensions({ width: window.width, height: window.height });
        });
        
        return () => subscription?.remove();
    }, []);
    
    return dimensions;
};

// Utilitários para responsividade
export const responsiveValue = (mobileValue, tabletValue, desktopValue) => {
    const deviceType = getDeviceType();
    
    switch (deviceType) {
        case 'mobile':
            return mobileValue;
        case 'tablet':
            return tabletValue;
        case 'desktop':
            return desktopValue;
        default:
            return mobileValue;
    }
};

export const responsiveFontSize = (mobileSize, tabletSize, desktopSize) => {
    return responsiveValue(mobileSize, tabletSize, desktopSize);
};

export const responsiveSpacing = (mobileSpacing, tabletSpacing, desktopSpacing) => {
    return responsiveValue(mobileSpacing, tabletSpacing, desktopSpacing);
};

// Configurações específicas para o app LEAF
export const LEAF_LAYOUT_CONFIG = {
    // Configurações de mapa
    map: {
        mobile: {
            height: height * 0.6,
            zoomLevel: 15,
            padding: 16,
        },
        tablet: {
            height: height * 0.7,
            zoomLevel: 14,
            padding: 24,
        },
        desktop: {
            height: height * 0.8,
            zoomLevel: 13,
            padding: 32,
        },
    },
    
    // Configurações de cards de carro
    carCards: {
        mobile: {
            columns: 1,
            gap: 12,
            cardHeight: 80,
        },
        tablet: {
            columns: 2,
            gap: 16,
            cardHeight: 100,
        },
        desktop: {
            columns: 3,
            gap: 20,
            cardHeight: 120,
        },
    },
    
    // Configurações de botões
    buttons: {
        mobile: {
            height: 48,
            fontSize: 16,
            padding: 16,
        },
        tablet: {
            height: 56,
            fontSize: 18,
            padding: 20,
        },
        desktop: {
            height: 64,
            fontSize: 20,
            padding: 24,
        },
    },
    
    // Configurações de header
    header: {
        mobile: {
            height: 60,
            fontSize: 18,
            padding: 16,
        },
        tablet: {
            height: 80,
            fontSize: 20,
            padding: 24,
        },
        desktop: {
            height: 100,
            fontSize: 24,
            padding: 32,
        },
    },
};

// Hook para configurações específicas do LEAF
export const useLeafLayout = (section) => {
    const { deviceType } = useResponsiveLayout();
    return LEAF_LAYOUT_CONFIG[section]?.[deviceType] || LEAF_LAYOUT_CONFIG[section]?.mobile;
}; 