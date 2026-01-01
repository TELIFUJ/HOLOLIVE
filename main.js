// === 設定區：改成你自己的 Supabase URL / anon key ===
// Project URL: Supabase 後台 Settings → API → Project URL
const PROJECT_URL = "https://mpqvepdodjriiygcmyz.supabase.co";
// anon key: Supabase 後台 Settings → API → Project API keys → anon public
const ANON_KEY = "sb_publishable_cKHCb75guFnbR69u1uPvUQ_f_w3jU1c";

// REST base
const REST_BASE = `${PROJECT_URL}/rest/v1`;

// DOM elements
const statusEl = document.getElementById("status");
const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const reloadBtn = document.getElementById("reloadBtn");

// 全部資料快取（用來做搜尋）
let allRows = [];

// ---- 共用工具 ----

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return n.toLocaleString("ja-JP");
}

function buildYuyuUrl(row) {
  // 若 view 本身已有欄位，就直接用
  if (row.yuyutei_url) return row.yuyutei_url;

  // 後備方案：從 card_code 推一個搜尋連結（不保證 100% 準，但至少點得出去）
  const code = row.card_code || "";
  if (!code) return null;
  const search = encodeURIComponent(code);
  return `https://yuyu-tei.jp/sell/hocg/s/search?search_word=${search}`;
}

// ---- 取資料 ----

async function fetchPortfolio() {
  setStatus("載入中（向 Supabase 取得資料）…");

  const url =
    `${REST_BASE}/v_portfolio_positions_jpy_v2` +
    "?select=card_code,name_ja,rarity_code,qty,sell_price_jpy,market_value_jpy,yuyutei_url" +
    "&order=card_code.asc&order=rarity_code.asc";

  const resp = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase 回應錯誤: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data;
}

// ---- 畫表格 ----

function renderTable(rows) {
  tableBody.innerHTML = "";

  if (!rows || rows.length === 0) {
    setStatus("目前沒有任何持有紀錄。");
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    // 卡號：顯示卡號，本體保持乾淨；版本在稀有度欄位
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "-";
    tr.appendChild(tdCode);

    // 名稱（日文）
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "-";
    tr.appendChild(tdName);

    // 稀有度
    const tdRarity = document.createElement("td");
    const rarity = row.rarity_code || "-";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = rarity;
    tdRarity.appendChild(badge);
    tr.appendChild(tdRarity);

    // 持有張數
    const tdQty = document.createElement("td");
    tdQty.className = "num";
    tdQty.textContent = formatNumber(row.qty);
    tr.appendChild(tdQty);

    // YUYU 賣價
    const tdPrice = document.createElement("td");
    tdPrice.className = "num";
    tdPrice.textContent =
      row.sell_price_jpy != null ? formatNumber(row.sell_price_jpy) : "-";
    tr.appendChild(tdPrice);

    // 市值
    const tdValue = document.createElement("td");
    tdValue.className = "num";
    tdValue.textContent =
      row.market_value_jpy != null ? formatNumber(row.market_value_jpy) : "-";
    tr.appendChild(tdValue);

    // YUYU 連結
    const tdLink = document.createElement("td");
    const url = buildYuyuUrl(row);
    if (url) {
      const btn = document.createElement("button");
      btn.className = "link-btn";
      btn.textContent = "開啟";
      btn.addEventListener("click", () => {
        window.open(url, "_blank", "noopener");
      });
      tdLink.appendChild(btn);
    } else {
      tdLink.textContent = "-";
    }
    tr.appendChild(tdLink);

    tableBody.appendChild(tr);
  }

  setStatus(`已載入 ${rows.length} 筆卡片持有資料。`);
}

// ---- 搜尋 ----

function applyFilter() {
  const q = (searchInput.value || "").trim().toLowerCase();
  if (!q) {
    renderTable(allRows);
    return;
  }

  const filtered = allRows.filter((row) => {
    const code = (row.card_code || "").toLowerCase();
    const name = (row.name_ja || "").toLowerCase();
    return code.includes(q) || name.includes(q);
  });

  renderTable(filtered);
}

// ---- 入口 ----

async function loadAndRender() {
  try {
    setStatus("載入中…");
    tableBody.innerHTML = "";
    allRows = await fetchPortfolio();
    renderTable(allRows);
  } catch (err) {
    console.error(err);
    setStatus(`載入失敗：${err.message}`);
  }
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilter();
  });
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    loadAndRender();
  });
}

// 首次載入
loadAndRender();
