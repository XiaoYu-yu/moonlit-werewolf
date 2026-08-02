function readPort(name: string, fallback: number): string {
  const raw = process.env[name]?.trim();
  if (!raw) return String(fallback);

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return String(port);
}

export const E2E_WEB_PORT = readPort('E2E_WEB_PORT', 3000);
export const E2E_API_PORT = readPort('E2E_API_PORT', 3001);
export const E2E_MOCK_OPENAI_PORT = readPort('E2E_MOCK_OPENAI_PORT', 4010);

export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;
export const E2E_API_URL = `http://localhost:${E2E_API_PORT}`;
export const E2E_MOCK_OPENAI_URL = `http://127.0.0.1:${E2E_MOCK_OPENAI_PORT}`;
