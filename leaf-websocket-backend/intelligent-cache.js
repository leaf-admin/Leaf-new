// Cache Inteligente com TTL Dinâmico e Warming
console.log('🧠 Carregando Cache Inteligente...');

class IntelligentCache {
    constructor() {
        this.cache = new Map();
        this.accessCount = new Map();
        this.lastAccess = new Map();
        this.size = new Map();
        this.maxSize = 10000;
        this.maxMemory = 100 * 1024 * 1024;
        this.currentMemory = 0;
        
        this.metrics = {
            hits: 0,
            misses: 0,
            evictions: 0,
            memoryUsage: 0,
            hitRate: 0
        };
        
        this.ttlConfig = {
            default: 3600000,
            highAccess: 7200000,
            lowAccess: 1800000,
            critical: 86400000
        };
        
        this.initializeAutoCleanup();
        this.initializeMetrics();
    }
    
    initializeAutoCleanup() {
        setInterval(() => {
            this.cleanup();
        }, 60000);
        
        setInterval(() => {
            this.defragment();
        }, 300000);
    }
    
    initializeMetrics() {
        setInterval(() => {
            this.calculateMetrics();
            this.displayMetrics();
        }, 10000);
    }
    
    set(key, value, customTTL = null) {
        try {
            const itemSize = this.calculateItemSize(value);
            
            if (this.currentMemory + itemSize > this.maxMemory) {
                this.evictItems(itemSize);
            }
            
            const ttl = this.calculateDynamicTTL(key, customTTL);
            
            const item = {
                value,
                ttl,
                createdAt: Date.now(),
                expiresAt: Date.now() + ttl,
                size: itemSize,
                accessCount: 0,
                lastAccess: Date.now()
            };
            
            this.cache.set(key, item);
            this.accessCount.set(key, 0);
            this.lastAccess.set(key, Date.now());
            this.size.set(key, itemSize);
            this.currentMemory += itemSize;
            
            console.log('💾 Item cacheado:', key, 'TTL:', ttl + 'ms');
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao cachear item:', error);
            return false;
        }
    }
    
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            this.metrics.misses++;
            return null;
        }
        
        if (Date.now() > item.expiresAt) {
            this.delete(key);
            this.metrics.misses++;
            return null;
        }
        
        item.accessCount++;
        item.lastAccess = Date.now();
        this.accessCount.set(key, item.accessCount);
        this.lastAccess.set(key, item.lastAccess);
        
        this.metrics.hits++;
        this.extendTTLIfNeeded(key, item);
        
        return item.value;
    }
    
    calculateDynamicTTL(key, customTTL) {
        if (customTTL) return customTTL;
        
        const accessCount = this.accessCount.get(key) || 0;
        
        if (accessCount > 100) {
            return this.ttlConfig.highAccess;
        } else if (accessCount > 50) {
            return this.ttlConfig.default;
        } else if (accessCount > 10) {
            return this.ttlConfig.lowAccess;
        } else {
            return this.ttlConfig.default;
        }
    }
    
    extendTTLIfNeeded(key, item) {
        const accessCount = item.accessCount;
        const currentTTL = item.expiresAt - Date.now();
        
        if (accessCount > 50 && currentTTL < 300000) {
            const newTTL = this.ttlConfig.highAccess;
            item.expiresAt = Date.now() + newTTL;
            console.log('⏰ TTL estendido para:', key, 'novo TTL:', newTTL + 'ms');
        }
    }
    
    warmCache(keys) {
        console.log('🔥 Iniciando cache warming...');
        
        keys.forEach(key => {
            if (!this.cache.has(key)) {
                const warmData = this.generateWarmData(key);
                this.set(key, warmData, this.ttlConfig.highAccess);
            }
        });
        
        console.log('✅ Cache warming concluído');
    }
    
    generateWarmData(key) {
        if (key.includes('user')) {
            return { id: key, type: 'user', warmed: true, timestamp: Date.now() };
        } else if (key.includes('ride')) {
            return { id: key, type: 'ride', warmed: true, timestamp: Date.now() };
        } else {
            return { id: key, type: 'generic', warmed: true, timestamp: Date.now() };
        }
    }
    
    cleanup() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.delete(key);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log('🧹 Limpeza automática:', cleanedCount, 'itens removidos');
        }
    }
    
    evictItems(requiredSize) {
        const items = Array.from(this.cache.entries())
            .sort((a, b) => {
                const scoreA = this.calculateEvictionScore(a[1]);
                const scoreB = this.calculateEvictionScore(b[1]);
                return scoreA - scoreB;
            });
        
        let freedMemory = 0;
        let evictedCount = 0;
        
        for (const [key, item] of items) {
            if (freedMemory >= requiredSize) break;
            
            this.delete(key);
            freedMemory += item.size;
            evictedCount++;
        }
        
        this.metrics.evictions += evictedCount;
        console.log('🗑️ Evicção:', evictedCount, 'itens removidos, memória liberada:', freedMemory);
    }
    
    calculateEvictionScore(item) {
        const timeSinceLastAccess = Date.now() - item.lastAccess;
        const accessScore = 1 / (item.accessCount + 1);
        const timeScore = timeSinceLastAccess / 1000000;
        const sizeScore = item.size / 1024;
        
        return timeScore + accessScore + sizeScore;
    }
    
    defragment() {
        const beforeMemory = this.currentMemory;
        const beforeCount = this.cache.size;
        
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (item.expiresAt - now < 60000) {
                this.delete(key);
            }
        }
        
        const afterMemory = this.currentMemory;
        const afterCount = this.cache.size;
        
        if (beforeMemory !== afterMemory || beforeCount !== afterCount) {
            console.log('🔧 Defragmentação:', 
                'Memória:', (beforeMemory - afterMemory) / 1024 / 1024, 'MB liberados',
                'Itens:', beforeCount - afterCount, 'removidos'
            );
        }
    }
    
    calculateItemSize(value) {
        try {
            return Buffer.byteLength(JSON.stringify(value), 'utf8');
        } catch (error) {
            return 1024;
        }
    }
    
    delete(key) {
        const item = this.cache.get(key);
        if (item) {
            this.currentMemory -= item.size;
            this.cache.delete(key);
            this.accessCount.delete(key);
            this.lastAccess.delete(key);
            this.size.delete(key);
        }
    }
    
    calculateMetrics() {
        const totalRequests = this.metrics.hits + this.metrics.misses;
        this.metrics.hitRate = totalRequests > 0 ? this.metrics.hits / totalRequests : 0;
        this.metrics.memoryUsage = this.currentMemory;
    }
    
    displayMetrics() {
        console.log('📊 CACHE INTELIGENTE METRICS:');
        console.log('=============================');
        console.log('Hit Rate:', (this.metrics.hitRate * 100).toFixed(1) + '%');
        console.log('Hits:', this.metrics.hits);
        console.log('Misses:', this.metrics.misses);
        console.log('Evictions:', this.metrics.evictions);
        console.log('Memória:', (this.metrics.memoryUsage / 1024 / 1024).toFixed(2), 'MB');
        console.log('Itens:', this.cache.size);
        console.log('------------------------------');
    }
    
    getHealthStatus() {
        return {
            status: this.metrics.hitRate > 0.7 ? 'healthy' : 'warning',
            hitRate: this.metrics.hitRate,
            memoryUsage: this.metrics.memoryUsage,
            itemCount: this.cache.size,
            metrics: this.metrics
        };
    }
}

module.exports = IntelligentCache;
