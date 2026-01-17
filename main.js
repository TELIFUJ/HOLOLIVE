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
const pageInfoEl = document.getElementById("pageInfo");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const expansionFilter = document.getElementById("expansionFilter");
const nameFilter = document.getElementById("nameFilter");
const totalAllValueEl = document.getElementById("totalAllValue");
const totalFilteredValueEl = document.getElementById("totalFilteredValue");
const totalFilteredCountEl = document.getElementById("totalFilteredCount");

const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// 全部資料快取（用來做搜尋 / 篩選 / Decklog 比對）
let allRows = [];
let filteredRows = [];

// 分頁狀態
let currentPage = 1;
let pageSize = 50;

/* ---------------- 共用工具 ---------------- */

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return new Intl.NumberFormat("ja-JP").format(n);
}

function formatJPY(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return new Intl.NumberFormat("ja-JP").format(n);
}

function rarityToClass(rarity) {
  if (!rarity) return "rarity-chip";
  const r = rarity.toUpperCase();
  if (r.includes("SEC")) return "rarity-chip rarity-sec";
  if (r.includes("SSR")) return "rarity-chip rarity-ssr";
  if (r.includes("UR") || r.includes("LR")) return "rarity-chip rarity-ur";
  return "rarity-chip";
}

// 專門給「賣價」用：優先用 view 的 sell_url，沒有就退回搜尋頁
function buildYuyuSellUrl(code) {
  if (!code) return null;
  const cardCode = typeof code === "string" ? code : code.card_code;
  if (!cardCode) return null;
  const search = encodeURIComponent(cardCode);
  return `https://yuyu-tei.jp/sell/hocg/s/search?search_word=${search}`;
}

// 專門給「收購」用：優先用 view 的 buy_url，沒有就退回搜尋頁
// 專門給「收購」用：可以吃整列 row 或直接吃卡號字串
function buildYuyuBuyUrl(cardOrRow) {
  if (!cardOrRow) return null;

  // 如果是字串，視為卡號
  if (typeof cardOrRow === "string") {
    const search = encodeURIComponent(cardOrRow);
    return `https://yuyu-tei.jp/buy/hocg/s/search?search_word=${search}`;
  }

  // 如果是整列 row，優先用 view 給的 buy_url
  if (cardOrRow.buy_url) return cardOrRow.buy_url;

  const code = cardOrRow.card_code || "";
  if (!code) return null;
  const search = encodeURIComponent(code);
  return `https://yuyu-tei.jp/buy/hocg/s/search?search_word=${search}`;
}

/* ---------------- 持有市值（收購價）計算 ---------------- */

function getRowMarketValueBuy(row) {
  const qty = Number(row.qty || 0);
  const base = Number(
    row.buy_price_jpy != null ? row.buy_price_jpy : 0
  );
  if (!Number.isNaN(qty) && !Number.isNaN(base)) {
    return qty * base;
  }
  return 0;
}

function calcTotalValue(rows) {
  if (!Array.isArray(rows)) return 0;
  let sum = 0;

  for (const row of rows) {
    const v = getRowMarketValueBuy(row);
    const num = Number(v);
    if (!Number.isNaN(num)) {
      sum += num;
    }
  }

  return sum;
}

function updateTotals() {
  if (totalAllValueEl) {
    const totalAll = calcTotalValue(allRows);
    totalAllValueEl.textContent = formatNumber(totalAll);
  }

  if (totalFilteredValueEl) {
    const totalFiltered = calcTotalValue(filteredRows);
    totalFilteredValueEl.textContent = formatNumber(totalFiltered);
  }

  if (totalFilteredCountEl) {
    totalFilteredCountEl.textContent = filteredRows.length;
  }
}

/* ---------------- 取資料 ---------------- */

