# HAG Deployment Guide

This guide provides comprehensive instructions for deploying HAG (Home Assistant aGentic HVAC Automation) to production environments.

## 📋 Pre-Deployment Checklist

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- **Runtime**: Deno 2.0+
- **Memory**: Minimum 512MB RAM, Recommended 1GB+
- **CPU**: Minimum 2 cores, Recommended 4+ cores
- **Storage**: 1GB free space
- **Network**: Stable connection to Home Assistant and internet (for AI features)

### Prerequisites

- [ ] Home Assistant instance running and accessible
- [ ] Long-lived access token generated in Home Assistant
- [ ] OpenAI API key (optional, for AI features)
- [ ] HVAC entities configured in Home Assistant
- [ ] Temperature sensors configured and reporting

## 🔧 Environment Setup

### 1. Install Deno

```bash
# Install Deno using the official installer
curl -fsSL https://deno.land/install.sh | sh

# Add to PATH (add to ~/.bashrc or ~/.zshrc for persistence)
export PATH="$HOME/.deno/bin:$PATH"

# Verify installation
deno --version
```

### 2. Create System User

```bash
# Create dedicated user for HAG
sudo useradd -r -s /bin/false -d /opt/hag hag

# Create application directory
sudo mkdir -p /opt/hag
sudo chown hag:hag /opt/hag

# Create config directory
sudo mkdir -p /etc/hag
sudo chown hag:hag /etc/hag

# Create log directory
sudo mkdir -p /var/log/hag
sudo chown hag:hag /var/log/hag
```

### 3. Download and Build HAG

```bash
# Clone repository
git clone https://github.com/your-org/hag_js.git /tmp/hag_js
cd /tmp/hag_js

# Build production binary
deno task build

# Copy binary to system location
sudo cp hag /opt/hag/
sudo chown hag:hag /opt/hag/hag
sudo chmod +x /opt/hag/hag

# Copy configuration template
sudo cp config.example.yaml /etc/hag/config.yaml
sudo chown hag:hag /etc/hag/config.yaml

# Cleanup
rm -rf /tmp/hag_js
```

## ⚙️ Configuration

### 1. Environment Variables

Create `/etc/hag/environment`:

```bash
# Home Assistant Configuration
HASS_URL=http://homeassistant.local:8123
HASS_TOKEN=your_long_lived_access_token

# AI Configuration (Optional)
OPENAI_API_KEY=sk-your-openai-api-key

# Application Configuration
NODE_ENV=production
LOG_LEVEL=info
PORT=8080

# Security
HTTPS_ENABLED=true
SSL_CERT_PATH=/etc/ssl/certs/hag.crt
SSL_KEY_PATH=/etc/ssl/private/hag.key
```

```bash
# Set proper permissions
sudo chown hag:hag /etc/hag/environment
sudo chmod 600 /etc/hag/environment
```

### 2. Main Configuration

Edit `/etc/hag/config.yaml`:

```yaml
# Home Assistant Integration
homeAssistant:
  url: "${HASS_URL}"
  token: "${HASS_TOKEN}"
  websocket:
    reconnectInterval: 5000
    maxReconnectAttempts: 10
  
# HVAC Configuration
hvac:
  tempSensor: "sensor.indoor_temperature"
  outdoorSensor: "sensor.outdoor_temperature"
  humiditySensor: "sensor.humidity"
  occupancySensor: "binary_sensor.occupancy"
  
  heating:
    enabled: true
    switch: "switch.heating"
    temperatureThresholds:
      low: 18
      high: 24
    minRunTime: 15
    maxCyclesPerHour: 4
    
  cooling:
    enabled: true
    switch: "switch.cooling"
    temperatureThresholds:
      low: 20
      high: 26
    minRunTime: 15
    maxCyclesPerHour: 4

# AI Configuration
ai:
  enabled: true
  openai:
    apiKey: "${OPENAI_API_KEY}"
    model: "gpt-4"
    temperature: 0.3
    maxTokens: 1000
    timeout: 30000
  
  decisionEngine:
    enabled: true
    confidenceThreshold: 0.7
    fallbackToRule: true
    
  optimization:
    comfortWeight: 0.5
    energyWeight: 0.3
    costWeight: 0.2
    
  learning:
    enabled: true
    learningRate: 0.2
    adaptationWindow: 14
    
  scheduling:
    enabled: true
    defaultLookaheadHours: 8
    autoOptimization: true

# Monitoring Configuration
monitoring:
  enabled: true
  dashboard:
    enabled: true
    port: 8080
    refreshInterval: 30
  
  alerts:
    enabled: true
    maxDecisionLatency: 1000
    minComfortScore: 0.6
    maxErrorRate: 0.05
    
  metrics:
    retention: 7 # days
    exportEnabled: true

# Performance Configuration
performance:
  caching:
    enabled: true
    maxSize: 1000
    ttl: 300
  
  optimization:
    enabled: true
    memoryThreshold: 512 # MB
    cpuThreshold: 80 # percentage
    
# Logging Configuration
logging:
  level: "${LOG_LEVEL}"
  format: "json"
  file: "/var/log/hag/application.log"
  maxSize: "100MB"
  maxFiles: 10
  
# Security Configuration
security:
  https:
    enabled: "${HTTPS_ENABLED:-false}"
    certPath: "${SSL_CERT_PATH}"
    keyPath: "${SSL_KEY_PATH}"
    
  authentication:
    enabled: false
    type: "basic" # or "jwt"
    
  rateLimit:
    enabled: true
    windowMs: 60000 # 1 minute
    maxRequests: 100
```

