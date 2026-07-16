#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Resolve paths relative to the script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${SCRIPT_DIR}/../frontend"

NAS_HOST="bvarnai@nas48"
NAS_DEST_DIR="/home/bvarnai/infra/nodes/nas48/etc/nginx/htdocs/lunagrid/"

echo "=== 1. Building Frontend Locally ==="
cd "${FRONTEND_DIR}"
npm run build

echo "=== 2. Creating Remote Directory on NAS ==="
ssh "${NAS_HOST}" "mkdir -p ${NAS_DEST_DIR}"

echo "=== 3. Uploading Static Assets via rsync ==="
# -a: archive mode, -v: verbose, -z: compress, --delete: delete extraneous files from destination
rsync -avz --delete "${FRONTEND_DIR}/dist/" "${NAS_HOST}:${NAS_DEST_DIR}"

echo "=== 4. Reloading Nginx Container on NAS ==="
ssh "${NAS_HOST}" "docker exec nginx nginx -s reload"

echo "=== Deployment Successful! ==="
