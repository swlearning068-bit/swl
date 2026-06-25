/**
 * 本地題庫管理：內建 JSON + localStorage 自訂詞彙
 */

const CUSTOM_TERMS_KEY = 'sw_custom_terms';
const MAX_CUSTOM_TERMS = 500;

const VALID_CATEGORIES = [
  '個案工作', '倫理原則', '介入取向', '小組工作', '社區工作', '評估工具'
];

/**
 * 讀取自訂詞彙
 * @returns {Array}
 */
function getCustomTerms() {
  try {
    const raw = localStorage.getItem(CUSTOM_TERMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 寫入自訂詞彙
 * @param {Array} terms
 */
function saveCustomTerms(terms) {
  localStorage.setItem(CUSTOM_TERMS_KEY, JSON.stringify(terms));
  if (typeof dispatchDataChanged === 'function') dispatchDataChanged();
}

/**
 * 產生 AI 詞彙唯一 ID
 * @returns {string}
 */
function generateAiTermId() {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 是否為 AI 擴充詞彙
 * @param {Object} term
 * @returns {boolean}
 */
function isCustomTerm(term) {
  return term.source === 'ai' || (term.id && String(term.id).startsWith('ai_'));
}

/**
 * 是否為內建詞彙
 * @param {Object} term
 * @returns {boolean}
 */
function isBuiltinTerm(term) {
  return !isCustomTerm(term);
}

/**
 * 正規化 AI 詞條格式
 * @param {Object} raw
 * @returns {Object|null}
 */
function normalizeTerm(raw) {
  if (!raw || !raw.term_en || !raw.term_zh_hk) return null;

  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : '個案工作';
  const difficulty = [1, 2, 3].includes(Number(raw.difficulty)) ? Number(raw.difficulty) : 2;

  return {
    id: raw.id || generateAiTermId(),
    term_en: String(raw.term_en).trim(),
    term_zh_hk: String(raw.term_zh_hk).trim(),
    category,
    difficulty,
    importance_exam: raw.importance_exam || 3,
    definition_zh: raw.definition_zh || '',
    easy_example_en: raw.easy_example_en || `The social worker used ${raw.term_en} in practice.`,
    example_zh: raw.example_zh || '',
    common_collocations: raw.common_collocations || [],
    related_terms: raw.related_terms || [],
    common_mistake: raw.common_mistake || '',
    wrong_example_en: raw.wrong_example_en || '',
    corrected_example_en: raw.corrected_example_en || raw.easy_example_en || '',
    grammar_note_zh: raw.grammar_note_zh || '',
    pronunciation: raw.pronunciation || '',
    memory_tip_zh: raw.memory_tip_zh || '',
    ethical_note_zh: raw.ethical_note_zh || '',
    hk_context_zh: raw.hk_context_zh || '',
    tags: raw.tags || ['ai', 'custom'],
    source: 'ai',
    createdAt: raw.createdAt || Date.now()
  };
}

/**
 * 合併內建與自訂詞庫
 * @param {Array} builtinTerms
 * @returns {Array}
 */
function mergeTerms(builtinTerms) {
  const custom = getCustomTerms();
  return [...builtinTerms, ...custom];
}

/**
 * 依英文詞查找（含內建與自訂）
 * @param {Array} allTerms
 * @param {string} termEn
 * @returns {Object|null}
 */
function findTermByEn(allTerms, termEn) {
  const lower = termEn.toLowerCase().trim();
  return allTerms.find(t => t.term_en.toLowerCase() === lower) || null;
}

/**
 * 批量加入自訂詞彙（自動去重）
 * @param {Array} rawTerms
 * @returns {{ added: Array, skipped: number }}
 */
function addCustomTerms(rawTerms) {
  const existing = getCustomTerms();
  const allEn = new Set([
    ...existing.map(t => t.term_en.toLowerCase()),
  ]);

  const added = [];
  for (const raw of rawTerms) {
    if (existing.length + added.length >= MAX_CUSTOM_TERMS) break;

    const term = normalizeTerm(raw);
    if (!term) continue;

    const key = term.term_en.toLowerCase();
    if (allEn.has(key)) continue;

    allEn.add(key);
    added.push(term);
  }

  if (added.length > 0) {
    saveCustomTerms([...existing, ...added]);
  }

  return { added, skipped: rawTerms.length - added.length };
}

/**
 * 刪除自訂詞彙
 * @param {string} termId
 * @returns {boolean}
 */
function deleteCustomTerm(termId) {
  const terms = getCustomTerms();
  const filtered = terms.filter(t => t.id !== termId);
  if (filtered.length === terms.length) return false;
  saveCustomTerms(filtered);
  return true;
}

/**
 * 清除全部 AI 詞彙
 * @returns {number}
 */
function clearAllCustomTerms() {
  const count = getCustomTerms().length;
  saveCustomTerms([]);
  return count;
}

/**
 * 匯出自訂詞彙 JSON
 * @returns {string}
 */
function exportCustomTermsJSON() {
  return JSON.stringify(getCustomTerms(), null, 2);
}

/**
 * 匯入自訂詞彙
 * @param {string} jsonString
 * @returns {{ added: number, error?: string }}
 */
function importCustomTermsFromJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      return { added: 0, error: '格式錯誤：需要 JSON 陣列' };
    }
    const { added } = addCustomTerms(parsed);
    return { added: added.length };
  } catch {
    return { added: 0, error: '無法解析 JSON 檔案' };
  }
}

/**
 * 合併詞彙佇列（去重，primary 優先）
 * @param {Array} primary
 * @param {Array} secondary
 * @returns {Array}
 */
function mergeTermQueues(primary, secondary) {
  const seen = new Set();
  const result = [];
  for (const t of [...primary, ...secondary]) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      result.push(t);
    }
  }
  return result;
}

/**
 * 取得題庫統計
 * @param {Array} builtinTerms
 * @returns {{ builtin: number, custom: number, total: number }}
 */
function getTermBankStats(builtinTerms) {
  const custom = getCustomTerms().length;
  return {
    builtin: builtinTerms.length,
    custom,
    total: builtinTerms.length + custom
  };
}
