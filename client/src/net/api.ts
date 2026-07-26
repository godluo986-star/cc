/** HTTP auth API. In dev, Vite proxies /api to the game server. */
export interface AuthResponse {
  token: string;
  user: { id: number; username: string; isGuest?: boolean };
}

async function post(path: string, body?: unknown): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('连不上服务器,确认它在运行吗?');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & AuthResponse;
  if (!res.ok) throw new Error(data.error ?? `请求失败(${res.status})`);
  return data;
}

export const api = {
  register: (username: string, password: string) => post('/api/register', { username, password }),
  login: (username: string, password: string) => post('/api/login', { username, password }),
  guest: () => post('/api/guest'),
};
