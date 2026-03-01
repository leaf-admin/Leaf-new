// graphql/schema/subscriptions/LocationSubscriptions.js
// Subscriptions de Localização - Serão implementadas na Semana 3

module.exports = `
  # Atualizações de localização do motorista
  driverLocationUpdates(driverId: ID!): Location
  
  # Atualizações de localização do passageiro
  passengerLocationUpdates(passengerId: ID!): Location
  
  # Motoristas próximos em tempo real
  nearbyDriversUpdates(location: LocationInput!, radius: Float!): [Driver!]!
`;




