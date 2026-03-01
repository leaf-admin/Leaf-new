// graphql/schema/types/Vehicle.js
// Tipo Vehicle para GraphQL - Veículos dos motoristas

module.exports = `
  type Vehicle {
    id: ID!
    model: String!
    brand: String!
    year: Int!
    color: String!
    plate: String!
    capacity: Int!
    vehicleType: VehicleType!
    isActive: Boolean!
    
    # Relacionamentos
    driver: Driver
    
    # Documentos do veículo
    documents: VehicleDocuments
  }

  enum VehicleType {
    SEDAN
    SUV
    HATCHBACK
    MOTORCYCLE
    VAN
  }

  type VehicleDocuments {
    registration: String
    insurance: String
    inspection: String
    driverLicense: String
    vehicleLicense: String
  }

  input VehicleInput {
    model: String!
    brand: String!
    year: Int!
    color: String!
    plate: String!
    capacity: Int!
    vehicleType: VehicleType!
  }

  input VehicleUpdateInput {
    model: String
    brand: String
    year: Int
    color: String
    plate: String
    capacity: Int
    vehicleType: VehicleType
    isActive: Boolean
  }
`;




