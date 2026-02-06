#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${CONTAINER_IMAGE:-microclaw-agent:latest}"

echo "Building MicroClaw agent container: ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" -f "${SCRIPT_DIR}/Dockerfile" "${SCRIPT_DIR}/"

echo "Done. Image: ${IMAGE_NAME}"
