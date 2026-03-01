// graphql/schema/mutations/DriverMutations.js
// Mutations de Motoristas - Serão implementadas na Semana 2

module.exports = `
  # Criar motorista
  createDriver(input: DriverInput!): Driver
  
  # Atualizar motorista
  updateDriver(id: ID!, input: DriverUpdateInput!): Driver
  
  # Atualizar status do motorista
  updateDriverStatus(driverId: ID!, status: DriverStatus!): Driver
  
  # Atualizar localização do motorista
  updateDriverLocation(driverId: ID!, location: LocationInput!): Driver
  
  # Aceitar corrida
  acceptBooking(bookingId: ID!, driverId: ID!): Booking
`;




