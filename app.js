/**
 * 班級代辦費與收費管理系統
 * 支援功能：
 * 1. 班級名單管理：
 *    - 單筆新增、批次匯入、刪除
 *    - 隨時手動「編輯」學生座號與姓名
 *    - 「重新整理座號」按鈕（當同學轉出刪除後，一鍵將全班座號依序遞補為 01, 02, 03...）
 *    - 嚴格綁定隱藏唯一 ID (student.id)，修改座號或重編座號絕不影響收費明細與繳費狀態
 *    - 全系統（名單、收費勾選、繳費點收表、A4 總表、聯絡簿收費單）永遠自動依照「座號」由小到大排序
 * 2. 收費項目管理（全班平分、指定同學平分/定額、指定同學各自付費、編輯與刪除）
 * 3. 繳費總覽與打勾點收（自動結算每人總額與個人明細、篩選、搜尋）
 * 4. 雙模式列印（搭配 @media print 隱藏所有操作介面）：
 *    - 列印收費明細表 (A4 全班簽收總表)
 *    - 列印聯絡簿明細 (一頁 A4 印 6 張個人小收費單，附裁剪虛線與家長簽閱欄)
 * 5. localStorage 自動儲存 + JSON 備份匯出/匯入
 */

const STORAGE_KEY = 'CLASS_FEE_MANAGER_STATE_V1';

// 產生不重複的隱藏唯一 ID (Unique ID)
function generateUniqueId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// 預設範例資料（每位學生皆有固定唯一 ID：stu_uid_1 ~ stu_uid_10）
function getDemoState() {
  const students = [
    { id: 'stu_uid_1', seat: '01', name: '王小明', paid: true },
    { id: 'stu_uid_2', seat: '02', name: '林佳穎', paid: true },
    { id: 'stu_uid_3', seat: '03', name: '陳冠宇', paid: false },
    { id: 'stu_uid_4', seat: '04', name: '張雅婷', paid: true },
    { id: 'stu_uid_5', seat: '05', name: '李承翰', paid: false },
    { id: 'stu_uid_6', seat: '06', name: '黃詩涵', paid: false },
    { id: 'stu_uid_7', seat: '07', name: '吳柏翰', paid: true },
    { id: 'stu_uid_8', seat: '08', name: '劉子瑜', paid: false },
    { id: 'stu_uid_9', seat: '09', name: '蔡宇軒', paid: true },
    { id: 'stu_uid_10', seat: '10', name: '鄭心怡', paid: false }
  ];

  const expenses = [
    {
      id: 'exp_uid_1',
      title: '生物複習講義',
      mode: 'all_equal',
      calcType: 'by_total',
      inputAmount: 2500,
      totalAmount: 2500,
      selectedStudentIds: students.map(s => s.id),
      customAmounts: {}
    },
    {
      id: 'exp_uid_2',
      title: '班服製作 (排汗衫)',
      mode: 'all_equal',
      calcType: 'by_total',
      inputAmount: 3200,
      totalAmount: 3200,
      selectedStudentIds: students.map(s => s.id),
      customAmounts: {}
    },
    {
      id: 'exp_uid_3',
      title: '週五訂便當 (雞腿/排骨)',
      mode: 'custom_individual',
      calcType: 'custom',
      inputAmount: 770,
      totalAmount: 770,
      selectedStudentIds: [],
      customAmounts: {
        stu_uid_1: 100,
        stu_uid_2: 95,
        stu_uid_3: 100,
        stu_uid_4: 95,
        stu_uid_5: 100,
        stu_uid_7: 95,
        stu_uid_9: 90,
        stu_uid_10: 95
      }
    },
    {
      id: 'exp_uid_4',
      title: '科展材料費分攤 (自然組)',
      mode: 'selected_equal',
      calcType: 'by_total',
      inputAmount: 600,
      totalAmount: 600,
      selectedStudentIds: ['stu_uid_1', 'stu_uid_3', 'stu_uid_5', 'stu_uid_7', 'stu_uid_9'],
      customAmounts: {}
    }
  ];

  return {
    classTitle: '二年一班 代辦費與收費管理',
    students,
    expenses
  };
}

// =========================================================
// 座號排序工具：永遠依照「座號」由小到大進行自然排序
// =========================================================
function compareStudentsBySeat(a, b) {
  const seatA = String(a.seat ?? '').trim();
  const seatB = String(b.seat ?? '').trim();
  const numA = parseInt(seatA, 10);
  const numB = parseInt(seatB, 10);

  if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
    return numA - numB;
  }
  if (!isNaN(numA) && isNaN(numB)) return -1;
  if (isNaN(numA) && !isNaN(numB)) return 1;

  const cmpSeat = seatA.localeCompare(seatB, 'zh-Hant', { numeric: true });
  if (cmpSeat !== 0) return cmpSeat;
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hant');
}

function getSortedStudents() {
  return [...state.students].sort(compareStudentsBySeat);
}

function sortStateStudentsInPlace() {
  state.students.sort(compareStudentsBySeat);
}

// 系統狀態
let state = loadState();
sortStateStudentsInPlace();

let currentFilter = 'all';
let searchQuery = '';
let editingExpenseId = null;
let editingStudentId = null; // 目前正在行內編輯座號/姓名的學生唯一 ID

// 表單暫存狀態（新增收費項目時使用，皆以 student.id 為鍵值）
let tempSelectedStudentIds = new Set(state.students.map(s => s.id));
let tempCustomAmounts = {};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const demo = getDemoState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
      return demo;
    }
    const parsed = JSON.parse(raw);
    const students = Array.isArray(parsed.students)
      ? parsed.students.map((s, idx) => ({
          id: s.id || generateUniqueId(`stu_${idx}`),
          seat: s.seat !== undefined ? String(s.seat) : String(idx + 1).padStart(2, '0'),
          name: s.name || '未命名',
          paid: Boolean(s.paid)
        }))
      : [];
    return {
      classTitle: parsed.classTitle || '班級代辦費與收費管理',
      students,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : []
    };
  } catch (err) {
    console.error('讀取 localStorage 失敗，使用預設值：', err);
    return getDemoState();
  }
}

function saveState() {
  try {
    sortStateStudentsInPlace();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('寫入 localStorage 失敗：', err);
  }
}

