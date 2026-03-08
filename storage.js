// ─── Azure Blob Storage backend with Managed Identity ────────
// Falls back to local filesystem when AZURE_STORAGE_ACCOUNT is not set.
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT || '';
const CONTAINER_NAME  = process.env.AZURE_STORAGE_CONTAINER || 'perf-agent-data';
const DATA_DIR        = path.join(__dirname, 'data');

let containerClient = null;

if (STORAGE_ACCOUNT) {
  const credential = new DefaultAzureCredential();
  const blobService = new BlobServiceClient(
    `https://${STORAGE_ACCOUNT}.blob.core.windows.net`,
    credential
  );
  containerClient = blobService.getContainerClient(CONTAINER_NAME);
  // Ensure container exists on startup
  containerClient.createIfNotExists().catch(err => {
    console.error(`[storage] Failed to create container "${CONTAINER_NAME}":`, err.message);
  });
  console.log(`[storage] Using Azure Blob Storage: ${STORAGE_ACCOUNT}/${CONTAINER_NAME}`);
} else {
  console.log('[storage] AZURE_STORAGE_ACCOUNT not set — using local filesystem (data/)');
}

/**
 * Read a JSON file. Returns parsed data or the provided default.
 * Uses blob storage when available, local fs otherwise.
 */
async function readJson(fileName, defaultValue = []) {
  if (containerClient) {
    try {
      const blob = containerClient.getBlockBlobClient(fileName);
      const resp = await blob.download(0);
      const body = await streamToString(resp.readableStreamBody);
      return JSON.parse(body);
    } catch (err) {
      if (err.statusCode === 404) return defaultValue;
      console.error(`[storage] Failed to read blob "${fileName}":`, err.message);
      return defaultValue;
    }
  }
  // Local fallback
  const filePath = path.join(DATA_DIR, fileName);
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* corrupted */ }
  return defaultValue;
}

/**
 * Write a JSON file. Uses blob storage when available, local fs otherwise.
 */
async function writeJson(fileName, data) {
  if (containerClient) {
    try {
      const blob = containerClient.getBlockBlobClient(fileName);
      const content = JSON.stringify(data, null, 2);
      await blob.upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        overwrite: true,
      });
    } catch (err) {
      console.error(`[storage] Failed to write blob "${fileName}":`, err.message);
    }
    return;
  }
  // Local fallback
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, fileName), JSON.stringify(data, null, 2));
}

function streamToString(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    readable.on('error', reject);
  });
}

module.exports = { readJson, writeJson };
