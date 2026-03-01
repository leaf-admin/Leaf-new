const { PubSub } = require('graphql-subscriptions');
const { withFilter } = require('graphql-subscriptions');
const { logStructured, logError } = require('../../utils/logger');
// Instância do PubSub para gerenciar subscriptions
const pubsub = new PubSub();

class SubscriptionResolver {
  constructor() {
    this.firebase = null;
    this.initializeFirebase();
  }

  async initializeFirebase() {
    // Firebase será inicializado quando necessário
    if (!this.firebase) {
      try {
        const { firebaseConfig } = require('../../firebase-config');

        this.firebase = await firebaseConfig.initializeFirebase();
      } catch (error) {
        logStructured('info', '⚠️ Firebase não disponível para subscriptions');
        this.firebase = null;
      }
    }
  }

  // ===== LOCATION SUBSCRIPTIONS =====
  driverLocationUpdate() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['DRIVER_LOCATION_UPDATE']),
        (payload, variables) => {
          return payload.driverLocationUpdate.bookingId === variables.bookingId;
        }
      )
    };
  }

  passengerLocationUpdate() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['PASSENGER_LOCATION_UPDATE']),
        (payload, variables) => {
          return payload.passengerLocationUpdate.bookingId === variables.bookingId;
        }
      )
    };
  }

  nearbyDriversUpdates() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['NEARBY_DRIVERS_UPDATE']),
        (payload, variables) => {
          // Verificar se a localização está dentro do raio
          const { location, radius } = variables;
          const driverLocation = payload.nearbyDriversUpdates.location;

          const distance = this.calculateDistance(
            location.latitude, location.longitude,
            driverLocation.latitude, driverLocation.longitude
          );

          return distance <= radius;
        }
      )
    };
  }

  // ===== BOOKING SUBSCRIPTIONS =====
  bookingStatusUpdate() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['BOOKING_STATUS_UPDATE']),
        (payload, variables) => {
          return payload.bookingStatusUpdate.bookingId === variables.bookingId;
        }
      )
    };
  }

  newBookingRequest() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['NEW_BOOKING_REQUEST']),
        (payload, variables) => {
          return payload.newBookingRequest.driverId === variables.driverId;
        }
      )
    };
  }

  bookingAccepted() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['BOOKING_ACCEPTED']),
        (payload, variables) => {
          return payload.bookingAccepted.passengerId === variables.passengerId;
        }
      )
    };
  }

  activeBookingUpdates() {
    return {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['ACTIVE_BOOKING_UPDATE']),
        (payload, variables) => {
          return payload.activeBookingUpdates.bookingId === variables.bookingId;
        }
      )
    };
  }

  // ===== UTILITY METHODS =====
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distância em km
    return d * 1000; // Converter para metros
  }

  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  // ===== PUBLISH METHODS =====
  publishDriverLocationUpdate(bookingId, driverId, location, estimatedArrival, distance) {
    pubsub.publish('DRIVER_LOCATION_UPDATE', {
      driverLocationUpdate: {
        driverId,
        location,
        timestamp: new Date().toISOString(),
        estimatedArrival,
        distance
      }
    });
  }

  publishPassengerLocationUpdate(bookingId, passengerId, location) {
    pubsub.publish('PASSENGER_LOCATION_UPDATE', {
      passengerLocationUpdate: {
        passengerId,
        location,
        timestamp: new Date().toISOString()
      }
    });
  }

  publishNearbyDriversUpdate(location, drivers) {
    pubsub.publish('NEARBY_DRIVERS_UPDATE', {
      nearbyDriversUpdates: {
        location,
        drivers,
        timestamp: new Date().toISOString()
      }
    });
  }

  publishBookingStatusUpdate(bookingId, status, driver, estimate, actualFare) {
    pubsub.publish('BOOKING_STATUS_UPDATE', {
      bookingStatusUpdate: {
        bookingId,
        status,
        timestamp: new Date().toISOString(),
        driver,
        estimate,
        actualFare
      }
    });
  }

  publishNewBookingRequest(driverId, bookingId, passenger, pickup, destination, estimate, distance) {
    pubsub.publish('NEW_BOOKING_REQUEST', {
      newBookingRequest: {
        bookingId,
        passenger,
        pickup,
        destination,
        estimate,
        distance,
        timestamp: new Date().toISOString()
      }
    });
  }

  publishBookingAccepted(passengerId, bookingId, driver, estimatedArrival, driverLocation) {
    pubsub.publish('BOOKING_ACCEPTED', {
      bookingAccepted: {
        bookingId,
        driver,
        estimatedArrival,
        driverLocation,
        timestamp: new Date().toISOString()
      }
    });
  }

  publishActiveBookingUpdate(bookingId, driverLocation, passengerLocation, estimatedArrival, distance) {
    pubsub.publish('ACTIVE_BOOKING_UPDATE', {
      activeBookingUpdates: {
        bookingId,
        driverLocation,
        passengerLocation,
        estimatedArrival,
        distance,
        timestamp: new Date().toISOString()
      }
    });
  }
}

module.exports = new SubscriptionResolver();
