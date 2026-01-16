// === 設定區：改成你自己的 Supabase URL / anon key ===
// Project URL: Supabase 後台 Settings → API → Project URL
const PROJECT_URL = "https://ktcupyeopcffmtzzpewm.supabase.co";
// anon key: Supabase 後台 Settings → API → Project API keys → anon public
const ANON_KEY = "sb_publishable_rEvRt6x4kT6pKBUqh06YhQ_jHHO3zWU";

// REST base
const REST_BASE = `${PROJECT_URL}/rest/v1`;

// DOM elements
const statusEl = document.getElementById("status");
const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const reloadBtn = document.getElementById("reloadBtn");
const expansionFilter = document.getElementById("expansionFilter");
const nameFilter = document.getElementById("nameFilter");
const totalAllEl = document.getElementById("totalAllValue");
const totalFilteredEl = document.getElementById("totalFilteredValue");

let allRows = [];
let filteredRows = [];

// pagination state
let currentPage = 1;
let pageSize = 50;

// decklog cache
const decklogCache = new Map();

// ---- 共用工具 ----

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-US");
}

function formatJpy(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-US");
}

function getRarityDisplay(rarity) {
  if (!rarity) return "";
  return rarity;
}

function safeGet(obj, key, fallback = "") {
  if (!obj) return fallback;
  const v = obj[key];
  return v === undefined || v === null ? fallback : v;
}

function updateSummary() {
  if (!allRows || allRows.length === 0) {
    if (totalAllEl) totalAllEl.textContent = "-";
    if (totalFilteredEl) totalFilteredEl.textContent = "-";
    return;
  }

  let totalAll = 0;
  for (const row of allRows) {
    const v = Number(row.market_value_jpy ?? 0);
    if (!Number.isNaN(v)) totalAll += v;
  }

  let totalFiltered = 0;
  if (filteredRows && filteredRows.length > 0) {
    for (const row of filteredRows) {
      const v = Number(row.market_value_jpy ?? 0);
      if (!Number.isNaN(v)) totalFiltered += v;
    }
  }

  if (totalAllEl) totalAllEl.textContent = formatNumber(totalAll);
  if (totalFilteredEl) totalFilteredEl.textContent = formatNumber(totalFiltered);
}

// ---- Supabase REST 抓資料 ----

async function fetchPortfolio() {
  const url =
    `${REST_BASE}/v_portfolio_positions_jpy_v8` +
    "?select=card_code,name_ja,rarity_code,qty," +
    "sell_price_jpy,buy_price_jpy,market_value_jpy," +
    "image_url,sell_url,buy_url,print_id,expansion,official_products,release_dates,release_label" +
    "&order=card_code.asc&order=rarity_code.asc&order=print_id.asc.nullslast";

  setStatus("從 Supabase 讀取資料中...");
  const res = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!res.ok) {
    setStatus(`讀取失敗: ${res.status} ${res.statusText}`);
    throw new Error("Failed to fetch portfolio");
  }

  const data = await res.json();
  setStatus(`載入完成，共 ${data.length} 筆`);
  return data;
}

// ---- 渲染表格 ----

function renderTablePage() {
  if (!Array.isArray(filteredRows)) return;
  if (!tableBody) return;

  tableBody.innerHTML = "";

  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, totalRows);
  const pageRows = filteredRows.slice(start, end);

  for (const row of pageRows) {
    const tr = document.createElement("tr");

    const codeTd = document.createElement("td");
    codeTd.className = "code-cell";
    codeTd.textContent = row.card_code || "";
    tr.appendChild(codeTd);

    const rarityTd = document.createElement("td");
    rarityTd.textContent = getRarityDisplay(row.rarity_code);
    tr.appendChild(rarityTd);

    const nameTd = document.createElement("td");
    const nameDiv = document.createElement("div");
    nameDiv.textContent = row.name_ja || "";
    nameTd.appendChild(nameDiv);

    if (row.expansion) {
      const expDiv = document.createElement("div");
      expDiv.style.fontSize = "10px";
      expDiv.style.color = "#6b7280";
      expDiv.textContent = row.expansion;
      nameTd.appendChild(expDiv);
    }

    tr.appendChild(nameTd);

    const qtyTd = document.createElement("td");
    qtyTd.className = "number-cell";
    qtyTd.textContent = formatNumber(row.qty);
    tr.appendChild(qtyTd);

    const sellTd = document.createElement("td");
    sellTd.className = "number-cell";
    sellTd.textContent = formatJpy(row.sell_price_jpy);
    tr.appendChild(sellTd);

    const buyTd = document.createElement("td");
    buyTd.className = "number-cell";
    buyTd.textContent = formatJpy(row.buy_price_jpy);
    tr.appendChild(buyTd);

    const mvTd = document.createElement("td");
    mvTd.className = "number-cell";
    mvTd.textContent = formatJpy(row.market_value_jpy);
    tr.appendChild(mvTd);

    const imgTd = document.createElement("td");
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code || "";
      img.className = "card-thumb";
      img.addEventListener("click", () => openImageModal(row.image_url));
      imgTd.appendChild(img);
    }
    tr.appendChild(imgTd);

    const linkTd = document.createElement("td");
    if (row.sell_url) {
      const aSell = document.createElement("a");
      aSell.href = row.sell_url;
      aSell.target = "_blank";
      aSell.rel = "noopener noreferrer";
      aSell.className = "url-link";
      aSell.textContent = "YUYU 賣價";
      linkTd.appendChild(aSell);
    }
    if (row.buy_url) {
      const aBuy = document.createElement("a");
      aBuy.href = row.buy_url;
      aBuy.target = "_blank";
      aBuy.rel = "noopener noreferrer";
      aBuy.className = "url-link";
      aBuy.textContent = "YUYU 收購";
      linkTd.appendChild(aBuy);
    }

    tr.appendChild(linkTd);
    tableBody.appendChild(tr);
  }

  const pageInfoEl = document.getElementById("pageInfo");
  const prevBtn = document.getElementById("prevPageBtn");
  const nextBtn = document.getElementById("nextPageBtn");

  if (pageInfoEl) {
    pageInfoEl.textContent = `${currentPage} / ${Math.max(
      1,
      Math.ceil(totalRows / pageSize)
    )} 頁（共 ${totalRows} 筆）`;
  }

  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = currentPage >= Math.ceil(totalRows / pageSize);
  }
}

