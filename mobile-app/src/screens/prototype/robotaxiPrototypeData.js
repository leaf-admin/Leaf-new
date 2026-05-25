export const PROTOTYPE_REGION = {
  latitude: -22.984843,
  longitude: -43.221972,
  latitudeDelta: 0.018,
  longitudeDelta: 0.018,
};

export const PROTOTYPE_ORIGIN_COORDINATE = {
  latitude: PROTOTYPE_REGION.latitude,
  longitude: PROTOTYPE_REGION.longitude,
};

export const DESTINATION_HISTORY = [
  {
    id: "h1",
    name: "Copacabana Palace",
    address: "Av. Atlantica, 1702 - Copacabana",
    eta: "4 min",
    coordinate: { latitude: -22.96722, longitude: -43.17874 },
  },
  {
    id: "h2",
    name: "Rio Sul",
    address: "Rua Lauro Muller, 116 - Botafogo",
    eta: "6 min",
    coordinate: { latitude: -22.95706, longitude: -43.17695 },
  },
  {
    id: "h3",
    name: "Barra Shopping",
    address: "Av. das Americas, 4666 - Barra da Tijuca",
    eta: "12 min",
    coordinate: { latitude: -22.99932, longitude: -43.35988 },
  },
  {
    id: "h4",
    name: "Jardim Botanico",
    address: "Rua Jardim Botanico, 1008",
    eta: "9 min",
    coordinate: { latitude: -22.9674, longitude: -43.2239 },
  },
];

export const VEHICLE_OPTIONS = [
  {
    id: "plus",
    name: "Leaf Plus",
    operationalType: "Leaf Plus",
    seats: 4,
    description: "Confortavel e acessivel",
    range: "Sedan ou hatch",
    eta: "4 min",
    pickupDistance: "1,2 km",
    arrival: "14h32",
    cancellationWindow: "3 min",
    price: "R$ 24,90",
    fare: 24.9,
  },
  {
    id: "elite",
    name: "Leaf Elite",
    operationalType: "Leaf Elite",
    seats: 5,
    description: "Mais conforto para sua viagem",
    range: "Carros selecionados",
    eta: "6 min",
    pickupDistance: "1,6 km",
    arrival: "14h34",
    cancellationWindow: "3 min",
    price: "R$ 31,90",
    fare: 31.9,
  },
  {
    id: "moto",
    name: "Leaf Moto",
    operationalType: "Leaf Moto",
    seats: 1,
    description: "Mais rapido para ir sozinho",
    range: "Viagem individual",
    eta: "3 min",
    pickupDistance: "900 m",
    arrival: "14h30",
    cancellationWindow: "2 min",
    price: "R$ 18,90",
    fare: 18.9,
  },
];

export function resolveOperationalVehicleType(vehicleName) {
  const normalized = String(vehicleName || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "Leaf Plus";
  }

  const matched = VEHICLE_OPTIONS.find(
    (item) => item.name.toLowerCase() === normalized,
  );
  if (matched?.operationalType) {
    return matched.operationalType;
  }

  if (
    normalized.includes("elite") ||
    normalized === "premium"
  ) {
    return "Leaf Elite";
  }

  if (
    normalized.includes("moto") ||
    normalized.includes("bike")
  ) {
    return "Leaf Moto";
  }

  return "Leaf Plus";
}
