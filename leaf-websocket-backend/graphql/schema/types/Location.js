// graphql/schema/types/Location.js
// Tipo Location para GraphQL - Localizações e coordenadas

module.exports = `
  type Location {
    latitude: Float!
    longitude: Float!
    address: String
    city: String
    state: String
    country: String
    postalCode: String
    accuracy: Float
    timestamp: Date
  }

  input LocationInput {
    latitude: Float!
    longitude: Float!
    address: String
    city: String
    state: String
    country: String
    postalCode: String
  }

  type Route {
    id: ID!
    pickup: Location!
    destination: Location!
    distance: Float!
    duration: Int!
    polyline: String
    waypoints: [Location!]
    trafficInfo: TrafficInfo
  }

  type TrafficInfo {
    isHeavyTraffic: Boolean!
    estimatedDelay: Int
    alternativeRoutes: [Route!]
  }
`;




