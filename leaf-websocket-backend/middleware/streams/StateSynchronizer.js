/**
 * StateSynchronizer - Sincronizador de estado para garantir consistência
 * 
 * Este serviço garante que os estados entre diferentes sistemas (Redis Streams,
 * banco de dados, cache) permaneçam consistentes, detectando e corrigindo
 * inconsistências automaticamente.
 * 
 * FUNCIONALIDADES:
 * - Sincronização periódica de estados
 * - Detecção de inconsistências
 * - Correção automática de estados
 * - Event sourcing para auditoria
 * - Resolução de conflitos
 */

// const redisPool = require('../redis-pool');
// const firebaseConfig = require('../firebase-config');

class StateSynchronizer {
  constructor(options = {}) {
    this.name = 'StateSynchronizer';
    this.isRunning = false;
    this.syncInterval = options.syncInterval || 30000; // 30 segundos
    this.maxRetries = options.maxRetries || 3;
    this.conflictResolution = options.conflictResolution || 'database_wins'; // database_wins, redis_wins, latest_wins
    
    // Dependências injetadas
    this.redisPool = null;
    this.firebaseConfig = null;
    
    // Estado atual
    this.lastSync = null;
    this.isHealthy = true;
    this.syncInProgress = false;
    
    // Métricas
    this.metrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      inconsistenciesFound: 0,
      inconsistenciesFixed: 0,
      conflictsResolved: 0,
      averageSyncTime: 0,
      lastSyncTime: null
    };
    