async function fetchPortfolio() {
  setStatus("從 Supabase 讀取資料中...");
  const url = `${REST_BASE}/v_portfolio_positions_jpy_v8`;

  const query = new URLSearchParams({
    select:
      "card_code,rarity_code,name_ja,image_url,qty,yuyu_sell_jpy,yuyu_buy_jpy,market_value_jpy,buy_url,sell_url,expansion",
    order: "card_code.asc",
  });

  const resp = await fetch(`${url}?${query.toString()}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase 回應錯誤 ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data;
}

async function loadAllRowsFromSupabase() {
  try {
    setStatus("載入中...");
    tableBody.innerHTML = `
      <tr><td colspan="9">讀取中...</td></tr>
    `;

    const rows = await fetchPortfolio();
    allRows = rows.map((r) => ({
      card_code: r.card_code,
      rarity_code: r.rarity_code,
      name_ja: r.name_ja,
      image_url: r.image_url,
      qty: Number(r.qty || 0),
      sell_price_jpy: r.yuyu_sell_jpy,
      buy_price_jpy: r.yuyu_buy_jpy,
      market_value_jpy: r.market_value_jpy,
      buy_url: r.buy_url,
      sell_url: r.sell_url,
      expansion: r.expansion || "",
    }));

    filteredRows = [...allRows];
    currentPage = 1;

    populateExpansionFilter();
    populateNameFilter();
    applyFiltersAndRender();
    updateTotals();

    setStatus(
      `載入完成，共 ${allRows.length} 筆。持有市值＝持有張數 × YUYU 收購價。`
    );
  } catch (err) {
    console.error(err);
    setStatus(`載入失敗：${err.message}`);
    tableBody.innerHTML = `
      <tr><td colspan="9">載入失敗：${err.message}</td></tr>
    `;
  }
}

/* ---------------- 篩選與分頁 ---------------- */

function populateExpansionFilter() {
  if (!expansionFilter) return;
  const expansions = new Set(
    allRows
      .map((r) => r.expansion)
      .filter((x) => x && x.trim().length > 0)
  );

  expansionFilter.innerHTML = `<option value="">全部系列</option>`;
  Array.from(expansions)
    .sort()
    .forEach((exp) => {
      const opt = document.createElement("option");
      opt.value = exp;
      opt.textContent = exp;
      expansionFilter.appendChild(opt);
    });
}

function populateNameFilter() {
  if (!nameFilter) return;
  const names = new Set(
    allRows
      .map((r) => r.name_ja)
      .filter((x) => x && x.trim().length > 0)
  );

  nameFilter.innerHTML = `<option value="">全部角色</option>`;
  Array.from(names)
    .sort()
    .forEach((nm) => {
      const opt = document.createElement("option");
      opt.value = nm;
      opt.textContent = nm;
      nameFilter.appendChild(opt);
    });
}

function applyFiltersAndRender() {
  const keyword = searchInput.value.trim();
  const keywordLower = keyword.toLowerCase();

  const expansion = expansionFilter.value;
  const name = nameFilter.value;

  filteredRows = allRows.filter((row) => {
    if (expansion && row.expansion !== expansion) return false;
    if (name && row.name_ja !== name) return false;

    if (keywordLower) {
      const code = (row.card_code || "").toLowerCase();
      const nm = (row.name_ja || "").toLowerCase();
      if (!code.includes(keywordLower) && !nm.includes(keywordLower)) {
        return false;
      }
    }

    return true;
  });

  currentPage = 1;
  updateTotals();
  renderTable();
}

function getPagedRows() {
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  return filteredRows.slice(start, end);
}

function updatePager() {
  if (!pageInfoEl) return;
  const total = filteredRows.length;
  if (total === 0) {
    pageInfoEl.textContent = "沒有資料";
    return;
  }
  const totalPages = Math.ceil(total / pageSize);
  if (currentPage > totalPages) currentPage = totalPages;
  pageInfoEl.textContent = `第 ${currentPage} / ${totalPages} 頁（共 ${total} 筆）`;
}

/* ---------------- 表格繪製 ---------------- */

function attachImageModal(img) {
  if (!imageModal || !modalImage) return;
  img.addEventListener("click", () => {
    modalImage.src = img.src;
    imageModal.classList.add("active");
  });
}

if (imageModal) {
  imageModal.addEventListener("click", () => {
    imageModal.classList.remove("active");
    modalImage.src = "";
  });
}

function renderTable() {
  const rows = getPagedRows();
  tableBody.innerHTML = "";

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="9">沒有資料</td></tr>`;
    updatePager();
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code;
    tr.appendChild(tdCode);

    const tdRarity = document.createElement("td");
    const spanR = document.createElement("span");
    spanR.textContent = row.rarity_code || "";
    spanR.className = rarityToClass(row.rarity_code);
    tdRarity.appendChild(spanR);
    tr.appendChild(tdRarity);

    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    const tdImg = document.createElement("td");
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code;
      img.loading = "lazy";
      img.className = "card-img";
      attachImageModal(img);
      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    const tdQty = document.createElement("td");
    tdQty.textContent = formatNumber(row.qty);
    tdQty.classList.add("num");
    tr.appendChild(tdQty);

    const tdSell = document.createElement("td");
    tdSell.textContent =
      row.sell_price_jpy != null ? formatJPY(row.sell_price_jpy) : "-";
    tdSell.classList.add("num");
    tr.appendChild(tdSell);

    const tdBuy = document.createElement("td");
    tdBuy.textContent =
      row.buy_price_jpy != null ? formatJPY(row.buy_price_jpy) : "-";
    tdBuy.classList.add("num");
    tr.appendChild(tdBuy);

    const tdValue = document.createElement("td");
    const mvBuy = getRowMarketValueBuy(row);
    tdValue.textContent = formatNumber(mvBuy);
    tdValue.classList.add("num");
    tr.appendChild(tdValue);

    const tdLinks = document.createElement("td");
    const linkWrap = document.createElement("div");
    linkWrap.classList.add("yuyu-links");

    const sellUrl = row.sell_url || buildYuyuSellUrl(row.card_code);
    const buyUrl = row.buy_url || buildYuyuBuyUrl(row);

    if (sellUrl) {
      const aSell = document.createElement("a");
      aSell.href = sellUrl;
      aSell.target = "_blank";
      aSell.rel = "noopener noreferrer";
      aSell.textContent = "賣價";
      aSell.classList.add("link-btn");
      linkWrap.appendChild(aSell);
    }
    if (buyUrl) {
      const aBuy = document.createElement("a");
      aBuy.href = buyUrl;
      aBuy.target = "_blank";
      aBuy.rel = "noopener noreferrer";
      aBuy.textContent = "收購";
      aBuy.classList.add("link-btn");
      linkWrap.appendChild(aBuy);
    }

    tdLinks.appendChild(linkWrap);
    tr.appendChild(tdLinks);

    tableBody.appendChild(tr);
  }

  updatePager();
}

