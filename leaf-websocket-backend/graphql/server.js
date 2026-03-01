// graphql/server.js
// Servidor Apollo GraphQL para Leaf App

const { ApolloServer } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const depthLimit = require('graphql-depth-limit');
const costAnalysis = require('graphql-cost-analysis').default;
const { logStructured, logError } = require('../utils/logger');

// Importar schema e resolvers
const { schema } = require('./schema');
const resolvers = require('./resolvers');

// Importar middleware de autenticação
const graphqlAuth = require('../middleware/graphql-auth');

// Configurações de segurança
const securityConfig = {
  // Limitar profundidade das queries
  depthLimit: 10,
  
  // Limitar complexidade das queries
  costLimit: 1000,
  
  // Limitar número de operações
  maxOperations: 5,
  
  // Timeout para queries
  queryTimeout: 30000, // 30 segundos
};

// Criar schema executável
const executableSchema = makeExecutableSchema({
  typeDefs: schema,
  resolvers,
  // Permitir introspection em desenvolvimento
  introspection: true,
  // Permitir playground em desenvolvimento
  playground: true
});

// Configurar plugins de segurança
const plugins = [
  // Plugin de análise de custos
  {
    requestDidStart() {
      return {
        didResolveOperation({ request, operation }) {
          // Verificar complexidade da query
          const complexity = costAnalysis(executableSchema, request.query);
          if (complexity > securityConfig.costLimit) {
            throw new Error(`Query muito complexa: ${complexity} > ${securityConfig.costLimit}`);
          }
        }
      };
    }
  }
];

// Criar servidor Apollo
const apolloServer = new ApolloServer({
  schema: executableSchema,
  resolvers,
  
  // Configurações de contexto com autenticação
  context: graphqlAuth.createContextMiddleware(),
  
  // Configurações de segurança
  plugins,
  
  // Configurações de cache
  cache: 'bounded',
  
  // Configurações de introspection
  introspection: true,
  
  // Configurações de debug
  debug: true,
  tracing: true,
  
  // Configurações de playground
  playground: process.env.NODE_ENV !== 'production' ? {
    settings: {
      'request.credentials': 'include',
      'editor.theme': 'dark',
      'editor.fontSize': 14,
      'editor.fontFamily': 'Monaco, Consolas, "Courier New", monospace'
    },
    tabs: [
      {
        endpoint: '/graphql',
        query: `# Exemplo de query para relatório financeiro
query FinancialReport($period: String!) {
  financialReport(period: $period) {
    period
    totalRevenue
    totalCosts
    profitMargin
    totalTrips
    averageFare
    costBreakdown {
      mapsApi
      infrastructure
      paymentProcessing
      serverCosts
      firebaseCosts
      redisCosts
      totalOperationalCosts
    }
    revenueBreakdown {
      rideFares
      commissions
      subscriptions
      marketing
      other
    }
    topRoutes {
      route
      frequency
      revenue
      averageFare
      distance
    }
    dailyMetrics {
      date
      trips
      revenue
      costs
      profit
    }
  }
}`,
        variables: {
          period: '30d'
        }
      },
      {
        endpoint: '/graphql',
        query: `# Exemplo de query para motoristas próximos
query NearbyDrivers($location: LocationInput!) {
  nearbyDrivers(location: $location, radius: 5000, limit: 10) {
    id
    name
    rating
    totalTrips
    isOnline
    vehicle {
      model
      brand
      color
      vehicleType
    }
    location {
      latitude
      longitude
      address
    }
  }
}`,
        variables: {
          location: {
            latitude: -23.5505,
            longitude: -46.6333,
            address: 'São Paulo, SP'
          }
        }
      },
      {
        endpoint: '/graphql',
        query: `# Exemplo de query para métricas operacionais
query OperationalMetrics($period: String!) {
  operationalMetrics(period: $period) {
    totalTrips
    completedTrips
    cancelledTrips
    averageTripDuration
    averageTripDistance
    peakHours
    busyAreas {
      area
      tripCount
      revenue
      averageFare
    }
  }
}`,
        variables: {
          period: '7d'
        }
      }
    ]
  } : false,
  
  // Configurações de formatError
  formatError: (error) => {
    logError(error, 'Erro GraphQL', {
      service: 'graphql',
      operation: 'formatError',
      code: error.extensions?.code || 'UNKNOWN_ERROR',
      path: error.path
    });
    
    // Não expor detalhes internos em produção
    if (process.env.NODE_ENV === 'production') {
      return {
        message: 'Erro interno do servidor',
        code: 'INTERNAL_ERROR'
      };
    }
    
    return {
      message: error.message,
      code: error.extensions?.code || 'UNKNOWN_ERROR',
      path: error.path,
      locations: error.locations
    };
  },
  
  // Configurações de formatResponse
  formatResponse: (response) => {
    // Log de queries em desenvolvimento
    if (process.env.NODE_ENV !== 'production' && response.data) {
      logStructured('info', 'Query GraphQL executada', {
        service: 'graphql',
        operation: 'query',
        queries: Object.keys(response.data).join(', ')
      });
    }
    
    return response;
  }
});

