/**
 * GitHub Gist 同步：使用者 PAT + 私有 Gist
 */

const GITHUB_TOKEN_KEY = 'sw_github_token';
const GITHUB_GIST_ID_KEY = 'sw_github_gist_id';
const GITHUB_LAST_SYNC_KEY = 'sw_github_last_sync';
const GITHUB_AUTO_SYNC_KEY = 'sw_github_auto_sync';
const GITHUB_USERNAME_KEY = 'sw_github_username';
const GITHUB_BACKUP_DESC = '社工英文學習助手 — 學習資料備份（請勿公開分享）';

let autoSyncTimer = null;

function getGithubToken() {
  try {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function saveGithubToken(token) {
  localStorage.setItem(GITHUB_TOKEN_KEY, (token || '').trim());
}

function clearGithubToken() {
  localStorage.removeItem(GITHUB_TOKEN_KEY);
  localStorage.removeItem(GITHUB_GIST_ID_KEY);
  localStorage.removeItem(GITHUB_USERNAME_KEY);
  localStorage.removeItem(GITHUB_LAST_SYNC_KEY);
}

function getGithubGistId() {
  try {
    return localStorage.getItem(GITHUB_GIST_ID_KEY) || '';
  } catch {
    return '';
  }
}

function saveGithubGistId(id) {
  localStorage.setItem(GITHUB_GIST_ID_KEY, id);
}

function getGithubUsername() {
  try {
    return localStorage.getItem(GITHUB_USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

function saveGithubUsername(username) {
  localStorage.setItem(GITHUB_USERNAME_KEY, username);
}

function isGithubAutoSyncEnabled() {
  try {
    return localStorage.getItem(GITHUB_AUTO_SYNC_KEY) === '1';
  } catch {
    return false;
  }
}

function setGithubAutoSyncEnabled(enabled) {
  localStorage.setItem(GITHUB_AUTO_SYNC_KEY, enabled ? '1' : '0');
}

function getGithubLastSyncTime() {
  try {
    return localStorage.getItem(GITHUB_LAST_SYNC_KEY) || '';
  } catch {
    return '';
  }
}

function markGithubSynced() {
  localStorage.setItem(GITHUB_LAST_SYNC_KEY, new Date().toISOString());
}

/**
 * @param {string} path
 * @param {RequestInit} options
 */
async function githubApi(path, options = {}) {
  const token = getGithubToken();
  if (!token) throw new Error('請先在設定中填入 GitHub Token');

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new Error('GitHub Token 無效或已過期，請重新建立');
    }
    throw new Error(`GitHub API 失敗（${response.status}）${errText.slice(0, 80)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * 測試 GitHub 連線
 * @returns {Promise<string>} username
 */
async function testGithubConnection() {
  const user = await githubApi('/user');
  saveGithubUsername(user.login);
  return user.login;
}

/**
 * 上傳備份至 Gist
 * @returns {Promise<{ gistId: string, username: string }>}
 */
async function uploadBackupToGithub() {
  const content = exportBackupJSON();
  const gistId = getGithubGistId();
  const payload = {
    description: GITHUB_BACKUP_DESC,
    files: {
      [BACKUP_FILENAME]: { content }
    }
  };

  let result;
  if (gistId) {
    result = await githubApi(`/gists/${gistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    result = await githubApi('/gists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, public: false })
    });
    saveGithubGistId(result.id);
  }

  markGithubSynced();
  return { gistId: result.id, username: getGithubUsername() };
}

/**
 * 從 Gist 下載並合併備份
 * @param {'merge'|'replace'} mode
 * @returns {Promise<{ progress: number, terms: number }>}
 */
async function downloadBackupFromGithub(mode = 'merge') {
  const gistId = getGithubGistId();
  if (!gistId) throw new Error('尚未建立 Gist，請先上傳一次');

  const gist = await githubApi(`/gists/${gistId}`);
  const file = gist.files?.[BACKUP_FILENAME];
  if (!file?.content) {
    throw new Error('Gist 中找不到備份檔案，請先上傳');
  }

  const result = importBackupFromJSON(file.content, mode);
  if (result.error) throw new Error(result.error);

  markGithubSynced();
  return result;
}

/**
 * 排程自動同步（debounce）
 */
function scheduleGithubAutoSync() {
  if (!isGithubAutoSyncEnabled() || !getGithubToken()) return;

  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    try {
      await uploadBackupToGithub();
      if (typeof refreshSettingsSyncStatus === 'function') refreshSettingsSyncStatus();
    } catch (err) {
      console.warn('GitHub 自動同步失敗:', err.message);
    }
  }, 5000);
}

/**
 * 初始化自動同步監聽
 */
function initGithubAutoSync() {
  window.addEventListener('sw-data-changed', scheduleGithubAutoSync);
}
