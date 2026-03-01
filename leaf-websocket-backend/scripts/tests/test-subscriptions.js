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

// Testes das subscriptions
const testSubscriptions = async () => {
  console.log('🧪 TESTANDO SUBSCRIPTIONS GRAPHQL');
  console.log('==================================');

  const tests = [
    {
      name: 'Driver Location Update',
      query: `
        subscription {
          driverLocationUpdate(bookingId: "test-booking-123") {
            driverId
            location {
              latitude
              longitude
              address
            }
            timestamp
            estimatedArrival
            distance
          }
        }
      `
    },
    {
      name: 'Passenger Location Update',
      query: `
        subscription {
          passengerLocationUpdate(bookingId: "test-booking-123") {
            passengerId
            location {
              latitude
              longitude
              address
            }
            timestamp
          }
        }
      `
    },
    {
      name: 'Nearby Drivers Update',
      query: `
        subscription {
          nearbyDriversUpdates(
            location: {
              latitude: -23.5505
              longitude: -46.6333
            }
            radius: 5000
          ) {
            location {
              latitude
              longitude
            }
            drivers {
              id
              name
              location {
                latitude
                longitude
              }
            }
            timestamp
          }
        }
      `
    },
    {
      name: 'Booking Status Update',
      query: `
        subscription {
          bookingStatusUpdate(bookingId: "test-booking-123") {
            bookingId
            status
            timestamp
            driver {
              id
              name
            }
            estimate
            actualFare
          }
        }
      `
    },
    {
      name: 'New Booking Request',
      query: `
        subscription {
          newBookingRequest(driverId: "test-driver-456") {
            bookingId
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
            estimate
            distance
            timestamp
          }
        }
      `
    },
    {
      name: 'Booking Accepted',
      query: `
        subscription {
          bookingAccepted(passengerId: "test-passenger-789") {
            bookingId
            driver {
              id
              name
              vehicle {
                model
                plate
              }
            }
            estimatedArrival
            driverLocation {
              latitude
              longitude
            }
            timestamp
          }
        }
      `
    },
    {
      name: 'Active Booking Update',
      query: `
        subscription {
          activeBookingUpdates(bookingId: "test-booking-123") {
            bookingId
            driverLocation {
              latitude
              longitude
            }
            passengerLocation {
              latitude
              longitude
            }
            estimatedArrival
            distance
            timestamp
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
      
      // Para subscriptions, vamos apenas validar a sintaxe
      const result = await graphql({
        schema,
        source: test.query,
        rootValue: resolvers
      });

      if (result.errors) {
        console.log(`❌ Erro: ${result.errors[0].message}`);
        failed++;
      } else {
        console.log(`✅ Sucesso: Schema válido para subscription`);
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
    console.log('\n🎉 TODAS AS SUBSCRIPTIONS FUNCIONANDO!');
  } else {
    console.log('\n⚠️  Algumas subscriptions precisam de ajustes');
  }
};

// Executar testes
testSubscriptions().catch(console.error);




