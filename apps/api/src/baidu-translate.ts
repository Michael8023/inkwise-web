const BAIDU_OAUTH_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_TRANSLATE_URL = 'https://aip.baidubce.com/rpc/2.0/mt/texttrans/v1';

type TokenCache = { value: string; expiresAt: number } | null;
let tokenCache: TokenCache = null;

export type Translation = {
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
  translatedText: string;
  provider: 'baidu';
};

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const apiKey = process.env.BAIDU_TRANSLATE_API_KEY;
  const secretKey = process.env.BAIDU_TRANSLATE_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error('BAIDU_TRANSLATE_NOT_CONFIGURED');

  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: apiKey, client_secret: secretKey });
  const response = await fetch(`${BAIDU_OAUTH_URL}?${params}`);
  const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || 'BAIDU_TOKEN_REQUEST_FAILED');

  tokenCache = { value: payload.access_token, expiresAt: Date.now() + Math.max((payload.expires_in ?? 1800) - 300, 60) * 1000 };
  return tokenCache.value;
}

export async function translateWithBaidu(input: { text: string; sourceLanguage: string; targetLanguage: string }): Promise<Translation> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${BAIDU_TRANSLATE_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: input.text, from: input.sourceLanguage, to: input.targetLanguage }),
  });
  const payload = await response.json() as { from?: string; to?: string; result?: { from?: string; to?: string; trans_result?: Array<{ dst?: string }> }; error_code?: number; error_msg?: string };
  const translatedText = payload.result?.trans_result?.map(item => item.dst ?? '').join('\n');
  if (!response.ok || !translatedText) throw new Error(payload.error_msg || `BAIDU_TRANSLATE_FAILED_${payload.error_code ?? response.status}`);
  return { sourceLanguage: payload.result?.from ?? payload.from ?? input.sourceLanguage, targetLanguage: payload.result?.to ?? payload.to ?? input.targetLanguage, text: input.text, translatedText, provider: 'baidu' };
}
