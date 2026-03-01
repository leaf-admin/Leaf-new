/**
 * RedisStreamManager - Gerenciador de Redis Streams real
 * 
 * Este serviço implementa Redis Streams funcionais com conexão real ao Redis,
 * incluindo criação de streams, envio de mensagens e gerenciamento de consumers.
 * 
 * FUNCIONALIDADES:
 * - Conexão real com Redis
 * - Criação e gerenciamento de streams
 * - Envio de mensagens para streams
 * - Monitoramento de streams
 * - Integração com sistema existente
 */

const redis = require('redis');
const { logStructured, logError } = require('../utils/logger');

class RedisStreamManager {
  constructor(options = {}) {
    this.name = 'RedisStreamManager';
    this.config = {
      host: options.host || process.env.REDIS_HOST || 'localhost',
      port: options.port || process.env.REDIS_PORT || 6379,
      password: options.password || process.env.REDIS_PASSWORD || null,
      db: options.db || process.env.REDIS_DB || 0,
      ...options
    };
    
    this.client = null;
    this.isConnected = false;
    this.streams = new Map();
    this.consumers = new Map();
    
    // Métricas
    this.metrics = {
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      averageLatency: 0,
      streamsCreated: 0,
      consumersStarted: 0,
      uptime: Date.now()
    };
  }

