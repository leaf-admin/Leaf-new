import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons, MaterialIcons, FontAwesome } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MENU_ITEMS = [
  {
    key: 'Home',
    icon: (color) => <Ionicons name="home" size={28} color={color} />,
    route: 'MapScreen',
  },
  {
    key: 'Rides',
    icon: (color) => <MaterialIcons name="directions-car" size={28} color={color} />,
    route: 'RideListScreen',
  },
  {
    key: 'Wallet',
    icon: (color) => <FontAwesome name="credit-card" size={26} color={color} />,
    route: 'WalletDetails',
  },
  {
    key: 'Settings',
    icon: (color) => <Ionicons name="settings" size={26} color={color} />,
    route: 'SettingsScreen',
  },
  {
    key: 'Profile',
    icon: (color) => <Ionicons name="person-circle" size={28} color={color} />,
    route: 'ProfileScreen',
  },
];

export default function BottomMenu({ visible = true }) {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>  
      <View style={styles.menuBox}>
        {MENU_ITEMS.map((item) => {
          const isActive = route.name === item.route;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.menuItem, isActive && styles.menuItemActive]}
              onPress={() => navigation.navigate(item.route)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={item.key}
            >
              {item.icon(isActive ? '#fff' : '#B0B0B0')}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    zIndex: 10000,
    pointerEvents: 'box-none',
  },
  menuBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(40,40,60,0.85)',
    borderRadius: 32,
    paddingHorizontal: 18,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 12,
    minWidth: 260,
    maxWidth: 380,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  menuItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 24,
  },
  menuItemActive: {
    backgroundColor: 'rgba(65,210,116,0.85)',
  },
}); 