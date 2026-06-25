/**
 * 生字學習模組：選擇題、填空測驗、間隔複習
 */

let learnTerms = [];
let practiceQueue = [];
let practiceIndex = 0;
let learnMode = 'flashcard';
let fcAnswered = false;
let fcAutoAdvanceTimer = null;

/** 填空測驗狀態 */
let fillBlankQueue = [];
let fillBlankIndex = 0;
let fillBlankAnswered = false;

/**
 * 隨機打亂陣列
 * @param {Array} arr
 * @returns {Array}
 */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 初始化生字學習
 * @param {Array} terms
 */
function initLearn(terms) {
  learnTerms = terms;

  document.getElementById('learn-start').addEventListener('click', startPractice);

  document.querySelectorAll('.learn-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.learn-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      learnMode = tab.dataset.mode;
    });
  });

  document.getElementById('flashcard-close').addEventListener('click', closeFlashcard);
  document.getElementById('fc-next').addEventListener('click', () => {
    practiceIndex++;
    showCurrentQuestion();
  });

  // 填空測驗
  document.getElementById('fillblank-submit').addEventListener('click', submitFillBlank);
  document.getElementById('fillblank-next').addEventListener('click', () => {
    fillBlankIndex++;
    renderFillBlankQuestion();
  });
  document.getElementById('fillblank-hint').addEventListener('click', showFillHint);
  document.getElementById('fillblank-back').addEventListener('click', backToLearnHome);
  document.getElementById('fillblank-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFillBlank();
  });

  refreshLearnHome();
}

/**
 * 更新詞彙列表
 * @param {Array} terms
 */
function setLearnTerms(terms) {
  learnTerms = terms;
  refreshLearnHome();
}

/**
 * 刷新學習主頁統計
 */
function refreshLearnHome() {
  const stats = getStats(learnTerms);
  document.getElementById('stat-learned').textContent = stats.learned;
  document.getElementById('stat-learning').textContent = stats.learning;
  document.getElementById('stat-mastered').textContent = stats.mastered;
  document.getElementById('stat-due').textContent = stats.due;
  document.getElementById('learn-streak').textContent = `🔥 連續學習 ${getStreak()} 天`;

  const customCount = learnTerms.filter(isCustomTerm).length;
  const bankEl = document.getElementById('learn-bank-info');
  if (bankEl) {
    bankEl.textContent = `📚 題庫：內建 ${learnTerms.filter(isBuiltinTerm).length} + 已存 ${customCount} = ${learnTerms.length} 詞`;
  }
}

/**
 * 開始練習（合併離線待複習 + 可選 AI 補充）
 */
