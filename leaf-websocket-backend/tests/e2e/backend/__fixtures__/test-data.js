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
  
  // Localizações de teste (Rio de Janeiro - zona ativa de operação)
  locations: {
    pickup: {
      lat: -22.971964,
      lng: -43.182543,
      address: 'Copacabana Palace, Rio de Janeiro, RJ'
    },
    destination: {
      lat: -22.984843,
      lng: -43.221972,
      address: 'Leblon, Rio de Janeiro, RJ'
    },
    // Localizações alternativas
    pickup2: {
      lat: -22.975839,
      lng: -43.193312,
      address: 'Ipanema, Rio de Janeiro, RJ'
    },
    destination2: {
      lat: -22.949684,
      lng: -43.155401,
      address: 'Botafogo, Rio de Janeiro, RJ'
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
        paymentMethod: 'pix',
        carType: 'leafplus',
        selectedVehicle: 'leafplus'
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
