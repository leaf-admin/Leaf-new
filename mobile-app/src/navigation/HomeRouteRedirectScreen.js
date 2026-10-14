import React, { useEffect } from 'react';
import { View } from 'react-native';

// "Map" is a legacy alias of the home. Rendering a second home there kept two
// live maps (and two ride runtimes' effects) in the stack. It now only forwards:
// back to the home already in the stack, or replaces itself with one.
export default function HomeRouteRedirectScreen({ navigation, route }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const routes = navigation.getState?.()?.routes || [];
      const existingHome = [...routes].reverse().find(item => item.name === 'RobotaxiPrototype');
      if (existingHome) {
        navigation.navigate({ name: existingHome.name, key: existingHome.key, params: route?.params });
        return;
      }
      navigation.replace('RobotaxiPrototype', route?.params);
    }, 0);

    return () => clearTimeout(timer);
  }, [navigation, route?.params]);

  return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
}