// Middleware de autenticação
const authMiddleware = (req, res, next) => {
  // Implementar autenticação JWT se necessário
  // Por enquanto, permitir acesso público para testes
  next();
};

// Middleware de rate limiting
const rateLimitMiddleware = (req, res, next) => {
  // Implementar rate limiting se necessário
  // Por enquanto, permitir acesso livre para testes
  next();
};

// Middleware de logging
const loggingMiddleware = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logStructured('info', 'GraphQL request', {
      service: 'graphql',
      operation: 'request',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      latency_ms: duration
    });
  });
  
  next();
};

// Função para aplicar middlewares
const applyMiddleware = async (app) => {
  // Iniciar servidor Apollo primeiro
  await apolloServer.start();
  
  // Aplicar middlewares
  app.use('/graphql', loggingMiddleware);
  app.use('/graphql', rateLimitMiddleware);
  app.use('/graphql', authMiddleware);
  
  // Aplicar servidor Apollo
  apolloServer.applyMiddleware({ 
    app, 
    path: '/graphql',
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://leafapp.com', 'https://dashboard.leafapp.com']
        : true,
      credentials: true
    }
  });
  
  logStructured('info', 'Servidor Apollo GraphQL configurado', {
    service: 'graphql',
    operation: 'configure',
    endpoint: '/graphql'
  });
};

// Função para iniciar servidor
const startServer = async () => {
  try {
    await apolloServer.start();
    logStructured('info', 'Servidor Apollo GraphQL iniciado', {
      service: 'graphql',
      operation: 'start'
    });
    return apolloServer;
  } catch (error) {
    logError(error, 'Erro ao iniciar servidor Apollo', {
      service: 'graphql',
      operation: 'start'
    });
    throw error;
  }
};

// Função para parar servidor
const stopServer = async () => {
  try {
    await apolloServer.stop();
    logStructured('info', 'Servidor Apollo GraphQL parado', {
      service: 'graphql',
      operation: 'stop'
    });
  } catch (error) {
    logError(error, 'Erro ao parar servidor Apollo', {
      service: 'graphql',
      operation: 'stop'
    });
    throw error;
  }
};

// Função para obter informações do servidor
const getServerInfo = () => {
  return {
    endpoint: '/graphql',
    playground: process.env.NODE_ENV !== 'production' ? '/graphql' : false,
    introspection: process.env.NODE_ENV !== 'production',
    security: securityConfig,
    version: '1.0.0',
    features: [
      'Dashboard Resolver',
      'User Resolver com DataLoader',
      'Driver Resolver com Redis GEO',
      'Booking Resolver',
      'Cache Inteligente',
      'Rate Limiting',
      'Query Complexity Analysis',
      'Depth Limiting'
    ]
  };
};

module.exports = {
  apolloServer,
  applyMiddleware,
  startServer,
  stopServer,
  getServerInfo,
  executableSchema
};
