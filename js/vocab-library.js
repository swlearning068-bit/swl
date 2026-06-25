/**
 * 詞彙庫模組：搜尋、篩選、摺疊卡片、題庫管理
 */

let libraryTerms = [];
let libraryCategory = '全部';
let librarySource = '全部';
let librarySearch = '';

/**
 * 更新詞彙列表（合併後刷新）
 * @param {Array} terms
 */
function setLibraryTerms(terms) {
  libraryTerms = terms;
  renderLibrary();
}

/**
 * 初始化詞彙庫
 * @param {Array} terms
 */
function initLibrary(terms) {
  libraryTerms = terms;
  renderLibrary();

  document.getElementById('library-search').addEventListener('input', (e) => {
    librarySearch = e.target.value.trim().toLowerCase();
    renderLibrary();
  });

  initCategoryChips('library-categories', (cat) => {
    libraryCategory = cat;
    renderLibrary();
  });

  initSourceChips('library-sources', (src) => {
    librarySource = src;
    renderLibrary();
  });

  document.getElementById('library-export').addEventListener('click', handleExportCustom);
  document.getElementById('library-import-btn').addEventListener('click', () => {
    document.getElementById('library-import-file').click();
  });
  document.getElementById('library-import-file').addEventListener('change', handleImportCustom);
  document.getElementById('library-clear-ai').addEventListener('click', handleClearCustom);
}

/**
 * 來源篩選 chips
 */
function initSourceChips(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (onSelect) onSelect(chip.dataset.source);
  });
}

function refreshLibrary() {
  if (typeof getMergedTerms === 'function') {
    libraryTerms = getMergedTerms();
  }
  renderLibrary();
}

function filterTerms() {
  return libraryTerms.filter(term => {
    if (libraryCategory !== '全部' && term.category !== libraryCategory) return false;

    if (librarySource === '內建' && !isBuiltinTerm(term)) return false;
    if (librarySource === 'AI' && !isCustomTerm(term)) return false;

    if (librarySearch) {
      const haystack = [
        term.term_en,
        term.term_zh_hk,
        term.definition_zh,
        ...(term.tags || [])
      ].join(' ').toLowerCase();
      if (!haystack.includes(librarySearch)) return false;
    }

    return true;
  });
}

function getTermStatus(termId) {
  const prog = getProgress(termId);
  if (!prog) return 'new';
  return prog.status;
}

function renderLibrary() {
  const filtered = filterTerms();
  const list = document.getElementById('library-list');
  const stats = document.getElementById('library-stats');

  const builtinCount = libraryTerms.filter(isBuiltinTerm).length;
  const customCount = libraryTerms.filter(isCustomTerm).length;
  const allProgress = getAllProgress();
  const masteredCount = libraryTerms.filter(t => {
    const p = allProgress[t.id];
    return p && p.status === 'mastered';
  }).length;

  stats.textContent = `內建 ${builtinCount} / AI ${customCount} / 共 ${libraryTerms.length} 詞 / 篩選 ${filtered.length} / 已掌握 ${masteredCount}`;

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state card">
        <div class="empty-state-icon">🔍</div>
        <p>找不到符合條件的詞彙。可試試 AI 擴充或在詞彙查詢後加入離線題庫。</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(term => {
    const status = getTermStatus(term.id);
    const catClass = `tag-cat-${term.category}`;
    const sourceTag = isCustomTerm(term)
      ? '<span class="tag tag-source-ai">AI</span>'
      : '<span class="tag tag-source-builtin">內建</span>';

    return `
      <div class="vocab-card" data-id="${term.id}">
        <div class="vocab-card-header">
          <span class="status-dot ${status}" title="${status}"></span>
          <div style="flex:1">
            <div class="vocab-term-en">${escapeHtml(term.term_en)} ${sourceTag}</div>
            <div class="vocab-term-zh">${escapeHtml(term.term_zh_hk)}</div>
          </div>
          <span class="tag ${catClass}">${escapeHtml(term.category)}</span>
          <span class="expand-icon">▼</span>
        </div>
        <div class="vocab-card-body">
          <div class="vocab-detail-row"><strong>定義：</strong>${escapeHtml(term.definition_zh)}</div>
          <div class="vocab-detail-row"><strong>例句：</strong>${escapeHtml(term.easy_example_en)}</div>
          <div class="vocab-detail-row"><strong>常見錯誤：</strong>${escapeHtml(term.common_mistake)}</div>
          <div class="vocab-detail-row"><strong>相關詞彙：</strong>${escapeHtml((term.related_terms || []).join('、'))}</div>
          <div class="vocab-detail-row"><strong>文法提示：</strong>${escapeHtml(term.grammar_note_zh || '')}</div>
          <div class="vocab-card-actions">
            <button class="btn btn-sm btn-secondary" data-action="add-learn" data-id="${term.id}">📖 加入生字學習</button>
            <button class="btn btn-sm btn-outline" data-action="ask-ai" data-zh="${escapeHtml(term.term_zh_hk)}">🤖 問 AI 更多</button>
            ${isCustomTerm(term) ? `<button class="btn btn-sm btn-danger-sm" data-action="delete" data-id="${term.id}">🗑️ 刪除</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.vocab-card-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      header.parentElement.classList.toggle('expanded');
    });
  });

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;

      if (action === 'add-learn') {
        initTermProgress(btn.dataset.id);
        showToast('已加入生字學習！', 'success');
        renderLibrary();
      } else if (action === 'ask-ai') {
        navigateToLookup(btn.dataset.zh);
      } else if (action === 'delete') {
        if (deleteCustomTerm(btn.dataset.id)) {
          showToast('已從離線題庫刪除', 'success');
          refreshAllTerms();
        }
      }
    });
  });
}

function handleExportCustom() {
  const custom = getCustomTerms();
  if (custom.length === 0) {
    showToast('沒有 AI 詞彙可匯出', 'warning');
    return;
  }
  const blob = new Blob([exportCustomTermsJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sw_custom_terms_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`已匯出 ${custom.length} 個詞彙`, 'success');
}

function handleImportCustom(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const result = importCustomTermsFromJSON(reader.result);
    e.target.value = '';
    if (result.error) {
      showToast(result.error, 'error');
      return;
    }
    showToast(`成功匯入 ${result.added} 個新詞彙`, 'success');
    refreshAllTerms();
  };
  reader.readAsText(file);
}

function handleClearCustom() {
  const count = getCustomTerms().length;
  if (count === 0) {
    showToast('沒有 AI 詞彙可清除', 'warning');
    return;
  }
  if (!confirm(`確定要刪除全部 ${count} 個 AI 詞彙嗎？此操作無法復原。`)) return;
  clearAllCustomTerms();
  showToast(`已清除 ${count} 個 AI 詞彙`, 'success');
  refreshAllTerms();
}
