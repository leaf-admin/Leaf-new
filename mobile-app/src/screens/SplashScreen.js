import React, { useEffect, useRef } from 'react';
import { View, Image, StyleSheet, StatusBar, Animated } from 'react-native';

export default function SplashScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(() => {
        navigation.replace('WelcomeScreen');
      });
    }, 4400); // 4400ms visível + 600ms fade out = 5000ms total
    return () => clearTimeout(timer);
  }, [navigation, fadeAnim]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}> 
      <StatusBar backgroundColor="#1A330E" barStyle="light-content" />
      <View style={styles.logoWrapper}>
        <Image
          source={require('../../assets/images/fg2.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A330E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
  },
  logo: {
    width: 215,
    height: 215,
    alignSelf: 'center',
    marginTop: 0,
  },
}); 