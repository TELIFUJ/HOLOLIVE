// === 設定區：Supabase 讀取 v_portfolio_positions_jpy_v8 ===
// Project URL: Supabase 後台 Settings → API → Project URL
const PROJECT_URL = "https://ktcupyeopcffmtzzpewm.supabase.co";
// anon key: Supabase 後台 Settings → API → Project API keys → anon public
const ANON_KEY = "sb_publishable_rEvRt6x4kT6pKBUqh06YhQ_jHHO3zWU";

// REST base
const REST_BASE = `${PROJECT_URL}/rest/v1`;
const VIEW_NAME = "v_portfolio_positions_jpy_v8";

// DOM elements
const statusEl = document.getElementById("status");
const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const expansionFilter = document.getElementById("expansionFilter");
const rarityFilter = document.getElementById("rarityFilter");
const nameFilter = document.getElementById("nameFilter");
const reloadBtn = document.getElementById("reloadBtn");

const pageSizeSelect = document.getElementById("pageSizeSelect");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfoEl = document.getElementById("pageInfo");
const totalAllValueEl = document.getElementById("totalAllValue");
const totalFilteredValueEl = document.getElementById("totalFilteredValue");

// Decklog elements
const decklogInput = document.getElementById("decklogInput");
const decklogBtn = document.getElementById("decklogBtn");
const decklogTableBody = document.getElementById("decklogTableBody");
const decklogSummary = document.getElementById("decklogSummary");
const decklogNeedHeaderEl = document.getElementById("decklogNeedHeader");

// Image modal
const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// 全部資料快取（用來做搜尋＋比對）
let allRows = [];
let filteredRows = [];
let currentPage = 1;
let dataLoaded = false;

// ---- 共用工具 ----

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("ja-JP");
}

