// "Leaf Ambient" dark map style — green-black base matching
// robotaxiPrototypeTokens.colorDark. Unused until dark mode surfaces
// adopt the scheme (issue #203 phase 2).
const mapStyleAmbientDark = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#101609' }]
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#b8b2a8' }]
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#0e1409' }]
  },
  {
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }]
  },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5a614e' }]
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry.fill',
    stylers: [{ color: '#121a0a' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry.fill',
    stylers: [{ color: '#16220e' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4a6136' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.fill',
    stylers: [{ color: '#1c2412' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#252e1b' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.fill',
    stylers: [{ color: '#24301b' }]
  },
  {
    featureType: 'transit.line',
    elementType: 'geometry.fill',
    stylers: [{ color: '#24301b' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry.fill',
    stylers: [{ color: '#0a130f' }]
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4a6136' }]
  }
];

export default mapStyleAmbientDark;
