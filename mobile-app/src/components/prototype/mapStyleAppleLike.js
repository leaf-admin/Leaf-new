const mapStyleAppleLike = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#f2f3ee' }]
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#697068' }]
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#f8faf5' }]
  },
  {
    elementType: 'labels.icon',
    stylers: [{ saturation: -72 }, { lightness: 18 }]
  },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9ca39a' }]
  },
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry.fill',
    stylers: [{ color: '#f3f4ef' }]
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry.fill',
    stylers: [{ color: '#edf1e8' }]
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#e8ede3' }]
  },
  {
    featureType: 'poi.business',
    stylers: [{ visibility: 'off' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry.fill',
    stylers: [{ color: '#d9e6d3' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#587154' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#fbfcf8' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.fill',
    stylers: [{ color: '#fbfcf8' }, { saturation: -100 }, { lightness: 28 }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#d8ded4' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }]
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#f8faf5' }]
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry.fill',
    stylers: [{ color: '#f8faf5' }, { saturation: -100 }, { lightness: 24 }]
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#d4dcd1' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#e4e7dc' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.fill',
    stylers: [{ color: '#e6e9de' }, { saturation: -100 }, { lightness: 22 }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#cbd3c7' }]
  },
  {
    featureType: 'road.highway.controlled_access',
    elementType: 'geometry.fill',
    stylers: [{ color: '#dce2d6' }, { saturation: -100 }, { lightness: 18 }]
  },
  {
    featureType: 'road.highway.controlled_access',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#c4cebf' }]
  },
  {
    featureType: 'road.local',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#7e857d' }]
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#dfe5dc' }]
  },
  {
    featureType: 'transit.station',
    stylers: [{ visibility: 'simplified' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#c8dbe3' }]
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#647f8b' }]
  }
];

export default mapStyleAppleLike;
