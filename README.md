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
