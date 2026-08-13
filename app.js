/* 黑马记账 — 核心逻辑（记账 / 账单 / 统计 / 图表 / 数据备份） */

'use strict';

/* ================= 工具函数 ================= */

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = 'heima_records_v1';   // 记账数据
const SNAP_KEY = 'heima_snapshots_v1';    // 每日快照
const SNAP_MAX = 30;                       // 最多保留 30 天快照

const pad2 = (n) => String(n).padStart(2, '0');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function currentMonthStr() { return todayStr().slice(0, 7); }

function monthOf(dateStr) { return dateStr.slice(0, 7); }

function fmtMoney(n) {
  return '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateCN(dateStr) {
  const p = dateStr.split('-');
  return Number(p[0]) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
}

function weekDayCN(dateStr) {
  const p = dateStr.split('-');
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(p[0], p[1] - 1, p[2]).getDay()];
}

function fmtMonthCN(m) {
  const p = m.split('-');
  return p[0] + '年' + Number(p[1]) + '月';
}

function shiftMonth(m, delta) {
  const p = m.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

function sum(arr) { return arr.reduce((a, b) => a + Number(b), 0); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer = null;
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= 数据读写 ================= */

let records = [];

function loadRecords() {
  try { records = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch (e) { records = []; }
  normalizeTypes(records);
  return records;
}

// 旧数据没有 type 字段，统一视为支出
function normalizeTypes(arr) {
  arr.forEach((r) => { if (r && !r.type) r.type = 'expense'; });
}

function saveRecords() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }

function loadSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY)) || []; }
  catch (e) { return []; }
}

// 每天打开应用时，自动存一份当天快照（保留最近 30 天）
function maybeSnapshot() {
  const today = todayStr();
  const snaps = loadSnapshots();
  const last = snaps[snaps.length - 1];
  if (!last || last.date !== today) {
    snaps.push({
      date: today,
      data: JSON.parse(JSON.stringify(records)),
      count: records.length,
      total: sum(records.map((r) => r.amount))
    });
    while (snaps.length > SNAP_MAX) snaps.shift();
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
  }
}

function monthRecords(m) { return records.filter((r) => monthOf(r.date) === m); }