// =========================================================
// 核心計算邏輯：所有分攤與明細完全綁定學生唯一 ID (student.id)
// =========================================================

/**
 * 計算單一收費項目中，每位學生的應繳金額 Map: { [studentId]: amount }
 */
function calculateExpenseShares(expense, students) {
  const shares = {};
  const studentCount = students.length;
  if (studentCount === 0) return shares;

  if (expense.mode === 'all_equal') {
    const perPerson = Math.round((Number(expense.inputAmount) || 0) / studentCount);
    students.forEach(s => {
      if (perPerson > 0) shares[s.id] = perPerson;
    });
  } else if (expense.mode === 'selected_equal') {
    const validIds = new Set(students.map(s => s.id));
    const activeIds = (expense.selectedStudentIds || []).filter(id => validIds.has(id));
    if (activeIds.length > 0) {
      let perPerson = 0;
      if (expense.calcType === 'by_unit') {
        perPerson = Math.round(Number(expense.inputAmount) || 0);
      } else {
        perPerson = Math.round((Number(expense.inputAmount) || 0) / activeIds.length);
      }
      activeIds.forEach(id => {
        if (perPerson > 0) shares[id] = perPerson;
      });
    }
  } else if (expense.mode === 'custom_individual') {
    const customMap = expense.customAmounts || {};
    students.forEach(s => {
      const val = Math.round(Number(customMap[s.id]) || 0);
      if (val > 0) {
        shares[s.id] = val;
      }
    });
  }

  return shares;
}

/**
 * 彙整全班每位學生的費用明細與總金額（自動依座號由小到大排序）
 * 回傳陣列：[{ student, items: [{ expenseId, title, amount }], totalAmount }]
 */
function computeAllStudentSummaries() {
  const sortedStudents = getSortedStudents();
  const expenseShareMap = {};
  state.expenses.forEach(exp => {
    expenseShareMap[exp.id] = calculateExpenseShares(exp, sortedStudents);
  });

  return sortedStudents.map(student => {
    const items = [];
    let totalAmount = 0;

    state.expenses.forEach(exp => {
      const amt = expenseShareMap[exp.id]?.[student.id] || 0;
      if (amt > 0) {
        items.push({
          expenseId: exp.id,
          title: exp.title,
          amount: amt
        });
        totalAmount += amt;
      }
    });

    return {
      student,
      items,
      totalAmount
    };
  });
}

