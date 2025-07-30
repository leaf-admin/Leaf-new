// user.js - Rotas para gerenciamento de usuário e toggle de perfil
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// ===== MIDDLEWARE DE AUTENTICAÇÃO =====
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido'
      });
    }

    // Verificar token (mock para teste)
    // Em produção, usar Firebase Admin SDK
    req.user = {
      uid: req.query.userId || 'test_user_123',
      email: 'test@leaf.com'
    };
    
    next();
  } catch (error) {
    console.error('❌ Erro na autenticação:', error);
    return res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }
};

// ===== ROTAS DE MODO =====
router.post('/mode', authenticateUser, async (req, res) => {
  try {
    const { userId, mode } = req.body;
    
    if (!userId || !mode) {
      return res.status(400).json({
        success: false,
        message: 'userId e mode são obrigatórios'
      });
    }

    if (!['passenger', 'driver'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'mode deve ser "passenger" ou "driver"'
      });
    }

    // Atualizar modo no banco (mock para teste)
    console.log(`🔄 User Mode: Atualizando modo de ${userId} para ${mode}`);
    
    // Em produção, salvar no Firebase/Redis
    // await admin.firestore().collection('users').doc(userId).update({
    //   currentMode: mode,
    //   updatedAt: admin.firestore.FieldValue.serverTimestamp()
    // });

    res.json({
      success: true,
      message: `Modo atualizado para ${mode}`,
      data: { userId, mode }
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar modo:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ===== ROTAS DE PERFIL =====
router.get('/profile/:mode', authenticateUser, async (req, res) => {
  try {
    const { mode } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId é obrigatório'
      });
    }

    if (!['passenger', 'driver'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'mode deve ser "passenger" ou "driver"'
      });
    }

    console.log(`📊 User Profile: Carregando dados de ${mode} para ${userId}`);

    // Mock data para teste
    const profileData = getMockProfileData(mode, userId);
    
    res.json({
      success: true,
      profile: profileData
    });
  } catch (error) {
    console.error('❌ Erro ao carregar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ===== ROTAS DE PERMISSÕES =====
router.get('/permissions/:userId', authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`🔐 User Permissions: Verificando permissões para ${userId}`);

    // Mock permissions para teste
    const permissions = {
      canBeDriver: true,
      canBePassenger: true,
      driverVerified: true,
      driverApproved: true
    };
    
    res.json({
      success: true,
      permissions
    });
  } catch (error) {
    console.error('❌ Erro ao verificar permissões:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ===== ROTAS DE CACHE =====
router.get('/cache/stats', authenticateUser, async (req, res) => {
  try {
    const { userId } = req.query;
    
    console.log(`📊 Cache Stats: Obtendo estatísticas para ${userId}`);

    // Mock cache stats para teste
    const stats = {
      total: 2,
      passenger: 1,
      driver: 1
    };
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('❌ Erro ao obter cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ===== FUNÇÕES AUXILIARES =====
function getMockProfileData(mode, userId) {
  if (mode === 'passenger') {
    return {
      preferences: {
        paymentMethod: 'pix',
        favoriteRoutes: [
          {
            id: 'route_1',
            name: 'Casa - Trabalho',
            start: 'Rua das Flores, 123',
            end: 'Av. Paulista, 1000'
          }
        ],
        rating: 4.8
      },
      tripHistory: [
        {
          id: 'trip_1',
          date: '2025-07-29T10:00:00Z',
          start: 'Rua das Flores, 123',
          end: 'Av. Paulista, 1000',
          price: 25.50,
          status: 'completed'
        }
      ],
      savedAddresses: [
        {
          id: 'addr_1',
          name: 'Casa',
          address: 'Rua das Flores, 123',
          lat: -23.5505,
          lng: -46.6333
        },
        {
          id: 'addr_2',
          name: 'Trabalho',
          address: 'Av. Paulista, 1000',
          lat: -23.5630,
          lng: -46.6544
        }
      ]
    };
  } else {
    return {
      vehicle: {
        model: 'Toyota Corolla',
        plate: 'ABC-1234',
        year: 2020,
        color: 'Prata'
      },
      documents: {
        cnh: '12345678901',
        crlv: '987654321',
        verified: true
      },
      status: 'online',
      currentLocation: {
        lat: -23.5505,
        lng: -46.6333,
        timestamp: new Date().toISOString()
      },
      earnings: {
        total: 1500.00,
        thisMonth: 450.00,
        thisWeek: 120.00
      },
      rating: 4.9,
      tripsCompleted: 156
    };
  }
}

module.exports = router; 