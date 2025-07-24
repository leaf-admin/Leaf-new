import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ThemeSwitch({ value, onValueChange }) {
    return (
        <TouchableOpacity
            style={styles.themeSwitchTouchable}
            onPress={() => onValueChange(!value)}
            activeOpacity={0.8}
        >
            <View style={[styles.themeSwitchTrack, { backgroundColor: value ? '#222' : '#fff', borderColor: value ? '#444' : '#ddd' }]}> 
                {/* Sol (esquerda) */}
                <Ionicons name="sunny" size={18} color={value ? '#888' : '#FFD700'} style={{ marginLeft: 2, marginRight: 2 }} />
                {/* Slider bubble */}
                <View style={{
                    position: 'absolute',
                    left: value ? 38 : 6,
                    top: 6,
                    zIndex: 2,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: value ? '#111' : '#FFD700',
                    justifyContent: 'center',
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOpacity: 0.08,
                    shadowRadius: 2,
                    elevation: 2,
                    // Animação suave
                    transitionProperty: 'left',
                    transitionDuration: '200ms',
                    transitionTimingFunction: 'ease',
                }}>
                    <Ionicons 
                        name={value ? 'moon' : 'sunny'} 
                        size={16} 
                        color={value ? '#fff' : '#fff'} 
                    />
                </View>
                {/* Espaço para slider */}
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'transparent' }} />
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'transparent' }} />
                {/* Lua (direita) */}
                <Ionicons name="moon" size={18} color={value ? '#fff' : '#888'} style={{ marginLeft: 2, marginRight: 2 }} />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    themeSwitchTouchable: {
        width: 72,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    themeSwitchTrack: {
        width: 72,
        height: 40,
        borderRadius: 20,
        borderWidth: 1.5,
        flexDirection: 'row',
        alignItems: 'center',
        position: 'relative',
        justifyContent: 'space-between',
        paddingHorizontal: 6,
        backgroundColor: '#fff',
        borderColor: '#ddd',
    },
}); 