function formatCurrency(num) {
  const n = Math.round(Number(num) || 0);
  return '$' + n.toLocaleString('zh-TW');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =========================================================
// 畫面渲染 (Render)
// =========================================================

function renderAll() {
  sortStateStudentsInPlace();
  renderHeaderTitle();
  renderStudentChips();
  renderSplitConfigControls();
  renderExpenseList();
  renderSummaryAndCollectionTable();
  renderPrintSheet();
  renderPrintContactSlips();
}

function renderHeaderTitle() {
  const titleInput = document.getElementById('class-title-input');
  if (document.activeElement !== titleInput) {
    titleInput.value = state.classTitle;
  }
}

// 1. 渲染學生名單（依座號排序，支援行內編輯座號與姓名）
function renderStudentChips() {
  const container = document.getElementById('student-chips-container');
  const badge = document.getElementById('student-count-badge');
  const sortedStudents = getSortedStudents();
  badge.textContent = `${sortedStudents.length} 人`;

  if (sortedStudents.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding:14px;">目前尚無學生名單，請在上方輸入姓名新增或點擊「批次貼上」。</div>`;
    return;
  }

  container.innerHTML = sortedStudents
    .map(s => {
      if (editingStudentId === s.id) {
        return `
          <div class="student-chip editing" data-student-id="${s.id}">
            <div class="student-edit-inline">
              <input type="text" class="input student-edit-seat" id="edit-seat-${s.id}" value="${escapeHtml(s.seat)}" placeholder="座號">
              <input type="text" class="input student-edit-name" id="edit-name-${s.id}" value="${escapeHtml(s.name)}" placeholder="學生姓名">
              <button type="button" class="btn btn-primary btn-xs" data-save-student="${s.id}">儲存</button>
              <button type="button" class="btn btn-ghost btn-xs" data-cancel-student="${s.id}">取消</button>
            </div>
          </div>
        `;
      }

      const seatHtml = s.seat ? `<span class="student-chip-seat">${escapeHtml(s.seat)}</span>` : '';
      return `
        <div class="student-chip" data-student-id="${s.id}">
          <div class="student-chip-info">
            ${seatHtml}
            <span class="student-chip-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
          </div>
          <div class="student-chip-actions">
            <button type="button" class="student-chip-btn" data-edit-student="${s.id}" title="編輯座號或姓名">編輯</button>
            <button type="button" class="student-chip-btn danger" data-remove-student="${s.id}" title="刪除此學生">×</button>
          </div>
        </div>
      `;
    })
    .join('');
}

// 2. 渲染收費項目的分攤設定區（學生名單亦依座號由小到大排序）
function getSelectedSplitMode() {
  const checked = document.querySelector('input[name="split_mode"]:checked');
  return checked ? checked.value : 'all_equal';
}

function getSelectedCalcType() {
  const checked = document.querySelector('input[name="selected_calc_type"]:checked');
  return checked ? checked.value : 'by_total';
}

function renderSplitConfigControls() {
  const mode = getSelectedSplitMode();
  const calcType = getSelectedCalcType();
  const amountInput = document.getElementById('input-expense-amount');
  const amountLabel = document.getElementById('label-expense-amount');
  const sortedStudents = getSortedStudents();

  // 切換 Tab 外觀
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  // 顯示對應區塊
  document.getElementById('split-preview-all').classList.toggle('hidden', mode !== 'all_equal');
  document.getElementById('split-config-selected').classList.toggle('hidden', mode !== 'selected_equal');
  document.getElementById('split-config-custom').classList.toggle('hidden', mode !== 'custom_individual');

  // 調整金額輸入框狀態
  if (mode === 'custom_individual') {
    amountLabel.innerHTML = `項目總金額 (自動加總)`;
    amountInput.readOnly = true;
    amountInput.style.backgroundColor = '#f1f5f9';
  } else if (mode === 'selected_equal' && calcType === 'by_unit') {
    amountLabel.innerHTML = `每人單價 ($) <span class="required">*</span>`;
    amountInput.readOnly = false;
    amountInput.style.backgroundColor = '';
    amountInput.placeholder = '例如：150';
  } else {
    amountLabel.innerHTML = `項目總金額 ($) <span class="required">*</span>`;
    amountInput.readOnly = false;
    amountInput.style.backgroundColor = '';
    amountInput.placeholder = '例如：3000';
  }

  // 渲染「指定同學平分」勾選清單（綁定 s.id）
  const selectedGrid = document.getElementById('selected-students-grid');
  if (sortedStudents.length === 0) {
    selectedGrid.innerHTML = `<div class="text-sm text-muted">請先新增班級學生名單</div>`;
  } else {
    selectedGrid.innerHTML = sortedStudents
      .map(s => {
        const isChecked = tempSelectedStudentIds.has(s.id);
        const label = s.seat ? `${escapeHtml(s.seat)} ${escapeHtml(s.name)}` : escapeHtml(s.name);
        return `
          <label class="student-check-item ${isChecked ? 'checked' : ''}">
            <input type="checkbox" data-select-student="${s.id}" ${isChecked ? 'checked' : ''}>
            <span>${label}</span>
          </label>
        `;
      })
      .join('');
  }

  // 渲染「指定同學各自付費」輸入清單（綁定 s.id）
  const customGrid = document.getElementById('custom-students-grid');
  if (sortedStudents.length === 0) {
    customGrid.innerHTML = `<div class="text-sm text-muted">請先新增班級學生名單</div>`;
  } else {
    customGrid.innerHTML = sortedStudents
      .map(s => {
        const val = tempCustomAmounts[s.id] !== undefined && tempCustomAmounts[s.id] !== '' ? tempCustomAmounts[s.id] : '';
        const label = s.seat ? `${escapeHtml(s.seat)} ${escapeHtml(s.name)}` : escapeHtml(s.name);
        return `
          <div class="custom-student-cell">
            <span class="custom-student-label" title="${label}">${label}</span>
            <input type="number" class="custom-student-input" data-custom-student="${s.id}" value="${val}" placeholder="$0" min="0" step="1">
          </div>
        `;
      })
      .join('');
  }

  updateSplitPreviewNumbers();
}

function updateSplitPreviewNumbers() {
  const mode = getSelectedSplitMode();
  const calcType = getSelectedCalcType();
  const amountInput = document.getElementById('input-expense-amount');
  const rawVal = Number(amountInput.value) || 0;
  const studentCount = state.students.length;

  if (mode === 'all_equal') {
    const perPerson = studentCount > 0 ? Math.round(rawVal / studentCount) : 0;
    document.getElementById('all-equal-preview-text').textContent =
      studentCount > 0
        ? `全班 ${studentCount} 人，每人應繳 ${formatCurrency(perPerson)}`
        : '請先新增班級名單';
  } else if (mode === 'selected_equal') {
    const validSelected = state.students.filter(s => tempSelectedStudentIds.has(s.id));
    const count = validSelected.length;
    document.getElementById('selected-count-text').textContent = `已勾選 ${count} 人`;

    if (count === 0) {
      document.getElementById('selected-equal-preview-text').textContent = '請至少勾選 1 位同學';
    } else if (calcType === 'by_unit') {
      const unit = Math.round(rawVal);
      const total = unit * count;
      document.getElementById('selected-equal-preview-text').textContent =
        `每人 ${formatCurrency(unit)} × ${count} 人 ＝ 總計 ${formatCurrency(total)}`;
    } else {
      const perPerson = Math.round(rawVal / count);
      document.getElementById('selected-equal-preview-text').textContent =
        `每人應繳 ${formatCurrency(perPerson)}（共 ${count} 人分攤）`;
    }
  } else if (mode === 'custom_individual') {
    let total = 0;
    let participants = 0;
    state.students.forEach(s => {
      const v = Math.round(Number(tempCustomAmounts[s.id]) || 0);
      if (v > 0) {
        total += v;
        participants++;
      }
    });
    amountInput.value = total > 0 ? total : '';
    document.getElementById('custom-participants-text').textContent = `共 ${participants} 人參與`;
    document.getElementById('custom-total-preview-text').textContent = `合計總金額：${formatCurrency(total)}`;
  }
}

// 渲染已建立的收費項目列表
function renderExpenseList() {
  const container = document.getElementById('expense-items-container');
  const summaryEl = document.getElementById('expense-list-summary');
  summaryEl.textContent = `共 ${state.expenses.length} 筆`;

  if (state.expenses.length === 0) {
    container.innerHTML = `<div class="empty-state">尚未新增任何收費項目，請由上方表單新增。</div>`;
    return;
  }

  container.innerHTML = state.expenses
    .map(exp => {
      const shares = calculateExpenseShares(exp, state.students);
      const participantIds = Object.keys(shares);
      const actualSum = participantIds.reduce((sum, id) => sum + shares[id], 0);

      let modeLabel = '全班平分';
      let detailDesc = '';
      if (exp.mode === 'all_equal') {
        modeLabel = '全班平分';
        const per = participantIds.length > 0 ? shares[participantIds[0]] : 0;
        detailDesc = `全班 ${participantIds.length} 人 · 每人 ${formatCurrency(per)}`;
      } else if (exp.mode === 'selected_equal') {
        modeLabel = '指定同學分攤';
        const per = participantIds.length > 0 ? shares[participantIds[0]] : 0;
        detailDesc = `指定 ${participantIds.length} 人 · 每人 ${formatCurrency(per)}`;
      } else {
        modeLabel = '各自付費';
        detailDesc = `指定 ${participantIds.length} 人依個人金額收費`;
      }

      return `
        <div class="expense-item-card">
          <div class="expense-item-info">
            <div class="expense-item-title-row">
              <span class="expense-item-title">${escapeHtml(exp.title)}</span>
              <span class="expense-mode-tag">${modeLabel}</span>
            </div>
            <div class="expense-item-meta">${detailDesc}</div>
          </div>
          <div class="expense-item-right">
            <span class="expense-item-total">${formatCurrency(actualSum)}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-edit-expense="${exp.id}">編輯</button>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-delete-expense="${exp.id}">刪除</button>
          </div>
        </div>
      `;
    })
    .join('');
}

// 3. 渲染統計卡片與右側繳費點收表格（已依座號由小到大排序）
function renderSummaryAndCollectionTable() {
  const summaries = computeAllStudentSummaries();

  const activeSummaries = summaries.filter(s => s.totalAmount > 0);
  const totalExpected = summaries.reduce((acc, s) => acc + s.totalAmount, 0);
  const totalCollected = summaries.reduce((acc, s) => acc + (s.student.paid ? s.totalAmount : 0), 0);
  const totalUnpaid = totalExpected - totalCollected;

  const paidStudentsCount = activeSummaries.filter(s => s.student.paid).length;
  const unpaidStudentsCount = activeSummaries.length - paidStudentsCount;
  const progressPercent =
    activeSummaries.length > 0 ? Math.round((paidStudentsCount / activeSummaries.length) * 100) : 0;

  // 更新頂部儀表板
  document.getElementById('stat-total-expected').textContent = formatCurrency(totalExpected);
  document.getElementById('stat-items-count').textContent = `共 ${state.expenses.length} 個收費項目`;
  document.getElementById('stat-total-collected').textContent = formatCurrency(totalCollected);
  document.getElementById('stat-paid-students').textContent = `${paidStudentsCount} / ${activeSummaries.length} 人已繳清`;
  document.getElementById('stat-total-unpaid').textContent = formatCurrency(totalUnpaid);
  document.getElementById('stat-unpaid-students').textContent = `尚有 ${unpaidStudentsCount} 人未繳`;
  document.getElementById('stat-progress-percent').textContent = `${progressPercent}%`;
  document.getElementById('stat-progress-bar').style.width = `${progressPercent}%`;

  // 更新篩選器數量
  const allCount = summaries.length;
  const paidCountAll = summaries.filter(s => s.student.paid).length;
  const unpaidCountAll = allCount - paidCountAll;
  document.getElementById('count-all').textContent = allCount;
  document.getElementById('count-unpaid').textContent = unpaidCountAll;
  document.getElementById('count-paid').textContent = paidCountAll;

  // 篩選與搜尋
  const filtered = summaries.filter(entry => {
    if (currentFilter === 'paid' && !entry.student.paid) return false;
    if (currentFilter === 'unpaid' && entry.student.paid) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.trim().toLowerCase();
      const matchName = entry.student.name.toLowerCase().includes(q);
      const matchSeat = (entry.student.seat || '').toLowerCase().includes(q);
      return matchName || matchSeat;
    }
    return true;
  });

  const tbody = document.getElementById('collection-table-body');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">沒有符合篩選條件的學生資料</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map(({ student, items, totalAmount }) => {
      const isPaid = Boolean(student.paid);
      let statusBadge = '';
      if (totalAmount === 0) {
        statusBadge = `<span class="status-pill zero">無須繳費</span>`;
      } else if (isPaid) {
        statusBadge = `<span class="status-pill paid">已繳費</span>`;
      } else {
        statusBadge = `<span class="status-pill unpaid">未繳費</span>`;
      }

      const breakdownHtml =
        items.length > 0
          ? `<div class="breakdown-tags">` +
            items
              .map(
                item => `
                <span class="breakdown-tag">
                  <span>${escapeHtml(item.title)}</span>
                  <span class="breakdown-tag-price">${formatCurrency(item.amount)}</span>
                </span>
              `
              )
              .join('') +
            `</div>`
          : `<span class="text-sm text-muted">無分攤項目</span>`;

      return `
        <tr class="${isPaid ? 'row-paid' : ''}" data-toggle-paid-row="${student.id}">
          <td class="col-check">
            <label class="paid-checkbox-label" onclick="event.stopPropagation()">
              <input type="checkbox" class="paid-checkbox" data-toggle-paid="${student.id}" ${isPaid ? 'checked' : ''}>
              ${statusBadge}
            </label>
          </td>
          <td class="col-student">
            <span class="student-seat-badge">${escapeHtml(student.seat || '')}</span>
            <span class="student-name-text">${escapeHtml(student.name)}</span>
          </td>
          <td class="col-breakdown">${breakdownHtml}</td>
          <td class="col-total">
            <span class="student-total-amount">${formatCurrency(totalAmount)}</span>
          </td>
        </tr>
      `;
    })
    .join('');
}