  /**
   * Conectar ao Redis
   */
  async connect() {
    if (this.isConnected) {
      logStructured('info', '⚠️ [RedisStreamManager] Já está conectado');
      return;
    }

    try {
      logStructured('info', '🔌 [RedisStreamManager] Conectando ao Redis...');
      
      this.client = redis.createClient({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logStructured('error', '❌ [RedisStreamManager] Redis recusou conexão');
            return new Error('Redis recusou conexão');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logStructured('error', '❌ [RedisStreamManager] Timeout de reconexão');
            return new Error('Timeout de reconexão');
          }
          if (options.attempt > 10) {
            logStructured('error', '❌ [RedisStreamManager] Muitas tentativas de reconexão');
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      // Event listeners
      this.client.on('connect', () => {
        logStructured('info', '🔌 [RedisStreamManager] Conectado ao Redis');
      });

      this.client.on('ready', () => {
        logStructured('info', '✅ [RedisStreamManager] Redis pronto para uso');
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        logError(error, '❌ [RedisStreamManager] Erro do Redis:', { service: 'RedisStreamManager' });
        this.isConnected = false;
      });

      this.client.on('end', () => {
        logStructured('info', '🔌 [RedisStreamManager] Conexão Redis encerrada');
        this.isConnected = false;
      });

      // Conectar
      await this.client.connect();
      
      logStructured('info', '🎉 [RedisStreamManager] Conectado com sucesso!');
      
    } catch (error) {
      logError(error, '❌ [RedisStreamManager] Erro na conexão:', { service: 'RedisStreamManager' });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Desconectar do Redis
   */
  async disconnect() {
    if (!this.isConnected) {
      logStructured('info', '⚠️ [RedisStreamManager] Não está conectado');
      return;
    }

    try {
      logStructured('info', '🔌 [RedisStreamManager] Desconectando do Redis...');
      
      // Parar todos os consumers
      for (const [consumerName, consumer] of this.consumers) {
        await this.stopConsumer(consumerName);
      }
      
      // Desconectar
      await this.client.quit();
      this.isConnected = false;
      
      logStructured('info', '✅ [RedisStreamManager] Desconectado com sucesso');
      
    } catch (error) {
      logError(error, '❌ [RedisStreamManager] Erro na desconexão:', { service: 'RedisStreamManager' });
      throw error;
    }
  }

  /**
   * Criar stream
   */
  async createStream(streamName, options = {}) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    try {
      logStructured('info', `📝 [RedisStreamManager] Criando stream: ${streamName}`);
      
      // Verificar se stream já existe
      const exists = await this.streamExists(streamName);
      
      if (!exists) {
        // Criar stream com mensagem inicial
        const messageId = await this.client.xAdd(streamName, '*', {
          type: 'init',
          timestamp: Date.now().toString(),
          message: 'Stream inicializado',
          source: 'system'
        });
        
        logStructured('info', `✅ [RedisStreamManager] Stream ${streamName} criado com ID: ${messageId}`);
        this.metrics.streamsCreated++;
      } else {
        logStructured('info', `ℹ️ [RedisStreamManager] Stream ${streamName} já existe`);
      }
      
      // Registrar stream
      this.streams.set(streamName, { service: 'RedisStreamManager', ...{
        name: streamName,
        created: new Date(),
        options,
        messageCount: 0,
        lastMessage: null
      } });
      
      return streamName;
      
    } catch (error) {
      logError(error, `❌ [RedisStreamManager] Erro ao criar stream ${streamName}:`, { service: 'RedisStreamManager' });
      throw error;
    }
  }

  /**
   * Verificar se stream existe
   */
  async streamExists(streamName) {
    try {
      await this.client.xInfo('STREAM', streamName);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Enviar mensagem para stream
   */
  async sendMessage(streamName, data, options = {}) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    const startTime = Date.now();
    this.metrics.totalMessages++;

    try {
      // Verificar se stream existe
      if (!this.streams.has(streamName)) {
        await this.createStream(streamName);
      }

      // Preparar dados da mensagem
      const messageData = {
        ...data,
        timestamp: Date.now().toString(),
        source: 'api',
        ...options
      };

      // Converter objetos para string
      const streamData = {};
      for (const [key, value] of Object.entries(messageData)) {
        streamData[key] = typeof value === 'object' ? JSON.stringify(value) : value.toString();
      }

      // Enviar para Redis
      const messageId = await this.client.xAdd(streamName, '*', streamData);
      
      // Atualizar métricas do stream
      const stream = this.streams.get(streamName);
      if (stream) {
        stream.messageCount++;
        stream.lastMessage = {
          id: messageId,
          timestamp: new Date(),
          data: messageData
        };
      }

      const latency = Date.now() - startTime;
      this.updateMetrics(latency, true);

      logStructured('info', `📤 [RedisStreamManager] Mensagem enviada para ${streamName}: ${messageId} (${latency}ms)`);
      
      return {
        success: true,
        messageId,
        streamName,
        latency,
        data: messageData
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateMetrics(latency, false);

      logError(error, `❌ [RedisStreamManager] Erro ao enviar mensagem para ${streamName}:`, { service: 'RedisStreamManager' });
      
      return {
        success: false,
        streamName,
        error: error.message,
        latency
      };
    }
  }

  /**
   * Ler mensagens do stream
   */
  async readMessages(streamName, options = {}) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    try {
      const {
        count = 10,
        block = 0,
        start = '-',
        end = '+'
      } = options;

      const messages = await this.client.xRange(streamName, start, end, 'COUNT', count);
      
      logStructured('info', `📖 [RedisStreamManager] Lidas ${messages.length} mensagens de ${streamName}`);
      
      return messages.map(([id, fields]) => ({
        id,
        fields: this.parseFields(fields),
        streamName
      }));

    } catch (error) {
      logError(error, `❌ [RedisStreamManager] Erro ao ler mensagens de ${streamName}:`, { service: 'RedisStreamManager' });
      throw error;
    }
  }

  /**
   * Criar consumer group
   */
  async createConsumerGroup(streamName, groupName, options = {}) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    try {
      const {
        startId = '0',
        mkstream = true
      } = options;

      await this.client.xGroupCreate(streamName, groupName, startId, {
        MKSTREAM: mkstream
      });

      logStructured('info', `👥 [RedisStreamManager] Consumer group ${groupName} criado para stream ${streamName}`);

    } catch (error) {
      if (error.message.includes('BUSYGROUP')) {
        logStructured('info', `ℹ️ [RedisStreamManager] Consumer group ${groupName} já existe`);
      } else {
        logError(error, `❌ [RedisStreamManager] Erro ao criar consumer group:`, { service: 'RedisStreamManager' });
        throw error;
      }
    }
  }

  /**
   * Ler mensagens do consumer group
   */
  async readGroupMessages(streamName, groupName, consumerName, options = {}) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    try {
      const {
        count = 1,
        block = 1000,
        noack = false
      } = options;

      const messages = await this.client.xReadGroup(
        groupName,
        consumerName,
        [{ key: streamName, id: '>' }],
        {
          COUNT: count,
          BLOCK: block,
          NOACK: noack
        }
      );

      if (messages && messages.length > 0) {
        const streamMessages = messages[0].messages;
        logStructured('info', `📖 [RedisStreamManager] Consumer ${consumerName} leu ${streamMessages.length} mensagens`);
        
        return streamMessages.map(({ id, message }) => ({
          id,
          fields: this.parseFields(message),
          streamName,
          groupName,
          consumerName
        }));
      }

      return [];

    } catch (error) {
      logError(error, `❌ [RedisStreamManager] Erro ao ler mensagens do group:`, { service: 'RedisStreamManager' });
      throw error;
    }
  }

  /**
   * Confirmar processamento de mensagem
   */
  async ackMessage(streamName, groupName, messageId) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    try {
      const acked = await this.client.xAck(streamName, groupName, messageId);
      logStructured('info', `✅ [RedisStreamManager] Mensagem ${messageId} confirmada (${acked} acked)`);
      return acked;
    } catch (error) {
      logError(error, `❌ [RedisStreamManager] Erro ao confirmar mensagem:`, { service: 'RedisStreamManager' });
      throw error;
    }
  }

  /**
   * Obter informações do stream
   */
  async getStreamInfo(streamName) {
    if (!this.isConnected) {
      throw new Error('Redis não está conectado');
    }

    try {
      const info = await this.client.xInfo('STREAM', streamName);
      
      return {
        name: streamName,
        length: info.length,
        radixTreeKeys: info.radixTreeKeys,
        radixTreeNodes: info.radixTreeNodes,
        groups: info.groups,
        lastGeneratedId: info.lastGeneratedId,
        firstEntry: info.firstEntry,
        lastEntry: info.lastEntry
      };

    } catch (error) {
      logError(error, `❌ [RedisStreamManager] Erro ao obter info do stream:`, { service: 'RedisStreamManager' });
      throw error;
    }
  }

  /**
   * Obter informações de todos os streams
   */
  async getAllStreamsInfo() {
    const streamsInfo = {};
    
    for (const [streamName, stream] of this.streams) {
      try {
        streamsInfo[streamName] = await this.getStreamInfo(streamName);
        streamsInfo[streamName].localInfo = stream;
      } catch (error) {
        streamsInfo[streamName] = { error: error.message };
      }
    }
    
    return streamsInfo;
  }

  /**
   * Parsear campos da mensagem
   */
  parseFields(fields) {
    const parsed = {};
    
    for (const [key, value] of Object.entries(fields)) {
      try {
        parsed[key] = JSON.parse(value);
      } catch {
        parsed[key] = value;
      }
    }
    
    return parsed;
  }

  /**
   * Atualizar métricas
   */
  updateMetrics(latency, success) {
    if (success) {
      this.metrics.successfulMessages++;
      this.metrics.averageLatency = 
        (this.metrics.averageLatency * (this.metrics.successfulMessages - 1) + latency) / 
        this.metrics.successfulMessages;
    } else {
      this.metrics.failedMessages++;
    }
  }

  /**
   * Obter métricas
   */
  getMetrics() {
    const successRate = this.metrics.totalMessages > 0 ? 
      (this.metrics.successfulMessages / this.metrics.totalMessages) * 100 : 0;

    return {
      ...this.metrics,
      successRate,
      isConnected: this.isConnected,
      streamsCount: this.streams.size,
      consumersCount: this.consumers.size,
      uptime: Date.now() - this.metrics.uptime
    };
  }

  /**
   * Obter status de saúde
   */
  getHealthStatus() {
    return {
      service: this.name,
      status: this.isConnected ? 'healthy' : 'unhealthy',
      isConnected: this.isConnected,
      metrics: this.getMetrics(),
      streams: Array.from(this.streams.keys()),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Ping Redis
   */
  async ping() {
    if (!this.isConnected) {
      return { success: false, error: 'Not connected' };
    }

    try {
      const startTime = Date.now();
      const pong = await this.client.ping();
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        response: pong,
        latency
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = RedisStreamManager;
