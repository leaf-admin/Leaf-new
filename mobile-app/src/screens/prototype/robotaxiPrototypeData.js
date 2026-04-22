export const PROTOTYPE_REGION = {
  latitude: 37.7749,
  longitude: -122.4194,
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
    name: "Leaf Office",
    address: "2115 S Lamar Blvd",
    eta: "4 min",
    coordinate: { latitude: 37.7798, longitude: -122.4116 },
  },
  {
    id: "h2",
    name: "Nomade",
    address: "1506 S 1st St",
    eta: "6 min",
    coordinate: { latitude: 37.7682, longitude: -122.4294 },
  },
  {
    id: "h3",
    name: "Stanford Shopping Center",
    address: "660 Stanford Shopping Center",
    eta: "12 min",
    coordinate: { latitude: 37.765, longitude: -122.4314 },
  },
  {
    id: "h4",
    name: "Loro Asian Smokehouse",
    address: "2115 S Lamar Blvd",
    eta: "9 min",
    coordinate: { latitude: 37.7834, longitude: -122.4247 },
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