// 4A. 渲染「全班 A4 收費明細總表」
function renderPrintSheet() {
  const summaries = computeAllStudentSummaries();
  const totalExpected = summaries.reduce((acc, s) => acc + s.totalAmount, 0);
  const totalCollected = summaries.reduce((acc, s) => acc + (s.student.paid ? s.totalAmount : 0), 0);
  const totalUnpaid = totalExpected - totalCollected;

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  document.getElementById('print-class-title').textContent = `${state.classTitle} — 收費明細表`;
  document.getElementById('print-date').textContent = dateStr;
  document.getElementById('print-total-expected').textContent = formatCurrency(totalExpected);
  document.getElementById('print-collected-status').textContent = `已收 ${formatCurrency(totalCollected)} / 待收 ${formatCurrency(totalUnpaid)}`;

  // 渲染收費項目摘要列
  const summaryBox = document.getElementById('print-expense-summary');
  if (state.expenses.length === 0) {
    summaryBox.innerHTML = `<span>尚無收費項目</span>`;
  } else {
    summaryBox.innerHTML =
      `<strong>本次收費項目一覽：</strong>` +
      state.expenses
        .map((exp, idx) => {
          const shares = calculateExpenseShares(exp, state.students);
          const ids = Object.keys(shares);
          const sum = ids.reduce((a, id) => a + shares[id], 0);
          return `<span class="print-summary-item">${idx + 1}. ${escapeHtml(exp.title)}（共 ${ids.length} 人，合計 ${formatCurrency(sum)}）</span>`;
        })
        .join('');
  }

  // 渲染每位同學的明細列（依座號排序）
  const printTbody = document.getElementById('print-table-body');
  if (summaries.length === 0) {
    printTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">尚無學生名單</td></tr>`;
  } else {
    printTbody.innerHTML = summaries
      .map(({ student, items, totalAmount }, index) => {
        const seatText = student.seat ? escapeHtml(student.seat) : String(index + 1).padStart(2, '0');
        const detailsText =
          items.length > 0
            ? items
                .map(
                  i =>
                    `<span class="print-detail-item">• ${escapeHtml(i.title)}: <strong>${formatCurrency(i.amount)}</strong></span>`
                )
                .join(' ')
            : '無收費項目';

        const statusCell = student.paid
          ? `<span class="print-checkbox-box">☑ 已繳費</span>`
          : `<span class="print-checkbox-box">☐ 未繳費</span>`;

        return `
          <tr>
            <td class="p-col-seat">${seatText}</td>
            <td class="p-col-name">${escapeHtml(student.name)}</td>
            <td class="p-col-details">${detailsText}</td>
            <td class="p-col-total">${formatCurrency(totalAmount)}</td>
            <td class="p-col-status">${statusCell}</td>
          </tr>
        `;
      })
      .join('');
  }

  const paidCount = summaries.filter(s => s.totalAmount > 0 && s.student.paid).length;
  const activeCount = summaries.filter(s => s.totalAmount > 0).length;
  document.getElementById('print-footer-stats').textContent = `應繳人數：${activeCount} 人 ｜ 已繳：${paidCount} 人 ｜ 未繳：${activeCount - paidCount} 人`;
}

