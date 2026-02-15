#!/bin/bash
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  🚀 Local Deploy Script for Performance Agent Website
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
#  Usage:
#    ./deploy.sh website     → Deploy only website changes (HTML/CSS/JS)
#    ./deploy.sh full        → Full rebuild with node_modules (Docker image)
#    ./deploy.sh             → Interactive menu
#
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -euo pipefail

# ─── Load .env if present ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# ─── Config ───────────────────────────────────────────────────
RESOURCE_GROUP="perf-agent-website-rg"
CONTAINER_APP_NAME="perf-agent-website"
ACR_NAME="perfagentwebsite"
IMAGE_NAME="perf-agent-website"
ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERR]${NC}   $1"; }
header(){ echo -e "\n${BOLD}━━━ $1 ━━━${NC}"; }

# ─── Pre-flight checks ───────────────────────────────────────
preflight() {
    header "Pre-flight Checks"

    if ! command -v az &>/dev/null; then
        err "Azure CLI not found. Install: https://aka.ms/install-azure-cli"
        exit 1
    fi
    ok "Azure CLI found"

    # Check login
    if ! az account show &>/dev/null; then
        warn "Not logged into Azure. Running 'az login'..."
        az login
    fi
    ok "Azure CLI authenticated"

    # Verify resource group exists
    if ! az group show --name "$RESOURCE_GROUP" &>/dev/null; then
        err "Resource group '$RESOURCE_GROUP' not found"
        exit 1
    fi
    ok "Resource group '$RESOURCE_GROUP' exists"
}

# ─── Get app URL ──────────────────────────────────────────────
get_app_url() {
    az containerapp show \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query properties.configuration.ingress.fqdn -o tsv
}

# ─── Health check ─────────────────────────────────────────────
health_check() {
    local app_url="$1"
    header "Health Check"
    log "Waiting 15s for revision to start..."
    sleep 15

    for i in {1..5}; do
        if curl -sf "https://${app_url}/health" -o /dev/null; then
            ok "Health check passed!"
            curl -s "https://${app_url}/health" | python3 -m json.tool 2>/dev/null || true
            return 0
        fi
        warn "Attempt $i/5 failed, retrying in 8s..."
        sleep 8
    done

    err "Health check failed after 5 attempts"
    return 1
}

# ─── Deployment summary ──────────────────────────────────────
summary() {
    local app_url="$1"
    local mode="$2"
    echo ""
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}  ✅ Deployment Successful!${NC}"
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  Mode:    ${BOLD}${mode}${NC}"
    echo -e "  URL:     ${BOLD}https://${app_url}${NC}"
    echo -e "  Health:  ${BOLD}https://${app_url}/health${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  MODE 1: Website-only deploy (HTML/CSS/JS + server.js)
#  → Copies changed files into the running container revision
#    by rebuilding ONLY the app layer (no npm install)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
deploy_website() {
    header "🌐 Website-Only Deploy (skip node_modules)"

    log "Building image with cached node_modules layer..."

    # Use a Dockerfile that skips npm install by leveraging cache
    local IMAGE_TAG="web-$(date +%Y%m%d%H%M%S)"

    # ACR build uses layer cache — since package.json hasn't changed,
    # the npm install layer is reused. Only the COPY server.js / public/ layers rebuild.
    az acr build \
        --registry "$ACR_NAME" \
        --image "${IMAGE_NAME}:${IMAGE_TAG}" \
        --image "${IMAGE_NAME}:latest" \
        . 2>&1 | tail -5

    ok "Image built: ${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}"

    header "Deploying to Container App"
    az containerapp update \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --image "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}" \
        --set-env-vars NODE_ENV=production PORT=8000 GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
        -o none

    ok "Container App updated"

    local app_url
    app_url=$(get_app_url)
    health_check "$app_url"
    summary "$app_url" "Website-only (HTML/CSS/JS)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  MODE 2: Full deploy (includes npm install / node_modules)
#  → Clean Docker build with --no-cache on the npm layer
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
deploy_full() {
    header "📦 Full Deploy (rebuild with node_modules)"

    local IMAGE_TAG="full-$(date +%Y%m%d%H%M%S)"

    log "Building full image (no cache — fresh npm install)..."

    az acr build \
        --registry "$ACR_NAME" \
        --image "${IMAGE_NAME}:${IMAGE_TAG}" \
        --image "${IMAGE_NAME}:latest" \
        --no-cache \
        . 2>&1 | tail -5

    ok "Image built: ${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}"

    header "Deploying to Container App"
    az containerapp update \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --image "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}" \
        --set-env-vars NODE_ENV=production PORT=8000 GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
        -o none

    ok "Container App updated"

    local app_url
    app_url=$(get_app_url)
    health_check "$app_url"
    summary "$app_url" "Full (with node_modules rebuild)"
}

# ─── Interactive menu ─────────────────────────────────────────
show_menu() {
    echo ""
    echo -e "${BOLD}🚀 Performance Agent Website — Local Deploy${NC}"
    echo ""
    echo "  1) 🌐 Website only  — HTML/CSS/JS changes (fast, ~30s)"
    echo "  2) 📦 Full rebuild  — node_modules + everything (slower, ~60s)"
    echo "  3) ❌ Cancel"
    echo ""
    read -rp "Choose [1/2/3]: " choice

    case "$choice" in
        1) deploy_website ;;
        2) deploy_full ;;
        *) echo "Cancelled." && exit 0 ;;
    esac
}

# ─── Main ─────────────────────────────────────────────────────
main() {
    preflight

    case "${1:-}" in
        website|web|w|1)
            deploy_website
            ;;
        full|f|2)
            deploy_full
            ;;
        *)
            show_menu
            ;;
    esac
}

main "$@"