function formatPrice(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const v = Number(n);
  if (!isFinite(v)) return "-";
  return v.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

function getQty(row) {
  const v =
    row.owned_qty !== undefined && row.owned_qty !== null
      ? row.owned_qty
      : row.qty !== undefined && row.qty !== null
      ? row.qty
      : 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 市值計算：只使用 YUYU 收購價；沒有收購價視為 0
function calcRowMarketValue(row) {
  const qty = getQty(row);

  // 如果 view 已經算好 market_value_jpy 就直接用
  if (row.market_value_jpy !== null && row.market_value_jpy !== undefined) {
    const v = Number(row.market_value_jpy);
    return Number.isFinite(v) ? v : 0;
  }

  // 否則只看收購價
  if (row.yuyu_buy_jpy !== null && row.yuyu_buy_jpy !== undefined) {
    const buy = Number(row.yuyu_buy_jpy);
    if (Number.isFinite(buy) && buy > 0 && qty > 0) {
      return buy * qty;
    }
  }

  return 0;
}

function sumMarketValue(rows) {
  return rows.reduce((acc, row) => acc + calcRowMarketValue(row), 0);
}

// ---- 資料載入 ----

async function fetchPortfolioRows() {
  const url = `${REST_BASE}/${VIEW_NAME}?select=*`;
  const resp = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`Supabase 回應錯誤: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

async function loadData() {
  setStatus("從 Supabase 載入資料中...");
  try {
    const rows = await fetchPortfolioRows();
    allRows = rows;
    dataLoaded = true;

    buildFilterOptions(rows);
    applyFiltersAndRender();
    setStatus(`已載入 ${rows.length} 筆卡片資料。`);
  } catch (err) {
    console.error(err);
    setStatus("載入失敗");
    alert(String(err.message || err));
  }
}

// 根據所有資料建立「系列 / 稀有度 / 名稱」下拉選項
function buildFilterOptions(rows) {
  const expansions = new Set();
  const rarities = new Set();
  const names = new Set();

  rows.forEach((row) => {
    if (row.expansion) expansions.add(row.expansion);
    if (row.rarity_code || row.rarity) rarities.add(row.rarity_code || row.rarity);
    if (row.name_ja) names.add(row.name_ja);
  });

  function fillSelect(selectEl, values) {
    if (!selectEl) return;
    const current = selectEl.value;
    const firstOption = selectEl.querySelector("option");
    selectEl.innerHTML = "";
    if (firstOption) {
      selectEl.appendChild(firstOption);
    } else {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "全部";
      selectEl.appendChild(opt);
    }
    Array.from(values)
      .sort((a, b) => String(a).localeCompare(String(b), "ja"))
      .forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        selectEl.appendChild(opt);
      });
    if (current && Array.from(values).includes(current)) {
      selectEl.value = current;
    }
  }

  fillSelect(expansionFilter, expansions);
  fillSelect(rarityFilter, rarities);
  fillSelect(nameFilter, names);
}

// ---- 過濾＋排序＋分頁 ----

function applyFiltersAndRender() {
  let rows = Array.from(allRows);

  const keyword = (searchInput?.value || "").trim().toLowerCase();
  const expansion = expansionFilter?.value || "";
  const rarity = rarityFilter?.value || "";
  const name = nameFilter?.value || "";

  if (keyword) {
    rows = rows.filter((row) => {
      const code = String(row.card_code || "").toLowerCase();
      const nameJa = String(row.name_ja || "").toLowerCase();
      return code.includes(keyword) || nameJa.includes(keyword);
    });
  }

  if (expansion) {
    rows = rows.filter((row) => row.expansion === expansion);
  }

  if (rarity) {
    rows = rows.filter(
      (row) => (row.rarity_code || row.rarity || "") === rarity
    );
  }

  if (name) {
    rows = rows.filter((row) => row.name_ja === name);
  }

  // 固定以卡號排序
  rows.sort((a, b) =>
    String(a.card_code || "").localeCompare(String(b.card_code || ""), "en")
  );

  filteredRows = rows;
  currentPage = 1;
  renderCurrentPage();
  updateTotals();
}

function getPageSize() {
  const v = pageSizeSelect ? Number(pageSizeSelect.value) : 20;
  return Number.isFinite(v) && v > 0 ? v : 20;
}

function renderCurrentPage() {
  const pageSize = getPageSize();
  const total = filteredRows.length || 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(start, start + pageSize);

  renderTable(pageRows);

  if (pageInfoEl) {
    pageInfoEl.textContent = `第 ${currentPage} / ${totalPages} 頁（共 ${filteredRows.length} 筆）`;
  }

  if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
  if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
}

function renderTable(rows) {
  if (!tableBody) return;
  tableBody.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "";
    tr.appendChild(tdCode);

    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    const tdExpansion = document.createElement("td");
    tdExpansion.textContent = row.expansion || "";
    tr.appendChild(tdExpansion);

    const tdImg = document.createElement("td");
    if (row.image_url) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.src = row.image_url;
      img.alt = row.card_code || "";
      img.addEventListener("click", () => openImageModal(row.image_url));
      tdImg.appendChild(img);
    }
    tr.appendChild(tdImg);

    const tdRarity = document.createElement("td");
    tdRarity.textContent = row.rarity_code || row.rarity || "";
    tr.appendChild(tdRarity);

    const qty = getQty(row);

    const tdQty = document.createElement("td");
    tdQty.className = "numeric";
    tdQty.textContent = formatNumber(qty);
    tr.appendChild(tdQty);

    const tdSell = document.createElement("td");
    tdSell.className = "numeric";
    tdSell.textContent = formatPrice(row.yuyu_sell_jpy);
    tr.appendChild(tdSell);

    const tdBuy = document.createElement("td");
    tdBuy.className = "numeric";
    tdBuy.textContent = formatPrice(row.yuyu_buy_jpy);
    tr.appendChild(tdBuy);

    const tdValue = document.createElement("td");
    tdValue.className = "numeric";
    tdValue.textContent = formatPrice(calcRowMarketValue(row));
    tr.appendChild(tdValue);

    tableBody.appendChild(tr);
  });
}

function updateTotals() {
  if (!totalAllValueEl || !totalFilteredValueEl) return;
  const allValue = sumMarketValue(allRows);
  const filteredValue = sumMarketValue(filteredRows);

  totalAllValueEl.textContent = formatPrice(allValue);
  totalFilteredValueEl.textContent = formatPrice(filteredValue);
}

// ---- Image Modal ----

function openImageModal(src) {
  if (!imageModal || !modalImage) return;
  modalImage.src = src;
  imageModal.classList.add("active");
}

if (imageModal) {
  imageModal.addEventListener("click", () => {
    imageModal.classList.remove("active");
    if (modalImage) modalImage.src = "";
  });
}

// ---- Decklog 比對（貼 JSON）----

// 從 Decklog API 的 JSON（/system/app-ja/api/view/{id}）計算每張卡需求張數
function buildDeckRequirementMap(deckJson) {
  const map = new Map();

  function addList(list) {
    if (!Array.isArray(list)) return;

    for (const item of list) {
      const code = String(item.card_number || "").trim();
      if (!code) continue;

      const nRaw =
        item.num !== undefined && item.num !== null
          ? item.num
          : item._num !== undefined && item._num !== null
          ? item._num
          : 0;

      const n = Number(nRaw);
      if (!Number.isFinite(n) || n <= 0) continue;

      const prev = map.get(code) || 0;
      map.set(code, prev + n);
    }
  }

  addList(deckJson.list);
  addList(deckJson.sub_list);
  addList(deckJson.p_list);

  return map;
}

// 將 Decklog 需求與目前庫存做差：回傳「不足」清單
function diffDeckAndInventory(deckMap) {
  // 先彙總庫存
  const inventoryQty = new Map();
  const metaByCode = new Map();

  for (const row of allRows) {
    const code = String(row.card_code || "").trim();
    if (!code) continue;

    const qty = getQty(row);
    if (qty > 0) {
      inventoryQty.set(code, (inventoryQty.get(code) || 0) + qty);
    }

    if (!metaByCode.has(code)) {
      metaByCode.set(code, {
        name_ja: row.name_ja || "",
        expansion: row.expansion || "",
      });
    }
  }

  const result = [];

  for (const [code, need] of deckMap.entries()) {
    const have = inventoryQty.get(code) || 0;
    if (have >= need) continue;

    const meta = metaByCode.get(code) || {};
    result.push({
      card_code: code,
      name_ja: meta.name_ja || "",
      expansion: meta.expansion || "",
      need,
      have,
      short: need - have,
    });
  }

  // 依卡號排序
  result.sort((a, b) =>
    String(a.card_code).localeCompare(String(b.card_code), "en")
  );

  return result;
}

async function handleDecklogCompare() {
  try {
    if (!dataLoaded) {
      await loadData();
    }

    const raw = (decklogInput?.value || "").trim();
    if (!raw) {
      alert("請先在 Decklog 頁面用書籤取得 JSON，然後貼在上面的欄位。");
      return;
    }

    let deckJson;
    try {
      deckJson = JSON.parse(raw);
    } catch (e) {
      console.error(e);
      alert(
        "Decklog JSON 解析失敗，請確認有完整貼上（以 { 開頭、} 結尾）。\n錯誤訊息：" +
          e.message
      );
      return;
    }

    if (!deckJson.list && !deckJson.sub_list && !deckJson.p_list) {
      alert(
        "JSON 看起來不是 Decklog 的格式（缺少 list / sub_list / p_list）。\n請確定是用書籤從 Decklog 直接複製。"
      );
      return;
    }

    setStatus("Decklog 牌組比對中...");

    const deckMap = buildDeckRequirementMap(deckJson);
    const diff = diffDeckAndInventory(deckMap);

    // 統計
    let totalNeed = 0;
    for (const v of deckMap.values()) {
      totalNeed += v;
    }
    const totalShort = diff.reduce((acc, r) => acc + r.short, 0);

    if (decklogNeedHeaderEl) {
      decklogNeedHeaderEl.textContent = "需求張數";
    }

    if (decklogSummary) {
      if (diff.length === 0) {
        decklogSummary.textContent =
          `本牌組共需要 ${totalNeed} 張卡，你目前庫存全部足夠。`;
      } else {
        decklogSummary.textContent =
          `本牌組共需要 ${totalNeed} 張卡，其中有 ${totalShort} 張目前庫存不足（${diff.length} 種卡號）。`;
      }
    }

    renderDecklogTable(diff);
  } catch (err) {
    console.error(err);
    alert("Decklog 比對失敗：" + (err.message || String(err)));
  } finally {
    setStatus("");
  }
}

function renderDecklogTable(rows) {
  if (!decklogTableBody) return;
  decklogTableBody.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code;
    tr.appendChild(tdCode);

    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja;
    tr.appendChild(tdName);

    const tdExpansion = document.createElement("td");
    tdExpansion.textContent = row.expansion;
    tr.appendChild(tdExpansion);

    const tdNeed = document.createElement("td");
    tdNeed.className = "numeric";
    tdNeed.textContent = formatNumber(row.need);
    tr.appendChild(tdNeed);

    const tdHave = document.createElement("td");
    tdHave.className = "numeric";
    tdHave.textContent = formatNumber(row.have);
    tr.appendChild(tdHave);

    const tdShort = document.createElement("td");
    tdShort.className = "numeric";
    tdShort.textContent = formatNumber(row.short);
    tr.appendChild(tdShort);

    decklogTableBody.appendChild(tr);
  });
}

// ---- 事件繫結 ----

function bindEvents() {
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      loadData();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applyFiltersAndRender();
    });
  }

  if (expansionFilter) {
    expansionFilter.addEventListener("change", () => {
      applyFiltersAndRender();
    });
  }

  if (rarityFilter) {
    rarityFilter.addEventListener("change", () => {
      applyFiltersAndRender();
    });
  }

  if (nameFilter) {
    nameFilter.addEventListener("change", () => {
      applyFiltersAndRender();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      renderCurrentPage();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      currentPage -= 1;
      renderCurrentPage();
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      currentPage += 1;
      renderCurrentPage();
    });
  }

  if (decklogBtn) {
    decklogBtn.addEventListener("click", () => {
      handleDecklogCompare();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadData();
});