/* ---------------- Decklog JSON 比對 ---------------- */

const decklogInput = document.getElementById("decklogInput");
const decklogCompareBtn = document.getElementById("decklogCompareBtn");
const decklogStatusSpan = document.getElementById("decklogStatus");
const decklogResultBody = document.getElementById("decklogResultBody");
const decklogDownloadCsvBtn = document.getElementById(
  "decklogDownloadCsvBtn"
);

let lastDecklogDiffRows = [];

function setDecklogStatus(msg) {
  if (decklogStatusSpan) {
    decklogStatusSpan.textContent = msg;
  }
}

// 解析文字框中的 Decklog JSON
function parseDecklogJsonFromTextarea() {
  if (!decklogInput) {
    throw new Error("找不到 Decklog 輸入欄位 decklogInput。");
  }
  const raw = decklogInput.value.trim();
  if (!raw) {
    throw new Error("請先在上方貼上 Decklog JSON。");
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("Decklog JSON parse error", e);
    throw new Error("Decklog JSON 不是合法的 JSON。請確認有從書籤正確貼上。");
  }
  return data;
}

// 把 Decklog JSON 轉成 Map<card_code, total_needed>
function buildDeckRequirementMap(deckJson) {
  const map = new Map();
  if (!deckJson || typeof deckJson !== "object") return map;

  const addFromObj = (obj) => {
    if (!obj) return;
    for (const [codeRaw, countRaw] of Object.entries(obj)) {
      const code = String(codeRaw || "").trim();
      const n = Number(countRaw || 0);
      if (!code || !Number.isFinite(n) || n <= 0) continue;
      map.set(code, (map.get(code) || 0) + n);
    }
  };

  const addFromList = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const code = String(
        item.card_number || item.card_code || ""
      ).trim();
      if (!code) continue;
      const n = Number(
        item.num != null
          ? item.num
          : item._num != null
          ? item._num
          : item.count != null
          ? item.count
          : 0
      );
      if (!Number.isFinite(n) || n <= 0) continue;
      map.set(code, (map.get(code) || 0) + n);
    }
  };

  // 書籤 summary 版
  if (deckJson.main || deckJson.sub || deckJson.partner) {
    addFromObj(deckJson.main);
    addFromObj(deckJson.sub);
    addFromObj(deckJson.partner);
    return map;
  }

  // Decklog 原始 JSON 版
  addFromList(deckJson.list);
  addFromList(deckJson.sub_list);
  addFromList(deckJson.p_list);

  return map;
}

