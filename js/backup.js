/**
 * 學習資料備份：匯出 / 匯入 / 合併
 */

const BACKUP_VERSION = 1;
const BACKUP_FILENAME = 'sw-learning-backup.json';

/**
 * 建立完整備份物件
 * @returns {Object}
 */
function buildBackupData() {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    progress: getAllProgress(),
    streak: getStreakData(),
    customTerms: getCustomTerms()
  };
}

/**
 * 匯出備份 JSON 字串
 * @returns {string}
 */
function exportBackupJSON() {
  return JSON.stringify(buildBackupData(), null, 2);
}

/**
 * 觸發下載備份檔
 */
function downloadBackupFile() {
  const blob = new Blob([exportBackupJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sw_learning_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 合併兩份進度（以 lastSeen 較新者為準）
 * @param {Object} local
 * @param {Object} remote
 * @returns {Object}
 */
function mergeProgressRecords(local, remote) {
  const merged = { ...(local || {}) };
  for (const [id, remoteProg] of Object.entries(remote || {})) {
    const localProg = merged[id];
    if (!localProg) {
      merged[id] = remoteProg;
      continue;
    }
    const localSeen = localProg.lastSeen || 0;
    const remoteSeen = remoteProg.lastSeen || 0;
    merged[id] = remoteSeen > localSeen ? remoteProg : localProg;
  }
  return merged;
}

/**
 * 合併連續學習紀錄
 * @param {{ count: number, lastDate: string }} local
 * @param {{ count: number, lastDate: string }} remote
 * @returns {{ count: number, lastDate: string }}
 */
function mergeStreakRecords(local, remote) {
  const a = local || { count: 0, lastDate: '' };
  const b = remote || { count: 0, lastDate: '' };
  if (!a.lastDate) return { ...b };
  if (!b.lastDate) return { ...a };
  if (a.lastDate > b.lastDate) return { ...a };
  if (b.lastDate > a.lastDate) return { ...b };
  return { count: Math.max(a.count, b.count), lastDate: a.lastDate };
}

/**
 * 解析並驗證備份 JSON
 * @param {string} jsonString
 * @returns {{ data: Object|null, error?: string }}
 */
function parseBackupJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { data: null, error: '格式錯誤：需要 JSON 物件' };
    }
    if (!parsed.progress && !parsed.customTerms && !parsed.streak) {
      return { data: null, error: '找不到可還原的學習資料' };
    }
    return { data: parsed };
  } catch {
    return { data: null, error: '無法解析 JSON 檔案' };
  }
}

/**
 * 套用備份資料
 * @param {Object} data
 * @param {'replace'|'merge'} mode
 * @returns {{ progress: number, terms: number }}
 */
function applyBackupData(data, mode) {
  const incomingProgress = data.progress && typeof data.progress === 'object' ? data.progress : {};
  const incomingStreak = data.streak && typeof data.streak === 'object'
    ? data.streak
    : { count: 0, lastDate: '' };
  const incomingTerms = Array.isArray(data.customTerms) ? data.customTerms : [];

  if (mode === 'merge') {
    replaceAllProgress(mergeProgressRecords(getAllProgress(), incomingProgress));
    setStreakData(mergeStreakRecords(getStreakData(), incomingStreak));
    const { added } = addCustomTerms(incomingTerms);
    if (typeof refreshAllTerms === 'function') refreshAllTerms();
    dispatchDataChanged();
    return {
      progress: Object.keys(incomingProgress).length,
      terms: added.length
    };
  }

  replaceAllProgress(incomingProgress);
  setStreakData(incomingStreak);
  saveCustomTerms(incomingTerms);
  if (typeof refreshAllTerms === 'function') refreshAllTerms();
  dispatchDataChanged();
  return {
    progress: Object.keys(incomingProgress).length,
    terms: incomingTerms.length
  };
}

/**
 * 從 JSON 字串匯入備份
 * @param {string} jsonString
 * @param {'replace'|'merge'} mode
 * @returns {{ progress: number, terms: number, error?: string }}
 */
function importBackupFromJSON(jsonString, mode = 'merge') {
  const { data, error } = parseBackupJSON(jsonString);
  if (error) return { progress: 0, terms: 0, error };
  const result = applyBackupData(data, mode);
  return { ...result };
}

/**
 * 取得備份摘要（供 UI 顯示）
 * @returns {{ progressCount: number, termsCount: number, streak: number }}
 */
function getBackupSummary() {
  const progress = getAllProgress();
  return {
    progressCount: Object.keys(progress).length,
    termsCount: getCustomTerms().length,
    streak: getStreak()
  };
}
