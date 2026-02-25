# Performance Agent Website

AI-powered performance testing agent for VS Code — landing page and documentation site.

## Local Development

```bash
npm install
npm start
```

Open [http://localhost:8000](http://localhost:8000)

## Docker

```bash
docker build -t perf-agent-website .
docker run -p 8000:8000 perf-agent-website
```

## Deployment

The site auto-deploys to Azure Container Apps on push to `main` via the GitHub Actions workflow.

### Required Secrets

| Secret | Description |
|--------|-------------|
| `AZURE_CREDENTIALS` | Azure service principal credentials JSON |

### Azure Resources

Before first deployment, create the infrastructure:

```bash
# Create resource group
az group create --name perf-agent-website-rg --location eastus

# Create ACR
az acr create --name perfagentwebsite --resource-group perf-agent-website-rg --sku Basic --admin-enabled true

# Create Container App environment
az containerapp env create --name perf-agent-env --resource-group perf-agent-website-rg --location eastus

# Create Container App
az containerapp create \
  --name perf-agent-website \
  --resource-group perf-agent-website-rg \
  --environment perf-agent-env \
  --image perfagentwebsite.azurecr.io/perf-agent-website:latest \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 2
```

## Project Structure

```
website/
├── public/
│   ├── index.html      # Landing page
│   ├── styles.css       # Styles
│   └── script.js        # Interactions
├── server.js            # Express server
├── Dockerfile           # Container image
├── package.json
├── .dockerignore
├── .github/
│   └── workflows/
│       └── deploy.yml   # CI/CD pipeline
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check — uptime, timestamp, config status |
| GET | `/api/releases` | Lists up to 20 GitHub releases (cached 5 min) |
| GET | `/api/releases/latest` | Returns the latest stable (non-prerelease) release |
| GET | `/api/download/:assetId` | Proxies a release asset download from GitHub |
| GET | `/api/perf-test` | Performance test target endpoint (see below) |

### `GET /api/perf-test`

A lightweight endpoint designed for performance testing with tools like JMeter or k6. Every request is logged with origin and user agent details.

**Response:**

```json
{
  "status": "ok",
  "endpoint": "/api/perf-test",
  "hit": 42,
  "timestamp": "2026-02-25T17:30:00.000Z",
  "response_time_ms": 2.35,
  "request": {
    "origin": "52.170.33.171",
    "user_agent": "k6/0.45.0",
    "referer": "direct",
    "method": "GET"
  },
  "server": {
    "uptime": 3600.5,
    "memory_mb": 45.12
  }
}
```

**Log output** (visible in `az containerapp logs show`):

```
[PERF] #42 | GET /api/perf-test | 2.4ms | origin=52.170.33.171 | ua=k6/0.45.0
```

**Features:**
- Hit counter to track total requests
- Request origin IP, user agent, and referer logging
- Server uptime and memory usage in response
- 0–5ms simulated latency for realistic response time variance