// 牌組需求 vs 庫存
function diffDeckAndInventory(deckMap) {
  const invMap = new Map();
  for (const row of allRows) {
    const code = row.card_code;
    const qty = Number(row.qty || 0);
    if (!code || !qty) continue;
    invMap.set(code, (invMap.get(code) || 0) + qty);
  }

  const result = [];
  let totalDeckNeeded = 0;
  let totalMissing = 0;

  for (const [code, need] of deckMap.entries()) {
    const have = invMap.get(code) || 0;
    const missing = Math.max(0, need - have);

    const invRow =
      allRows.find((r) => r.card_code === code) ||
      allRows.find(
        (r) => r.card_code.toLowerCase() === code.toLowerCase()
      );

    const buyPrice = invRow ? Number(invRow.buy_price_jpy ?? 0) : 0;
    const sellPrice = invRow ? Number(invRow.sell_price_jpy ?? 0) : 0;

    const missingValueBuy = missing * (Number.isFinite(buyPrice) ? buyPrice : 0);
    const missingValueSell =
      missing * (Number.isFinite(sellPrice) ? sellPrice : 0);

    result.push({
      card_code: code,
      name_ja: invRow ? invRow.name_ja : "（庫存表沒有這張卡）",
      rarity_code: invRow ? invRow.rarity_code : "",
      image_url: invRow ? invRow.image_url : "",
      deck_needed_qty: need,
      owned_qty: have,
      missing_qty: missing,
      yuyu_buy_jpy: buyPrice || null,
      yuyu_sell_jpy: sellPrice || null,
      missing_value_buy: missingValueBuy || null,
      missing_value_sell: missingValueSell || null,
      buy_url: invRow ? invRow.buy_url : null,
      sell_url: invRow ? invRow.sell_url : null,
      expansion: invRow ? invRow.expansion : "",
    });

    totalDeckNeeded += need;
    totalMissing += missing;
  }

  result.sort((a, b) => {
    if (a.missing_qty === b.missing_qty) {
      return (b.missing_value_buy || 0) - (a.missing_value_buy || 0);
    }
    return (b.missing_qty || 0) - (a.missing_qty || 0);
  });

  return { rows: result, totalDeckNeeded, totalMissing };
}

function renderDecklogResultsTable(diffRows) {
  if (!decklogResultBody) return;

  decklogResultBody.innerHTML = "";

  if (!diffRows || diffRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent =
      "尚未載入任何 Decklog 牌組，或目前這副牌你庫存都足夠。";
    tr.appendChild(td);
    decklogResultBody.appendChild(tr);
    return;
  }

  for (const row of diffRows) {
    const tr = document.createElement("tr");

    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code;
    tr.appendChild(tdCode);

    const tdRarity = document.createElement("td");
    tdRarity.textContent = row.rarity_code || "";
    tr.appendChild(tdRarity);

    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    const tdImg = document.createElement("td");
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code;
      img.loading = "lazy";
      img.style.maxHeight = "64px";
      img.style.maxWidth = "64px";
      attachImageModal(img);
      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    const tdNeed = document.createElement("td");
    tdNeed.textContent = row.deck_needed_qty;
    tdNeed.classList.add("num");
    tr.appendChild(tdNeed);

    const tdHave = document.createElement("td");
    tdHave.textContent = row.owned_qty;
    tdHave.classList.add("num");
    tr.appendChild(tdHave);

    const tdMissing = document.createElement("td");
    tdMissing.textContent = row.missing_qty;
    tdMissing.classList.add("num");
    tr.appendChild(tdMissing);

    const tdBuy = document.createElement("td");
    tdBuy.textContent =
      row.yuyu_buy_jpy != null ? formatJPY(row.yuyu_buy_jpy) : "-";
    tdBuy.classList.add("num");
    tr.appendChild(tdBuy);

    const tdSell = document.createElement("td");
    tdSell.textContent =
      row.yuyu_sell_jpy != null ? formatJPY(row.yuyu_sell_jpy) : "-";
    tdSell.classList.add("num");
    tr.appendChild(tdSell);

    const tdMissingBuy = document.createElement("td");
    tdMissingBuy.textContent =
      row.missing_value_buy != null
        ? formatJPY(row.missing_value_buy)
        : "-";
    tdMissingBuy.classList.add("num");
    tr.appendChild(tdMissingBuy);

    const tdLinks = document.createElement("td");
    const linkWrap = document.createElement("div");
    linkWrap.classList.add("yuyu-links");

    const sellUrl = row.sell_url || buildYuyuSellUrl(row.card_code);
    const buyUrl = row.buy_url || buildYuyuBuyUrl(row.card_code);

    if (sellUrl) {
      const aSell = document.createElement("a");
      aSell.href = sellUrl;
      aSell.target = "_blank";
      aSell.rel = "noopener noreferrer";
      aSell.textContent = "賣價";
      aSell.classList.add("link-btn");
      linkWrap.appendChild(aSell);
    }
    if (buyUrl) {
      const aBuy = document.createElement("a");
      aBuy.href = buyUrl;
      aBuy.target = "_blank";
      aBuy.rel = "noopener noreferrer";
      aBuy.textContent = "收購";
      aBuy.classList.add("link-btn");
      linkWrap.appendChild(aBuy);
    }
    tdLinks.appendChild(linkWrap);
    tr.appendChild(tdLinks);

    decklogResultBody.appendChild(tr);
  }
}

