/**
 * AI 詞彙生成與解析
 */

const AI_FILL_MAX_RETRIES = 3;

/**
 * 從 AI 回覆中提取 JSON 陣列
 * @param {string} text
 * @returns {Array}
 */
function parseTermsFromAiResponse(text) {
  const trimmed = text.trim();

  // 嘗試直接解析
  try {
    const direct = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
    if (direct.terms && Array.isArray(direct.terms)) return direct.terms;
  } catch {
    // 繼續嘗試其他方式
  }

  // 從 ```json ... ``` 區塊提取
  const codeMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) {
    try {
      const parsed = JSON.parse(codeMatch[1].trim());
      return Array.isArray(parsed) ? parsed : (parsed.terms || []);
    } catch {
      // fall through
    }
  }

  // 找第一個 [ 到最後一個 ]
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * 建立批量生詞 prompt 的 user message
 * @param {Object} opts
 */
function buildGenerateTermsMessage({ topic, count, category, difficulty, excludeTerms = [] }) {
  let msg = `請生成 ${count} 個社工專業英文詞彙，主題：${topic}`;
  if (category) msg += `，類別：${category}`;
  if (difficulty) msg += `，難度：${difficulty}`;
  msg += '。請用「主題延伸」方式出題：圍繞此主題提供相關學術與實務術語，不要只重複主題名稱本身。';
  if (excludeTerms.length > 0) {
    const limited = excludeTerms.slice(0, 60);
    msg += `請避免重複以下英文術語：${limited.join(', ')}。`;
  }
  return msg;
}

/**
 * 透過 AI 批量生成詞彙
 * @param {Object} opts
 * @returns {Promise<Array>}
 */
async function generateTermsViaAi(opts) {
  const { topic, count = 5, category = '', difficulty = '', excludeTerms = [] } = opts;

  if (!topic || !topic.trim()) {
    throw new Error('請輸入主題');
  }

  const systemPrompt = getGenerateTermsPrompt(count, category, difficulty);
  const userMessage = buildGenerateTermsMessage({ topic, count, category, difficulty, excludeTerms });

  const response = await fetchDeepSeekComplete(systemPrompt, userMessage, 2000);
  const rawTerms = parseTermsFromAiResponse(response);

  if (rawTerms.length === 0) {
    throw new Error('AI 回覆格式無法解析，請再試一次');
  }

  return rawTerms;
}

/**
 * 生成詞彙並寫入本地題庫
 * @param {Object} opts
 * @returns {Promise<{ added: Array, skipped: number }>}
 */
async function generateAndSaveTerms(opts) {
  const targetCount = Math.max(1, Number(opts?.count) || 5);
  const added = [];
  let skipped = 0;
  const allTerms = typeof getMergedTerms === 'function' ? getMergedTerms() : getCustomTerms();
  const seenEn = new Set(allTerms.map(t => String(t.term_en || '').toLowerCase()));

  for (let attempt = 0; attempt < AI_FILL_MAX_RETRIES && added.length < targetCount; attempt++) {
    const remaining = targetCount - added.length;
    const rawTerms = await generateTermsViaAi({
      ...opts,
      count: remaining,
      excludeTerms: Array.from(seenEn)
    });
    const result = addCustomTerms(rawTerms);

    skipped += result.skipped;
    added.push(...result.added);

    for (const t of rawTerms) {
      if (t && t.term_en) seenEn.add(String(t.term_en).toLowerCase());
    }
    for (const t of result.added) {
      if (t && t.term_en) seenEn.add(String(t.term_en).toLowerCase());
    }

    // 連續補齊失敗時，進入下一輪重試（最多 AI_FILL_MAX_RETRIES 次）
  }

  if (added.length === 0) {
    throw new Error('沒有新詞彙被加入（可能全部重複或格式不符）');
  }

  return { added, skipped };
}

/**
 * 從詞彙查詢 AI 回覆建立詞條
 * @param {string} text
 * @param {string} topicZh
 * @returns {Object|null}
 */
function termFromLookupResponse(text, topicZh) {
  const termEn = parseEnglishTermFromLookup(text);
  if (!termEn) return null;

  const exampleMatch = text.match(/📖\s*\*\*簡單例句：\*\*\s*\n?(.+)/);
  const mistakeMatch = text.match(/⚠️\s*\*\*常見錯誤：\*\*\s*\n?(.+)/);
  const usageMatch = text.match(/🈶\s*\*\*用法解說：\*\*\s*\n?([\s\S]*?)(?=\n⚠️|\n🔗|$)/);

  return normalizeTerm({
    term_en: termEn,
    term_zh_hk: topicZh || termEn,
    category: '個案工作',
    difficulty: 2,
    definition_zh: usageMatch ? usageMatch[1].trim().slice(0, 200) : '',
    easy_example_en: exampleMatch ? exampleMatch[1].trim() : '',
    common_mistake: mistakeMatch ? mistakeMatch[1].trim() : '',
    wrong_example_en: '',
    corrected_example_en: exampleMatch ? exampleMatch[1].trim() : '',
    tags: ['ai', 'lookup']
  });
}

/**
 * HTML 跳脫（共用）
 * @param {string} str
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
