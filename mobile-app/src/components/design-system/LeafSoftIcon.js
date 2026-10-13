import React from 'react';
import { Image } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useLeafIconMotion } from './LeafLineIcon';

// Soft 3D set: the Leaf clay objects with the dark extrusion lifted, so they
// keep the brand's personality without dominating the map. Selected state is
// the same object in Leaf green.
const ICONS = {
  home: [require('../../../assets/leaf-ui/leafSoftHome.png'), require('../../../assets/leaf-ui/leafSoftHomeActive.png')],
  activity: [require('../../../assets/leaf-ui/leafSoftActivity.png'), require('../../../assets/leaf-ui/leafSoftActivityActive.png')],
  account: [require('../../../assets/leaf-ui/leafSoftAccount.png'), require('../../../assets/leaf-ui/leafSoftAccountActive.png')],
  bell: [require('../../../assets/leaf-ui/leafSoftNotifications.png'), require('../../../assets/leaf-ui/leafSoftNotificationsActive.png')],
  locate: [require('../../../assets/leaf-ui/leafSoftLocate.png'), require('../../../assets/leaf-ui/leafSoftLocateActive.png')],
};

export default function LeafSoftIcon({ name, size = 28, active = false, signal = 0 }) {
  const animatedStyle = useLeafIconMotion(name, signal);
  const pair = ICONS[name] || ICONS.home;
  return (
    <Reanimated.View style={[{ width: size, height: size }, name === 'bell' && { transformOrigin: 'top' }, animatedStyle]}>
      <Image source={pair[active ? 1 : 0]} style={{ width: size, height: size }} resizeMode="contain" />
    </Reanimated.View>
  );
}
