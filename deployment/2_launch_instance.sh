#!/bin/bash
# =============================================================================
# 2. Launch EC2 Instance
# =============================================================================
# Launches a new EC2 instance with proper security group configuration.
# Automatically creates security group if it doesn't exist.
# =============================================================================

set -e

# Configuration
REGION="us-east-2"
INSTANCE_TYPE="t3.micro"
AMI_ID="ami-0ea3c35c5c3284d82"  # Ubuntu 24.04 (us-east-2)
KEY_NAME="mcp-server-key"
SECURITY_GROUP_NAME="figma-mcp-sg"
INSTANCE_NAME="Figma-MCP-Server-2.0"

echo ""
echo "=========================================="
echo "  Launching EC2 Instance"
echo "=========================================="
echo ""
echo "Region:        ${REGION}"
echo "Instance Type: ${INSTANCE_TYPE}"
echo "AMI:           ${AMI_ID} (Ubuntu 24.04)"
echo "Key Pair:      ${KEY_NAME}"
echo ""

# Check if key pair exists
if ! aws ec2 describe-key-pairs --key-names "${KEY_NAME}" --region "${REGION}" &> /dev/null; then
    echo "❌ SSH key pair '${KEY_NAME}' not found in ${REGION}."
    echo ""
    echo "Create it with:"
    echo ""
    echo "  aws ec2 create-key-pair \\"
    echo "    --key-name ${KEY_NAME} \\"
    echo "    --region ${REGION} \\"
    echo "    --query 'KeyMaterial' \\"
    echo "    --output text > ~/.ssh/${KEY_NAME}.pem"
    echo ""
    echo "  chmod 400 ~/.ssh/${KEY_NAME}.pem"
    echo ""
    exit 1
fi

echo "✓ SSH key pair found"

# Check/create security group
echo ""
echo "Checking security group..."
SECURITY_GROUP_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${SECURITY_GROUP_NAME}" \
    --region "${REGION}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "None")

if [ "$SECURITY_GROUP_ID" = "None" ] || [ -z "$SECURITY_GROUP_ID" ]; then
    echo "Creating security group: ${SECURITY_GROUP_NAME}"
    
    SECURITY_GROUP_ID=$(aws ec2 create-security-group \
        --group-name "${SECURITY_GROUP_NAME}" \
        --description "Security group for Figma MCP Server - SSH and HTTP" \
        --region "${REGION}" \
        --query 'GroupId' \
        --output text)
    
    echo "  Adding SSH rule (port 22)..."
    aws ec2 authorize-security-group-ingress \
        --group-id "${SECURITY_GROUP_ID}" \
        --protocol tcp \
        --port 22 \
        --cidr 0.0.0.0/0 \
        --region "${REGION}" > /dev/null
    
    echo "  Adding HTTP rule (port 3333)..."
    aws ec2 authorize-security-group-ingress \
        --group-id "${SECURITY_GROUP_ID}" \
        --protocol tcp \
        --port 3333 \
        --cidr 0.0.0.0/0 \
        --region "${REGION}" > /dev/null
    
    echo "✓ Security group created: ${SECURITY_GROUP_ID}"
else
    echo "✓ Security group exists: ${SECURITY_GROUP_ID}"
fi

# Launch instance
echo ""
echo "Launching instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "${AMI_ID}" \
    --instance-type "${INSTANCE_TYPE}" \
    --key-name "${KEY_NAME}" \
    --security-group-ids "${SECURITY_GROUP_ID}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}}]" \
    --region "${REGION}" \
    --query 'Instances[0].InstanceId' \
    --output text)

echo "✓ Instance launched: ${INSTANCE_ID}"

# Wait for instance to be running
echo ""
echo "Waiting for instance to start..."
aws ec2 wait instance-running --instance-ids "${INSTANCE_ID}" --region "${REGION}"

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
    --instance-ids "${INSTANCE_ID}" \
    --region "${REGION}" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

echo "✓ Instance is running: ${PUBLIC_IP}"

# Wait for SSH to be ready
echo ""
echo "Waiting for SSH to be ready (60 seconds)..."
sleep 60

# Test SSH connection
echo ""
echo "Testing SSH connection..."
if ssh -i ~/.ssh/${KEY_NAME}.pem -o StrictHostKeyChecking=no -o ConnectTimeout=10 ubuntu@${PUBLIC_IP} "echo 'SSH OK'" 2>/dev/null; then
    echo "✓ SSH connection successful"
else
    echo "⚠ SSH not ready yet. Wait a bit longer before deploying."
fi

echo ""
echo "=========================================="
echo "  ✅ Instance Launched!"
echo "=========================================="
echo ""
echo "Instance ID:  ${INSTANCE_ID}"
echo "Public IP:    ${PUBLIC_IP}"
echo "Region:       ${REGION}"
echo ""
echo "Next step: Deploy the MCP server"
echo "  ./3_deploy_code.sh ${PUBLIC_IP}"
echo ""
echo "To terminate later:"
echo "  aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --region ${REGION}"
echo ""