function sortByDateDesc(arr) {
  return [...arr].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/* ================= 页面状态 ================= */

let viewMonth = currentMonthStr();   // 账单页当前月份
let statMonth = currentMonthStr();   // 统计页当前月份
let editingId = null;                // 正在修改的记录 id
let entryType = 'expense';           // 记账页当前类型：支出/收入
let statPieType = 'expense';         // 统计页饼图当前类型：支出/收入
let selectedCat1 = CATEGORIES[0].name;
let selectedCat2 = CATEGORIES[0].subs[0];

// 当前类型对应的分类表 / 颜色表 / 图标
function getEntryCats() { return entryType === 'income' ? INCOME_CATEGORIES : CATEGORIES; }
function getStatCats() { return statPieType === 'income' ? INCOME_CATEGORIES : CATEGORIES; }
function catIconOf(type, cat1) {
  const list = type === 'income' ? INCOME_CATEGORIES : CATEGORIES;
  const c = list.find((x) => x.name === cat1);
  return c ? c.icon : '📦';
}
function colorOf(type, cat1) {
  const map = type === 'income' ? INCOME_COLORS : CATEGORY_COLORS;
  return map[cat1] || '#898781';
}

/* ================= 记账页 ================= */

function renderCat1() {
  $('cat1Wrap').innerHTML = getEntryCats().map((c) =>
    '<button class="chip ' + (c.name === selectedCat1 ? 'active' : '') + '" data-cat="' + esc(c.name) + '">' +
    c.icon + ' ' + esc(c.name) + '</button>'
  ).join('');
}

function renderCat2() {
  const cat = getEntryCats().find((c) => c.name === selectedCat1);
  const subs = cat ? cat.subs : [];
  $('cat2Wrap').innerHTML = subs.map((s) =>
    '<button class="chip sub ' + (s === selectedCat2 ? 'active' : '') + '" data-sub="' + esc(s) + '">' +
    esc(s) + '</button>'
  ).join('');
}

function renderTypeToggle() {
  $('btnTypeExpense').classList.toggle('active', entryType === 'expense');
  $('btnTypeIncome').classList.toggle('active', entryType === 'income');
}

// 切换记账类型：同时把选中的分类切到对应体系的第一个
function setEntryType(t) {
  entryType = t;
  const list = getEntryCats();
  selectedCat1 = list[0].name;
  selectedCat2 = list[0].subs[0];
  renderTypeToggle();
  renderCat1();
  renderCat2();
}

function resetForm() {
  editingId = null;
  $('inputAmount').value = '';
  $('inputNote').value = '';
  $('inputDate').value = todayStr();
  $('editingBar').classList.add('hidden');
  $('btnSave').textContent = '保存记录';
  renderTypeToggle();
  const list = getEntryCats();
  selectedCat1 = list[0].name;
  selectedCat2 = list[0].subs[0];
  renderCat1();
  renderCat2();
}

// 点击账单里的「编辑」→ 预填表单
function startEdit(r) {
  editingId = r.id;
  entryType = r.type === 'income' ? 'income' : 'expense';
  $('inputAmount').value = String(parseFloat(r.amount));
  $('inputDate').value = r.date;
  $('inputNote').value = r.note || '';
  selectedCat1 = r.cat1;
  selectedCat2 = r.cat2;
  renderTypeToggle();
  renderCat1();
  renderCat2();
  $('editingLabel').textContent = r.cat1 + '·' + r.cat2 + '　' + fmtDateCN(r.date);
  $('editingBar').classList.remove('hidden');
  $('btnSave').textContent = '保存修改';
  switchTab('add');
}

function saveRecord() {
  const amt = parseFloat($('inputAmount').value);
  if (!isFinite(amt) || amt <= 0) { toast('请输入大于 0 的金额'); return; }
  if (amt > 99999999.99) { toast('金额太大了，最多 9999 万元'); return; }
  const date = $('inputDate').value;
  if (!date) { toast('请选择日期'); return; }

  const rec = {
    id: editingId || uid(),
    type: entryType,
    amount: Math.round(amt * 100) / 100,
    date: date,
    cat1: selectedCat1,
    cat2: selectedCat2,
    note: $('inputNote').value.trim().slice(0, 50)
  };

  if (editingId) {
    const i = records.findIndex((r) => r.id === editingId);
    if (i >= 0) records[i] = rec; else records.push(rec);
    editingId = null;
    viewMonth = monthOf(rec.date);   // 保存后回到账单页，能看到刚改的那笔
    resetForm();
    saveRecords();
    switchTab('bill');
    toast('修改已保存 ✅');
  } else {
    records.push(rec);
    saveRecords();
    resetForm();
    toast('记好啦 ✅');
  }
}

/* ================= 账单页 ================= */

function emptyHTML(title, sub) {
  return '<div class="empty"><div class="empty-icon">📭</div><div>' + title + '</div>' +
    '<div class="tip">' + sub + '</div></div>';
}

function renderBill() {
  const ms = monthRecords(viewMonth);
  const exps = ms.filter((r) => r.type !== 'income');
  const incs = ms.filter((r) => r.type === 'income');
  const expTotal = sum(exps.map((r) => r.amount));
  const incTotal = sum(incs.map((r) => r.amount));
  const balance = incTotal - expTotal;

  $('billMonthLabel').textContent = fmtMonthCN(viewMonth);
  $('billToday').classList.toggle('hidden', viewMonth === currentMonthStr());
  $('billExpense').textContent = fmtMoney(expTotal);
  $('billIncome').textContent = fmtMoney(incTotal);
  $('billBalance').textContent = fmtMoney(balance);
  $('billBalance').className = 'sum-amount ' + (balance >= 0 ? 'green' : 'red');

  const listEl = $('billList');
  if (!ms.length) {
    listEl.innerHTML = emptyHTML('这个月还没有记账', '去「记账」页记第一笔吧');
    return;
  }

  // 按日期分组
  const groups = {};
  sortByDateDesc(ms).forEach((r) => { (groups[r.date] = groups[r.date] || []).push(r); });

  let html = '';
  Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach((date) => {
    const items = groups[date];
    const dExp = sum(items.filter((i) => i.type !== 'income').map((i) => i.amount));
    const dInc = sum(items.filter((i) => i.type === 'income').map((i) => i.amount));
    let daySums = '';
    if (dExp > 0) daySums += '<b class="exp">支出 ' + fmtMoney(dExp) + '</b>';
    if (dInc > 0) daySums += '<b class="inc">收入 ' + fmtMoney(dInc) + '</b>';
    html += '<div class="day-group">' +
      '<div class="day-head"><span>' + fmtDateCN(date) + ' ' + weekDayCN(date) + '</span>' +
      '<span class="day-sums">' + (daySums || '<b>' + fmtMoney(0) + '</b>') + '</span></div>';
    items.forEach((r) => {
      const isInc = r.type === 'income';
      html += '<div class="bill-item">' +
        '<span class="item-icon">' + catIconOf(r.type, r.cat1) + '</span>' +
        '<div class="item-main">' +
        '<div class="item-title">' + esc(r.cat1) + '·' + esc(r.cat2) +
        '<span class="type-badge ' + (isInc ? 'inc' : 'exp') + '">' + (isInc ? '收入' : '支出') + '</span></div>' +
        '<div class="item-note">' + (r.note ? esc(r.note) : '') + '</div>' +
        '</div>' +
        '<span class="item-amount ' + (isInc ? 'inc' : '') + '">' + (isInc ? '+' : '-') + fmtMoney(r.amount) + '</span>' +
        '<div class="item-actions">' +
        '<button class="act-btn edit" data-id="' + r.id + '">编辑</button>' +
        '<button class="act-btn del" data-id="' + r.id + '">删除</button>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';
  });
  listEl.innerHTML = html;
}

function deleteRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  if (!confirm('确定删除这笔记录吗？\n' + fmtDateCN(r.date) + '　' + r.cat1 + '·' + r.cat2 + '　-' + fmtMoney(r.amount))) return;
  records = records.filter((x) => x.id !== id);
  saveRecords();
  renderAll();
  toast('已删除');
}

/* ================= 统计页 ================= */

function daysElapsed(m) {
  const p = m.split('-').map(Number);
  if (m === currentMonthStr()) return new Date().getDate();
  return new Date(p[0], p[1], 0).getDate();
}

function renderStats() {
  const ms = monthRecords(statMonth);
  const exps = ms.filter((r) => r.type !== 'income');
  const incs = ms.filter((r) => r.type === 'income');
  const expTotal = sum(exps.map((r) => r.amount));
  const incTotal = sum(incs.map((r) => r.amount));
  const balance = incTotal - expTotal;

  $('statMonthLabel').textContent = fmtMonthCN(statMonth);
  $('statToday').classList.toggle('hidden', statMonth === currentMonthStr());
  $('statIncome').textContent = fmtMoney(incTotal);
  $('statExpense').textContent = fmtMoney(expTotal);
  $('statBalance').textContent = fmtMoney(balance);
  $('statBalance').className = balance >= 0 ? 'green' : 'red';

  renderPieSeg();
  renderPie(ms);
  renderBar(ms);
  renderDetail(ms);
}

// 饼图切换按钮状态
function renderPieSeg() {
  $('btnPieExpense').classList.toggle('active', statPieType === 'expense');
  $('btnPieIncome').classList.toggle('active', statPieType === 'income');
}

// 分类占比饼图（按一级大类，可切换支出/收入）
function renderPie(ms) {
  const el = $('pieChart');
  const list = ms.filter((r) => (statPieType === 'income' ? r.type === 'income' : r.type !== 'income'));
  const map = {};
  list.forEach((r) => { map[r.cat1] = (map[r.cat1] || 0) + r.amount; });
  const items = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const total = sum(list.map((r) => r.amount));

  if (window.chartsEnabled) {
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.dispose();
    const chart = echarts.init(el);
    chart.setOption({
      color: items.map((i) => colorOf(statPieType, i[0])),
      tooltip: {
        trigger: 'item',
        formatter: (p) => p.name + '<br/>' + fmtMoney(p.value) + '（' + p.percent + '%）'
      },
      legend: {
        bottom: 0, left: 'center', itemWidth: 12, itemHeight: 12, icon: 'circle',
        textStyle: { color: '#52514e', fontSize: 12 }
      },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 4 },
        label: { formatter: '{b}\n{d}%', fontSize: 12, color: '#52514e' },
        emphasis: { label: { fontWeight: 'bold', color: '#0b0b0b' } },
        data: items.map((kv) => ({ name: kv[0], value: Math.round(kv[1] * 100) / 100 }))
      }]
    });
  } else {
    // 离线简易版：色块 + 名称 + 占比条
    el.innerHTML = items.map((kv) => {
      const pct = total ? (kv[1] / total * 100).toFixed(1) : '0';
      const col = colorOf(statPieType, kv[0]);
      return '<div class="fb-row">' +
        '<span class="fb-dot" style="background:' + col + '"></span>' +
        '<span class="fb-name">' + esc(kv[0]) + '</span>' +
        '<div class="fb-bar"><div class="fb-bar-in" style="width:' + pct + '%;background:' + col + '"></div></div>' +
        '<span class="fb-pct">' + pct + '%</span>' +
        '</div>';
    }).join('') || '<p class="tip">本月还没有数据</p>';
  }
}