function downloadDecklogCsv() {
  if (!lastDecklogDiffRows || lastDecklogDiffRows.length === 0) {
    alert("目前沒有 Decklog 比對結果可以下載。");
    return;
  }
  const headers = [
    "card_code",
    "rarity",
    "name_ja",
    "deck_needed_qty",
    "owned_qty",
    "missing_qty",
    "yuyu_buy_jpy",
    "yuyu_sell_jpy",
    "missing_value_buy",
    "missing_value_sell",
    "yuyu_buy_url",
    "yuyu_sell_url",
  ];

  const lines = [headers.join(",")];

  for (const r of lastDecklogDiffRows) {
    const row = [
      r.card_code,
      r.rarity_code || "",
      (r.name_ja || "").replace(/"/g, '""'),
      r.deck_needed_qty,
      r.owned_qty,
      r.missing_qty,
      r.yuyu_buy_jpy ?? "",
      r.yuyu_sell_jpy ?? "",
      r.missing_value_buy ?? "",
      r.missing_value_sell ?? "",
      r.buy_url || buildYuyuBuyUrl(r.card_code),
      r.sell_url || buildYuyuSellUrl(r.card_code),
    ];
    lines.push(
      row
        .map((v) => {
          if (v === null || v === undefined) return "";
          const s = String(v);
          if (/[",\n]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "decklog_diff.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- 事件綁定 / 入口 ---------------- */

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

if (nameFilter) {
  nameFilter.addEventListener("change", () => {
    applyFiltersAndRender();
  });
}

if (pageSizeSelect) {
  pageSizeSelect.addEventListener("change", () => {
    pageSize = Number(pageSizeSelect.value || 50);
    currentPage = 1;
    renderTable();
  });
}

if (prevPageBtn) {
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderTable();
    }
  });
}

if (nextPageBtn) {
  nextPageBtn.addEventListener("click", () => {
    const totalPages = Math.ceil(filteredRows.length / pageSize);
    if (currentPage < totalPages) {
      currentPage += 1;
      renderTable();
    }
  });
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    loadAllRowsFromSupabase();
  });
}

if (decklogCompareBtn) {
  decklogCompareBtn.addEventListener("click", () => {
    try {
      const deckJson = parseDecklogJsonFromTextarea();
      const deckMap = buildDeckRequirementMap(deckJson);

      if (!deckMap || deckMap.size === 0) {
        setDecklogStatus("Decklog JSON 裡沒有讀到任何卡片。");
        renderDecklogResultsTable([]);
        lastDecklogDiffRows = [];
        if (decklogDownloadCsvBtn) decklogDownloadCsvBtn.disabled = true;
        return;
      }

      const { rows, totalDeckNeeded, totalMissing } =
        diffDeckAndInventory(deckMap);
      lastDecklogDiffRows = rows;
      renderDecklogResultsTable(rows);

      if (decklogDownloadCsvBtn) {
        decklogDownloadCsvBtn.disabled = rows.length === 0;
      }

      if (rows.length === 0) {
        setDecklogStatus(
          `牌組總共需要 ${totalDeckNeeded} 張，你的庫存全部足夠。`
        );
      } else {
        setDecklogStatus(
          `牌組總共需要 ${totalDeckNeeded} 張，其中有 ${totalMissing} 張不足（${rows.length} 種卡）。`
        );
      }
    } catch (err) {
      console.error(err);
      alert(`Decklog 比對失敗：${err.message}`);
      setDecklogStatus(`Decklog 比對失敗：${err.message}`);
    }
  });
}

if (decklogDownloadCsvBtn) {
  decklogDownloadCsvBtn.addEventListener("click", () => {
    downloadDecklogCsv();
  });
}

// 初始化
loadAllRowsFromSupabase();