## 🚀 Service Configuration

### 1. Systemd Service

Create `/etc/systemd/system/hag.service`:

```ini
[Unit]
Description=HAG AI HVAC Controller
Documentation=https://github.com/your-org/hag_js
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hag
Group=hag
WorkingDirectory=/opt/hag
EnvironmentFile=/etc/hag/environment
ExecStart=/opt/hag/hag start --config /etc/hag/config.yaml
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=10
TimeoutStartSec=30
TimeoutStopSec=30

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/hag
CapabilityBoundingSet=

# Resource limits
MemoryLimit=1G
TasksMax=100

[Install]
WantedBy=multi-user.target
```

### 2. Enable and Start Service

```bash
# Reload systemd configuration
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable hag

# Start the service
sudo systemctl start hag

# Check service status
sudo systemctl status hag

# View logs
sudo journalctl -u hag -f
```

## 🔒 Security Hardening

### 1. SSL/TLS Configuration

```bash
# Generate self-signed certificate (for testing)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/hag.key \
  -out /etc/ssl/certs/hag.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=hag.local"

# Set proper permissions
sudo chmod 600 /etc/ssl/private/hag.key
sudo chmod 644 /etc/ssl/certs/hag.crt
```

For production, use Let's Encrypt:

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d your-domain.com

# Update paths in environment file
HTTPS_ENABLED=true
SSL_CERT_PATH=/etc/letsencrypt/live/your-domain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/your-domain.com/privkey.pem
```

### 2. Firewall Configuration

```bash
# Configure UFW (Ubuntu/Debian)
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 8080/tcp  # HAG dashboard
sudo ufw allow 8443/tcp  # HAG HTTPS (if enabled)

# For more restrictive access, limit to specific IPs
sudo ufw allow from 192.168.1.0/24 to any port 8080
```

### 3. Fail2Ban Configuration

Create `/etc/fail2ban/jail.local`:

```ini
[hag]
enabled = true
port = 8080,8443
filter = hag
logpath = /var/log/hag/application.log
maxretry = 5
bantime = 3600
findtime = 600
```

Create `/etc/fail2ban/filter.d/hag.conf`:

```ini
[Definition]
failregex = ^.*"level":"error".*"ip":"<HOST>".*"message":"Authentication failed".*$
ignoreregex =
```

## 📊 Monitoring Setup

### 1. Log Rotation

Create `/etc/logrotate.d/hag`:

```
/var/log/hag/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 hag hag
    postrotate
        systemctl reload hag
    endscript
}
```

### 2. Health Check Script

Create `/opt/hag/health-check.sh`:

```bash
#!/bin/bash

# Health check script for HAG
set -e

# Configuration
HAG_URL="http://localhost:8080"
TIMEOUT=30
LOG_FILE="/var/log/hag/health-check.log"

# Function to log with timestamp
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Check if HAG is responding
if curl -f -s --max-time "$TIMEOUT" "$HAG_URL/health" > /dev/null; then
    log "HAG health check: PASSED"
    exit 0
else
    log "HAG health check: FAILED"
    exit 1
fi
```

```bash
# Make executable
sudo chmod +x /opt/hag/health-check.sh
sudo chown hag:hag /opt/hag/health-check.sh

# Add to crontab for regular health checks
sudo crontab -u hag -e
# Add this line:
# */5 * * * * /opt/hag/health-check.sh
```

### 3. Monitoring Integration

#### Prometheus Metrics

If using Prometheus, configure metrics endpoint in `config.yaml`:

```yaml
monitoring:
  prometheus:
    enabled: true
    port: 9090
    path: "/metrics"
```

#### Grafana Dashboard

Import the HAG Grafana dashboard (dashboard ID: coming soon) or create custom panels for:

- System health status
- HVAC operation metrics
- AI decision performance
- Energy efficiency trends
- Alert frequency

## 🔄 Backup and Recovery

### 1. Backup Script

Create `/opt/hag/backup.sh`:

```bash
#!/bin/bash

# HAG Backup Script
BACKUP_DIR="/opt/hag/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="hag_backup_$DATE.tar.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup
tar -czf "$BACKUP_DIR/$BACKUP_FILE" \
    /etc/hag/ \
    /var/log/hag/ \
    /opt/hag/data/ 2>/dev/null || true