// ---- 圖片放大 modal ----

function openImageModal(src) {
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("modalImage");
  if (!modal || !modalImg) return;
  modalImg.src = src;
  modal.classList.add("active");
}

function closeImageModal() {
  const modal = document.getElementById("imageModal");
  if (!modal) return;
  modal.classList.remove("active");
}

(function setupModalClose() {
  const modal = document.getElementById("imageModal");
  if (!modal) return;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeImageModal();
    }
  });
})();

// ---- 搜尋 / 篩選 ----

function applyFilter() {
  if (!allRows) return;
  const q = (searchInput?.value || "").trim();
  const expValue = expansionFilter?.value || "";
  const nameValue = (nameFilter?.value || "").trim();

  let rows = allRows;

  if (q) {
    const lower = q.toLowerCase();
    rows = rows.filter((r) => {
      const code = (r.card_code || "").toLowerCase();
      const name = (r.name_ja || "").toLowerCase();
      return code.includes(lower) || name.includes(lower);
    });
  }

  if (expValue) {
    rows = rows.filter((r) => (r.expansion || "") === expValue);
  }

  if (nameValue) {
    const lowerName = nameValue.toLowerCase();
    rows = rows.filter((r) =>
      (r.name_ja || "").toLowerCase().includes(lowerName)
    );
  }

  filteredRows = rows;
  currentPage = 1;
  updateSummary();
  renderTablePage();
}

function buildFilterOptions(rows) {
  if (!expansionFilter) return;
  const expansions = new Set();

  for (const row of rows) {
    if (row.expansion) {
      expansions.add(row.expansion);
    }
  }

  const current = expansionFilter.value;
  expansionFilter.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "全部";
  expansionFilter.appendChild(optAll);

  Array.from(expansions)
    .sort()
    .forEach((exp) => {
      const opt = document.createElement("option");
      opt.value = exp;
      opt.textContent = exp;
      expansionFilter.appendChild(opt);
    });

  if (current && expansions.has(current)) {
    expansionFilter.value = current;
  }
}

// ---- 初始化 ----

async function init() {
  try {
    allRows = await fetchPortfolio();
    buildFilterOptions(allRows);
    filteredRows = allRows;
    currentPage = 1;
    updateSummary();
    renderTablePage();
  } catch (e) {
    console.error(e);
  }
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    init();
  });
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilter();
  });
}

if (expansionFilter) {
  expansionFilter.addEventListener("change", () => {
    applyFilter();
  });
}

if (nameFilter) {
  nameFilter.addEventListener("input", () => {
    applyFilter();
  });
}

const prevBtn = document.getElementById("prevPageBtn");
const nextBtn = document.getElementById("nextPageBtn");
const pageSizeSelect = document.getElementById("pageSizeSelect");

if (prevBtn) {
  prevBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderTablePage();
    }
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredRows.length / pageSize)
    );
    if (currentPage < totalPages) {
      currentPage += 1;
      renderTablePage();
    }
  });
}

if (pageSizeSelect) {
  pageSizeSelect.addEventListener("change", (e) => {
    const v = Number(e.target.value || "50");
    pageSize = Number.isNaN(v) || v <= 0 ? 50 : v;
    currentPage = 1;
    renderTablePage();
  });
}

init();
