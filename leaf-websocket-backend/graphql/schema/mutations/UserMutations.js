// graphql/schema/mutations/UserMutations.js
// Mutations de Usuários - Serão implementadas na Semana 2

module.exports = `
  # Criar usuário
  createUser(input: UserInput!): User
  
  # Atualizar usuário
  updateUser(id: ID!, input: UserUpdateInput!): User
  
  # Deletar usuário
  deleteUser(id: ID!): Response
  
  # Atualizar localização do usuário
  updateUserLocation(userId: ID!, location: LocationInput!): User
`;




