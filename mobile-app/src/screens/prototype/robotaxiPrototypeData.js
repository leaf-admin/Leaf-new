export const PROTOTYPE_REGION = {
  latitude: -22.9711,
  longitude: -43.1822,
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
    id: "v1",
    name: "Model 3",
    operationalType: "Leaf Plus",
    seats: 4,
    range: "358 mi",
    eta: "6 min",
    price: "$4.20",
  },
  {
    id: "v2",
    name: "Model Y",
    operationalType: "Leaf Plus",
    seats: 5,
    range: "330 mi",
    eta: "7 min",
    price: "$4.80",
  },
  {
    id: "v3",
    name: "Model S",
    operationalType: "Leaf Elite",
    seats: 4,
    range: "402 mi",
    eta: "9 min",
    price: "$5.60",
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
    normalized.includes("model s") ||
    normalized.includes("elite") ||
    normalized === "premium"
  ) {
    return "Leaf Elite";
  }

  return "Leaf Plus";
}
