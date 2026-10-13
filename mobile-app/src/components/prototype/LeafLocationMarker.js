import React from 'react';
import { StyleSheet, View } from 'react-native';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

export const LEAF_LOCATION_MARKER_SIZE = 32;

const LeafLocationMarker = React.memo(function LeafLocationMarker({
  testID = 'leaf-location-marker',
}) {
  return (
    <View pointerEvents="none" collapsable={false} style={styles.halo} testID={testID}>
      <View style={styles.rim}>
        <View style={styles.dot} testID={`${testID}-dot`} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  halo: {
    width: LEAF_LOCATION_MARKER_SIZE,
    height: LEAF_LOCATION_MARKER_SIZE,
    borderRadius: LEAF_LOCATION_MARKER_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,122,255,0.13)',
  },
  rim: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#172B4D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 2,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: robotaxiPrototypeTokens.color.feedback.indicator,
  },
});

export default LeafLocationMarker;
