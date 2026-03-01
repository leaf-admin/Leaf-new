#!/bin/bash

# KYC Service Deployment Script
# Deploys the KYC service with all dependencies

set -e

echo "🚀 DEPLOYING KYC SERVICE..."
echo "====================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SERVICE_NAME="kyc-service"
SERVICE_DIR="/opt/kyc-service"
SERVICE_USER="kyc"
SERVICE_GROUP="kyc"
PYTHON_VERSION="3.9"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root"
   exit 1
fi

# Update system packages
log_info "Updating system packages..."
apt-get update -y

# Install system dependencies
log_info "Installing system dependencies..."
apt-get install -y \
    python3.9 \
    python3.9-dev \
    python3.9-venv \
    python3-pip \
    cmake \
    build-essential \
    libopencv-dev \
    libdlib-dev \
    libblas-dev \
    liblapack-dev \
    libatlas-base-dev \
    gfortran \
    redis-server \
    nginx \
    supervisor

# Create service user
log_info "Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd -r -s /bin/false -d "$SERVICE_DIR" "$SERVICE_USER"
    log_info "Created user: $SERVICE_USER"
else
    log_warn "User $SERVICE_USER already exists"
fi

# Create service directory
log_info "Creating service directory..."
mkdir -p "$SERVICE_DIR"
chown "$SERVICE_USER:$SERVICE_GROUP" "$SERVICE_DIR"

# Copy service files
log_info "Copying service files..."
cp -r . "$SERVICE_DIR/"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$SERVICE_DIR"

# Create Python virtual environment
log_info "Creating Python virtual environment..."
cd "$SERVICE_DIR"
sudo -u "$SERVICE_USER" python3.9 -m venv venv
sudo -u "$SERVICE_USER" "$SERVICE_DIR/venv/bin/pip" install --upgrade pip

# Install Python dependencies
log_info "Installing Python dependencies..."
sudo -u "$SERVICE_USER" "$SERVICE_DIR/venv/bin/pip" install -r requirements.txt

# Create logs directory
log_info "Creating logs directory..."
mkdir -p "$SERVICE_DIR/logs"
chown "$SERVICE_USER:$SERVICE_GROUP" "$SERVICE_DIR/logs"

# Create systemd service file
log_info "Creating systemd service..."
cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=KYC Face Verification Service
After=network.target redis.service
Requires=redis.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$SERVICE_DIR
Environment=PATH=$SERVICE_DIR/venv/bin
ExecStart=$SERVICE_DIR/venv/bin/python src/main.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create supervisor configuration
log_info "Creating supervisor configuration..."
cat > "/etc/supervisor/conf.d/$SERVICE_NAME.conf" << EOF
[program:$SERVICE_NAME]
command=$SERVICE_DIR/venv/bin/python src/main.py
directory=$SERVICE_DIR
user=$SERVICE_USER
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=$SERVICE_DIR/logs/supervisor.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=10
EOF

# Create nginx configuration
log_info "Creating nginx configuration..."
cat > "/etc/nginx/sites-available/$SERVICE_NAME" << EOF
server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000/docs;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable nginx site
ln -sf "/etc/nginx/sites-available/$SERVICE_NAME" "/etc/nginx/sites-enabled/$SERVICE_NAME"

# Configure Redis
log_info "Configuring Redis..."
cat > "/etc/redis/redis.conf" << EOF
# Redis configuration for KYC service
bind 127.0.0.1
port 6379
timeout 0
tcp-keepalive 300
daemonize yes
pidfile /var/run/redis/redis-server.pid
logfile /var/log/redis/redis-server.log
loglevel notice
databases 16
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /var/lib/redis
maxmemory 256mb
maxmemory-policy allkeys-lru
EOF

# Start and enable services
log_info "Starting and enabling services..."

# Start Redis
systemctl start redis-server
systemctl enable redis-server

# Reload systemd
systemctl daemon-reload

# Start KYC service
systemctl start "$SERVICE_NAME"
systemctl enable "$SERVICE_NAME"

# Start supervisor
systemctl start supervisor
systemctl enable supervisor

# Reload nginx
systemctl reload nginx

# Wait for service to start
log_info "Waiting for service to start..."
sleep 10

# Check service status
if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_info "✅ KYC service is running"
else
    log_error "❌ KYC service failed to start"
    systemctl status "$SERVICE_NAME"
    exit 1
fi

# Check Redis status
if systemctl is-active --quiet redis-server; then
    log_info "✅ Redis is running"
else
    log_error "❌ Redis failed to start"
    systemctl status redis-server
    exit 1
fi

# Test service endpoints
log_info "Testing service endpoints..."
sleep 5

# Test health endpoint
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    log_info "✅ Health endpoint is working"
else
    log_warn "⚠️ Health endpoint test failed"
fi

# Test root endpoint
if curl -s http://localhost:8000/ | grep -q "running"; then
    log_info "✅ Root endpoint is working"
else
    log_warn "⚠️ Root endpoint test failed"
fi

# Create monitoring script
log_info "Creating monitoring script..."
cat > "/usr/local/bin/kyc-monitor.sh" << 'EOF'
#!/bin/bash

# KYC Service Monitoring Script

SERVICE_NAME="kyc-service"
LOG_FILE="/var/log/kyc-monitor.log"

check_service() {
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        echo "$(date): KYC service is running" >> "$LOG_FILE"
        return 0
    else
        echo "$(date): KYC service is not running" >> "$LOG_FILE"
        systemctl restart "$SERVICE_NAME"
        return 1
    fi
}

check_redis() {
    if systemctl is-active --quiet redis-server; then
        echo "$(date): Redis is running" >> "$LOG_FILE"
        return 0
    else
        echo "$(date): Redis is not running" >> "$LOG_FILE"
        systemctl restart redis-server
        return 1
    fi
}

check_endpoints() {
    if curl -s http://localhost:8000/health | grep -q "healthy"; then
        echo "$(date): Health endpoint is working" >> "$LOG_FILE"
        return 0
    else
        echo "$(date): Health endpoint is not working" >> "$LOG_FILE"
        return 1
    fi
}

# Run checks
check_service
check_redis
check_endpoints
EOF

chmod +x "/usr/local/bin/kyc-monitor.sh"

# Create cron job for monitoring
log_info "Creating monitoring cron job..."
echo "*/5 * * * * /usr/local/bin/kyc-monitor.sh" | crontab -u root -

# Display service information
log_info "Deployment completed successfully!"
echo ""
echo "📋 SERVICE INFORMATION:"
echo "====================================================="
echo "Service Name: $SERVICE_NAME"
echo "Service Directory: $SERVICE_DIR"
echo "Service User: $SERVICE_USER"
echo "Python Version: $PYTHON_VERSION"
echo "API Endpoint: http://localhost:8000"
echo "Documentation: http://localhost:8000/docs"
echo "Health Check: http://localhost:8000/health"
echo ""
echo "📊 SERVICE STATUS:"
echo "====================================================="
systemctl status "$SERVICE_NAME" --no-pager -l
echo ""
echo "🔧 USEFUL COMMANDS:"
echo "====================================================="
echo "Start service:   systemctl start $SERVICE_NAME"
echo "Stop service:    systemctl stop $SERVICE_NAME"
echo "Restart service: systemctl restart $SERVICE_NAME"
echo "View logs:       journalctl -u $SERVICE_NAME -f"
echo "Monitor service: /usr/local/bin/kyc-monitor.sh"
echo ""
echo "✅ KYC SERVICE DEPLOYMENT COMPLETED!"

