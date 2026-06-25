/**
 * 測驗模式：英翻中、中翻英、改錯選擇題
 */

let quizTerms = [];
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizWrongTerms = [];
let quizAnswered = false;

/**
 * 初始化測驗模組
 * @param {Array} terms
 */
function initQuiz(terms) {
  quizTerms = terms;

  document.getElementById('quiz-start').addEventListener('click', startQuiz);
  document.getElementById('quiz-next').addEventListener('click', nextQuestion);
  document.getElementById('quiz-retry').addEventListener('click', resetQuiz);
  document.getElementById('quiz-add-review').addEventListener('click', addWrongToReview);
}

/**
 * 更新詞彙列表
 * @param {Array} terms
 */
function setQuizTerms(terms) {
  quizTerms = terms;
}

/**
 * 隨機打亂陣列
 * @param {Array} arr
 * @returns {Array}
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 從陣列中隨機取 n 個不同元素
 * @param {Array} arr
 * @param {number} n
 * @param {*} exclude
 */
function pickRandom(arr, n, exclude) {
  const filtered = arr.filter(item => item !== exclude);
  return shuffle(filtered).slice(0, n);
}

/**
 * 篩選可用詞條
 */
function getFilteredTerms() {
  const category = document.getElementById('quiz-category').value;
  const difficulty = document.getElementById('quiz-difficulty').value;

  return quizTerms.filter(t => {
    if (category && t.category !== category) return false;
    if (difficulty && String(t.difficulty) !== difficulty) return false;
    return true;
  });
}

/**
 * 生成測驗題目
 * @param {Array} terms
 * @param {number} count
 * @param {Array} terms - 出題詞彙
 * @param {number} count - 題數
 * @param {Array} [distractorPool] - 干擾項來源（預設同 terms）
 * @returns {Array}
 */
function generateQuestions(terms, count, distractorPool) {
  const pool = shuffle(terms);
  const distractors = distractorPool || terms;
  const questions = [];
  const types = ['en2zh', 'zh2en', 'correction'];

  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const term = pool[i];
    const type = types[i % types.length];

    if (type === 'en2zh') {
      const distractorItems = pickRandom(
        distractors.filter(t => t.id !== term.id).map(t => t.term_zh_hk),
        3,
        term.term_zh_hk
      );
      questions.push({
        type: 'en2zh',
        term,
        question: term.term_en,
        options: shuffle([term.term_zh_hk, ...distractorItems]),
        correct: term.term_zh_hk,
        explanation: term.definition_zh
      });
    } else if (type === 'zh2en') {
      const distractorItems = pickRandom(
        distractors.filter(t => t.id !== term.id).map(t => t.term_en),
        3,
        term.term_en
      );
      questions.push({
        type: 'zh2en',
        term,
        question: term.term_zh_hk,
        options: shuffle([term.term_en, ...distractorItems]),
        correct: term.term_en,
        explanation: term.definition_zh
      });
    } else {
      const others = distractors.filter(t => t.id !== term.id && t.corrected_example_en);
      const distractorItems = pickRandom(
        others.map(t => t.corrected_example_en),
        3,
        term.corrected_example_en
      );
      questions.push({
        type: 'correction',
        term,
        question: term.wrong_example_en || term.easy_example_en,
        options: shuffle([term.corrected_example_en || term.easy_example_en, ...distractorItems]),
        correct: term.corrected_example_en || term.easy_example_en,
        explanation: term.common_mistake
      });
    }
  }

  return questions;
}

/**
 * 開始測驗（合併本地題庫 + 可選 AI 補充）
 */
