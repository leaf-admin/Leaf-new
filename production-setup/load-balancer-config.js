// Configurações de Load Balancing para Produção
const loadBalancerConfig = {
    // Configurações do Nginx
    nginx: {
        upstream: {
            name: 'leaf_backend',
            servers: [
                { host: 'localhost', port: 3001, weight: 1 },
                { host: 'localhost', port: 3002, weight: 1 },
                { host: 'localhost', port: 3003, weight: 1 }
            ],
            // Configurações de health check
            health_check: {
                interval: '10s',
                timeout: '5s',
                fails: 3,
                passes: 2
            }
        },
        
        // Configurações de rate limiting
        rate_limit: {
            zone: 'api_limit',
            rate: '100r/s', // 100 requests por segundo
            burst: 200,
            nodelay: true
        },
        
        // Configurações de WebSocket
        websocket: {
            proxy_read_timeout: '60s',
            proxy_send_timeout: '60s',
            proxy_connect_timeout: '10s',
            proxy_http_version: '1.1',
            proxy_set_header: {
                'Upgrade': '$http_upgrade',
                'Connection': 'upgrade',
                'Host': '$host',
                'X-Real-IP': '$remote_addr',
                'X-Forwarded-For': '$proxy_add_x_forwarded_for',
                'X-Forwarded-Proto': '$scheme'
            }
    },
    
    // Configurações do Redis Cluster
    redis: {
        cluster: {
            nodes: [
                { host: 'redis-1', port: 6379 },
                { host: 'redis-2', port: 6379 },
                { host: 'redis-3', port: 6379 }
            ],
            options: {
                scaleReads: 'slave',
                maxRedirections: 16,
                retryDelayOnFailover: 100,
                enableOfflineQueue: false
            }
        },
        
        // Configurações de sentinel (para alta disponibilidade)
        sentinel: {
            sentinels: [
                { host: 'sentinel-1', port: 26379 },
                { host: 'sentinel-2', port: 26379 },
                { host: 'sentinel-3', port: 26379 }
            ],
            name: 'mymaster',
            role: 'master'
        }
    },
    
    // Configurações de monitoramento
    monitoring: {
        // Prometheus metrics
        prometheus: {
            port: 9090,
            metrics: [
                'http_requests_total',
                'http_request_duration_seconds',
                'websocket_connections_total',
                'redis_operations_total',
                'driver_locations_total'
            ]
        },
        
        // Grafana dashboards
        grafana: {
            port: 3000,
            dashboards: [
                'leaf-backend-overview',
                'leaf-driver-activity',
                'leaf-redis-performance',
                'leaf-websocket-connections'
            ]
        },
        
        // Alertas
        alerts: {
            high_cpu: { threshold: 80, duration: '5m' },
            high_memory: { threshold: 85, duration: '5m' },
            connection_failures: { threshold: 10, duration: '1m' },
            redis_errors: { threshold: 5, duration: '1m' }
        }
    },
    
    // Configurações de auto-scaling
    autoScaling: {
        // Kubernetes HPA (Horizontal Pod Autoscaler)
        kubernetes: {
            minReplicas: 3,
            maxReplicas: 10,
            targetCPUUtilizationPercentage: 70,
            targetMemoryUtilizationPercentage: 80,
            scaleUpCooldown: '3m',
            scaleDownCooldown: '5m'
        },
        
        // AWS Auto Scaling Group
        aws: {
            minSize: 3,
            maxSize: 10,
            desiredCapacity: 3,
            healthCheckGracePeriod: 300,
            healthCheckType: 'ELB',
            cooldown: 300
        }
    },
    
    // Configurações de CDN
    cdn: {
        // CloudFront (AWS)
        cloudfront: {
            distribution: {
                enabled: true,
                priceClass: 'PriceClass_100',
                defaultCacheBehavior: {
                    targetOriginId: 'leaf-backend',
                    viewerProtocolPolicy: 'https-only',
                    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
                    cachedMethods: ['GET', 'HEAD'],
                    compress: true,
                    minTTL: 0,
                    defaultTTL: 86400,
                    maxTTL: 31536000
                }
        },
        
        // Cloudflare
        cloudflare: {
            enabled: true,
            cacheLevel: 'aggressive',
            minify: {
                css: true,
                js: true,
                html: true
            },
            rocketLoader: true,
            alwaysOnline: true
        }
    },
    
    // Configurações de segurança
    security: {
        // Rate limiting por IP
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutos
            max: 100, // limite por IP
            message: 'Too many requests from this IP'
        },
        
        // CORS
        cors: {
            origin: [
                'https://leaf-app.com',
                'https://www.leaf-app.com',
                'capacitor://localhost',
                'ionic://localhost'
            ],
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        },
        
        // Helmet (segurança HTTP)
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "wss:", "https:"]
                }
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
    },
    
    // Configurações de backup
    backup: {
        // Backup do Redis
        redis: {
            schedule: '0 2 * * *', // 2 AM diariamente
            retention: '30d',
            compression: true,
            encryption: true
        },
        
        // Backup do banco de dados
        database: {
            schedule: '0 1 * * *', // 1 AM diariamente
            retention: '90d',
            compression: true,
            encryption: true
        }
};

