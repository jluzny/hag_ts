#!/bin/bash

# HAG HVAC Production Deployment Script
# This script deploys the HAG HVAC system to production

set -e

# Configuration
DEPLOY_DIR="/opt/hag-hvac"
SERVICE_NAME="hag-hvac"
USER="hag"
GROUP="hag"

echo "🚀 Starting HAG HVAC production deployment..."

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root for production deployment"
   exit 1
fi

# Create user and group if they don't exist
if ! id "$USER" &>/dev/null; then
    echo "👤 Creating user: $USER"
    useradd -r -s /bin/bash -d "$DEPLOY_DIR" "$USER"
fi

# Create deployment directory
echo "📁 Creating deployment directory: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Stop existing service if running
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "🛑 Stopping existing service: $SERVICE_NAME"
    systemctl stop "$SERVICE_NAME"
fi

# Copy application files
echo "📋 Copying application files..."
cp -r src/ "$DEPLOY_DIR/"
cp -r config/ "$DEPLOY_DIR/"
cp deno.json "$DEPLOY_DIR/"
cp deno.lock "$DEPLOY_DIR/"

# Set ownership
echo "🔐 Setting file ownership..."
chown -R "$USER:$GROUP" "$DEPLOY_DIR"

# Install systemd service
echo "⚙️ Installing systemd service..."
cp config/hag-hvac.service /etc/systemd/system/
systemctl daemon-reload

# Enable and start service
echo "🔄 Enabling and starting service..."
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

# Check service status
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "✅ Service started successfully!"
    echo "📊 Service status:"
    systemctl status "$SERVICE_NAME" --no-pager -l
else
    echo "❌ Service failed to start!"
    echo "📋 Service logs:"
    journalctl -u "$SERVICE_NAME" --no-pager -l
    exit 1
fi

echo ""
echo "🎉 Production deployment completed successfully!"
echo ""
echo "📚 Useful commands:"
echo "  Status:   systemctl status $SERVICE_NAME"
echo "  Logs:     journalctl -u $SERVICE_NAME -f"
echo "  Restart:  systemctl restart $SERVICE_NAME"
echo "  Stop:     systemctl stop $SERVICE_NAME"
echo ""
echo "⚠️  Remember to:"
echo "  1. Set your Home Assistant token in the service file"
echo "  2. Update the config file with your specific settings"
echo "  3. Monitor logs for any issues"