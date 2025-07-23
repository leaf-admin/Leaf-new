// Tipos para métricas de latência
export interface LatencyPerformance {
  avgLatency: number;
  maxLatency: number;
  minLatency: number | null;
  totalOperations: number;
  errorRate: number;
}

export interface OperationStats {
  type: string;
  totalOperations: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  errorCount: number;
  errorRate: number;
  lastUpdated: number;
}

export interface LatencyAlert {
  type: 'HIGH_LATENCY' | 'HIGH_ERROR_RATE';
  operation: string;
  avgLatency?: number;
  errorRate?: number;
  message: string;
}

export interface LatencyReport {
  uptime: number;
  performance: LatencyPerformance;
  operations: Record<string, OperationStats>;
  alerts: LatencyAlert[];
}

// Tipos para métricas do Docker
export interface ContainerMetrics {
  name: string;
  status: string;
  cpu: number;
  memory: {
    usage: number;
    limit: number;
    percentage: number;
  };
  network: {
    rx: number;
    tx: number;
  };
  uptime: number;
  lastCheck: number;
}

export interface SystemResources {
  totalContainers: number;
  runningContainers: number;
  totalImages: number;
  diskUsage: number;
  lastCheck: number;
}

export interface HostMetrics {
  cpu: number;
  memory: number;
  uptime: number;
  lastCheck: number;
  totalMemory: number;
  usedMemory: number;
  freeMemory: number;
}

export interface RedisMetrics {
  status: string;
  connections: number;
  memory: number;
  operations: number;
  errors: number;
  latency: number;
  lastCheck: number;
  keyspace?: Record<string, string>;
  memoryUsage?: string;
  memoryPeak?: string;
}

export interface FirebaseMetrics {
  connections: number;
  operations: number;
  errors: number;
  latency: number;
  lastCheck: number;
  status?: string;
}

export interface ResourceAlert {
  id: string;
  type: string;
  message: string;
  severity: 'warning' | 'error' | 'critical';
  timestamp: number;
  acknowledged: boolean;
}

export interface ResourceSummary {
  status: 'healthy' | 'warning' | 'error' | 'critical';
  totalAlerts: number;
  criticalAlerts: number;
  errorAlerts: number;
  warningAlerts: number;
  containerStatus: string;
  redisStatus: string;
  uptime: number;
}

export interface ResourceReport {
  timestamp: number;
  container: ContainerMetrics;
  redis: RedisMetrics;
  firebase: FirebaseMetrics;
  system: SystemResources;
  host: HostMetrics;
  alerts: ResourceAlert[];
  summary: ResourceSummary;
}

// Tipos para alertas de sincronização
export interface SyncFailure {
  id: string;
  type: 'redis' | 'firebase' | 'sync';
  operation: string;
  error: string;
  timestamp: number;
  data?: any;
  retryCount: number;
}

export interface SyncAlert {
  id: string;
  type: 'SYNC_FAILURE';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  timestamp: number;
  acknowledged: boolean;
  failures: SyncFailure[];
  recommendations: string[];
}

export interface SyncSummary {
  status: 'healthy' | 'warning' | 'error' | 'critical';
  totalAlerts: number;
  criticalAlerts: number;
  errorAlerts: number;
  warningAlerts: number;
}

export interface SyncReport {
  timestamp: number;
  activeAlerts: number;
  totalFailures: number;
  recentFailures: number;
  alerts: SyncAlert[];
  failures: SyncFailure[];
  summary: SyncSummary;
}

// Tipos para métricas em tempo real
export interface RealTimeMetrics {
  operationsLastMinute: number;
  avgLatencyLastMinute: number;
  errorRateLastMinute: number;
  activeConnections: number;
}

export interface RealTimeReport {
  timestamp: string;
  latency: RealTimeMetrics;
  resources: {
    container: ContainerMetrics;
    redis: RedisMetrics;
    firebase: FirebaseMetrics;
  };
  system: SystemResources;
}

// Tipo simplificado para o backend atual
export interface SimpleMetrics {
  timestamp: string;
  container?: ContainerMetrics;
  redis?: RedisMetrics;
  system?: SystemResources;
  host?: HostMetrics;
  alerts?: ResourceAlert[];
  summary: {
    status: string;
    alerts?: number;
    uptime?: number | null;
    totalAlerts?: number;
    criticalAlerts?: number;
    errorAlerts?: number;
    warningAlerts?: number;
    activeConnections?: number;
    monitoringActive?: boolean;
  };
}

// Tipo principal para o dashboard
export interface DashboardMetrics {
  timestamp: string;
  latency: LatencyReport;
  resources: ResourceReport;
  sync: SyncReport;
  summary: {
    status: string;
    alerts: number;
    uptime: number;
  };
}

// Tipos para autenticação
export interface User {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

// Tipos para configurações do dashboard
export interface DashboardConfig {
  theme: 'light' | 'dark';
  refreshInterval: number;
  notifications: {
    enabled: boolean;
    sound: boolean;
    critical: boolean;
    error: boolean;
    warning: boolean;
  };
  charts: {
    timeRange: '1h' | '6h' | '24h' | '7d';
    autoRefresh: boolean;
  };
} 