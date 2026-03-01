const { graphql } = require('graphql');
const { makeExecutableSchema } = require('@graphql-tools/schema');

// Importar schema e resolvers
const { typeDefs } = require('./graphql/schema');
const resolvers = require('./graphql/resolvers');

// Criar schema executável
const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

// Testes das mutations
const testMutations = async () => {
  console.log('🧪 TESTANDO MUTATIONS GRAPHQL');
  console.log('============================');

  const tests = [
    {
      name: 'Criar Usuário',
      query: `
        mutation {
          createUser(input: {
            name: "João Silva"
            email: "joao@email.com"
            phone: "+5511999999999"
            userType: CUSTOMER
          }) {
            success
            user {
              id
              name
              email
              phone
              userType
            }
            message
          }
        }
      `
    },
    {
      name: 'Criar Motorista',
      query: `
        mutation {
          createDriver(input: {
            name: "Maria Santos"
            email: "maria@email.com"
            phone: "+5511888888888"
            licenseNumber: "123456789"
            vehicle: {
              model: "Honda Civic"
              brand: "Honda"
              year: 2020
              plate: "ABC-1234"
              color: "Branco"
              capacity: 4
              vehicleType: SEDAN
            }
          }) {
            success
            driver {
              id
              name
              email
              phone
              licenseNumber
              vehicle {
                model
                brand
                year
                plate
                color
                vehicleType
              }
            }
            message
          }
        }
      `
    },
    {
      name: 'Criar Corrida',
      query: `
        mutation {
          createBooking(input: {
            passengerId: "test-passenger-id"
            pickup: {
              latitude: -23.5505
              longitude: -46.6333
              address: "Av. Paulista, 1000"
            }
            destination: {
              latitude: -23.5615
              longitude: -46.6565
              address: "Shopping Iguatemi"
            }
            estimatedFare: 25.50
            notes: "Corrida de teste"
          }) {
            success
            booking {
              id
              passenger {
                id
                name
              }
              pickup {
                latitude
                longitude
                address
              }
              destination {
                latitude
                longitude
                address
              }
              fare
              status
            }
            message
          }
        }
      `
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`\n📊 Testando: ${test.name}`);
      
      const result = await graphql({
        schema,
        source: test.query,
        rootValue: resolvers
      });

      if (result.errors) {
        console.log(`❌ Erro: ${result.errors[0].message}`);
        failed++;
      } else {
        console.log(`✅ Sucesso: ${JSON.stringify(result.data, null, 2)}`);
        passed++;
      }
    } catch (error) {
      console.log(`❌ Erro: ${error.message}`);
      failed++;
    }
  }

  console.log('\n📊 RESULTADO DOS TESTES');
  console.log('========================');
  console.log(`✅ Passou: ${passed}`);
  console.log(`❌ Falhou: ${failed}`);
  console.log(`📈 Taxa de sucesso: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (passed === tests.length) {
    console.log('\n🎉 TODAS AS MUTATIONS FUNCIONANDO!');
  } else {
    console.log('\n⚠️  Algumas mutations precisam de ajustes');
  }
};

// Executar testes
testMutations().catch(console.error);
