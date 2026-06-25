/**
 * DeepSeek API 串流呼叫層
 */

const API_KEY_STORAGE = 'sw_api_key';

/**
 * 取得 DeepSeek API Key（localStorage 優先，其次 config.js）
 * @returns {string}
 */
function getDeepSeekApiKey() {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // ignore
  }
  if (typeof CONFIG !== 'undefined' && CONFIG.DEEPSEEK_API_KEY) {
    const key = CONFIG.DEEPSEEK_API_KEY.trim();
    if (key && key !== 'your_api_key_here') return key;
  }
  return '';
}

/**
 * 儲存 API Key 至 localStorage
 * @param {string} key
 */
function saveDeepSeekApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, (key || '').trim());
}

/**
 * 清除 localStorage 中的 API Key
 */
function clearDeepSeekApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
}

/**
 * 遮罩顯示 API Key
 * @param {string} key
 * @returns {string}
 */
function maskApiKey(key) {
  if (!key || key.length < 8) return '（已設定）';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/**
 * 取得 API 模型設定
 */
function getApiConfig() {
  const defaults = {
    model: 'deepseek-chat',
    maxTokens: 600,
    temperature: 0.4
  };
  if (typeof CONFIG === 'undefined') return defaults;
  return {
    model: CONFIG.MODEL || defaults.model,
    maxTokens: CONFIG.MAX_TOKENS ?? defaults.maxTokens,
    temperature: CONFIG.TEMPERATURE ?? defaults.temperature
  };
}

/**
 * 檢查 API Key 是否已設定
 */
function validateApiKey() {
  if (isApiManuallyDisabled()) {
    throw new Error('API 連接已取消。點擊上方狀態燈可重新連接。');
  }
  const key = getDeepSeekApiKey();
  if (!key) {
    throw new Error('找不到 API 設定。請在「設定」分頁填入 DeepSeek API Key，或複製 config.example.js 為 config.js。');
  }
}

/**
 * 串流呼叫 DeepSeek API
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @yields {string} 每個 token
 */
async function* streamDeepSeek(systemPrompt, userMessage) {
  validateApiKey();
  const apiKey = getDeepSeekApiKey();
  const apiConfig = getApiConfig();

  let response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        stream: true,
        temperature: apiConfig.temperature,
        max_tokens: apiConfig.maxTokens
      })
    });
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      throw new Error('無法連接 DeepSeek API。可能是網絡問題或 CORS 限制，請檢查網絡連線。');
    }
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API 請求失敗（${response.status}）。${errText.slice(0, 100)}`);
  }

  if (!response.body) {
    throw new Error('API 回應無內容，請稍後再試。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // 忽略無法解析的行
      }
    }
  }
}

/**
 * 將串流結果渲染到 DOM 元素
 * @param {AsyncGenerator<string>} generator
 * @param {HTMLElement} element
 * @param {Function} [onDone] - 完成回調，接收完整文字
 */
async function renderStreamToElement(generator, element, onDone) {
  element.classList.remove('hidden');
  element.classList.add('streaming');
  element.textContent = '';

  let fullText = '';
  try {
    for await (const token of generator) {
      fullText += token;
      element.textContent = fullText;
      element.scrollTop = element.scrollHeight;
    }
  } finally {
    element.classList.remove('streaming');
  }

  if (onDone) onDone(fullText);
  return fullText;
}

/**
 * 非串流 API 呼叫（用於 JSON 生詞）
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {number} [maxTokens=2000]
 * @returns {Promise<string>}
 */
async function fetchDeepSeekComplete(systemPrompt, userMessage, maxTokens = 2000) {
  validateApiKey();
  const apiKey = getDeepSeekApiKey();
  const apiConfig = getApiConfig();

  let response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: maxTokens
      })
    });
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      throw new Error('無法連接 DeepSeek API。可能是網絡問題或 CORS 限制。');
    }
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API 請求失敗（${response.status}）。${errText.slice(0, 100)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('API 回應無內容');
  return content;
}

/** API 連線狀態 */
let apiConnectionStatus = 'unknown';

const API_DISABLED_KEY = 'sw_api_disabled';

/**
 * 使用者是否已手動取消 API 連接
 */
function isApiManuallyDisabled() {
  try {
    return localStorage.getItem(API_DISABLED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 取消 API 連接（保留 config.js 設定，僅停用本次使用）
 */
function disconnectApi() {
  try {
    localStorage.setItem(API_DISABLED_KEY, '1');
  } catch {
    // localStorage 不可用時仍更新記憶體狀態
  }
  apiConnectionStatus = 'disabled';
  updateApiIndicator();
  if (typeof updateUnifiedAiUi === 'function') updateUnifiedAiUi();
}

/**
 * 清除手動取消標記，允許重新連接
 */
function enableApiConnection() {
  try {
    localStorage.removeItem(API_DISABLED_KEY);
  } catch {
    // ignore
  }
}

/**
 * 取得 API 連線狀態
 * @returns {'connected'|'configured'|'disconnected'|'error'|'checking'}
 */
function getApiConnectionStatus() {
  return apiConnectionStatus;
}

/**
 * 檢查 API Key 是否已設定（不發請求、不含手動取消狀態）
 */
function isApiKeyConfigured() {
  return !!getDeepSeekApiKey();
}

/**
 * 更新頁面 API 提示燈
 */
function updateApiIndicator() {
  const el = document.getElementById('api-status');
  if (!el) return;

  const dot = el.querySelector('.api-status-dot');
  const label = el.querySelector('.api-status-label');

  el.classList.remove('status-connected', 'status-configured', 'status-disconnected', 'status-error', 'status-checking', 'status-disabled');

  const states = {
    connected: { class: 'status-connected', text: 'API 已連接' },
    configured: { class: 'status-configured', text: 'API 已設定' },
    disconnected: { class: 'status-disconnected', text: '未設定 API' },
    disabled: { class: 'status-disabled', text: 'API 已取消連接' },
    error: { class: 'status-error', text: 'API 連接失敗' },
    checking: { class: 'status-checking', text: '檢查連線中…' }
  };

  const s = states[apiConnectionStatus] || states.disconnected;
  el.classList.add(s.class);
  if (label) label.textContent = s.text;
  if (dot) dot.setAttribute('aria-label', s.text);
  el.title = apiConnectionStatus === 'disabled'
    ? '點擊重新連接 API'
    : 'DeepSeek API 連線狀態';

  const disconnectBtn = document.getElementById('api-disconnect');
  if (disconnectBtn) {
    const showDisconnect = ['connected', 'error', 'configured'].includes(apiConnectionStatus);
    disconnectBtn.classList.toggle('hidden', !showDisconnect);
  }
}

/**
 * 測試 API 連線（輕量請求）
 * @returns {Promise<boolean>}
 */
async function checkApiConnection() {
  if (isApiManuallyDisabled()) {
    apiConnectionStatus = 'disabled';
    updateApiIndicator();
    if (typeof updateUnifiedAiUi === 'function') updateUnifiedAiUi();
    return false;
  }

  if (!isApiKeyConfigured()) {
    apiConnectionStatus = 'disconnected';
    updateApiIndicator();
    if (typeof updateUnifiedAiUi === 'function') updateUnifiedAiUi();
    return false;
  }

  apiConnectionStatus = 'checking';
  updateApiIndicator();
  if (typeof updateUnifiedAiUi === 'function') updateUnifiedAiUi();

  try {
    await fetchDeepSeekComplete(
      'You are a ping test. Reply with exactly: OK',
      'ping',
      5
    );
    apiConnectionStatus = 'connected';
    updateApiIndicator();
    if (typeof updateUnifiedAiUi === 'function') updateUnifiedAiUi();
    return true;
  } catch {
    apiConnectionStatus = 'error';
    updateApiIndicator();
    if (typeof updateUnifiedAiUi === 'function') updateUnifiedAiUi();
    return false;
  }
}