async function startPractice() {
  const btn = document.getElementById('learn-start');
  const category = document.getElementById('learn-category').value;
  const topic = document.getElementById('learn-ai-topic')?.value.trim() || '';
  const aiCount = parseInt(document.getElementById('learn-ai-count')?.value || '5', 10);

  if (topic && getApiConnectionStatus() !== 'connected') {
    showToast('請先連接 API 才能使用 AI 補充主題', 'warning');
    return;
  }

  setButtonLoading(btn, true, topic ? 'AI 補充中...' : '載入中...');

  try {
    learnTerms = getMergedTerms();
    let queue = getTodayPracticeTerms(learnTerms, category || undefined);
    let aiAdded = [];

    if (topic) {
      const result = await generateAndSaveTerms({ topic, count: aiCount, category });
      aiAdded = result.added;
      refreshAllTerms();
      learnTerms = getMergedTerms();
      queue = mergeTermQueues(aiAdded, queue);
    }

    if (queue.length === 0) {
      const msg = getApiConnectionStatus() === 'connected'
        ? '暫無待練詞彙，請填寫 AI 補充主題或從詞彙庫加入生字'
        : '沒有可練習的詞彙，請從詞彙庫加入生字';
      showToast(msg, 'warning');
      return;
    }

    practiceQueue = queue;
    practiceQueue.forEach(t => initTermProgress(t.id));
    updateStreak();

    if (aiAdded.length > 0) {
      showToast(`已加入 ${aiAdded.length} 個新詞，共 ${practiceQueue.length} 詞開始練習`, 'success');
    }

    if (learnMode === 'flashcard') {
      practiceIndex = 0;
      openFlashcard();
    } else {
      fillBlankQueue = [...practiceQueue];
      fillBlankIndex = 0;
      showFillBlankMode();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ===== 選擇題模式（英翻中） ===== */

function openFlashcard() {
  const overlay = document.getElementById('flashcard-overlay');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  showCurrentQuestion();
}

function closeFlashcard() {
  clearFcAutoAdvance();
  const overlay = document.getElementById('flashcard-overlay');
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  refreshLearnHome();
}

/**
 * 產生四選項（1 正確 + 3 干擾）
 * @param {Object} term
 * @returns {string[]}
 */
function generateFcOptions(term) {
  const pool = learnTerms.filter(t => t.id !== term.id);
  const sameCategory = pool.filter(t => t.category === term.category);
  const source = sameCategory.length >= 3 ? sameCategory : pool;

  const seen = new Set([term.term_zh_hk]);
  const distractors = [];
  for (const t of shuffleArray(source)) {
    if (seen.has(t.term_zh_hk)) continue;
    seen.add(t.term_zh_hk);
    distractors.push(t.term_zh_hk);
    if (distractors.length >= 3) break;
  }

  return shuffleArray([term.term_zh_hk, ...distractors]);
}

function clearFcAutoAdvance() {
  if (fcAutoAdvanceTimer) {
    clearTimeout(fcAutoAdvanceTimer);
    fcAutoAdvanceTimer = null;
  }
}

function showCurrentQuestion() {
  clearFcAutoAdvance();

  if (practiceIndex >= practiceQueue.length) {
    closeFlashcard();
    showToast('今日練習完成！做得好！', 'success');
    return;
  }

  fcAnswered = false;
  const term = practiceQueue[practiceIndex];
  const options = generateFcOptions(term);

  document.getElementById('fc-term').textContent = term.term_en;

  const optionsEl = document.getElementById('fc-options');
  optionsEl.innerHTML = options.map((opt, i) =>
    `<button type="button" class="fc-option" data-index="${i}">${escapeHtml(opt)}</button>`
  ).join('');

  optionsEl.querySelectorAll('.fc-option').forEach(btn => {
    btn.addEventListener('click', () => handleFcAnswer(parseInt(btn.dataset.index, 10), options, term));
  });

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  const feedback = document.getElementById('fc-feedback');
  feedback.className = 'fc-feedback hidden';
  feedback.textContent = '';
  document.getElementById('fc-next').classList.add('hidden');

  const total = practiceQueue.length;
  const current = practiceIndex + 1;
  document.getElementById('flashcard-progress').textContent = `第 ${current} / ${total} 題`;
  document.getElementById('flashcard-bar').style.width = `${(current / total) * 100}%`;
}

/**
 * 處理選擇題作答
 * @param {number} selectedIndex
 * @param {string[]} options
 * @param {Object} term
 */
function handleFcAnswer(selectedIndex, options, term) {
  if (fcAnswered) return;
  fcAnswered = true;

  const selected = options[selectedIndex];
  const isCorrect = selected === term.term_zh_hk;

  updateReviewSchedule(term.id, isCorrect ? 'good' : 'bad');

  const optionsEl = document.getElementById('fc-options');
  optionsEl.querySelectorAll('.fc-option').forEach((btn, i) => {
    btn.disabled = true;
    if (options[i] === term.term_zh_hk) btn.classList.add('correct');
    else if (i === selectedIndex) btn.classList.add('wrong');
  });

  const feedback = document.getElementById('fc-feedback');
  feedback.classList.remove('hidden');
  if (isCorrect) {
    feedback.className = 'fc-feedback correct';
    feedback.textContent = '✅ 答對了！';
    fcAutoAdvanceTimer = setTimeout(() => {
      fcAutoAdvanceTimer = null;
      practiceIndex++;
      showCurrentQuestion();
    }, 1200);
  } else {
    feedback.className = 'fc-feedback wrong';
    feedback.innerHTML = `❌ 答錯了，正確答案是「${escapeHtml(term.term_zh_hk)}」<br><small>${escapeHtml(term.definition_zh)}</small>`;
    document.getElementById('fc-next').classList.remove('hidden');
  }
}

/* ===== 填空測驗模式 ===== */

function showFillBlankMode() {
  document.getElementById('learn-home').classList.add('hidden');
  document.getElementById('fillblank-area').classList.remove('hidden');
  renderFillBlankQuestion();
}

function backToLearnHome() {
  document.getElementById('learn-home').classList.remove('hidden');
  document.getElementById('fillblank-area').classList.add('hidden');
  refreshLearnHome();
}

function renderFillBlankQuestion() {
  if (fillBlankIndex >= fillBlankQueue.length) {
    showToast('填空測驗完成！', 'success');
    backToLearnHome();
    return;
  }

  const term = fillBlankQueue[fillBlankIndex];
  const escaped = term.term_en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let sentence = term.easy_example_en.replace(
    new RegExp(escaped, 'gi'),
    '_______'
  );
  if (sentence === term.easy_example_en) {
    sentence = `The social work term means: _______ (${term.term_zh_hk})`;
  }

  document.getElementById('fillblank-sentence').textContent = sentence;
  document.getElementById('fillblank-input').value = '';
  document.getElementById('fillblank-feedback').classList.add('hidden');
  document.getElementById('fillblank-next').classList.add('hidden');
  document.getElementById('fillblank-submit').disabled = false;
  document.getElementById('fillblank-input').disabled = false;
  fillBlankAnswered = false;

  const total = fillBlankQueue.length;
  const current = fillBlankIndex + 1;
  document.getElementById('fillblank-progress').textContent = `第 ${current} / ${total} 題`;
  document.getElementById('fillblank-bar').style.width = `${(current / total) * 100}%`;
}

function showFillHint() {
  const term = fillBlankQueue[fillBlankIndex];
  const firstLetter = term.term_en[0].toUpperCase();
  showToast(`提示：首字母是 "${firstLetter}"`, 'info');
}

function submitFillBlank() {
  if (fillBlankAnswered) return;

  const term = fillBlankQueue[fillBlankIndex];
  const input = document.getElementById('fillblank-input').value.trim();
  const feedback = document.getElementById('fillblank-feedback');

  if (!input) {
    showToast('請輸入答案', 'warning');
    return;
  }

  fillBlankAnswered = true;
  const correct = input.toLowerCase() === term.term_en.toLowerCase();
  updateFillBlankProgress(term.id, correct);

  document.getElementById('fillblank-submit').disabled = true;
  document.getElementById('fillblank-input').disabled = true;

  feedback.classList.remove('hidden');
  if (correct) {
    feedback.className = 'fill-feedback correct';
    feedback.textContent = '✅ 答對了！';
    setTimeout(() => {
      fillBlankIndex++;
      renderFillBlankQuestion();
    }, 1200);
  } else {
    feedback.className = 'fill-feedback wrong';
    feedback.innerHTML = `❌ 正確答案是「${term.term_en}」<br><small>${term.example_zh || term.definition_zh}</small>`;
    document.getElementById('fillblank-next').classList.remove('hidden');
  }
}