// Gerador de configuração Nginx
function generateNginxConfig() {
    const { upstream, rate_limit, websocket } = loadBalancerConfig.nginx;
    
    return `
# Configuração do upstream
upstream ${upstream.name} {
    ${upstream.servers.map(server => 
        `server ${server.host}:${server.port} weight=${server.weight};`
    ).join('\n    ')}
    
    # Health check
    keepalive 32;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=${rate_limit.zone}:10m rate=${rate_limit.rate};

# Configuração do servidor
server {
    listen 80;
    server_name leaf-app.com www.leaf-app.com;
    
    # Rate limiting
    limit_req zone=${rate_limit.zone} burst=${rate_limit.burst} nodelay;
    
    # WebSocket proxy
    location /socket.io/ {
        proxy_pass http://${upstream.name};
        proxy_http_version ${websocket.proxy_http_version};
        proxy_set_header Upgrade ${websocket.proxy_set_header.Upgrade};
        proxy_set_header Connection ${websocket.proxy_set_header.Connection};
        proxy_set_header Host ${websocket.proxy_set_header.Host};
        proxy_set_header X-Real-IP ${websocket.proxy_set_header['X-Real-IP']};
        proxy_set_header X-Forwarded-For ${websocket.proxy_set_header['X-Forwarded-For']};
        proxy_set_header X-Forwarded-Proto ${websocket.proxy_set_header['X-Forwarded-Proto']};
        proxy_read_timeout ${websocket.proxy_read_timeout};
        proxy_send_timeout ${websocket.proxy_send_timeout};
        proxy_connect_timeout ${websocket.proxy_connect_timeout};
    }
    
    # API REST
    location /api/ {
        proxy_pass http://${upstream.name};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
`;
}

// Gerador de configuração Docker Compose para produção
 = loadBalancerConfig.nginx;
    
    return `
# Configuração do upstream
upstream ${upstream.name} {
    ${upstream.servers.map(server => 
        `server ${server.host}:${server.port} weight=${server.weight};`
    ).join('\n    ')}
    
    # Health check
    keepalive 32;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=${rate_limit.zone}:10m rate=${rate_limit.rate};

# Configuração do servidor
server {
    listen 80;
    server_name leaf-app.com www.leaf-app.com;
    
    # Rate limiting
    limit_req zone=${rate_limit.zone} burst=${rate_limit.burst} nodelay;
    
    # WebSocket proxy
    location /socket.io/ {
        proxy_pass http://${upstream.name};
        proxy_http_version ${websocket.proxy_http_version};
        proxy_set_header Upgrade ${websocket.proxy_set_header.Upgrade};
        proxy_set_header Connection ${websocket.proxy_set_header.Connection};
        proxy_set_header Host ${websocket.proxy_set_header.Host};
        proxy_set_header X-Real-IP ${websocket.proxy_set_header['X-Real-IP']};
        proxy_set_header X-Forwarded-For ${websocket.proxy_set_header['X-Forwarded-For']};
        proxy_set_header X-Forwarded-Proto ${websocket.proxy_set_header['X-Forwarded-Proto']};
        proxy_read_timeout ${websocket.proxy_read_timeout};
        proxy_send_timeout ${websocket.proxy_send_timeout};
        proxy_connect_timeout ${websocket.proxy_connect_timeout};
    }
    
    # API REST
    location /api/ {
        proxy_pass http://${upstream.name};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
`;
}

// Gerador de configuração Docker Compose para produção
function generateDockerCompose() {
    return `
version: '3.8'

services:
  # Backend instances
  leaf-backend-1:
    build: ./leaf-websocket-backend
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis-cluster:6379
    depends_on:
      - redis-cluster
    restart: unless-stopped

  leaf-backend-2:
    build: ./leaf-websocket-backend
    ports:
      - "3002:3001"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis-cluster:6379
    depends_on:
      - redis-cluster
    restart: unless-stopped

  leaf-backend-3:
    build: ./leaf-websocket-backend
    ports:
      - "3003:3001"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis-cluster:6379
    depends_on:
      - redis-cluster
    restart: unless-stopped

  # Redis Cluster
  redis-cluster:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --cluster-enabled yes --cluster-config-file nodes.conf --cluster-node-timeout 5000
    volumes:
      - redis-data:/data
    restart: unless-stopped

  # Nginx Load Balancer
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - leaf-backend-1
      - leaf-backend-2
      - leaf-backend-3
    restart: unless-stopped

  # Monitoring
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    restart: unless-stopped

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
    restart: unless-stopped

volumes:
  redis-data:
  grafana-data:
`;
}