// 4B. 渲染「聯絡簿個人收費通知單」（一頁 A4 印 6 格，適合裁剪貼在聯絡簿上）
function renderPrintContactSlips() {
  const summaries = computeAllStudentSummaries();
  const container = document.getElementById('print-slips-container');

  const today = new Date();
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

  if (summaries.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding: 20mm;">目前尚無學生名單可產生聯絡簿收費單</div>`;
    return;
  }

  container.innerHTML = summaries
    .map(({ student, items, totalAmount }, index) => {
      const seatText = student.seat ? `${escapeHtml(student.seat)}號` : `${index + 1}號`;
      const paidBadge = student.paid ? '☑ 已繳清' : '☐ 待繳費';

      const itemsRowsHtml =
        items.length > 0
          ? items
              .map(
                (item, idx) => `
                <tr>
                  <td class="slip-item-name">${idx + 1}. ${escapeHtml(item.title)}</td>
                  <td class="slip-item-amount">${formatCurrency(item.amount)}</td>
                </tr>
              `
              )
              .join('')
          : `
            <tr>
              <td colspan="2" style="text-align:center; color:#666; padding: 8px 0;">本次無須繳納項目</td>
            </tr>
          `;

      return `
        <article class="contact-slip-card">
          <span class="slip-cut-hint">✂ 聯絡簿貼條</span>
          <div>
            <div class="slip-header">
              <div class="slip-class-name">
                <span>${escapeHtml(state.classTitle)}</span>
                <span>日期：${dateStr}</span>
              </div>
              <div class="slip-student-line">
                <div class="slip-student-name">
                  <span class="slip-seat-tag">${seatText}</span>${escapeHtml(student.name)} 同學
                </div>
                <span class="slip-paid-tag">${paidBadge}</span>
              </div>
            </div>

            <div class="slip-body">
              <div class="slip-items-title">【個人收費項目明細】</div>
              <table class="slip-items-table">
                <tbody>
                  ${itemsRowsHtml}
                </tbody>
              </table>
            </div>
          </div>

          <div class="slip-footer">
            <div class="slip-total-row">
              <span>應繳總金額：</span>
              <span class="slip-total-amount">${formatCurrency(totalAmount)}</span>
            </div>
            <div class="slip-sign-row">
              <span>家長簽閱：_______________</span>
              <span>老師點收：_______________</span>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

// =========================================================
// 自動推算下一位學生的座號
// =========================================================
function getNextSuggestedSeat() {
  if (state.students.length === 0) return '01';
  const maxSeat = state.students.reduce((max, s) => {
    const n = parseInt(s.seat, 10);
    return !isNaN(n) && n > max ? n : max;
  }, 0);
  return String(maxSeat + 1).padStart(2, '0');
}

// =========================================================
// 事件綁定與互動處理
// =========================================================

function initEventListeners() {
  // 班級標題修改
  const titleInput = document.getElementById('class-title-input');
  titleInput.addEventListener('input', e => {
    state.classTitle = e.target.value.trim() || '班級代辦費與收費管理';
    saveState();
    renderPrintSheet();
    renderPrintContactSlips();
  });

  // 單筆新增學生
  document.getElementById('form-add-student').addEventListener('submit', e => {
    e.preventDefault();
    const seatInput = document.getElementById('input-student-seat');
    const nameInput = document.getElementById('input-student-name');
    const name = nameInput.value.trim();
    if (!name) return;

    let seat = seatInput.value.trim();
    if (!seat) {
      seat = getNextSuggestedSeat();
    } else if (/^\d+$/.test(seat) && seat.length === 1) {
      seat = seat.padStart(2, '0');
    }

    const newStudent = {
      id: generateUniqueId('stu'),
      seat,
      name,
      paid: false
    };

    state.students.push(newStudent);
    tempSelectedStudentIds.add(newStudent.id);

    saveState();
    seatInput.value = '';
    nameInput.value = '';
    nameInput.focus();
    renderAll();
  });

  // 重新整理座號按鈕（當轉出學生刪除後，將目前名單依序重編為 01, 02, 03...，完全保留唯一 ID 與帳務綁定）
  document.getElementById('btn-renumber-seats').addEventListener('click', () => {
    if (state.students.length === 0) {
      alert('目前名單沒有學生可整理座號！');
      return;
    }
    if (
      !confirm(
        '確定要依目前順序將全班座號重新編為 01, 02, 03... 嗎？\n（不用擔心，所有學生的應繳金額、個人明細與繳費紀錄都會安全保留！）'
      )
    ) {
      return;
    }

    sortStateStudentsInPlace();
    state.students.forEach((student, index) => {
      student.seat = String(index + 1).padStart(2, '0');
    });

    editingStudentId = null;
    saveState();
    renderAll();
  });

  // 切換批次新增抽屜
  const bulkDrawer = document.getElementById('bulk-add-drawer');
  document.getElementById('btn-toggle-bulk').addEventListener('click', () => {
    bulkDrawer.classList.toggle('hidden');
  });
  document.getElementById('btn-cancel-bulk').addEventListener('click', () => {
    bulkDrawer.classList.add('hidden');
  });

  // 確認批次匯入學生
  document.getElementById('btn-confirm-bulk').addEventListener('click', () => {
    const textarea = document.getElementById('textarea-bulk-students');
    const raw = textarea.value.trim();
    if (!raw) return;

    const lines = raw
      .split(/[\r\n,，、]+/)
      .map(s => s.trim())
      .filter(Boolean);

    lines.forEach(line => {
      const match = line.match(/^(\d{1,3})\s+(.+)$/);
      let seat = '';
      let name = line;
      if (match) {
        seat = match[1].padStart(2, '0');
        name = match[2].trim();
      } else {
        seat = getNextSuggestedSeat();
      }

      const newStudent = {
        id: generateUniqueId('stu'),
        seat,
        name,
        paid: false
      };
      state.students.push(newStudent);
      tempSelectedStudentIds.add(newStudent.id);
    });

    textarea.value = '';
    bulkDrawer.classList.add('hidden');
    saveState();
    renderAll();
  });

  // 學生名單操作：編輯座號/姓名、儲存、取消、刪除
  const chipsContainer = document.getElementById('student-chips-container');
  chipsContainer.addEventListener('click', e => {
    // 1. 點擊「編輯」
    const editBtn = e.target.closest('[data-edit-student]');
    if (editBtn) {
      editingStudentId = editBtn.dataset.editStudent;
      renderStudentChips();
      const seatField = document.getElementById(`edit-seat-${editingStudentId}`);
      if (seatField) {
        seatField.focus();
        seatField.select();
      }
      return;
    }

    // 2. 點擊「儲存」
    const saveBtn = e.target.closest('[data-save-student]');
    if (saveBtn) {
      commitStudentInlineEdit(saveBtn.dataset.saveStudent);
      return;
    }

    // 3. 點擊「取消」
    const cancelBtn = e.target.closest('[data-cancel-student]');
    if (cancelBtn) {
      editingStudentId = null;
      renderStudentChips();
      return;
    }

    // 4. 點擊「刪除」
    const removeBtn = e.target.closest('[data-remove-student]');
    if (removeBtn) {
      const stuId = removeBtn.dataset.removeStudent;
      const target = state.students.find(s => s.id === stuId);
      if (!target) return;

      if (
        !confirm(
          `確定要從名單中刪除「${target.seat ? target.seat + '號 ' : ''}${target.name}」嗎？\n（刪除後可點擊右上角「重新整理座號」讓後面的同學座號自動往前遞補減 1）`
        )
      ) {
        return;
      }

      state.students = state.students.filter(s => s.id !== stuId);
      tempSelectedStudentIds.delete(stuId);
      delete tempCustomAmounts[stuId];
      if (editingStudentId === stuId) editingStudentId = null;
      saveState();
      renderAll();
    }
  });

  // 支援在學生行內編輯框按 Enter 直接儲存、按 Escape 取消
  chipsContainer.addEventListener('keydown', e => {
    if (!editingStudentId) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitStudentInlineEdit(editingStudentId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingStudentId = null;
      renderStudentChips();
    }
  });

  // 分攤模式切換
  document.querySelectorAll('input[name="split_mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      renderSplitConfigControls();
    });
  });

  document.querySelectorAll('input[name="selected_calc_type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      renderSplitConfigControls();
    });
  });

  // 總金額輸入即時預覽
  document.getElementById('input-expense-amount').addEventListener('input', () => {
    updateSplitPreviewNumbers();
  });

  // 指定同學勾選事件
  document.getElementById('selected-students-grid').addEventListener('change', e => {
    const checkbox = e.target.closest('[data-select-student]');
    if (!checkbox) return;
    const stuId = checkbox.dataset.selectStudent;
    if (checkbox.checked) {
      tempSelectedStudentIds.add(stuId);
    } else {
      tempSelectedStudentIds.delete(stuId);
    }
    renderSplitConfigControls();
  });

  // 全選 / 全不選同學
  document.getElementById('btn-select-all-students').addEventListener('click', () => {
    state.students.forEach(s => tempSelectedStudentIds.add(s.id));
    renderSplitConfigControls();
  });
  document.getElementById('btn-deselect-all-students').addEventListener('click', () => {
    tempSelectedStudentIds.clear();
    renderSplitConfigControls();
  });

  // 各自付費金額輸入事件
  document.getElementById('custom-students-grid').addEventListener('input', e => {
    const input = e.target.closest('[data-custom-student]');
    if (!input) return;
    const stuId = input.dataset.customStudent;
    tempCustomAmounts[stuId] = input.value;
    updateSplitPreviewNumbers();
  });

  // 快速填入全部 / 清空各自付費金額
  document.getElementById('btn-quick-fill-all').addEventListener('click', () => {
    const val = document.getElementById('input-quick-fill-amount').value;
    if (val === '') return;
    state.students.forEach(s => {
      tempCustomAmounts[s.id] = val;
    });
    renderSplitConfigControls();
  });
  document.getElementById('btn-clear-custom-amounts').addEventListener('click', () => {
    tempCustomAmounts = {};
    renderSplitConfigControls();
  });

  // 新增或儲存收費項目
  document.getElementById('form-add-expense').addEventListener('submit', e => {
    e.preventDefault();
    if (state.students.length === 0) {
      alert('請先新增班級學生名單！');
      return;
    }

    const titleInput = document.getElementById('input-expense-title');
    const amountInput = document.getElementById('input-expense-amount');
    const title = titleInput.value.trim();
    const mode = getSelectedSplitMode();
    const calcType = getSelectedCalcType();
    const inputAmount = Number(amountInput.value) || 0;

    if (!title) return;

    if (mode === 'selected_equal') {
      const validSelected = state.students.filter(s => tempSelectedStudentIds.has(s.id));
      if (validSelected.length === 0) {
        alert('請至少勾選一位參與分攤的同學！');
        return;
      }
    }

    if (mode === 'custom_individual') {
      const hasAny = state.students.some(s => (Number(tempCustomAmounts[s.id]) || 0) > 0);
      if (!hasAny) {
        alert('請至少為一位同學輸入應繳金額！');
        return;
      }
    } else if (inputAmount <= 0) {
      alert('請輸入大於 0 的金額！');
      return;
    }

    const expensePayload = {
      id: editingExpenseId || generateUniqueId('exp'),
      title,
      mode,
      calcType: mode === 'selected_equal' ? calcType : 'by_total',
      inputAmount,
      selectedStudentIds: Array.from(tempSelectedStudentIds),
      customAmounts: { ...tempCustomAmounts }
    };

    if (editingExpenseId) {
      const idx = state.expenses.findIndex(x => x.id === editingExpenseId);
      if (idx !== -1) state.expenses[idx] = expensePayload;
    } else {
      state.expenses.push(expensePayload);
    }

    resetExpenseForm();
    saveState();
    renderAll();
  });

  // 取消編輯收費項目
  document.getElementById('btn-cancel-edit-expense').addEventListener('click', () => {
    resetExpenseForm();
    renderSplitConfigControls();
  });

  // 編輯或刪除收費項目
  document.getElementById('expense-items-container').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit-expense]');
    if (editBtn) {
      const expId = editBtn.dataset.editExpense;
      const exp = state.expenses.find(x => x.id === expId);
      if (!exp) return;

      editingExpenseId = exp.id;
      document.getElementById('input-expense-title').value = exp.title;
      document.getElementById('input-expense-amount').value = exp.inputAmount;

      const modeRadio = document.querySelector(`input[name="split_mode"][value="${exp.mode}"]`);
      if (modeRadio) modeRadio.checked = true;

      if (exp.calcType) {
        const calcRadio = document.querySelector(`input[name="selected_calc_type"][value="${exp.calcType}"]`);
        if (calcRadio) calcRadio.checked = true;
      }

      tempSelectedStudentIds = new Set(exp.selectedStudentIds || state.students.map(s => s.id));
      tempCustomAmounts = { ...(exp.customAmounts || {}) };

      document.getElementById('btn-submit-expense').textContent = '儲存項目修改';
      document.getElementById('btn-cancel-edit-expense').classList.remove('hidden');
      renderSplitConfigControls();
      document.getElementById('panel-expenses').scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const delBtn = e.target.closest('[data-delete-expense]');
    if (delBtn) {
      const expId = delBtn.dataset.deleteExpense;
      const exp = state.expenses.find(x => x.id === expId);
      if (!exp) return;
      if (!confirm(`確定要刪除收費項目「${exp.title}」嗎？`)) return;

      state.expenses = state.expenses.filter(x => x.id !== expId);
      if (editingExpenseId === expId) resetExpenseForm();
      saveState();
      renderAll();
    }
  });

  // 點收表格打勾事件（支援直接點 Checkbox 或整列點擊）
  document.getElementById('collection-table-body').addEventListener('change', e => {
    const cb = e.target.closest('[data-toggle-paid]');
    if (!cb) return;
    const stuId = cb.dataset.togglePaid;
    const stu = state.students.find(s => s.id === stuId);
    if (stu) {
      stu.paid = cb.checked;
      saveState();
      renderSummaryAndCollectionTable();
      renderPrintSheet();
      renderPrintContactSlips();
    }
  });

  document.getElementById('collection-table-body').addEventListener('click', e => {
    if (e.target.closest('label') || e.target.closest('input')) return;
    const row = e.target.closest('[data-toggle-paid-row]');
    if (!row) return;
    const stuId = row.dataset.togglePaidRow;
    const stu = state.students.find(s => s.id === stuId);
    if (stu) {
      stu.paid = !stu.paid;
      saveState();
      renderSummaryAndCollectionTable();
      renderPrintSheet();
      renderPrintContactSlips();
    }
  });

  // 全部標為已繳 / 全部重置未繳
  document.getElementById('btn-mark-all-paid').addEventListener('click', () => {
    state.students.forEach(s => (s.paid = true));
    saveState();
    renderSummaryAndCollectionTable();
    renderPrintSheet();
    renderPrintContactSlips();
  });

  document.getElementById('btn-mark-all-unpaid').addEventListener('click', () => {
    state.students.forEach(s => (s.paid = false));
    saveState();
    renderSummaryAndCollectionTable();
    renderPrintSheet();
    renderPrintContactSlips();
  });

  // 篩選器切換
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderSummaryAndCollectionTable();
    });
  });

  // 搜尋學生
  document.getElementById('input-search-student').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderSummaryAndCollectionTable();
  });

  // 模式一：列印 A4 全班收費明細表
  document.getElementById('btn-print').addEventListener('click', () => {
    document.body.setAttribute('data-print-mode', 'summary');
    renderPrintSheet();
    window.print();
  });

  // 模式二：列印聯絡簿明細（一頁 A4 印 6 張個人小收費單）
  document.getElementById('btn-print-slips').addEventListener('click', () => {
    document.body.setAttribute('data-print-mode', 'slips');
    renderPrintContactSlips();
    window.print();
  });

  // 載入範例資料
  document.getElementById('btn-demo-data').addEventListener('click', () => {
    if (
      state.students.length > 0 &&
      !confirm('載入範例資料將會覆蓋目前的班級名單與收費紀錄，確定要繼續嗎？')
    ) {
      return;
    }
    state = getDemoState();
    editingStudentId = null;
    tempSelectedStudentIds = new Set(state.students.map(s => s.id));
    tempCustomAmounts = {};
    resetExpenseForm();
    saveState();
    renderAll();
  });

  // 重置系統
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('確定要清空所有學生名單與收費項目嗎？此動作無法復原。')) return;
    state = {
      classTitle: state.classTitle,
      students: [],
      expenses: []
    };
    editingStudentId = null;
    tempSelectedStudentIds.clear();
    tempCustomAmounts = {};
    resetExpenseForm();
    saveState();
    renderAll();
  });

  // 匯出 Excel 結算表
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    exportToExcel();
  });

  // 匯出 JSON 備份
  document.getElementById('btn-export-json').addEventListener('click', () => {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.classTitle}_備份.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 匯入 JSON 備份
  document.getElementById('input-import-json').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported.students) || !Array.isArray(imported.expenses)) {
          alert('備份檔案格式不正確！');
          return;
        }
        state = {
          classTitle: imported.classTitle || '班級代辦費與收費管理',
          students: imported.students.map((s, idx) => ({
            id: s.id || generateUniqueId(`stu_${idx}`),
            seat: s.seat !== undefined ? String(s.seat) : String(idx + 1).padStart(2, '0'),
            name: s.name || '未命名',
            paid: Boolean(s.paid)
          })),
          expenses: imported.expenses
        };
        editingStudentId = null;
        tempSelectedStudentIds = new Set(state.students.map(s => s.id));
        tempCustomAmounts = {};
        saveState();
        renderAll();
      } catch (err) {
        alert('無法解析備份檔案！');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// 儲存學生座號與姓名的行內編輯（保持原本的 student.id 不變，並自動重新依座號排序）
function commitStudentInlineEdit(stuId) {
  const student = state.students.find(s => s.id === stuId);
  if (!student) return;

  const seatInput = document.getElementById(`edit-seat-${stuId}`);
  const nameInput = document.getElementById(`edit-name-${stuId}`);
  const newName = (nameInput?.value || '').trim();
  let newSeat = (seatInput?.value || '').trim();

  if (!newName) {
    alert('學生姓名不能為空！');
    nameInput?.focus();
    return;
  }

  if (/^\d+$/.test(newSeat) && newSeat.length === 1) {
    newSeat = newSeat.padStart(2, '0');
  }

  student.seat = newSeat;
  student.name = newName;
  editingStudentId = null;

  saveState();
  renderAll();
}

// 匯出 Excel 結算表（採用 UTF-8 BOM CSV 格式，支援 Excel 直接開啟不亂碼，並保留座號前導 0 與分項欄位）
function exportToExcel() {
  if (state.students.length === 0) {
    alert('目前沒有學生資料可供匯出！');
    return;
  }

  const summaries = computeAllStudentSummaries();
  const sortedStudents = summaries.map(s => s.student);

  // 預先計算每個收費項目對每位學生的分攤金額
  const expenseSharesMap = {};
  state.expenses.forEach(exp => {
    expenseSharesMap[exp.id] = calculateExpenseShares(exp, sortedStudents);
  });

  const escapeCsvCell = val => {
    const str = String(val ?? '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [];
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 1. 報表標題與結算摘要
  const totalExpected = summaries.reduce((acc, s) => acc + s.totalAmount, 0);
  const totalCollected = summaries.reduce((acc, s) => acc + (s.student.paid ? s.totalAmount : 0), 0);
  const totalUnpaid = totalExpected - totalCollected;
  const activeSummaries = summaries.filter(s => s.totalAmount > 0);
  const paidCount = activeSummaries.filter(s => s.student.paid).length;
  const unpaidCount = activeSummaries.length - paidCount;

  rows.push([`${state.classTitle} - 收費結算明細表`]);
  rows.push([`匯出日期：${dateStr}`, `應收總額：$${totalExpected}`, `已收金額：$${totalCollected}`, `待收餘額：$${totalUnpaid}`, `繳清人數：${paidCount} / ${activeSummaries.length} 人 (未繳 ${unpaidCount} 人)`]);
  rows.push([]); // 空行分隔

  // 2. 表頭欄位：座號、姓名、各個收費項目名稱、應繳總額、繳費狀態、已收金額、尚欠金額、個人花費明細文字
  const expenseHeaders = state.expenses.map(exp => exp.title);
  rows.push([
    '座號',
    '姓名',
    ...expenseHeaders,
    '應繳總金額',
    '繳費狀態',
    '已收金額',
    '待收金額',
    '個人花費項目明細'
  ]);

  // 3. 學生逐列資料
  summaries.forEach(({ student, items, totalAmount }) => {
    // 使用 ="01" 語法避免 Excel 自動把座號 01 轉成 1，若非純數字則正常輸出
    const seatStr = String(student.seat || '');
    const excelSeat = /^\d+$/.test(seatStr) ? `="${seatStr}"` : seatStr;

    const perExpenseCells = state.expenses.map(exp => {
      const amt = expenseSharesMap[exp.id]?.[student.id] || 0;
      return amt;
    });

    let statusText = '無須繳費';
    if (totalAmount > 0) {
      statusText = student.paid ? '已繳費' : '未繳費';
    }

    const paidAmt = student.paid ? totalAmount : 0;
    const unpaidAmt = student.paid ? 0 : totalAmount;
    const detailText = items.map(i => `${i.title}($${i.amount})`).join('、') || '無';

    rows.push([
      excelSeat,
      student.name,
      ...perExpenseCells,
      totalAmount,
      statusText,
      paidAmt,
      unpaidAmt,
      detailText
    ]);
  });

  // 4. 底部總計列
  const expenseTotals = state.expenses.map(exp => {
    const shares = expenseSharesMap[exp.id] || {};
    return Object.values(shares).reduce((sum, v) => sum + v, 0);
  });

  rows.push([]);
  rows.push([
    '總計',
    `共 ${summaries.length} 人`,
    ...expenseTotals,
    totalExpected,
    `已繳 ${paidCount} 人 / 未繳 ${unpaidCount} 人`,
    totalCollected,
    totalUnpaid,
    ''
  ]);

  // 組合為含 UTF-8 BOM (\uFEFF) 的 CSV 內容，讓 Microsoft Excel 雙擊直接開啟時中文絕不亂碼
  const csvContent = '\uFEFF' + rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.classTitle}_收費結算表_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function resetExpenseForm() {
  editingExpenseId = null;
  document.getElementById('input-expense-title').value = '';
  document.getElementById('input-expense-amount').value = '';
  const defaultRadio = document.querySelector('input[name="split_mode"][value="all_equal"]');
  if (defaultRadio) defaultRadio.checked = true;
  tempSelectedStudentIds = new Set(state.students.map(s => s.id));
  tempCustomAmounts = {};
  document.getElementById('btn-submit-expense').textContent = '＋ 加入收費項目';
  document.getElementById('btn-cancel-edit-expense').classList.add('hidden');
}

// 啟動應用
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  renderAll();
});
