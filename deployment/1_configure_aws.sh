#!/bin/bash
# =============================================================================
# 1. Configure AWS CLI
# =============================================================================
# One-time setup for your local AWS CLI credentials.
# Run this before launching EC2 instances.
# =============================================================================

set -e

REGION="us-east-2"

echo ""
echo "=========================================="
echo "  AWS CLI Configuration"
echo "=========================================="
echo ""
echo "This will configure your local AWS CLI for EC2 management."
echo "Your credentials will be stored in ~/.aws/credentials"
echo ""
echo "Region: ${REGION} (Ohio)"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install it first:"
    echo ""
    echo "   macOS:   brew install awscli"
    echo "   Linux:   curl 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o 'awscliv2.zip' && unzip awscliv2.zip && sudo ./aws/install"
    echo ""
    exit 1
fi

# Prompt for credentials
read -p "AWS Access Key ID: " ACCESS_KEY
read -sp "AWS Secret Access Key: " SECRET_KEY
echo ""

# Validate input
if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
    echo ""
    echo "❌ Access Key and Secret Key are required."
    exit 1
fi

# Configure AWS CLI
echo ""
echo "Configuring AWS CLI..."
aws configure set aws_access_key_id "$ACCESS_KEY"
aws configure set aws_secret_access_key "$SECRET_KEY"
aws configure set region "$REGION"
aws configure set output json

echo ""
echo "Testing connection..."
if aws sts get-caller-identity; then
    echo ""
    echo "=========================================="
    echo "  ✅ AWS CLI Configured Successfully!"
    echo "=========================================="
    echo ""
    echo "Next step: Launch an EC2 instance"
    echo "  ./2_launch_instance.sh"
    echo ""
else
    echo ""
    echo "❌ Connection failed. Please check your credentials."
    exit 1
fi
