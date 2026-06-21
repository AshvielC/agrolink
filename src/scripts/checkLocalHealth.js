require('dotenv').config();
const baseUrl = String(
  process.env.MONITOR_BASE_URL ||
    'https://localhost:3443'
).replace(/\/$/, '');

const timeoutMs = Math.max(
  1000,
  Number(process.env.MONITOR_HEALTH_TIMEOUT_MS) || 10000
);

function write(level, message, metadata = {}) {
  const entry = {
    ...metadata,
    timestamp: new Date().toISOString(),
    service: 'AgroLink',
    environment: 'local-monitor',
    level,
    message
  };

  const stream =
    level === 'error' || level === 'warn'
      ? process.stderr
      : process.stdout;

  stream.write(`${JSON.stringify(entry)}\n`);
}

async function checkEndpoint(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  timeout.unref?.();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    write('info', 'Local health endpoint passed.', {
      event: 'monitor.health_check.passed',
      endpoint: path,
      statusCode: response.status
    });

    return true;
  } catch (error) {
    write('error', 'Local health endpoint failed.', {
      event: 'monitor.alert.triggered',
      alertType: 'health_check.failure',
      endpoint: path,
      error: {
        name: error.name,
        message: error.message
      }
    });

    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const livenessPassed = await checkEndpoint('/healthz');
  const readinessPassed = await checkEndpoint('/readyz');

  if (!livenessPassed || !readinessPassed) {
    process.exitCode = 1;
  }
}

void main();
