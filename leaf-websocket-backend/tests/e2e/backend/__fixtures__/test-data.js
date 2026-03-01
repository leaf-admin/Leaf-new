/**
 * Test Data Fixtures
 * 
 * Dados de teste reutilizáveis para todos os testes E2E
 */

const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

module.exports = {
  // IDs de teste
  generateId,
  
  // Usuários de teste
  users: {
    customer: {
      uid: 'test_customer_001',
      userType: 'customer'
    },
    driver: {
      uid: 'test_driver_001',
      userType: 'driver'
    },
    driver2: {
      uid: 'test_driver_002',
      userType: 'driver'
    }
  },
  
  // Localizações de teste (São Paulo)
  locations: {
    pickup: {
      lat: -23.5505,
      lng: -46.6333,
      address: 'Av. Paulista, 1000 - São Paulo, SP'
    },
    destination: {
      lat: -23.5515,
      lng: -46.6343,
      address: 'Av. Brigadeiro Faria Lima, 2000 - São Paulo, SP'
    },
    // Localizações alternativas
    pickup2: {
      lat: -23.5605,
      lng: -46.6433,
      address: 'Rua Augusta, 500 - São Paulo, SP'
    },
    destination2: {
      lat: -23.5615,
      lng: -46.6443,
      address: 'Rua Oscar Freire, 1000 - São Paulo, SP'
    }
  },
  
  // Dados de booking
  booking: {
    createBookingData(pickup, destination, customerId) {
      const testData = require('./test-data');
      return {
        customerId: customerId || testData.users.customer.uid,
        pickupLocation: pickup || testData.locations.pickup,
        destinationLocation: destination || testData.locations.destination,
        estimatedFare: 25.50,
        paymentMethod: 'pix'
      };
    }
  },
  
  // Dados de pagamento
  payment: {
    createPaymentData(bookingId, amount = 25.50) {
      return {
        bookingId: bookingId || generateId('booking'),
        paymentMethod: 'pix',
        paymentId: generateId('payment'),
        amount: amount
      };
    }
  },
  
  // Dados de início de viagem
  trip: {
    createStartTripData(bookingId, startLocation) {
      const testData = require('./test-data');
      return {
        bookingId: bookingId || generateId('booking'),
        startLocation: startLocation || testData.locations.pickup
      };
    },
    
    createFinishTripData(bookingId, endLocation, distance = 5.5, fare = 25.50) {
      const testData = require('./test-data');
      return {
        bookingId: bookingId || generateId('booking'),
        endLocation: endLocation || testData.locations.destination,
        distance: distance,
        fare: fare
      };
    }
  },
  
  // Helpers
  helpers: {
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    async waitFor(condition, timeout = 10000, interval = 100) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await condition()) {
          return true;
        }
        await this.sleep(interval);
      }
      return false;
    }
  }
};

