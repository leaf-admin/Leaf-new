import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, AlertTriangle, AlertCircle, AlertOctagon } from 'lucide-react';
import { ResourceAlert, SyncAlert } from '../types/metrics';

interface NotificationBellProps {
  resourceAlerts: ResourceAlert[];
  syncAlerts: SyncAlert[];
  onAcknowledgeAlert: (alertId: string) => void;
}

const NotificationBell: React.FC<NotificationBellProps> = ({
  resourceAlerts,
  syncAlerts,
  onAcknowledgeAlert,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Combinar todos os alertas
  const allAlerts = [
    ...resourceAlerts.map(alert => ({ ...alert, source: 'resource' as const })),
    ...syncAlerts.map(alert => ({ ...alert, source: 'sync' as const })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const unacknowledgedAlerts = allAlerts.filter(alert => !alert.acknowledged);
  const alertCount = unacknowledgedAlerts.length;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertOctagon className="h-4 w-4 text-critical-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-error-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-warning-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-critical-200 bg-critical-50';
      case 'error':
        return 'border-error-200 bg-error-50';
      case 'warning':
        return 'border-warning-200 bg-warning-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Agora';
    if (diffInMinutes < 60) return `${diffInMinutes}m atrás`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h atrás`;
    return date.toLocaleDateString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botão do Sino */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
      >
        <Bell className="h-6 w-6" />
        
        {/* Badge de contagem */}
        {alertCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-error-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
            {alertCount > 99 ? '99+' : alertCount}
          </span>
        )}
      </button>

      {/* Dropdown de Notificações */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Notificações
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {alertCount} não lida{alertCount !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="p-2">
            {unacknowledgedAlerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Bell className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Nenhuma notificação</p>
              </div>
            ) : (
              <div className="space-y-2">
                {unacknowledgedAlerts.slice(0, 10).map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)} transition-all hover:shadow-md`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-2 flex-1">
                        {getSeverityIcon(alert.severity)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {alert.message}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {formatTimestamp(alert.timestamp)}
                          </p>
                          {alert.source === 'sync' && alert.recommendations && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Recomendações:
                              </p>
                              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                                {alert.recommendations.slice(0, 2).map((rec, index) => (
                                  <li key={index} className="flex items-center">
                                    <span className="w-1 h-1 bg-gray-400 rounded-full mr-2"></span>
                                    {rec}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-2"
                        title="Marcar como lida"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {unacknowledgedAlerts.length > 10 && (
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                +{unacknowledgedAlerts.length - 10} mais notificações
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell; 