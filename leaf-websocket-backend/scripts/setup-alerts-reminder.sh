#!/bin/bash

# Script de lembrete para configurar alertas às 22:00

echo "🔔 LEMBRETE: Configurar Sistema de Alertas"
echo "⏰ Horário: Hoje às 22:00"
echo ""
echo "📋 Passos para configurar:"
echo ""
echo "1. Iniciar monitoramento:"
echo "   cd leaf-websocket-backend"
echo "   ./scripts/start-alert-monitor.sh start"
echo ""
echo "2. Verificar status:"
echo "   ./scripts/start-alert-monitor.sh status"
echo ""
echo "3. Ver logs:"
echo "   tail -f /var/log/leaf-server-alerts.log"
echo ""
echo "4. Ver alertas via API:"
echo "   curl http://216.238.107.59:3001/api/alerts"
echo ""
echo "📚 Documentação: monitoring/README-ALERTS.md"
echo ""
echo "💡 Para ver este lembrete novamente:"
echo "   cat leaf-websocket-backend/LEMBRETE-ALERTAS-22h.md"