// 每日收支趋势柱状图（红=支出，绿=收入）
function renderBar(ms) {
  const el = $('barChart');
  const p = statMonth.split('-').map(Number);
  const days = new Date(p[0], p[1], 0).getDate();
  const expArr = new Array(days).fill(0);
  const incArr = new Array(days).fill(0);
  ms.forEach((r) => {
    const i = Number(r.date.slice(8)) - 1;
    if (r.type === 'income') incArr[i] += r.amount;
    else expArr[i] += r.amount;
  });

  if (window.chartsEnabled) {
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.dispose();
    const chart = echarts.init(el);
    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => ps[0].axisValue + '日<br/>' +
          ps.map((x) => x.marker + x.seriesName + ' ' + fmtMoney(x.value)).join('<br/>')
      },
      legend: {
        top: 0, right: 0, itemWidth: 12, itemHeight: 12, icon: 'circle',
        textStyle: { color: '#52514e', fontSize: 12 }
      },
      grid: { left: 46, right: 12, top: 26, bottom: 24 },
      xAxis: {
        type: 'category',
        data: expArr.map((_, i) => i + 1),
        axisLabel: { color: '#898781', fontSize: 11, interval: 'auto' },
        axisLine: { lineStyle: { color: '#c3c2b7' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#e1e0d9' } },
        axisLabel: { color: '#898781', fontSize: 11, formatter: (v) => (v >= 10000 ? v / 10000 + 'w' : v) },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      series: [
        {
          name: '支出', type: 'bar',
          data: expArr.map((v) => Math.round(v * 100) / 100),
          itemStyle: { color: '#e34948', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 12
        },
        {
          name: '收入', type: 'bar',
          data: incArr.map((v) => Math.round(v * 100) / 100),
          itemStyle: { color: '#0ca30c', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 12
        }
      ]
    });
  } else {
    // 离线简易版：两行 CSS 条形图
    const barRow = (label, arr, color) => {
      const max = Math.max(...arr);
      return '<div style="font-size:12px;color:#52514e;margin:6px 0 2px">' + label + '</div>' +
        '<div class="fb-bars" style="height:90px">' + arr.map((v, i) => {
          const h = max ? Math.max(v / max * 100, v > 0 ? 4 : 2) : 2;
          return '<div class="fb-bar-col" title="' + (i + 1) + '日　' + fmtMoney(v) + '">' +
            '<div class="fb-bar-v" style="height:' + h + '%;background:' + color + '"></div>' +
            '<span>' + (i + 1) + '</span></div>';
        }).join('') + '</div>';
    };
    el.innerHTML = barRow('支出', expArr, '#e34948') + barRow('收入', incArr, '#0ca30c');
  }
}

// 分类明细（大类可展开小类，跟随饼图切换支出/收入）
function renderDetail(ms) {
  const list = ms.filter((r) => (statPieType === 'income' ? r.type === 'income' : r.type !== 'income'));
  const map1 = {}, map2 = {};
  list.forEach((r) => {
    map1[r.cat1] = (map1[r.cat1] || 0) + r.amount;
    const k = r.cat1 + '|' + r.cat2;
    map2[k] = (map2[k] || 0) + r.amount;
  });
  const total = sum(list.map((r) => r.amount));
  const cats = getStatCats();

  const rows = Object.entries(map1).sort((a, b) => b[1] - a[1]);
  $('detailList').innerHTML = rows.length ? rows.map((kv) => {
    const cat = kv[0], v = kv[1];
    const meta = cats.find((c) => c.name === cat);
    const pct = total ? (v / total * 100).toFixed(1) : '0';
    const subs = cats.find((c) => c.name === cat).subs
      .filter((s) => map2[cat + '|' + s])
      .map((s) =>
        '<div class="sub-row"><span></span><span>' + esc(s) + '</span>' +
        '<span class="sub-amt">' + fmtMoney(map2[cat + '|' + s]) + '</span></div>'
      ).join('');
    return '<div class="detail-row" data-cat="' + esc(cat) + '">' +
      '<span class="d-icon">' + (meta ? meta.icon : '📦') + '</span>' +
      '<span class="d-name">' + esc(cat) + '</span>' +
      '<div class="d-bar"><div class="d-bar-in" style="width:' + pct + '%;background:' + colorOf(statPieType, cat) + '"></div></div>' +
      '<span class="d-amount">' + fmtMoney(v) + '</span>' +
      '<span class="d-toggle">▸</span>' +
      '</div>' +
      '<div class="detail-sub hidden">' + (subs || '<div class="tip">无明细</div>') + '</div>';
  }).join('') : '<p class="tip">本月还没有数据</p>';
}

/* ================= 我的页 ================= */

function renderMe() {
  $('meCount').textContent = records.length + ' 笔';
  const dates = records.map((r) => r.date).sort();
  $('meEarliest').textContent = dates.length ? fmtDateCN(dates[0]) : '—';

  const snaps = loadSnapshots();
  const list = $('snapList');
  list.innerHTML = snaps.length
    ? snaps.slice().reverse().map((s, idx) => {
        const i = snaps.length - 1 - idx;
        return '<div class="snap-row">' +
          '<div><div>' + fmtDateCN(s.date) + '</div>' +
          '<div class="snap-meta">' + s.count + ' 笔 · ' + fmtMoney(s.total || 0) + '</div></div>' +
          '<button class="btn ghost small" data-snap="' + i + '">恢复</button>' +
          '</div>';
      }).join('')
    : '<p class="tip">打开一次应用就会自动生成今天的数据快照，之后每天一份。</p>';
}

function restoreSnapshot(i) {
  const snaps = loadSnapshots();
  const s = snaps[i];
  if (!s) return;
  if (!confirm('确定恢复到 ' + fmtDateCN(s.date) + ' 的数据吗？\n当前数据将被这份快照替换（建议先导出备份）。')) return;
  records = JSON.parse(JSON.stringify(s.data || []));
  normalizeTypes(records);
  saveRecords();
  renderAll();
  toast('已恢复到 ' + fmtDateCN(s.date) + ' ✅');
}

function exportBackup() {
  const payload = { app: '小杜专属账本', version: 1, exportedAt: todayStr(), records: records };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '小杜专属账本备份-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('备份已导出 ✅');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : (data && Array.isArray(data.records) ? data.records : null);
      if (!arr) throw new Error('bad format');
      const ids = new Set(records.map((r) => r.id));
      let added = 0;
      arr.forEach((r) => {
        if (r && typeof r.amount === 'number' && r.date && r.cat1 && r.cat2 && !ids.has(r.id)) {
          records.push({
            id: r.id || uid(),
            type: r.type === 'income' ? 'income' : 'expense',
            amount: Number(r.amount),
            date: String(r.date),
            cat1: String(r.cat1),
            cat2: String(r.cat2),
            note: r.note ? String(r.note).slice(0, 50) : ''
          });
          ids.add(r.id);
          added++;
        }
      });
      if (!added) { toast('备份里没有可导入的新记录'); return; }
      saveRecords();
      renderAll();
      toast('导入成功，新增 ' + added + ' 条记录 ✅');
    } catch (e) {
      toast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm('确定要清空所有记账记录吗？此操作不可撤销！\n建议先导出备份。')) return;
  if (!confirm('最后确认：真的要清空全部记录吗？')) return;
  records = [];
  saveRecords();
  renderAll();
  toast('已清空所有记录');
}

/* ================= 页面切换 ================= */

function switchTab(name) {
  document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
  $('page-' + name).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === 'page-' + name);
  });
  if (name === 'add') renderTypeToggle(), renderCat1(), renderCat2();
  if (name === 'bill') renderBill();
  if (name === 'stat') renderStats();
  if (name === 'me') renderMe();
}

