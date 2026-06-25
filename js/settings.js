/**
 * 設定分頁：API Key、備份匯出/匯入、GitHub Gist 同步
 */

function refreshSettingsSyncStatus() {
  const summaryEl = document.getElementById('settings-backup-summary');
  const syncStatusEl = document.getElementById('settings-github-status');
  const lastSyncEl = document.getElementById('settings-last-sync');

  if (summaryEl) {
    const s = getBackupSummary();
    summaryEl.textContent = `進度 ${s.progressCount} 詞 / AI 詞彙 ${s.termsCount} / 連續 ${s.streak} 天`;
  }

  if (syncStatusEl) {
    const token = getGithubToken();
    const username = getGithubUsername();
    const gistId = getGithubGistId();
    if (!token) {
      syncStatusEl.textContent = '未連接 GitHub';
    } else if (username && gistId) {
      syncStatusEl.textContent = `已連接 @${username}（Gist ${gistId.slice(0, 8)}…）`;
    } else if (username) {
      syncStatusEl.textContent = `已連接 @${username}，尚未上傳備份`;
    } else {
      syncStatusEl.textContent = 'Token 已儲存，請測試連線';
    }
  }

  if (lastSyncEl) {
    const last = getGithubLastSyncTime();
    lastSyncEl.textContent = last
      ? `上次同步：${new Date(last).toLocaleString('zh-HK')}`
      : '尚未同步';
  }

  const autoSyncEl = document.getElementById('settings-github-auto-sync');
  if (autoSyncEl) autoSyncEl.checked = isGithubAutoSyncEnabled();

  const apiStatusEl = document.getElementById('settings-api-status');
  if (apiStatusEl) {
    const key = getDeepSeekApiKey();
    if (!key) {
      apiStatusEl.textContent = '尚未設定 API Key';
    } else if (isApiManuallyDisabled()) {
      apiStatusEl.textContent = `已設定 ${maskApiKey(key)}（目前已取消連接）`;
    } else {
      apiStatusEl.textContent = `已設定 ${maskApiKey(key)}`;
    }
  }
}

function refreshSettings() {
  refreshSettingsSyncStatus();
}

async function handleSaveApiKey() {
  const input = document.getElementById('settings-api-key');
  const key = input?.value.trim() || '';

  if (!key) {
    showToast('請輸入 DeepSeek API Key', 'warning');
    return;
  }

  saveDeepSeekApiKey(key);
  if (input) input.value = '';
  enableApiConnection();
  showToast('API Key 已儲存，正在測試連線…', 'info');
  await checkApiConnection();
  updateUnifiedAiUi();
  refreshSettingsSyncStatus();

  if (getApiConnectionStatus() === 'connected') {
    showToast('API 連接成功', 'success');
  }
}

function handleClearApiKey() {
  if (!confirm('確定要清除本裝置儲存的 API Key？')) return;
  clearDeepSeekApiKey();
  apiConnectionStatus = 'disconnected';
  updateApiIndicator();
  updateUnifiedAiUi();
  refreshSettingsSyncStatus();
  showToast('已清除 API Key', 'info');
}

function handleExportBackup() {
  downloadBackupFile();
  showToast('已匯出學習資料', 'success');
}

function handleImportBackup(mode) {
  const input = document.getElementById('settings-import-file');
  if (!input) return;
  input.dataset.importMode = mode;
  input.click();
}

function handleImportBackupFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const mode = e.target.dataset.importMode || 'merge';
  const reader = new FileReader();
  reader.onload = () => {
    const result = importBackupFromJSON(reader.result, mode);
    e.target.value = '';
    if (result.error) {
      showToast(result.error, 'error');
      return;
    }
    if (typeof refreshLibrary === 'function') refreshLibrary();
    if (typeof refreshLearnHome === 'function') refreshLearnHome();
    refreshSettingsSyncStatus();
    const modeText = mode === 'merge' ? '合併' : '覆蓋';
    showToast(`${modeText}還原完成：${result.progress} 筆進度、${result.terms} 個 AI 詞彙`, 'success');
  };
  reader.readAsText(file);
}

async function handleSaveGithubToken() {
  const input = document.getElementById('settings-github-token');
  const token = input?.value.trim() || '';

  if (!token) {
    showToast('請輸入 GitHub Token', 'warning');
    return;
  }

  saveGithubToken(token);
  if (input) input.value = '';

  try {
    const username = await testGithubConnection();
    refreshSettingsSyncStatus();
    showToast(`GitHub 連接成功：@${username}`, 'success');
  } catch (err) {
    clearGithubToken();
    refreshSettingsSyncStatus();
    showToast(err.message, 'error');
  }
}

function handleClearGithub() {
  if (!confirm('確定要清除 GitHub Token 與同步設定？（不會刪除 Gist 上的備份）')) return;
  clearGithubToken();
  refreshSettingsSyncStatus();
  showToast('已清除 GitHub 設定', 'info');
}

async function handleGithubUpload() {
  const btn = document.getElementById('settings-github-upload');
  setButtonLoading(btn, true, '上傳中…');
  try {
    const { gistId } = await uploadBackupToGithub();
    refreshSettingsSyncStatus();
    showToast(`已上傳至 GitHub Gist（${gistId.slice(0, 8)}…）`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleGithubDownload(mode) {
  const btn = document.getElementById('settings-github-download');
  setButtonLoading(btn, true, '下載中…');
  try {
    const result = await downloadBackupFromGithub(mode);
    if (typeof refreshLibrary === 'function') refreshLibrary();
    if (typeof refreshLearnHome === 'function') refreshLearnHome();
    refreshSettingsSyncStatus();
    const modeText = mode === 'merge' ? '合併' : '覆蓋';
    showToast(`${modeText}同步完成：${result.progress} 筆進度、${result.terms} 個 AI 詞彙`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function initSettings() {
  document.getElementById('settings-save-api')?.addEventListener('click', handleSaveApiKey);
  document.getElementById('settings-clear-api')?.addEventListener('click', handleClearApiKey);
  document.getElementById('settings-export-backup')?.addEventListener('click', handleExportBackup);
  document.getElementById('settings-import-merge')?.addEventListener('click', () => handleImportBackup('merge'));
  document.getElementById('settings-import-replace')?.addEventListener('click', () => handleImportBackup('replace'));
  document.getElementById('settings-import-file')?.addEventListener('change', handleImportBackupFile);

  document.getElementById('settings-save-github')?.addEventListener('click', handleSaveGithubToken);
  document.getElementById('settings-clear-github')?.addEventListener('click', handleClearGithub);
  document.getElementById('settings-github-upload')?.addEventListener('click', handleGithubUpload);
  document.getElementById('settings-github-download-merge')?.addEventListener('click', () => handleGithubDownload('merge'));
  document.getElementById('settings-github-download-replace')?.addEventListener('click', () => handleGithubDownload('replace'));

  document.getElementById('settings-github-auto-sync')?.addEventListener('change', (e) => {
    setGithubAutoSyncEnabled(e.target.checked);
    showToast(e.target.checked ? '已啟用自動同步' : '已停用自動同步', 'info');
  });

  initGithubAutoSync();
  refreshSettingsSyncStatus();
}