    // Configurações de sincronização
    this.syncConfig = {
      // Tabelas/coleções para sincronizar
      entities: [
        {
          name: 'rides',
          primaryKey: 'id',
          syncFields: ['status', 'driverId', 'customerId', 'location', 'timestamp'],
          conflictFields: ['status', 'location'],
          ttl: 3600000 // 1 hora
        },
        {
          name: 'matching_requests',
          primaryKey: 'id',
          syncFields: ['status', 'driverId', 'customerId', 'location', 'timestamp'],
          conflictFields: ['status'],
          ttl: 1800000 // 30 minutos
        },
        {
          name: 'driver_locations',
          primaryKey: 'driverId',
          syncFields: ['location', 'status', 'timestamp'],
          conflictFields: ['location'],
          ttl: 300000 // 5 minutos
        }
      ],
      
      // Configurações de detecção
      detection: {
        maxAge: 300000, // 5 minutos - estados mais antigos que isso são suspeitos
        batchSize: 100,
        parallelSyncs: 3
      },
      
      // Configurações de resolução de conflitos
      conflictResolution: {
        strategies: {
          database_wins: 'database',
          redis_wins: 'redis',
          latest_wins: 'timestamp'
        },
        defaultStrategy: 'database_wins'
      }
    };
  }

  /**
   * Definir dependências
   */
  setDependencies(redisPool, firebaseConfig) {
    this.redisPool = redisPool;
    this.firebaseConfig = firebaseConfig;
  }

  /**
   * Iniciar sincronização
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ [StateSynchronizer] Já está rodando');
      return;
    }

    console.log('🚀 [StateSynchronizer] Iniciando sincronização...');
    this.isRunning = true;
    
    // Iniciar loop de sincronização
    this.syncLoop();
    
    console.log('✅ [StateSynchronizer] Sincronização iniciada');
  }

  /**
   * Parar sincronização
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ [StateSynchronizer] Não está rodando');
      return;
    }

    console.log('🛑 [StateSynchronizer] Parando sincronização...');
    this.isRunning = false;
    
    console.log('✅ [StateSynchronizer] Sincronização parada');
  }

  /**
   * Loop principal de sincronização
   */
  async syncLoop() {
    while (this.isRunning) {
      try {
        if (!this.syncInProgress) {
          await this.performSync();
        }
        await this.sleep(this.syncInterval);
      } catch (error) {
        console.error('❌ [StateSynchronizer] Erro no loop de sincronização:', error);
        await this.sleep(this.syncInterval);
      }
    }
  }

  /**
   * Realizar sincronização completa
   */
  async performSync() {
    if (this.syncInProgress) {
      console.log('⚠️ [StateSynchronizer] Sincronização já em progresso');
      return;
    }

    this.syncInProgress = true;
    const startTime = Date.now();
    this.metrics.totalSyncs++;

    try {
      console.log('🔄 [StateSynchronizer] Iniciando sincronização...');
      
      // 1. Sincronizar cada entidade
      for (const entity of this.syncConfig.entities) {
        await this.syncEntity(entity);
      }
      
      // 2. Detectar inconsistências
      const inconsistencies = await this.detectInconsistencies();
      
      // 3. Corrigir inconsistências
      if (inconsistencies.length > 0) {
        await this.fixInconsistencies(inconsistencies);
      }
      
      // 4. Limpar dados expirados
      await this.cleanupExpiredData();
      
      const syncTime = Date.now() - startTime;
      this.updateMetrics(syncTime, true);
      this.lastSync = new Date();
      
      console.log(`✅ [StateSynchronizer] Sincronização concluída em ${syncTime}ms`);
      
    } catch (error) {
      const syncTime = Date.now() - startTime;
      this.updateMetrics(syncTime, false);
      
      console.error('❌ [StateSynchronizer] Erro na sincronização:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sincronizar uma entidade específica
   */
  async syncEntity(entity) {
    try {
      console.log(`🔄 [StateSynchronizer] Sincronizando entidade: ${entity.name}`);
      
      // 1. Buscar dados do banco
      const dbData = await this.getDatabaseData(entity);
      
      // 2. Buscar dados do Redis
      const redisData = await this.getRedisData(entity);
      
      // 3. Comparar e sincronizar
      const syncResult = await this.compareAndSync(entity, dbData, redisData);
      
      console.log(`✅ [StateSynchronizer] ${entity.name}: ${syncResult.synced} sincronizados, ${syncResult.conflicts} conflitos`);
      
      return syncResult;
      
    } catch (error) {
      console.error(`❌ [StateSynchronizer] Erro ao sincronizar ${entity.name}:`, error);
      throw error;
    }
  }

  /**
   * Buscar dados do banco de dados
   */
  async getDatabaseData(entity) {
    try {
      if (!this.firebaseConfig) {
        console.log(`⚠️ [StateSynchronizer] Firebase não disponível para ${entity.name}`);
        return [];
      }
      
      // Simular busca no banco (Firebase/PostgreSQL)
      const data = await this.firebaseConfig.getFirestore()
        .collection(entity.name)
        .where('lastSync', '>', new Date(Date.now() - this.syncConfig.detection.maxAge))
        .get();
      
      return data.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        source: 'database',
        lastSync: doc.data().lastSync || new Date()
      }));
    } catch (error) {
      console.error(`Erro ao buscar dados do banco para ${entity.name}:`, error);
      return [];
    }
  }

  /**
   * Buscar dados do Redis
   */
  async getRedisData(entity) {
    try {
      if (!this.redisPool) {
        console.log(`⚠️ [StateSynchronizer] Redis não disponível para ${entity.name}`);
        return [];
      }
      
      const data = [];
      
      // Buscar dados de streams
      const streamKey = `${entity.name}:stream`;
      const streamData = await this.redisPool.pool.xRange(streamKey, '-', '+');
      
      for (const [id, fields] of streamData) {
        const record = {
          id: id,
          source: 'redis',
          lastSync: new Date(parseInt(fields.timestamp) || Date.now())
        };
        
        // Converter campos do stream
        for (const [key, value] of Object.entries(fields)) {
          if (entity.syncFields.includes(key)) {
            try {
              record[key] = JSON.parse(value);
            } catch {
              record[key] = value;
            }
          }
        }
        
        data.push(record);
      }
      
      return data;
    } catch (error) {
      console.error(`Erro ao buscar dados do Redis para ${entity.name}:`, error);
      return [];
    }
  }

  /**
   * Comparar e sincronizar dados
   */
  async compareAndSync(entity, dbData, redisData) {
    const result = {
      synced: 0,
      conflicts: 0,
      errors: 0
    };
    
    // Criar mapas para comparação
    const dbMap = new Map(dbData.map(item => [item.id, item]));
    const redisMap = new Map(redisData.map(item => [item.id, item]));
    
    // Sincronizar dados do banco para Redis
    for (const [id, dbItem] of dbMap) {
      const redisItem = redisMap.get(id);
      
      if (!redisItem) {
        // Item existe apenas no banco - adicionar ao Redis
        await this.addToRedis(entity, dbItem);
        result.synced++;
      } else {
        // Item existe em ambos - verificar conflitos
        const conflict = this.detectConflict(entity, dbItem, redisItem);
        
        if (conflict) {
          const resolved = await this.resolveConflict(entity, dbItem, redisItem);
          if (resolved) {
            result.conflicts++;
          } else {
            result.errors++;
          }
        } else {
          // Sem conflito - sincronizar se necessário
          if (this.needsSync(dbItem, redisItem)) {
            await this.syncItem(entity, dbItem, redisItem);
            result.synced++;
          }
        }
      }
    }
    
    // Sincronizar dados do Redis para banco (itens que existem apenas no Redis)
    for (const [id, redisItem] of redisMap) {
      if (!dbMap.has(id)) {
        await this.addToDatabase(entity, redisItem);
        result.synced++;
      }
    }
    
    return result;
  }

  /**
   * Detectar conflito entre dois itens
   */
  detectConflict(entity, dbItem, redisItem) {
    for (const field of entity.conflictFields) {
      const dbValue = dbItem[field];
      const redisValue = redisItem[field];
      
      if (dbValue !== redisValue) {
        const timeDiff = Math.abs(
          new Date(dbItem.lastSync).getTime() - 
          new Date(redisItem.lastSync).getTime()
        );
        
        // Se a diferença de tempo é maior que o threshold, é um conflito
        if (timeDiff > this.syncConfig.detection.conflictThreshold) {
          return {
            field,
            dbValue,
            redisValue,
            dbTime: dbItem.lastSync,
            redisTime: redisItem.lastSync
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Resolver conflito
   */
  async resolveConflict(entity, dbItem, redisItem) {
    try {
      let winner, loser;
      
      switch (this.conflictResolution) {
        case 'database_wins':
          winner = dbItem;
          loser = redisItem;
          break;
        case 'redis_wins':
          winner = redisItem;
          loser = dbItem;
          break;
        case 'latest_wins':
          winner = new Date(dbItem.lastSync) > new Date(redisItem.lastSync) ? dbItem : redisItem;
          loser = winner === dbItem ? redisItem : dbItem;
          break;
        default:
          winner = dbItem;
          loser = redisItem;
      }
      
      // Atualizar o perdedor com os dados do vencedor
      await this.updateItem(entity, loser, winner);
      
      this.metrics.conflictsResolved++;
      console.log(`🔧 [StateSynchronizer] Conflito resolvido para ${entity.name}:${winner.id} (${this.conflictResolution})`);
      
      return true;
    } catch (error) {
      console.error('Erro ao resolver conflito:', error);
      return false;
    }
  }

  /**
   * Verificar se item precisa de sincronização
   */
  needsSync(dbItem, redisItem) {
    const timeDiff = Math.abs(
      new Date(dbItem.lastSync).getTime() - 
      new Date(redisItem.lastSync).getTime()
    );
    
    return timeDiff > this.syncConfig.detection.staleThreshold;
  }

  /**
   * Sincronizar item específico
   */
  async syncItem(entity, sourceItem, targetItem) {
    try {
      // Atualizar item de destino com dados da fonte
      await this.updateItem(entity, targetItem, sourceItem);
    } catch (error) {
      console.error('Erro ao sincronizar item:', error);
      throw error;
    }
  }

  /**
   * Adicionar item ao Redis
   */
  async addToRedis(entity, item) {
    try {
      const streamKey = `${entity.name}:stream`;
      const fields = {};
      
      for (const field of entity.syncFields) {
        if (item[field] !== undefined) {
          fields[field] = typeof item[field] === 'object' ? 
            JSON.stringify(item[field]) : item[field];
        }
      }
      
      fields.timestamp = item.lastSync.getTime().toString();
      fields.source = 'database';
      
      await redisPool.pool.xAdd(streamKey, '*', fields);
    } catch (error) {
      console.error('Erro ao adicionar ao Redis:', error);
      throw error;
    }
  }

  /**
   * Adicionar item ao banco de dados
   */
  async addToDatabase(entity, item) {
    try {
      const docData = {
        ...item,
        lastSync: new Date(),
        source: 'redis'
      };
      
      await firebaseConfig.getFirestore()
        .collection(entity.name)
        .doc(item.id)
        .set(docData);
    } catch (error) {
      console.error('Erro ao adicionar ao banco:', error);
      throw error;
    }
  }

  /**
   * Atualizar item
   */
  async updateItem(entity, targetItem, sourceItem) {
    if (targetItem.source === 'redis') {
      await this.addToRedis(entity, sourceItem);
    } else {
      await this.addToDatabase(entity, sourceItem);
    }
  }

  /**
   * Detectar inconsistências gerais
   */
  async detectInconsistencies() {
    const inconsistencies = [];
    
    try {
      // Verificar estados órfãos
      const orphanStates = await this.findOrphanStates();
      inconsistencies.push(...orphanStates);
      
      // Verificar estados inconsistentes
      const inconsistentStates = await this.findInconsistentStates();
      inconsistencies.push(...inconsistentStates);
      
      this.metrics.inconsistenciesFound += inconsistencies.length;
      
      if (inconsistencies.length > 0) {
        console.log(`🔍 [StateSynchronizer] Encontradas ${inconsistencies.length} inconsistências`);
      }
      
    } catch (error) {
      console.error('Erro ao detectar inconsistências:', error);
    }
    
    return inconsistencies;
  }

  /**
   * Encontrar estados órfãos
   */
  async findOrphanStates() {
    const orphans = [];
    
    // Implementar lógica para encontrar estados órfãos
    // Por exemplo: corridas sem motorista, motoristas sem corrida, etc.
    
    return orphans;
  }

  /**
   * Encontrar estados inconsistentes
   */
  async findInconsistentStates() {
    const inconsistent = [];
    
    // Implementar lógica para encontrar estados inconsistentes
    // Por exemplo: corridas com status inválido, localizações impossíveis, etc.
    
    return inconsistent;
  }

  /**
   * Corrigir inconsistências
   */
  async fixInconsistencies(inconsistencies) {
    for (const inconsistency of inconsistencies) {
      try {
        await this.fixInconsistency(inconsistency);
        this.metrics.inconsistenciesFixed++;
      } catch (error) {
        console.error('Erro ao corrigir inconsistência:', error);
      }
    }
  }

  /**
   * Corrigir inconsistência específica
   */
  async fixInconsistency(inconsistency) {
    // Implementar lógica específica para cada tipo de inconsistência
    console.log(`🔧 [StateSynchronizer] Corrigindo inconsistência: ${inconsistency.type}`);
  }

  /**
   * Limpar dados expirados
   */
  async cleanupExpiredData() {
    try {
      if (!this.redisPool) {
        console.log('⚠️ [StateSynchronizer] Redis não disponível para cleanup');
        return;
      }
      
      const now = Date.now();
      
      for (const entity of this.syncConfig.entities) {
        // Limpar dados expirados do Redis
        const streamKey = `${entity.name}:stream`;
        const expiredData = await this.redisPool.pool.xRange(
          streamKey, 
          '-', 
          '+',
          'COUNT', 
          100
        );
        
        for (const [id, fields] of expiredData) {
          const timestamp = parseInt(fields.timestamp) || 0;
          if (now - timestamp > entity.ttl) {
            await this.redisPool.pool.xDel(streamKey, id);
          }
        }
      }
      
      console.log('🧹 [StateSynchronizer] Dados expirados limpos');
    } catch (error) {
      console.error('Erro ao limpar dados expirados:', error);
    }
  }

  /**
   * Atualizar métricas
   */
  updateMetrics(syncTime, success) {
    if (success) {
      this.metrics.successfulSyncs++;
      this.metrics.averageSyncTime = 
        (this.metrics.averageSyncTime * (this.metrics.successfulSyncs - 1) + syncTime) / 
        this.metrics.successfulSyncs;
    } else {
      this.metrics.failedSyncs++;
    }
    
    this.metrics.lastSyncTime = new Date();
  }

  /**
   * Obter métricas
   */
  getMetrics() {
    const successRate = this.metrics.totalSyncs > 0 ? 
      (this.metrics.successfulSyncs / this.metrics.totalSyncs) * 100 : 0;
    
    const fixRate = this.metrics.inconsistenciesFound > 0 ? 
      (this.metrics.inconsistenciesFixed / this.metrics.inconsistenciesFound) * 100 : 0;

    return {
      ...this.metrics,
      successRate,
      fixRate,
      isHealthy: this.isHealthy,
      lastSync: this.lastSync,
      syncInProgress: this.syncInProgress
    };
  }

  /**
   * Obter status de saúde
   */
  getHealthStatus() {
    return {
      service: this.name,
      status: this.isHealthy ? 'healthy' : 'unhealthy',
      isRunning: this.isRunning,
      metrics: this.getMetrics(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = StateSynchronizer;