function renderAll() {
  renderBill();
  renderMe();
  if (!$('page-stat').classList.contains('hidden')) renderStats();
}

/* ================= 事件绑定 ================= */

// 底部导航
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab.replace('page-', '')));
});

// 记账：分类选择
$('cat1Wrap').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  selectedCat1 = chip.dataset.cat;
  selectedCat2 = CATEGORIES.find((c) => c.name === selectedCat1).subs[0];
  renderCat1();
  renderCat2();
});

$('cat2Wrap').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  selectedCat2 = chip.dataset.sub;
  renderCat2();
});

// 记账类型切换：支出 / 收入
$('btnTypeExpense').addEventListener('click', () => setEntryType('expense'));
$('btnTypeIncome').addEventListener('click', () => setEntryType('income'));

// 统计页饼图切换：支出占比 / 收入占比
$('btnPieExpense').addEventListener('click', () => { statPieType = 'expense'; renderStats(); });
$('btnPieIncome').addEventListener('click', () => { statPieType = 'income'; renderStats(); });

// 金额输入：只允许数字和一个小数点，最多两位小数
$('inputAmount').addEventListener('input', function () {
  const m = this.value.replace(/[^\d.]/g, '').match(/^\d*\.?\d{0,2}/);
  const v = m ? m[0] : '';
  if (this.value !== v) this.value = v;
});