module.exports = {
    loadBalancerConfig,
    generateNginxConfig,
    generateDockerCompose
}; 
const loadBalancerConfig = {
    // Configurações do Nginx
    nginx: {
        upstream: {
            name: 'leaf_backend',
            servers: [
                { host: 'localhost', port: 3001, weight: 1 },
                { host: 'localhost', port: 3002, weight: 1 },
                { host: 'localhost', port: 3003, weight: 1 }
            ],
            // Configurações de health check
            health_check: {
                interval: '10s',
                timeout: '5s',
                fails: 3,
                passes: 2
            }
        },
        
        // Configurações de rate limiting
        rate_limit: {
            zone: 'api_limit',
            rate: '100r/s', // 100 requests por segundo
            burst: 200,
            nodelay: true
        },
        
        // Configurações de WebSocket
        websocket: {
            proxy_read_timeout: '60s',
            proxy_send_timeout: '60s',
            proxy_connect_timeout: '10s',
            proxy_http_version: '1.1',
            proxy_set_header: {
                'Upgrade': '$http_upgrade',
                'Connection': 'upgrade',
                'Host': '$host',
                'X-Real-IP': '$remote_addr',
                'X-Forwarded-For': '$proxy_add_x_forwarded_for',
                'X-Forwarded-Proto': '$scheme'
            }
    },
    
    // Configurações do Redis Cluster
    redis: {
        cluster: {
            nodes: [
                { host: 'redis-1', port: 6379 },
                { host: 'redis-2', port: 6379 },
                { host: 'redis-3', port: 6379 }
            ],
            options: {
                scaleReads: 'slave',
                maxRedirections: 16,
                retryDelayOnFailover: 100,
                enableOfflineQueue: false
            }
        },
        
        // Configurações de sentinel (para alta disponibilidade)
        sentinel: {
            sentinels: [
                { host: 'sentinel-1', port: 26379 },
                { host: 'sentinel-2', port: 26379 },
                { host: 'sentinel-3', port: 26379 }
            ],
            name: 'mymaster',
            role: 'master'
        }
    },
    
    // Configurações de monitoramento
    monitoring: {
        // Prometheus metrics
        prometheus: {
            port: 9090,
            metrics: [
                'http_requests_total',
                'http_request_duration_seconds',
                'websocket_connections_total',
                'redis_operations_total',
                'driver_locations_total'
            ]
        },
        
        // Grafana dashboards
        grafana: {
            port: 3000,
            dashboards: [
                'leaf-backend-overview',
                'leaf-driver-activity',
                'leaf-redis-performance',
                'leaf-websocket-connections'
            ]
        },
        
        // Alertas
        alerts: {
            high_cpu: { threshold: 80, duration: '5m' },
            high_memory: { threshold: 85, duration: '5m' },
            connection_failures: { threshold: 10, duration: '1m' },
            redis_errors: { threshold: 5, duration: '1m' }
        }
    },
    
    // Configurações de auto-scaling
    autoScaling: {
        // Kubernetes HPA (Horizontal Pod Autoscaler)
        kubernetes: {
            minReplicas: 3,
            maxReplicas: 10,
            targetCPUUtilizationPercentage: 70,
            targetMemoryUtilizationPercentage: 80,
            scaleUpCooldown: '3m',
            scaleDownCooldown: '5m'
        },
        
        // AWS Auto Scaling Group
        aws: {
            minSize: 3,
            maxSize: 10,
            desiredCapacity: 3,
            healthCheckGracePeriod: 300,
            healthCheckType: 'ELB',
            cooldown: 300
        }
    },
    
    // Configurações de CDN
    cdn: {
        // CloudFront (AWS)
        cloudfront: {
            distribution: {
                enabled: true,
                priceClass: 'PriceClass_100',
                defaultCacheBehavior: {
                    targetOriginId: 'leaf-backend',
                    viewerProtocolPolicy: 'https-only',
                    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
                    cachedMethods: ['GET', 'HEAD'],
                    compress: true,
                    minTTL: 0,
                    defaultTTL: 86400,
                    maxTTL: 31536000
                }
        },
        
        // Cloudflare
        cloudflare: {
            enabled: true,
            cacheLevel: 'aggressive',
            minify: {
                css: true,
                js: true,
                html: true
            },
            rocketLoader: true,
            alwaysOnline: true
        }
    },
    
    // Configurações de segurança
    security: {
        // Rate limiting por IP
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutos
            max: 100, // limite por IP
            message: 'Too many requests from this IP'
        },
        
        // CORS
        cors: {
            origin: [
                'https://leaf-app.com',
                'https://www.leaf-app.com',
                'capacitor://localhost',
                'ionic://localhost'
            ],
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        },
        
        // Helmet (segurança HTTP)
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "wss:", "https:"]
                }
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
    },
    
    // Configurações de backup
    backup: {
        // Backup do Redis
        redis: {
            schedule: '0 2 * * *', // 2 AM diariamente
            retention: '30d',
            compression: true,
            encryption: true
        },
        
        // Backup do banco de dados
        database: {
            schedule: '0 1 * * *', // 1 AM diariamente
            retention: '90d',
            compression: true,
            encryption: true
        }
};

// Gerador de configuração Nginx


module.exports = {
    loadBalancerConfig,
    generateNginxConfig,
    generateDockerCompose
}; 