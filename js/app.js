/**
 * 主應用邏輯：Tab 切換、AI 模組、題庫整合、API 狀態
 */

let writingDifficulty = '初級';
let lastWritingPrompt = '';
let sentenceDifficulty = '初級';
let lastSentenceResponse = '';
let lastLookupResponse = '';
let lastLookupTopic = '';

/** 內建詞彙（sw_terms.json） */
let builtinTermsCache = [];
/** 合併詞庫（內建 + 本地 AI） */
let allTermsCache = [];

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });

  if (tabId === 'library' && typeof refreshLibrary === 'function') refreshLibrary();
  if (tabId === 'learn' && typeof refreshLearnHome === 'function') refreshLearnHome();
  if (tabId === 'settings' && typeof refreshSettings === 'function') refreshSettings();
}

function setButtonLoading(btn, loading, loadingText = '處理中...') {
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

function hideEmptyShowResult(emptyId, resultId) {
  const empty = document.getElementById(emptyId);
  const result = document.getElementById(resultId);
  if (empty) empty.classList.add('hidden');
  if (result) result.classList.remove('hidden');
}

function resetModule(emptyId, resultId, inputId) {
  const empty = document.getElementById(emptyId);
  const result = document.getElementById(resultId);
  const input = document.getElementById(inputId);
  if (empty) empty.classList.remove('hidden');
  if (result) {
    result.classList.add('hidden');
    result.textContent = '';
  }
  if (input) input.value = '';
}

/**
 * 取得合併後詞庫
 * @returns {Array}
 */
function getMergedTerms() {
  return mergeTerms(builtinTermsCache);
}

/**
 * 刷新合併詞庫並同步各模組
 */
function refreshAllTerms() {
  allTermsCache = getMergedTerms();
  if (typeof setLibraryTerms === 'function') setLibraryTerms(allTermsCache);
  if (typeof setLearnTerms === 'function') setLearnTerms(allTermsCache);
  if (typeof setQuizTerms === 'function') setQuizTerms(allTermsCache);
}

/**
 * 依 API 連線狀態更新合併式 UI
 */
function updateUnifiedAiUi() {
  const status = getApiConnectionStatus();
  const connected = status === 'connected';

  document.querySelectorAll('.ai-optional-fields').forEach(el => {
    el.classList.toggle('hidden', !connected);
  });

  const learnHint = document.getElementById('learn-mode-hint');
  if (learnHint) {
    if (connected) {
      learnHint.textContent = '🤖 API 已連接：會先用待複習詞彙；填寫主題可額外補充 AI 新詞（自動存入題庫）';
    } else if (status === 'disabled') {
      learnHint.textContent = '📦 已取消 API 連接，目前僅使用本地題庫；點擊上方狀態燈可重新連接';
    } else if (status === 'error') {
      learnHint.textContent = '⚠️ API 連接失敗，目前僅使用本地題庫；修復後可自動啟用 AI 補充';
    } else if (status === 'checking') {
      learnHint.textContent = '正在檢查 API 連線…';
    } else {
      learnHint.textContent = '📦 使用本地題庫；在「設定」填入 API Key 並連接後，可輸入主題自動補充新詞';
    }
  }

  const quizHint = document.getElementById('quiz-mode-hint');
  if (quizHint) {
    if (connected) {
      quizHint.textContent = '🤖 API 已連接：預設從題庫出題；填寫主題可額外補充 AI 新詞再測驗';
    } else if (status === 'disabled') {
      quizHint.textContent = '📦 已取消 API 連接，目前僅從本地題庫出題；點擊上方狀態燈可重新連接';
    } else if (status === 'error') {
      quizHint.textContent = '⚠️ API 連接失敗，目前僅從本地題庫出題';
    } else if (status === 'checking') {
      quizHint.textContent = '正在檢查 API 連線…';
    } else {
      quizHint.textContent = '📦 從本地題庫出題；連接 API 後可輸入主題補充新詞';
    }
  }
}

/* ===== 模組 1：寫作測試 ===== */

const WRITING_LEVEL_DESC = {
  '初級': '初級：提供供詞協助寫作，評核不執著文法',
  '中級': '中級：不提供供詞，評核不執著文法'
};

function updateWritingLevelDesc() {
  const el = document.getElementById('writing-level-desc');
  if (el) el.textContent = WRITING_LEVEL_DESC[writingDifficulty] || '';
}

async function handleWritingGetPrompt() {
  const topicInput = document.getElementById('writing-topic');
  const promptEl = document.getElementById('writing-prompt');
  const btn = document.getElementById('writing-get-prompt');
  const topic = topicInput.value.trim();

  if (!topic) {
    showToast('請輸入或選擇寫作情境', 'warning');
    return;
  }

  hideEmptyShowResult('writing-empty', 'writing-prompt');
  document.getElementById('writing-compose').classList.add('hidden');
  document.getElementById('writing-feedback').classList.add('hidden');
  document.getElementById('writing-input').value = '';
  lastWritingPrompt = '';

  setButtonLoading(btn, true, '出題中...');

  try {
    const systemPrompt = getWritingPromptSystem(writingDifficulty);
    const userMessage = `請為以下社工工作情境設計一個${writingDifficulty}寫作測試題目：${topic}`;
    const gen = streamDeepSeek(systemPrompt, userMessage);
    await renderStreamToElement(gen, promptEl, (fullText) => {
      lastWritingPrompt = fullText;
      document.getElementById('writing-compose').classList.remove('hidden');
    });
  } catch (err) {
    promptEl.textContent = '';
    promptEl.classList.add('hidden');
    document.getElementById('writing-empty').classList.remove('hidden');
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleWritingSubmit() {
  const input = document.getElementById('writing-input');
  const feedbackEl = document.getElementById('writing-feedback');
  const btn = document.getElementById('writing-submit');
  const text = input.value.trim();

  if (!lastWritingPrompt) {
    showToast('請先取得寫作題目', 'warning');
    return;
  }

  if (!text) {
    showToast('請先完成英文寫作', 'warning');
    return;
  }

  setButtonLoading(btn, true, '評估中...');

  try {
    const systemPrompt = getWritingFeedbackSystem(writingDifficulty);
    const userMessage = `【寫作題目】
${lastWritingPrompt}

【學生英文寫作】
${text}

請按${writingDifficulty}標準評估這篇寫作。`;
    const gen = streamDeepSeek(systemPrompt, userMessage);
    feedbackEl.classList.remove('hidden');
    await renderStreamToElement(gen, feedbackEl);
  } catch (err) {
    feedbackEl.classList.add('hidden');
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function handleWritingClear() {
  document.getElementById('writing-empty').classList.remove('hidden');
  document.getElementById('writing-prompt').classList.add('hidden');
  document.getElementById('writing-prompt').textContent = '';
  document.getElementById('writing-compose').classList.add('hidden');
  document.getElementById('writing-feedback').classList.add('hidden');
  document.getElementById('writing-feedback').textContent = '';
  document.getElementById('writing-topic').value = '';
  document.getElementById('writing-input').value = '';
  lastWritingPrompt = '';
}

/* ===== 模組 2：詞彙查詢 ===== */

async function handleLookupSubmit() {
  const input = document.getElementById('lookup-input');
  const result = document.getElementById('lookup-result');
  const btn = document.getElementById('lookup-submit');
  const addBtn = document.getElementById('lookup-add-vocab');
  const text = input.value.trim();

  if (!text) {
    showToast('請輸入中文社工概念', 'warning');
    return;
  }

  lastLookupTopic = text;
  hideEmptyShowResult('lookup-empty', 'lookup-result');
  setButtonLoading(btn, true, '查詢中...');
  addBtn.classList.add('hidden');

  try {
    const gen = streamDeepSeek(PROMPTS.VOCAB_LOOKUP, text);
    await renderStreamToElement(gen, result, (fullText) => {
      lastLookupResponse = fullText;
      addBtn.classList.remove('hidden');
    });
  } catch (err) {
    result.textContent = '';
    result.classList.add('hidden');
    document.getElementById('lookup-empty').classList.remove('hidden');
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function handleLookupAddVocab() {
  const existing = findTermByEn(allTermsCache, parseEnglishTermFromLookup(lastLookupResponse) || '');
  if (existing) {
    initTermProgress(existing.id);
    showToast(`「${existing.term_en}」已在題庫中，已加入複習排程`, 'success');
    return;
  }

  const term = termFromLookupResponse(lastLookupResponse, lastLookupTopic);
  if (!term) {
    showToast('無法從結果中解析詞彙，請再試一次', 'warning');
    return;
  }

  const { added } = addCustomTerms([term]);
  if (added.length === 0) {
    showToast('此詞彙已存在於離線題庫', 'info');
    return;
  }

  refreshAllTerms();
  initTermProgress(added[0].id);
  showToast(`「${added[0].term_en}」已加入離線題庫！`, 'success');
}

function handleLookupClear() {
  resetModule('lookup-empty', 'lookup-result', 'lookup-input');
  document.getElementById('lookup-add-vocab').classList.add('hidden');
  lastLookupResponse = '';
  lastLookupTopic = '';
}

function navigateToLookup(termZh) {
  switchTab('lookup');
  document.getElementById('lookup-input').value = termZh;
  document.getElementById('lookup-empty').classList.remove('hidden');
  document.getElementById('lookup-result').classList.add('hidden');
}

/* ===== 模組 3：情境造句 ===== */

async function handleSentenceSubmit() {
  const input = document.getElementById('sentence-input');
  const result = document.getElementById('sentence-result');
  const btn = document.getElementById('sentence-submit');
  const copyArea = document.getElementById('copy-practice');
  const text = input.value.trim();

  if (!text) {
    showToast('請輸入社工工作場景', 'warning');
    return;
  }

  hideEmptyShowResult('sentence-empty', 'sentence-result');
  setButtonLoading(btn, true, '生成中...');
  copyArea.classList.add('hidden');

  for (let i = 1; i <= 3; i++) {
    document.getElementById(`copy-input-${i}`).value = '';
    document.getElementById(`copy-diff-${i}`).innerHTML = '';
  }

  try {
    const prompt = getSentencePrompt(sentenceDifficulty);
    const gen = streamDeepSeek(prompt, text);
    await renderStreamToElement(gen, result, (fullText) => {
      lastSentenceResponse = fullText;
      copyArea.classList.remove('hidden');
    });
  } catch (err) {
    result.textContent = '';
    result.classList.add('hidden');
    document.getElementById('sentence-empty').classList.remove('hidden');
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function handleSentenceClear() {
  resetModule('sentence-empty', 'sentence-result', 'sentence-input');
  document.getElementById('copy-practice').classList.add('hidden');
  lastSentenceResponse = '';
}

function parsePracticeSentences(text) {
  const sentences = [];
  const regex = /\d+\.\s*([^→\n]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    sentences.push(match[1].trim());
  }
  return sentences.slice(0, 3);
}

function highlightDiff(user, expected) {
  const userLower = user.trim().toLowerCase();
  const expectedLower = expected.trim().toLowerCase();

  if (userLower === expectedLower) {
    return `<span class="correct">✅ 完全正確！</span>`;
  }

  let html = '';
  const maxLen = Math.max(user.length, expected.length);

  for (let i = 0; i < maxLen; i++) {
    const u = user[i] || '';
    const e = expected[i] || '';
    if (u.toLowerCase() !== e.toLowerCase()) {
      html += `<mark>${e || '∅'}</mark>`;
    } else {
      html += e;
    }
  }

  return `正確答案：${html}`;
}

function handleCopyCompare() {
  const sentences = parsePracticeSentences(lastSentenceResponse);

  if (sentences.length === 0) {
    showToast('無法從結果中解析練習句子，請先生成練習', 'warning');
    return;
  }

  for (let i = 0; i < 3; i++) {
    const userInput = document.getElementById(`copy-input-${i + 1}`).value;
    const diffEl = document.getElementById(`copy-diff-${i + 1}`);

    if (!userInput.trim()) {
      diffEl.innerHTML = '<span style="color:var(--color-text-muted)">尚未抄寫</span>';
      continue;
    }

    if (sentences[i]) {
      diffEl.innerHTML = highlightDiff(userInput, sentences[i]);
    }
  }

  showToast('對比完成！黃色標記為差異處', 'info');
}

/* ===== 初始化 ===== */

function initChipButtons(containerId, inputId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.text) return;

    const input = document.getElementById(inputId);
    if (input) input.value = chip.dataset.text;
    if (onSelect) onSelect(chip.dataset.text);
  });
}

function initCategoryChips(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;

    container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (onSelect) onSelect(chip.dataset.category);
  });
}

async function loadTermsCache() {
  try {
    const res = await fetch('data/sw_terms.json');
    if (!res.ok) throw new Error('無法載入詞彙庫');
    builtinTermsCache = await res.json();
    refreshAllTerms();
  } catch (err) {
    console.error(err);
    showToast('詞彙庫載入失敗', 'error');
    builtinTermsCache = [];
    refreshAllTerms();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('writing-get-prompt').addEventListener('click', handleWritingGetPrompt);
  document.getElementById('writing-submit').addEventListener('click', handleWritingSubmit);
  document.getElementById('writing-clear').addEventListener('click', handleWritingClear);
  initChipButtons('writing-chips', 'writing-topic');

  document.querySelectorAll('[data-writing-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-writing-level]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      writingDifficulty = btn.dataset.writingLevel;
      updateWritingLevelDesc();
    });
  });

  document.getElementById('writing-topic').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleWritingGetPrompt();
  });

  updateWritingLevelDesc();

  document.getElementById('lookup-submit').addEventListener('click', handleLookupSubmit);
  document.getElementById('lookup-clear').addEventListener('click', handleLookupClear);
  document.getElementById('lookup-add-vocab').addEventListener('click', handleLookupAddVocab);
  initChipButtons('lookup-chips', 'lookup-input');
  document.getElementById('lookup-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLookupSubmit();
  });

  document.getElementById('sentence-submit').addEventListener('click', handleSentenceSubmit);
  document.getElementById('sentence-clear').addEventListener('click', handleSentenceClear);
  document.getElementById('copy-compare').addEventListener('click', handleCopyCompare);
  initChipButtons('sentence-chips', 'sentence-input');

  document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sentenceDifficulty = btn.dataset.level;
    });
  });

  document.getElementById('sentence-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSentenceSubmit();
  });

  await loadTermsCache();

  if (typeof initLibrary === 'function') initLibrary(allTermsCache);
  if (typeof initLearn === 'function') initLearn(allTermsCache);
  if (typeof initQuiz === 'function') initQuiz(allTermsCache);
  if (typeof initSettings === 'function') initSettings();

  updateApiIndicator();
  updateUnifiedAiUi();

  if (isApiManuallyDisabled()) {
    apiConnectionStatus = 'disabled';
    updateApiIndicator();
  } else if (isApiKeyConfigured()) {
    await checkApiConnection();
  } else {
    apiConnectionStatus = 'disconnected';
    updateApiIndicator();
  }

  updateUnifiedAiUi();

  document.getElementById('api-disconnect')?.addEventListener('click', (e) => {
    e.stopPropagation();
    disconnectApi();
    showToast('已取消 API 連接', 'info');
  });

  document.getElementById('api-status')?.addEventListener('click', async () => {
    if (isApiManuallyDisabled()) {
      enableApiConnection();
      showToast('正在重新連接 API…', 'info');
      await checkApiConnection();
      updateUnifiedAiUi();
      if (getApiConnectionStatus() === 'connected') {
        showToast('API 連接正常', 'success');
      }
      return;
    }

    if (isApiKeyConfigured()) {
      showToast('正在重新檢查 API 連線…', 'info');
      await checkApiConnection();
      updateUnifiedAiUi();
      if (getApiConnectionStatus() === 'connected') {
        showToast('API 連接正常', 'success');
      }
    } else {
      showToast('請在「設定」分頁填入 DeepSeek API Key', 'warning');
      switchTab('settings');
    }
  });
});

window.switchTab = switchTab;
window.showToast = showToast;
window.navigateToLookup = navigateToLookup;
window.refreshAllTerms = refreshAllTerms;
window.getMergedTerms = getMergedTerms;
window.allTermsCache = () => allTermsCache;