$('btnSave').addEventListener('click', saveRecord);
$('btnCancelEdit').addEventListener('click', () => { resetForm(); toast('已取消修改'); });

// 回车快速保存
['inputAmount', 'inputNote'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRecord(); }
  });
});

// 账单：月份切换 + 回到本月
$('billPrev').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, -1); renderBill(); });
$('billNext').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, 1); renderBill(); });
$('billToday').addEventListener('click', () => { viewMonth = currentMonthStr(); renderBill(); });

// 统计：月份切换 + 回到本月
$('statPrev').addEventListener('click', () => { statMonth = shiftMonth(statMonth, -1); renderStats(); });
$('statNext').addEventListener('click', () => { statMonth = shiftMonth(statMonth, 1); renderStats(); });
$('statToday').addEventListener('click', () => { statMonth = currentMonthStr(); renderStats(); });

// 账单列表：编辑 / 删除（事件委托）
$('billList').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-btn');
  if (!btn) return;
  const r = records.find((x) => x.id === btn.dataset.id);
  if (!r) return;
  if (btn.classList.contains('edit')) startEdit(r);
  else if (btn.classList.contains('del')) deleteRecord(r.id);
});

// 分类明细：点击展开小类
$('detailList').addEventListener('click', (e) => {
  const row = e.target.closest('.detail-row');
  if (!row) return;
  const sub = row.nextElementSibling;
  if (!sub) return;
  const isHidden = sub.classList.contains('hidden');
  sub.classList.toggle('hidden', !isHidden);
  row.querySelector('.d-toggle').textContent = isHidden ? '▾' : '▸';
});

// 我的：导出 / 导入 / 清空
$('btnExport').addEventListener('click', exportBackup);
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', function () {
  const f = this.files[0];
  this.value = '';   // 允许再次选择同一个文件
  if (f) importBackup(f);
});
$('btnClear').addEventListener('click', clearAll);

// 快照：恢复（事件委托）
$('snapList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-snap]');
  if (btn) restoreSnapshot(Number(btn.dataset.snap));
});

/* ================= 启动 ================= */

loadRecords();
maybeSnapshot();
resetForm();
renderBill();
switchTab('add');

// 手机端：注册离线缓存（网页环境才有；本地双击打开的文件没有此功能，不影响使用）
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