# Keep only last 30 backups
find "$BACKUP_DIR" -name "hag_backup_*.tar.gz" -type f -mtime +30 -delete

echo "Backup created: $BACKUP_FILE"
```

### 2. Automated Backups

```bash
# Add to crontab for daily backups
sudo crontab -u hag -e
# Add this line:
# 0 2 * * * /opt/hag/backup.sh
```

### 3. Recovery Procedure

```bash
# Stop service
sudo systemctl stop hag

# Extract backup
cd /
sudo tar -xzf /opt/hag/backups/hag_backup_YYYYMMDD_HHMMSS.tar.gz

# Restore permissions
sudo chown -R hag:hag /etc/hag /var/log/hag /opt/hag/data

# Start service
sudo systemctl start hag
```

## 🚀 Deployment Strategies

### 1. Blue-Green Deployment

```bash
# Current deployment in /opt/hag
# New deployment in /opt/hag-new

# Build new version
cd /tmp/hag_js
git pull origin main
deno task build

# Deploy to staging directory
sudo mkdir -p /opt/hag-new
sudo cp hag /opt/hag-new/
sudo chown hag:hag /opt/hag-new/hag

# Test new version
sudo -u hag /opt/hag-new/hag --config /etc/hag/config.yaml test

# Switch deployments
sudo systemctl stop hag
sudo mv /opt/hag /opt/hag-old
sudo mv /opt/hag-new /opt/hag
sudo systemctl start hag

# Verify deployment
sudo systemctl status hag

# Clean up old version if successful
sudo rm -rf /opt/hag-old
```

### 2. Rolling Updates

For multiple instances behind a load balancer:

```bash
# Update instances one by one
for instance in hag-1 hag-2 hag-3; do
    echo "Updating $instance..."
    
    # Remove from load balancer
    # Update instance
    # Health check
    # Add back to load balancer
    
    sleep 30  # Allow stabilization
done
```

## 🔍 Troubleshooting

### Common Issues

#### Service Won't Start

```bash
# Check logs
sudo journalctl -u hag -n 50

# Check configuration
sudo -u hag /opt/hag/hag --config /etc/hag/config.yaml validate

# Check permissions
ls -la /opt/hag/
ls -la /etc/hag/
ls -la /var/log/hag/
```

#### High Memory Usage

```bash
# Monitor memory
watch -n 5 'ps aux | grep hag'

# Check for memory leaks in logs
sudo grep "memory" /var/log/hag/application.log

# Restart service if needed
sudo systemctl restart hag
```

#### Connection Issues

```bash
# Test Home Assistant connectivity
curl -H "Authorization: Bearer $HASS_TOKEN" $HASS_URL/api/

# Check network connectivity
ping homeassistant.local

# Verify DNS resolution
nslookup homeassistant.local
```

### Performance Tuning

#### System Optimization

```bash
# Increase file descriptor limits
echo "hag soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "hag hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# Optimize network settings
echo "net.core.somaxconn = 1024" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 1024" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

#### Application Tuning

Update `config.yaml`:

```yaml
performance:
  caching:
    maxSize: 2000  # Increase cache size
    ttl: 600       # Increase TTL
    
  optimization:
    memoryThreshold: 768  # Adjust for available RAM
    cpuThreshold: 70      # Lower threshold for earlier optimization
    
  concurrency:
    maxConnections: 100
    maxConcurrentTasks: 8
```

## 📈 Scaling

### Horizontal Scaling

For high-availability setups:

1. **Load Balancer Configuration**:
   - Use HAProxy or nginx for load balancing
   - Configure health checks
   - Enable session affinity if needed

2. **Shared State**:
   - Use Redis for shared caching
   - Database for persistent data
   - Shared filesystem for logs

3. **Service Discovery**:
   - Consider using Consul or etcd
   - Implement automatic service registration

### Vertical Scaling

- Increase RAM allocation in systemd service
- Add more CPU cores
- Use SSD storage for better I/O performance

## 🏆 Production Checklist

Before going live:

- [ ] All tests pass (`deno task test`)
- [ ] Production readiness validation passes
- [ ] SSL/TLS certificates configured
- [ ] Firewall rules configured
- [ ] Monitoring and alerting setup
- [ ] Backup procedures tested
- [ ] Health checks configured
- [ ] Log rotation setup
- [ ] Security hardening applied
- [ ] Performance baseline established
- [ ] Documentation updated
- [ ] Team trained on operations

## 📞 Support

For deployment issues:

- Check the troubleshooting section above
- Review system logs: `sudo journalctl -u hag`
- Check application logs: `sudo tail -f /var/log/hag/application.log`
- Validate configuration: `/opt/hag/hag validate`
- Run health checks: `/opt/hag/hag health`

For additional support, visit our [GitHub Issues](https://github.com/your-org/hag_js/issues) page.

---

**Happy deploying! 🚀**