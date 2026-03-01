const { advancedCache } = require('../../utils/advanced-cache');
const { logStructured, logError } = require('../../utils/logger');
class MutationResolver {
  constructor() {
    this.firebase = null;
  }

  async initializeFirebase() {
    // Firebase será inicializado quando necessário
    if (!this.firebase) {
      try {
        const { firebaseConfig } = require('../../firebase-config');

        this.firebase = await firebaseConfig.initializeFirebase();
      } catch (error) {
        logStructured('info', '⚠️ Firebase não disponível, usando dados mock');
        this.firebase = null;
      }
    }
  }

  // ===== USER MUTATIONS =====
  async createUser(_, { input }) {
    try {
      logStructured('info', '📊 Criando usuário:', input);

      await this.initializeFirebase();

      const userData = {
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'ACTIVE',
        rating: 5.0,
        totalRides: 0
      };

      if (!this.firebase) {
        // Usar dados mock se Firebase não estiver disponível
        const mockUser = {
          id: `mock-${Date.now()}`,
          ...userData
        };
        return {
          success: true,
          message: 'Usuário criado com sucesso (modo mock)',
          user: mockUser
        };
      }

      const userRef = this.firebase.collection('users').doc();
      await userRef.set(userData);

      const user = { id: userRef.id, ...userData };

      // Invalidar cache
      await advancedCache.invalidate('users');

      logStructured('info', '✅ Usuário criado:', user.id);

      return {
        success: true,
        user,
        message: 'Usuário criado com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao criar usuário:', { service: 'MutationResolver' });
      return {
        success: false,
        user: null,
        message: `Erro ao criar usuário: ${error.message}`
      };
    }
  }

  async updateUser(_, { id, input }) {
    try {
      logStructured('info', '📊 Atualizando usuário:', id, input);

      await this.initializeFirebase();

      const updateData = {
        ...input,
        updatedAt: new Date().toISOString()
      };

      const userRef = this.firebase.collection('users').doc(id);
      await userRef.update(updateData);

      const userDoc = await userRef.get();
      const user = { id: userDoc.id, ...userDoc.data() };

      // Invalidar cache
      await advancedCache.invalidate('users');

      logStructured('info', '✅ Usuário atualizado:', id);

      return {
        success: true,
        user,
        message: 'Usuário atualizado com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao atualizar usuário:', { service: 'MutationResolver' });
      return {
        success: false,
        user: null,
        message: `Erro ao atualizar usuário: ${error.message}`
      };
    }
  }

  async deleteUser(_, { id }) {
    try {
      logStructured('info', '📊 Deletando usuário:', id);

      await this.initializeFirebase();

      const userRef = this.firebase.collection('users').doc(id);
      await userRef.delete();

      // Invalidar cache
      await advancedCache.invalidate('users');

      logStructured('info', '✅ Usuário deletado:', id);

      return {
        success: true,
        message: 'Usuário deletado com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao deletar usuário:', { service: 'MutationResolver' });
      return {
        success: false,
        message: `Erro ao deletar usuário: ${error.message}`
      };
    }
  }

  // ===== DRIVER MUTATIONS =====
  async createDriver(_, { input }) {
    try {
      logStructured('info', '📊 Criando motorista:', input);

      await this.initializeFirebase();

      const driverData = {
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'AVAILABLE',
        rating: 5.0,
        totalRides: 0,
        location: {
          latitude: 0,
          longitude: 0,
          address: 'Não definido'
        }
      };

      const driverRef = this.firebase.collection('drivers').doc();
      await driverRef.set(driverData);

      const driver = { id: driverRef.id, ...driverData };

      // Invalidar cache
      await advancedCache.invalidate('drivers');

      logStructured('info', '✅ Motorista criado:', driver.id);

      return {
        success: true,
        driver,
        message: 'Motorista criado com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao criar motorista:', { service: 'MutationResolver' });
      return {
        success: false,
        driver: null,
        message: `Erro ao criar motorista: ${error.message}`
      };
    }
  }

  async updateDriver(_, { id, input }) {
    try {
      logStructured('info', '📊 Atualizando motorista:', id, input);

      await this.initializeFirebase();

      const updateData = {
        ...input,
        updatedAt: new Date().toISOString()
      };

      const driverRef = this.firebase.collection('drivers').doc(id);
      await driverRef.update(updateData);

      const driverDoc = await driverRef.get();
      const driver = { id: driverDoc.id, ...driverDoc.data() };

      // Invalidar cache
      await advancedCache.invalidate('drivers');

      logStructured('info', '✅ Motorista atualizado:', id);

      return {
        success: true,
        driver,
        message: 'Motorista atualizado com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao atualizar motorista:', { service: 'MutationResolver' });
      return {
        success: false,
        driver: null,
        message: `Erro ao atualizar motorista: ${error.message}`
      };
    }
  }

  async deleteDriver(_, { id }) {
    try {
      logStructured('info', '📊 Deletando motorista:', id);

      await this.initializeFirebase();

      const driverRef = this.firebase.collection('drivers').doc(id);
      await driverRef.delete();

      // Invalidar cache
      await advancedCache.invalidate('drivers');

      logStructured('info', '✅ Motorista deletado:', id);

      return {
        success: true,
        message: 'Motorista deletado com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao deletar motorista:', { service: 'MutationResolver' });
      return {
        success: false,
        message: `Erro ao deletar motorista: ${error.message}`
      };
    }
  }

