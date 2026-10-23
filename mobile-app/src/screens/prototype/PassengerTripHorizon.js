import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import leafTypography from '../../components/prototype/LeafTypography';
import { LeafJourneyRoute, LeafTripProgressTrack, leafRideColors } from '../../components/prototype/LeafRideUI';

// Presentation only: timing, gross fare and progress remain owned by the trip screen.
export default function PassengerTripHorizon({
  arrivalLabel,
  etaLabel,
  distanceLabel,
  fareLabel,
  vehicleLabel,
  origin,
  destination,
  progress,
  progressKey,
  fieldTestIDs = {},
}) {
  const remainingDistance = distanceLabel && distanceLabel !== '--'
    ? `${distanceLabel} ${/^1\s/.test(distanceLabel) ? 'restante' : 'restantes'}`
    : '';
  const eta = etaLabel && etaLabel !== '--' ? etaLabel : '';

  return (
    <View testID="passenger-trip-horizon">
      <View style={styles.header}>
        <View style={styles.arrival}>
          <Text style={styles.eyebrow}>EM VIAGEM</Text>
          <Text style={styles.title} testID={fieldTestIDs.eta_final}>{arrivalLabel}</Text>
          {eta ? <Text style={styles.meta}>{eta} restantes</Text> : null}
        </View>
        <View style={styles.fare}>
          <Text style={styles.fareValue} testID={fieldTestIDs.fare}>{fareLabel}</Text>
          <Text style={styles.meta} testID={fieldTestIDs.vehicle_type}>{vehicleLabel}</Text>
        </View>
      </View>
      <View style={styles.progress} testID="passenger-trip-route-progress">
        <LeafTripProgressTrack
          variant="line"
          progress={progress}
          progressKey={progressKey}
          fillTestID={fieldTestIDs.route_progress}
        />
        <View style={styles.progressLabels}>
          <Text style={styles.progressCaption}>Viagem em andamento</Text>
          <Text style={styles.distance} testID={fieldTestIDs.distance_remaining}>{remainingDistance || 'Em rota'}</Text>
        </View>
      </View>
      <LeafJourneyRoute
        origin={origin}
        destination={destination}
        destinationTestID={fieldTestIDs.destination_address}
        testID="passenger-trip-route-details"
        dense
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 },
  arrival: { flexGrow: 1, flexBasis: 190, minWidth: 0 },
  eyebrow: { ...leafTypography.semiBold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7, color: leafRideColors.secondary },
  title: { ...leafTypography.semiBold, fontSize: 28, lineHeight: 33, letterSpacing: -0.8, marginTop: 5, color: leafRideColors.text },
  meta: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: leafRideColors.secondary, marginTop: 4 },
  fare: { flexShrink: 1, alignItems: 'flex-end', paddingTop: 2 },
  fareValue: { ...leafTypography.semiBold, fontSize: 15, lineHeight: 20, color: leafRideColors.text },
  progress: { marginVertical: 19 },
  progressLabels: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 9 },
  progressCaption: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: leafRideColors.secondary },
  distance: { ...leafTypography.semiBold, fontSize: 12, lineHeight: 17, color: leafRideColors.text },
});
