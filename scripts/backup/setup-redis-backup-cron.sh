#!/bin/bash

# Setup Redis Backup Cron Job
# Data: 29/07/2025
# Status: ✅ CRON SETUP

# Tornar o script executável
chmod +x /home/leaf/scripts/backup/redis-backup-automated.sh

# Criar cron job para backup a cada 6 horas
(crontab -l 2>/dev/null; echo "0 */6 * * * /home/leaf/scripts/backup/redis-backup-automated.sh") | crontab -

# Criar cron job para backup diário às 2h da manhã
(crontab -l 2>/dev/null; echo "0 2 * * * /home/leaf/scripts/backup/redis-backup-automated.sh") | crontab -

echo "✅ Cron jobs configurados para backup automático do Redis:"
echo "   - A cada 6 horas"
echo "   - Diário às 2h da manhã"
echo ""
echo "📁 Backups serão salvos em: /home/leaf/backups/redis/"
echo "📋 Logs serão salvos em: /var/log/redis-backup.log"
echo ""
echo "🔍 Para verificar os cron jobs: crontab -l"
echo "🔍 Para verificar os backups: ls -la /home/leaf/backups/redis/" 