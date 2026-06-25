/**
 * localStorage 學習進度管理
 * Keys: sw_progress, sw_streak
 */

const PROGRESS_KEY = 'sw_progress';
const STREAK_KEY = 'sw_streak';

/** 間隔天數對照表（Leitner 簡化版） */
const INTERVALS = [1, 3, 7, 14];

/**
 * 讀取全部進度
 * @returns {Object}
 */
function getAllProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 讀取單一詞條進度
 * @param {string} termId
 * @returns {Object|null}
 */
function getProgress(termId) {
  const all = getAllProgress();
  return all[termId] || null;
}

/**
 * 寫入單一詞條進度
 * @param {string} termId
 * @param {Object} data
 */
function setProgress(termId, data) {
  const all = getAllProgress();
  all[termId] = data;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  dispatchDataChanged();
}

/**
 * 覆寫全部進度
 * @param {Object} data
 */
function replaceAllProgress(data) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data || {}));
  dispatchDataChanged();
}

/**
 * 初始化新詞進度
 * @param {string} termId
 */
function initTermProgress(termId) {
  const existing = getProgress(termId);
  if (existing) return existing;

  const now = Date.now();
  const data = {
    status: 'new',
    interval: 1,
    nextReview: now,
    correctStreak: 0,
    totalAttempts: 0,
    lastSeen: now
  };
  setProgress(termId, data);
  return data;
}

/**
 * 加 N 天到 timestamp
 * @param {number} days
 * @returns {number}
 */
function addDays(days) {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

/**
 * 依自評更新複習排程
 * @param {string} termId
 * @param {'bad'|'ok'|'good'} rating
 */
function updateReviewSchedule(termId, rating) {
  let prog = getProgress(termId) || initTermProgress(termId);
  const now = Date.now();

  prog.totalAttempts = (prog.totalAttempts || 0) + 1;
  prog.lastSeen = now;

  if (rating === 'bad') {
    prog.correctStreak = 0;
    prog.interval = 1;
    prog.nextReview = addDays(1);
    prog.status = 'learning';
  } else if (rating === 'ok') {
    // 間隔不變，維持原 nextReview
  } else if (rating === 'good') {
    prog.correctStreak = (prog.correctStreak || 0) + 1;
    const streak = prog.correctStreak;

    if (streak >= 3) {
      prog.interval = 14;
      prog.status = 'mastered';
    } else {
      prog.interval = INTERVALS[streak] || 14;
      prog.status = 'learning';
    }
    prog.nextReview = addDays(prog.interval);
  }

  setProgress(termId, prog);
  return prog;
}

/**
 * 填空答對時更新進度
 * @param {string} termId
 * @param {boolean} correct
 */
function updateFillBlankProgress(termId, correct) {
  if (correct) {
    return updateReviewSchedule(termId, 'good');
  }
  return updateReviewSchedule(termId, 'bad');
}

/**
 * 取得今日到期需複習的詞條 ID 列表
 * @param {Array} allTerms
 * @param {string} [categoryFilter]
 * @returns {string[]}
 */
function getDueTerms(allTerms, categoryFilter) {
  const now = Date.now();
  let terms = allTerms;

  if (categoryFilter) {
    terms = terms.filter(t => t.category === categoryFilter);
  }

  return terms
    .filter(t => {
      const prog = getProgress(t.id);
      if (!prog) return false;
      return prog.nextReview <= now && prog.status !== 'mastered';
    })
    .map(t => t.id);
}

/**
 * 取得今日練習詞條（到期詞 + 最多 5 個新詞）
 * @param {Array} allTerms
 * @param {string} [categoryFilter]
 * @returns {Array}
 */
function getTodayPracticeTerms(allTerms, categoryFilter) {
  let terms = allTerms;
  if (categoryFilter) {
    terms = terms.filter(t => t.category === categoryFilter);
  }

  const now = Date.now();
  const due = terms.filter(t => {
    const prog = getProgress(t.id);
    return prog && prog.nextReview <= now && prog.status !== 'mastered';
  });

  const newTerms = terms.filter(t => {
    const prog = getProgress(t.id);
    return !prog || prog.status === 'new';
  }).slice(0, 5);

  const dueIds = new Set(due.map(t => t.id));
  const combined = [...due, ...newTerms.filter(t => !dueIds.has(t.id))];

  if (combined.length === 0) {
    return terms.slice(0, 10);
  }

  return combined;
}

/**
 * 取得學習統計
 * @param {Array} allTerms
 * @returns {{ learned: number, learning: number, mastered: number, due: number }}
 */
function getStats(allTerms) {
  const all = getAllProgress();
  const now = Date.now();
  let learned = 0;
  let learning = 0;
  let mastered = 0;
  let due = 0;

  for (const term of allTerms) {
    const prog = all[term.id];
    if (!prog) continue;

    learned++;
    if (prog.status === 'mastered') mastered++;
    else if (prog.status === 'learning' || prog.status === 'new') learning++;
    if (prog.nextReview <= now && prog.status !== 'mastered') due++;
  }

  return { learned, learning, mastered, due };
}

/**
 * 讀取連續學習紀錄物件
 * @returns {{ count: number, lastDate: string }}
 */
function getStreakData() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { count: 0, lastDate: '' };
  } catch {
    return { count: 0, lastDate: '' };
  }
}

/**
 * 寫入連續學習紀錄
 * @param {{ count: number, lastDate: string }} data
 */
function setStreakData(data) {
  localStorage.setItem(STREAK_KEY, JSON.stringify(data || { count: 0, lastDate: '' }));
  dispatchDataChanged();
}

/**
 * 通知資料已變更（供自動同步等使用）
 */
function dispatchDataChanged() {
  window.dispatchEvent(new CustomEvent('sw-data-changed'));
}

/**
 * 更新連續學習天數
 */
function updateStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    const streak = raw ? JSON.parse(raw) : { count: 0, lastDate: '' };

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (streak.lastDate === today) {
      return streak.count;
    }

    if (streak.lastDate === yesterday) {
      streak.count += 1;
    } else {
      streak.count = 1;
    }

    streak.lastDate = today;
    setStreakData(streak);
    return streak.count;
  } catch {
    return 0;
  }
}

/**
 * 讀取連續學習天數
 * @returns {number}
 */
function getStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return 0;
    const streak = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (streak.lastDate === today || streak.lastDate === yesterday) {
      return streak.count;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 依 term_en 在詞彙庫中查找 ID
 * @param {Array} allTerms
 * @param {string} termEn
 * @returns {string|null}
 */
function findTermIdByEn(allTerms, termEn) {
  const lower = termEn.toLowerCase().trim();
  const found = allTerms.find(t => t.term_en.toLowerCase() === lower);
  return found ? found.id : null;
}

/**
 * 將錯題加入複習（重置為 learning）
 * @param {string[]} termIds
 */
function addTermsToReview(termIds) {
  for (const id of termIds) {
    const prog = getProgress(id) || initTermProgress(id);
    prog.status = 'learning';
    prog.interval = 1;
    prog.nextReview = Date.now();
    prog.correctStreak = 0;
    setProgress(id, prog);
  }
}
