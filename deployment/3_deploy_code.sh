#!/bin/bash
# =============================================================================
# 3. Deploy Code to EC2
# =============================================================================
# Builds the project, uploads to EC2, and starts as a systemd service.
# Usage: ./3_deploy_code.sh <PUBLIC_IP>
# =============================================================================

set -e

if [ -z "$1" ]; then
    echo "Usage: ./3_deploy_code.sh <PUBLIC_IP>"
    echo ""
    echo "Example: ./3_deploy_code.sh 3.145.67.89"
    exit 1
fi

PUBLIC_IP=$1
KEY_NAME="mcp-server-key"
SSH_KEY="$HOME/.ssh/${KEY_NAME}.pem"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=30"

echo ""
echo "=========================================="
echo "  Deploying MCP Server to ${PUBLIC_IP}"
echo "=========================================="
echo ""

# Check SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH key not found: ${SSH_KEY}"
    exit 1
fi

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "Project root: ${PROJECT_ROOT}"
echo ""

# Build project
echo "Building project..."
pnpm build
echo "✓ Build complete"

# Create deployment package
echo ""
echo "Creating deployment package..."
PACKAGE_FILE="/tmp/mcp-server-2.0.tar.gz"
tar -czf "$PACKAGE_FILE" \
    dist/ \
    package.json \
    pnpm-lock.yaml

PACKAGE_SIZE=$(ls -lh "$PACKAGE_FILE" | awk '{print $5}')
echo "✓ Package created: ${PACKAGE_SIZE}"

# Upload to EC2
echo ""
echo "Uploading to EC2..."
scp -i "$SSH_KEY" $SSH_OPTS "$PACKAGE_FILE" ubuntu@${PUBLIC_IP}:~/
echo "✓ Upload complete"

# Install on EC2
echo ""
echo "Installing on EC2..."
ssh -i "$SSH_KEY" $SSH_OPTS ubuntu@${PUBLIC_IP} << 'REMOTE_SCRIPT'
set -e

echo ""
echo ">> Updating system packages..."
sudo apt-get update -y -qq

echo ""
echo ">> Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
node --version

echo ""
echo ">> Installing pnpm..."
if ! command -v pnpm &> /dev/null; then
    sudo npm install -g pnpm
fi
pnpm --version

echo ""
echo ">> Extracting deployment package..."
mkdir -p ~/mcp-server
cd ~/mcp-server
tar -xzf ~/mcp-server-2.0.tar.gz
rm ~/mcp-server-2.0.tar.gz

echo ""
echo ">> Installing dependencies..."
pnpm install --prod

echo ""
echo ">> Creating default .env..."
cat > .env << 'ENVFILE'
# Figma MCP Server 2.0 - Production
NODE_ENV=production
PORT=3333

# S3 credentials will be configured separately via 4_setup_s3.sh
# AWS_REGION=us-east-2
# AWS_BUCKET_NAME=your-bucket
# AWS_ACCESS_KEY_ID=your-key
# AWS_SECRET_ACCESS_KEY=your-secret
ENVFILE

echo ""
echo ">> Creating systemd service..."
sudo tee /etc/systemd/system/mcp-server.service > /dev/null << 'SERVICEFILE'
[Unit]
Description=Figma MCP Server 2.0
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mcp-server
ExecStart=/usr/bin/node dist/bin.js --host 0.0.0.0
Restart=always
RestartSec=10
EnvironmentFile=/home/ubuntu/mcp-server/.env

[Install]
WantedBy=multi-user.target
SERVICEFILE

echo ""
echo ">> Starting service..."
sudo systemctl daemon-reload
sudo systemctl enable mcp-server
sudo systemctl restart mcp-server

echo ""
echo ">> Service status:"
sudo systemctl status mcp-server --no-pager || true
REMOTE_SCRIPT

echo ""
echo "=========================================="
echo "  ✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Server URL: http://${PUBLIC_IP}:3333"
echo ""
echo "⚠️  Images/screenshots require S3 credentials."
echo "   Run: ./4_setup_s3.sh ${PUBLIC_IP}"
echo ""
echo "Server Management:"
echo "  Status:  ssh -i ${SSH_KEY} ubuntu@${PUBLIC_IP} 'sudo systemctl status mcp-server'"
echo "  Logs:    ssh -i ${SSH_KEY} ubuntu@${PUBLIC_IP} 'sudo journalctl -u mcp-server -f'"
echo "  Restart: ssh -i ${SSH_KEY} ubuntu@${PUBLIC_IP} 'sudo systemctl restart mcp-server'"
echo ""
