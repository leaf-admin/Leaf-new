import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '../../../services/httpClient';
import mapStyleAppleLike from '../../../components/prototype/mapStyleAppleLike';
import LeafLocationMarker from '../../../components/prototype/LeafLocationMarker';
import LeafStreetSearch from '../../../components/prototype/LeafStreetSearch';
import { nearestNodeIndex, streetDistances } from '../../../components/prototype/streetSearchGraph';
import { projectMapPoint } from '../home/projectMapPoint';
import leafTypography from '../../../components/prototype/LeafTypography';

// Laboratório da busca pelas ruas (dev): mesmo mapa da busca, malha real do backend e carros
// de exemplo em ruas a 300-1100 m. Serve para aprovar o visual e medir CPU antes de trocar a esfera.

const PICKUP = { latitude: -22.9468, longitude: -43.3577 };
const INITIAL_REGION = { ...PICKUP, latitudeDelta: 0.024, longitudeDelta: 0.024 };
const RADIUS_M = 1200;
const COLORS = ['black', 'white', 'silver', 'red', 'blue'];

function pickDemoCars(graph) {
  if (!graph?.nodes?.length) return [];
  const start = nearestNodeIndex(graph.nodes, [PICKUP.latitude, PICKUP.longitude]).index;
  const dist = streetDistances(graph, start);
  const candidates = [];
  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (dist[i] > 300 && dist[i] < 1100) candidates.push(i);
  }
  const step = Math.max(1, Math.floor(candidates.length / 5));
  return candidates.filter((_, k) => k % step === 0).slice(0, 5).map((i, k) => ({
    id: `demo-${k}`,
    latitude: graph.nodes[i][0],
    longitude: graph.nodes[i][1],
    heading: (k * 73) % 360,
    colorToken: COLORS[k % COLORS.length],
  }));
}

export default function LeafStreetSearchLab({ navigation }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [graph, setGraph] = useState(null);
  const [region, setRegion] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const [status, setStatus] = useState('Carregando ruas…');

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/api/map/street-graph', { params: { lat: PICKUP.latitude, lng: PICKUP.longitude, radius: RADIUS_M } })
      .then((response) => {
        const data = response?.data || response;
        if (cancelled) return;
        setGraph(data);
        setStatus(`${data?.edges?.length || 0} trechos de rua`);
      })
      .catch((error) => !cancelled && setStatus(`Sem malha: ${error?.message || 'erro'}`));
    return () => { cancelled = true; };
  }, []);

  const cars = useMemo(() => pickDemoCars(graph), [graph]);
  const pickupPoint = region ? projectMapPoint(region, PICKUP, width, height) : null;
  const replay = useCallback(() => setRunKey((k) => k + 1), []);

  return (
    <View style={styles.root}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        customMapStyle={mapStyleAppleLike}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        onRegionChangeComplete={setRegion}
      />
      {graph && region ? (
        <LeafStreetSearch
          key={runKey}
          graph={graph}
          pickup={PICKUP}
          cars={cars}
          region={region}
          width={width}
          height={height}
          maxDistanceM={RADIUS_M}
        />
      ) : null}
      {pickupPoint ? (
        <View pointerEvents="none" style={[styles.pickup, { left: pickupPoint.x - 12, top: pickupPoint.y - 12 }]}>
          <LeafLocationMarker />
        </View>
      ) : null}
      <View style={[styles.bar, { top: insets.top + 12 }]}>
        <Pressable style={styles.button} onPress={() => navigation.goBack()} testID="street-lab-back">
          <Text style={styles.buttonText}>Voltar</Text>
        </Pressable>
        <Text style={styles.status} testID="street-lab-status">{status}</Text>
        <Pressable style={styles.button} onPress={replay} testID="street-lab-replay">
          <Text style={styles.buttonText}>Repetir</Text>
        </Pressable>
      </View>
      <Text style={[styles.attribution, { bottom: insets.bottom + 8 }]}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6F2' },
  pickup: { position: 'absolute', width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  bar: {
    position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  button: {
    backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    shadowColor: '#0E1F12', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  buttonText: { ...leafTypography.semiBold, fontSize: 14, color: '#11210C' },
  status: { ...leafTypography.medium, fontSize: 12, color: 'rgba(17,33,12,0.7)' },
  attribution: { position: 'absolute', right: 10, fontSize: 10, color: 'rgba(17,33,12,0.55)' },
});
