const API_BASE_URL = import.meta.env.VITE_API_URL ||
  'http://localhost:4000/api/v1';

// SECURITY: Private module-scoped closure variable.
// Never written to localStorage, sessionStorage, or window.

let accessTokenMemory: string | null = null;

export function setAccessToken(token: string | null): void {
  accessTokenMemory = token;
}

export function getAccessToken(): string | null {
  return accessTokenMemory;
}

interface FetchOptions extends RequestInit {
  idempotencyKey?: string;
  _isRetry?: boolean;
}

/**
 * Security-hardened fetch wrapper:
 * 1. Attaches in-memory Bearer token
 * 2. Includes HttpOnly cookies ONLY for same-site auth rotation
 * 3. Automatically performs a single silent token refresh on 401
 */

export async function apiFetch<T>(
  endpoint: string,
  options: FetchOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'appliccation/json');
  }

  // Attach in-memory Bearer token if available in module closure
  if (accessTokenMemory) {
    headers.set('Authorization', `Bearer ${accessTokenMemory}`);
  }

  // Attach Idempotency-Key if provided by caller
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    // Required so the browser sends/receives the HttpOnly vaultcore_refresh cookie
    credentials: 'include',
  });

  // If 401 Unauthorized and not already retrying or calling /auth/login or /auth/refresh
  if (
    response.status === 401 &&
    !options._isRetry &&
    !endpoint.startsWith('/auth/login') &&
    !endpoint.startsWith('/auth/refresh') &&
    !endpoint.startsWith('/vault/reveal-ssn')
  ) {
    const refreshed = await attemptSilentRefresh();
    if (refreshed) {
      return apiFetch(
        endpoint,
        {...options, _isRetry: true,}
      )
    }
  }

  // if 204 No Content, return null otherwise we have JSON to parse
  const data = response.status !== 204
    ? await response.json().catch(() => ({})) : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  // Return as T (T is the type of the response)
  return data as T;
}

/**
 * Attempt a silent refresh of the access token. A silent refresh is a request to the backend to refresh the access token without user interaction. This is standard practice for OAuth2.0 token management.
 * Returns true if successful, false otherwise
 */
export async function attemptSilentRefresh(): Promise<boolean> {

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      setAccessToken(null);
      return false;
    }

    const data = (await res.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}