async function startQuiz() {
  const btn = document.getElementById('quiz-start');
  const topic = document.getElementById('quiz-ai-topic')?.value.trim() || '';
  const count = parseInt(document.getElementById('quiz-count').value, 10);
  const category = document.getElementById('quiz-category').value;

  if (topic && getApiConnectionStatus() !== 'connected') {
    showToast('請先連接 API 才能使用 AI 補充主題', 'warning');
    return;
  }

  setButtonLoading(btn, true, topic ? 'AI 補充中...' : '準備測驗...');

  try {
    quizTerms = getMergedTerms();
    let filtered = getFilteredTerms();
    let aiAdded = [];

    if (topic) {
      const result = await generateAndSaveTerms({ topic, count, category });
      aiAdded = result.added;
      refreshAllTerms();
      quizTerms = getMergedTerms();
      filtered = getFilteredTerms();

      if (aiAdded.length > 0) {
        const newIds = new Set(aiAdded.map(t => t.id));
        const newTerms = filtered.filter(t => newIds.has(t.id));
        const rest = filtered.filter(t => !newIds.has(t.id));
        filtered = [...newTerms, ...rest];
      }
    }

    if (filtered.length < 4) {
      const msg = getApiConnectionStatus() === 'connected'
        ? '詞彙不足，請填寫 AI 補充主題或放寬篩選條件'
        : '詞彙數量不足，請放寬篩選條件';
      showToast(msg, 'warning');
      return;
    }

    quizQuestions = generateQuestions(filtered, count, quizTerms);
    quizIndex = 0;
    quizScore = 0;
    quizWrongTerms = [];
    quizAnswered = false;

    document.getElementById('quiz-setup').classList.add('hidden');
    document.getElementById('quiz-result').classList.add('hidden');
    document.getElementById('quiz-play').classList.remove('hidden');

    if (aiAdded.length > 0) {
      showToast(`已加入 ${aiAdded.length} 個新詞，開始 ${Math.min(count, filtered.length)} 題測驗`, 'success');
    }

    renderQuestion();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * 渲染當前題目
 */
function renderQuestion() {
  if (quizIndex >= quizQuestions.length) {
    showResult();
    return;
  }

  const q = quizQuestions[quizIndex];
  quizAnswered = false;

  const typeLabels = {
    en2zh: '英翻中',
    zh2en: '中翻英',
    correction: '改錯選擇'
  };

  document.getElementById('quiz-type-tag').textContent = typeLabels[q.type];
  document.getElementById('quiz-question').textContent = q.question;

  const total = quizQuestions.length;
  document.getElementById('quiz-progress').textContent = `第 ${quizIndex + 1} / ${total} 題`;
  document.getElementById('quiz-bar').style.width = `${((quizIndex + 1) / total) * 100}%`;

  const optionsEl = document.getElementById('quiz-options');
  optionsEl.innerHTML = q.options.map((opt, i) =>
    `<button class="quiz-option" data-index="${i}">${escapeHtml(opt)}</button>`
  ).join('');

  optionsEl.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => handleAnswer(parseInt(btn.dataset.index, 10)));
  });

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  document.getElementById('quiz-feedback').classList.add('hidden');
  document.getElementById('quiz-next').classList.add('hidden');
}

/**
 * 處理答題
 * @param {number} selectedIndex
 */
function handleAnswer(selectedIndex) {
  if (quizAnswered) return;
  quizAnswered = true;

  const q = quizQuestions[quizIndex];
  const selected = q.options[selectedIndex];
  const isCorrect = selected === q.correct;

  if (isCorrect) {
    quizScore++;
  } else {
    quizWrongTerms.push(q.term);
  }

  const optionsEl = document.getElementById('quiz-options');
  optionsEl.querySelectorAll('.quiz-option').forEach((btn, i) => {
    btn.disabled = true;
    const val = q.options[i];
    if (val === q.correct) btn.classList.add('correct');
    else if (i === selectedIndex) btn.classList.add('wrong');
  });

  const feedback = document.getElementById('quiz-feedback');
  feedback.classList.remove('hidden');
  feedback.className = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;
  feedback.innerHTML = isCorrect
    ? '✅ 答對了！'
    : `❌ 答錯了。正確答案：${escapeHtml(q.correct)}<br><small>${escapeHtml(q.explanation)}</small>`;

  document.getElementById('quiz-next').classList.remove('hidden');
}

function nextQuestion() {
  quizIndex++;
  renderQuestion();
}

/**
 * 顯示結果頁
 */
function showResult() {
  document.getElementById('quiz-play').classList.add('hidden');
  document.getElementById('quiz-result').classList.remove('hidden');

  const total = quizQuestions.length;
  const pct = Math.round((quizScore / total) * 100);
  document.getElementById('quiz-score').textContent = `${pct}%`;
  document.getElementById('quiz-score-detail').textContent = `答對 ${quizScore} / ${total} 題`;

  const wrongList = document.getElementById('quiz-wrong-list');
  if (quizWrongTerms.length === 0) {
    wrongList.innerHTML = '<p style="text-align:center;color:var(--color-accent-green)">全部答對，太棒了！🎉</p>';
  } else {
    wrongList.innerHTML = '<h4 style="margin:1rem 0 0.5rem">錯題列表</h4>' +
      quizWrongTerms.map(t =>
        `<div class="wrong-list-item"><strong>${escapeHtml(t.term_en)}</strong> — ${escapeHtml(t.term_zh_hk)}<br><small>${escapeHtml(t.definition_zh)}</small></div>`
      ).join('');
  }

  document.getElementById('quiz-add-review').style.display = quizWrongTerms.length > 0 ? '' : 'none';
}

function addWrongToReview() {
  const ids = quizWrongTerms.map(t => t.id);
  addTermsToReview(ids);
  showToast(`已將 ${ids.length} 個錯題加入生字複習`, 'success');
}

function resetQuiz() {
  document.getElementById('quiz-setup').classList.remove('hidden');
  document.getElementById('quiz-play').classList.add('hidden');
  document.getElementById('quiz-result').classList.add('hidden');
}