  // ===== BOOKING MUTATIONS =====
  async createBooking(_, { input }) {
    try {
      logStructured('info', '📊 Criando corrida:', input);

      await this.initializeFirebase();

      const bookingData = {
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'PENDING',
        driverId: null,
        actualFare: null,
        startTime: null,
        endTime: null
      };

      const bookingRef = this.firebase.collection('bookings').doc();
      await bookingRef.set(bookingData);

      const booking = { id: bookingRef.id, ...bookingData };

      // Invalidar cache
      await advancedCache.invalidate('bookings');

      logStructured('info', '✅ Corrida criada:', booking.id);

      return {
        success: true,
        booking,
        message: 'Corrida criada com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao criar corrida:', { service: 'MutationResolver' });
      return {
        success: false,
        booking: null,
        message: `Erro ao criar corrida: ${error.message}`
      };
    }
  }

  async updateBooking(_, { id, input }) {
    try {
      logStructured('info', '📊 Atualizando corrida:', id, input);

      await this.initializeFirebase();

      const updateData = {
        ...input,
        updatedAt: new Date().toISOString()
      };

      const bookingRef = this.firebase.collection('bookings').doc(id);
      await bookingRef.update(updateData);

      const bookingDoc = await bookingRef.get();
      const booking = { id: bookingDoc.id, ...bookingDoc.data() };

      // Invalidar cache
      await advancedCache.invalidate('bookings');

      logStructured('info', '✅ Corrida atualizada:', id);

      return {
        success: true,
        booking,
        message: 'Corrida atualizada com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao atualizar corrida:', { service: 'MutationResolver' });
      return {
        success: false,
        booking: null,
        message: `Erro ao atualizar corrida: ${error.message}`
      };
    }
  }

  async deleteBooking(_, { id }) {
    try {
      logStructured('info', '📊 Deletando corrida:', id);

      await this.initializeFirebase();

      const bookingRef = this.firebase.collection('bookings').doc(id);
      await bookingRef.delete();

      // Invalidar cache
      await advancedCache.invalidate('bookings');

      logStructured('info', '✅ Corrida deletada:', id);

      return {
        success: true,
        message: 'Corrida deletada com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao deletar corrida:', { service: 'MutationResolver' });
      return {
        success: false,
        message: `Erro ao deletar corrida: ${error.message}`
      };
    }
  }

  // ===== SPECIAL ACTIONS =====
  async acceptBooking(_, { bookingId, driverId }) {
    try {
      logStructured('info', '📊 Aceitando corrida:', bookingId, 'por motorista:', driverId);

      await this.initializeFirebase();

      const bookingRef = this.firebase.collection('bookings').doc(bookingId);
      await bookingRef.update({
        status: 'ACCEPTED',
        driverId,
        updatedAt: new Date().toISOString()
      });

      const bookingDoc = await bookingRef.get();
      const booking = { id: bookingDoc.id, ...bookingDoc.data() };

      // Invalidar cache
      await advancedCache.invalidate('bookings');

      logStructured('info', '✅ Corrida aceita:', bookingId);

      return {
        success: true,
        booking,
        message: 'Corrida aceita com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao aceitar corrida:', { service: 'MutationResolver' });
      return {
        success: false,
        booking: null,
        message: `Erro ao aceitar corrida: ${error.message}`
      };
    }
  }

  async cancelBooking(_, { bookingId, reason }) {
    try {
      logStructured('info', '📊 Cancelando corrida:', bookingId, 'motivo:', reason);

      await this.initializeFirebase();

      const bookingRef = this.firebase.collection('bookings').doc(bookingId);
      await bookingRef.update({
        status: 'CANCELLED',
        cancellationReason: reason,
        updatedAt: new Date().toISOString()
      });

      const bookingDoc = await bookingRef.get();
      const booking = { id: bookingDoc.id, ...bookingDoc.data() };

      // Invalidar cache
      await advancedCache.invalidate('bookings');

      logStructured('info', '✅ Corrida cancelada:', bookingId);

      return {
        success: true,
        booking,
        message: 'Corrida cancelada com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao cancelar corrida:', { service: 'MutationResolver' });
      return {
        success: false,
        booking: null,
        message: `Erro ao cancelar corrida: ${error.message}`
      };
    }
  }

  async completeBooking(_, { bookingId, actualFare }) {
    try {
      logStructured('info', '📊 Finalizando corrida:', bookingId, 'valor:', actualFare);

      await this.initializeFirebase();

      const bookingRef = this.firebase.collection('bookings').doc(bookingId);
      await bookingRef.update({
        status: 'COMPLETED',
        actualFare,
        endTime: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const bookingDoc = await bookingRef.get();
      const booking = { id: bookingDoc.id, ...bookingDoc.data() };

      // Invalidar cache
      await advancedCache.invalidate('bookings');

      logStructured('info', '✅ Corrida finalizada:', bookingId);

      return {
        success: true,
        booking,
        message: 'Corrida finalizada com sucesso'
      };
    } catch (error) {
      logError(error, '❌ Erro ao finalizar corrida:', { service: 'MutationResolver' });
      return {
        success: false,
        booking: null,
        message: `Erro ao finalizar corrida: ${error.message}`
      };
    }
  }
}

module.exports = new MutationResolver();
