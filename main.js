// main.js v10 — HoloCard portfolio + Decklog compare

// === Supabase 設定 ===
const PROJECT_URL = "https://ktcupyeopcffmtzzpewm.supabase.co";
const ANON_KEY =
  "sb_publishable_rEvRt6x4kT6pKBUqh06YhQ_jHHO3zWU";

const REST_BASE = `${PROJECT_URL}/rest/v1`;

// 粗估匯率（之後你可以改成從 API 抓）
const JPY_TO_TWD = 0.22;

// === DOM 參照 ===
const statusEl = document.getElementById("status");

const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const expansionFilter = document.getElementById("expansionFilter");
const reloadBtn = document.getElementById("reloadBtn");
const pageInfoEl = document.getElementById("pageInfo");
const pageSizeSelect = document.getElementById("pageSize");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");

// 總覽數字
const allTotalJpyEl = document.getElementById("allTotalJpy");
const allTotalTwdEl = document.getElementById("allTotalTwd");
const recordCountEl = document.getElementById("recordCount");
const totalQtyEl = document.getElementById("totalQty");
const totalMarketJpyEl = document.getElementById("totalMarketJpy");
const totalMarketTwdEl = document.getElementById("totalMarketTwd");

// 圖片 modal
const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// Decklog 區塊
const decklogInput = document.getElementById("decklogInput");
const decklogBtn = document.getElementById("decklogBtn");
const decklogExportBtn = document.getElementById("decklogExportBtn");
const decklogStatusEl = document.getElementById("decklogStatus");
const decklogSummaryEl = document.getElementById("decklogSummary");
const deckCompareBody = document.getElementById("deckCompareBody");

// === 狀態 ===
let allRows = [];
let filteredRows = [];
let currentPage = 1;
let pageSize = pageSizeSelect ? Number(pageSizeSelect.value) || 10 : 10;

// Decklog 比對狀態
let currentDeck = null;
let deckCompareRows = [];
let deckCompareStat = null;

// === 小工具 ===
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatInt(n) {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US");
}

function formatMoney(n) {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US");
}

function rarityClass(rarity) {
  if (!rarity) return "badge";
  const r = String(rarity).toUpperCase();
  if (r === "OSR" || r === "SEC" || r === "SSP") return "badge r-osr";
  if (r === "RR" || r === "RRR") return "badge r-rr";
  if (r === "SR") return "badge r-sr";
  if (r === "R") return "badge r-r";
  if (r === "U") return "badge r-u";
  if (r === "C") return "badge r-c";
  if (r === "P" || r === "PR") return "badge r-p";
  return "badge";
}

// 只用收購價算市值；沒有收購價就 0
function calcMarketFromBuy(qty, buyPrice) {
  const q = toNumber(qty);
  const b =
    buyPrice === null || buyPrice === undefined
      ? NaN
      : Number(buyPrice);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return q * b;
}

function normalizeRow(raw) {
  const qty = toNumber(raw.qty);
  const buy =
    raw.buy_price_jpy === null || raw.buy_price_jpy === undefined
      ? null
      : Number(raw.buy_price_jpy);
  const sell =
    raw.sell_price_jpy === null ||
    raw.sell_price_jpy === undefined
      ? null
      : Number(raw.sell_price_jpy);

  const market = calcMarketFromBuy(qty, buy);

  return {
    card_code: raw.card_code || "",
    rarity_code: raw.rarity_code || "",
    expansion: raw.expansion || "",
    name_ja: raw.name_ja || "",
    image_url: raw.image_url || "",
    qty,
    buy_price_jpy: buy,
    sell_price_jpy: sell,
    market_value_jpy: market,
    buy_url: raw.buy_url || "",
    sell_url: raw.sell_url || "",
  };
}

// === 主要資料載入 ===
async function fetchPortfolio() {
  setStatus("讀取 Supabase 資料中…");

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };

  // 注意：order 的欄位要跟 view 裡的欄一致；print_id 在 view 裡若不存在，這行可以刪掉
  const url =
    `${REST_BASE}/v_portfolio_positions_jpy_v8` +
    "?select=card_code,rarity_code,expansion,name_ja,image_url,qty," +
    "buy_price_jpy,sell_price_jpy,market_value_jpy,buy_url,sell_url" +
    "&order=card_code.asc&order=rarity_code.asc&order=print_id.asc.nullslast";

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Supabase ${resp.status}: ${body}`);
    }

    const rawRows = await resp.json();
    allRows = rawRows.map(normalizeRow);

    setupExpansionFilter(allRows);
    applyFilterAndRender();

    setStatus(`載入成功，共 ${allRows.length} 筆資料`);
  } catch (err) {
    console.error(err);
    setStatus(`讀取失敗：${err.message}`);
  }
}

function setupExpansionFilter(rows) {
  if (!expansionFilter) return;
  const seen = new Set();
  rows.forEach((r) => {
    if (r.expansion) seen.add(r.expansion);
  });
  const options = Array.from(seen).sort();

  expansionFilter.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "全部系列";
  expansionFilter.appendChild(optAll);

  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    expansionFilter.appendChild(opt);
  });
}

function applyFilterAndRender() {
  const keyword = (searchInput?.value || "").trim().toLowerCase();
  const exp = expansionFilter?.value || "";

  filteredRows = allRows.filter((row) => {
    if (exp && row.expansion !== exp) return false;
    if (!keyword) return true;

    const code = (row.card_code || "").toLowerCase();
    const name = (row.name_ja || "").toLowerCase();

    return (
      (code && code.includes(keyword)) ||
      (name && name.includes(keyword))
    );
  });

  currentPage = 1;
  renderTable();
  updateTotals();
}

function renderTable() {
  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (!filteredRows.length) {
    if (pageInfoEl) pageInfoEl.textContent = "沒有資料";
    return;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRows.length / pageSize)
  );
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(start, start + pageSize);

  for (const row of pageRows) {
    const tr = document.createElement("tr");

    // 卡號
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "-";
    tr.appendChild(tdCode);

    // 稀有度（彩色 chip）
    const tdRarity = document.createElement("td");
    const spanR = document.createElement("span");
    spanR.className = rarityClass(row.rarity_code);
    spanR.textContent = row.rarity_code || "-";
    tdRarity.appendChild(spanR);
    tr.appendChild(tdRarity);

    // 名稱
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    // 系列
    const tdExpansion = document.createElement("td");
    tdExpansion.textContent = row.expansion || "";
    tr.appendChild(tdExpansion);

    // 圖片
    const tdImg = document.createElement("td");
    tdImg.className = "img-cell";
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code || "";
      img.loading = "lazy";
      img.addEventListener("click", () =>
        openImageModal(row.image_url)
      );
      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    // 持有張數
    const tdQty = document.createElement("td");
    tdQty.className = "numeric";
    tdQty.textContent = formatInt(row.qty);
    tr.appendChild(tdQty);

    // YUYU 收購價
    const tdBuy = document.createElement("td");
    tdBuy.className = "numeric";
    tdBuy.textContent =
      row.buy_price_jpy !== null && row.buy_price_jpy !== undefined
        ? formatMoney(row.buy_price_jpy)
        : "-";
    tr.appendChild(tdBuy);

    // YUYU 販售價
    const tdSell = document.createElement("td");
    tdSell.className = "numeric";
    tdSell.textContent =
      row.sell_price_jpy !== null &&
      row.sell_price_jpy !== undefined
        ? formatMoney(row.sell_price_jpy)
        : "-";
    tr.appendChild(tdSell);

    // 市值（持有張數 × 收購價；沒有收購價就 0）
    const tdValue = document.createElement("td");
    tdValue.className = "numeric";
    tdValue.textContent = formatMoney(row.market_value_jpy);
    tr.appendChild(tdValue);

    // YUYU 連結按鈕
    const tdLinks = document.createElement("td");
    tdLinks.className = "links-cell";
    let hasLink = false;

    if (row.sell_url) {
      const aSell = document.createElement("a");
      aSell.href = row.sell_url;
      aSell.target = "_blank";
      aSell.rel = "noopener noreferrer";
      aSell.textContent = "販售";
      aSell.className = "link-btn";
      tdLinks.appendChild(aSell);
      hasLink = true;
    }

    if (row.buy_url) {
      const aBuy = document.createElement("a");
      aBuy.href = row.buy_url;
      aBuy.target = "_blank";
      aBuy.rel = "noopener noreferrer";
      aBuy.textContent = "收購";
      aBuy.className = "link-btn";
      tdLinks.appendChild(aBuy);
      hasLink = true;
    }

    if (!hasLink) {
      tdLinks.textContent = "-";
    }

    tr.appendChild(tdLinks);

    tableBody.appendChild(tr);
  }

  const totalPages2 = Math.max(
    1,
    Math.ceil(filteredRows.length / pageSize)
  );
  if (pageInfoEl) {
    pageInfoEl.textContent = `第 ${currentPage} / ${totalPages2} 頁`;
  }
  if (prevPageBtn)
    prevPageBtn.disabled = currentPage <= 1;
  if (nextPageBtn)
    nextPageBtn.disabled = currentPage >= totalPages2;
}

function updateTotals() {
  let allValue = 0;
  allRows.forEach((row) => {
    allValue += toNumber(row.market_value_jpy);
  });

  let listValue = 0;
  let listQty = 0;
  filteredRows.forEach((row) => {
    listValue += toNumber(row.market_value_jpy);
    listQty += toNumber(row.qty);
  });

  if (allTotalJpyEl)
    allTotalJpyEl.textContent = formatMoney(allValue);
  if (allTotalTwdEl)
    allTotalTwdEl.textContent = (
      allValue * JPY_TO_TWD
    ).toFixed(2);

  if (recordCountEl)
    recordCountEl.textContent = formatInt(filteredRows.length);
  if (totalQtyEl)
    totalQtyEl.textContent = formatInt(listQty);
  if (totalMarketJpyEl)
    totalMarketJpyEl.textContent = formatMoney(listValue);
  if (totalMarketTwdEl)
    totalMarketTwdEl.textContent = (
      listValue * JPY_TO_TWD
    ).toFixed(2);
}

// === 圖片 modal ===
function openImageModal(src) {
  if (!imageModal || !modalImage) return;
  modalImage.src = src;
  imageModal.classList.add("active");
}

function closeImageModal() {
  if (!imageModal) return;
  imageModal.classList.remove("active");
}

if (imageModal) {
  imageModal.addEventListener("click", closeImageModal);
}

// === Decklog JSON 解析 ===
function parseDecklogJson(text) {
  if (!text) {
    throw new Error("請先貼上 Decklog JSON。");
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("JSON 格式錯誤：" + e.message);
  }

  const normalizeMap = (src) => {
    const map = {};
    if (!src) return map;
    for (const [key, value] of Object.entries(src)) {
      const code = String(key || "").trim();
      const n = Number(value);
      if (!code || !Number.isFinite(n) || n <= 0) continue;
      map[code] = (map[code] || 0) + n;
    }
    return map;
  };

  const mainRaw = data.main || data.list || {};
  const subRaw = data.sub || data.sub_list || {};
  const partnerRaw = data.partner || data.p_list || {};

  return {
    deck_id: data.deck_id || data.id || "",
    main: normalizeMap(mainRaw),
    sub: normalizeMap(subRaw),
    partner: normalizeMap(partnerRaw),
  };
}

function buildDeckCompare(deck) {
  const codes = new Set([
    ...Object.keys(deck.main),
    ...Object.keys(deck.sub),
    ...Object.keys(deck.partner),
  ]);

  const rows = [];
  let totalCards = 0;
  let totalValue = 0;
  let lackKinds = 0;
  let lackCards = 0;
  let lackValue = 0;

  codes.forEach((code) => {
    const needMain = deck.main[code] || 0;
    const needSub = deck.sub[code] || 0;
    const needPartner = deck.partner[code] || 0;
    const needTotal = needMain + needSub + needPartner;
    totalCards += needTotal;

    const ownedRows = allRows.filter(
      (r) => r.card_code === code
    );
    const ownedQty = ownedRows.reduce(
      (sum, r) => sum + toNumber(r.qty),
      0
    );

    const shortQty = Math.max(needTotal - ownedQty, 0);
    const overQty = Math.max(ownedQty - needTotal, 0);

    const base = ownedRows[0] || {};
    const buyPrice =
      base.buy_price_jpy === null ||
      base.buy_price_jpy === undefined
        ? null
        : Number(base.buy_price_jpy);
    const sellPrice =
      base.sell_price_jpy === null ||
      base.sell_price_jpy === undefined
        ? null
        : Number(base.sell_price_jpy);

    const needValue = calcMarketFromBuy(needTotal, buyPrice);
    const shortValue = calcMarketFromBuy(shortQty, buyPrice);

    totalValue += needValue;
    if (shortQty > 0) {
      lackKinds += 1;
      lackCards += shortQty;
      lackValue += shortValue;
    }

    rows.push({
      card_code: code,
      rarity_code: base.rarity_code || "",
      name_ja: base.name_ja || "",
      expansion: base.expansion || "",
      image_url: base.image_url || "",
      need_total: needTotal,
      need_main: needMain,
      need_sub: needSub,
      need_partner: needPartner,
      owned_qty: ownedQty,
      short_qty: shortQty,
      over_qty: overQty,
      buy_price_jpy: buyPrice,
      sell_price_jpy: sellPrice,
      buy_url: base.buy_url || "",
      sell_url: base.sell_url || "",
      deck_value_jpy: needValue,
      short_value_jpy: shortValue,
    });
  });

  rows.sort((a, b) => {
    if (a.short_qty !== b.short_qty) {
      return b.short_qty - a.short_qty; // 缺的排前面
    }
    return (a.card_code || "").localeCompare(
      b.card_code || ""
    );
  });

  return {
    rows,
    stat: {
      deck_id: deck.deck_id || "",
      kinds: codes.size,
      total_cards: totalCards,
      total_value_jpy: totalValue,
      total_value_twd: totalValue * JPY_TO_TWD,
      lack_kinds: lackKinds,
      lack_cards: lackCards,
      lack_value_jpy: lackValue,
      lack_value_twd: lackValue * JPY_TO_TWD,
    },
  };
}

function renderDeckCompare() {
  if (!deckCompareBody || !decklogSummaryEl) return;

  deckCompareBody.innerHTML = "";

  if (!deckCompareRows.length || !deckCompareStat) {
    decklogSummaryEl.textContent =
      "尚未載入任何 Decklog 牌組。";
    return;
  }

  const s = deckCompareStat;
  const totalJpy = Math.round(s.total_value_jpy);
  const lackJpy = Math.round(s.lack_value_jpy);

  decklogSummaryEl.innerHTML =
    `牌組 ID：${s.deck_id || "(未提供)"}｜` +
    `筆數：${formatInt(s.kinds)}｜` +
    `總張數：${formatInt(s.total_cards)}｜` +
    `總市值（日圓）：¥${formatMoney(totalJpy)}｜` +
    `約合新台幣：NT$${s.total_value_twd.toFixed(
      2
    )}<br>` +
    `缺少：${formatInt(s.lack_kinds)} 種／${formatInt(
      s.lack_cards
    )} 張（約 ¥${formatMoney(
      lackJpy
    )}，NT$${s.lack_value_twd.toFixed(2)}）`;

  deckCompareRows.forEach((row) => {
    const tr = document.createElement("tr");

    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code;
    tr.appendChild(tdCode);

    const tdRarity = document.createElement("td");
    const spanR = document.createElement("span");
    spanR.className = rarityClass(row.rarity_code);
    spanR.textContent = row.rarity_code || "-";
    tdRarity.appendChild(spanR);
    tr.appendChild(tdRarity);

    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    const tdImg = document.createElement("td");
    tdImg.className = "img-cell";
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code || "";
      img.loading = "lazy";
      img.addEventListener("click", () =>
        openImageModal(row.image_url)
      );
      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    const tdNeed = document.createElement("td");
    tdNeed.className = "numeric";
    const parts = [];
    if (row.need_main) parts.push(`主 ${row.need_main}`);
    if (row.need_sub) parts.push(`副 ${row.need_sub}`);
    if (row.need_partner)
      parts.push(`P ${row.need_partner}`);
    tdNeed.textContent = `${row.need_total}（${parts.join(
      " / "
    )}）`;
    tr.appendChild(tdNeed);

    const tdHave = document.createElement("td");
    tdHave.className = "numeric";
    tdHave.textContent = formatInt(row.owned_qty);
    tr.appendChild(tdHave);

    const tdShort = document.createElement("td");
    tdShort.className = "numeric";
    tdShort.textContent = formatInt(row.short_qty);
    if (row.short_qty > 0) {
      tdShort.classList.add("short-cell");
    }
    tr.appendChild(tdShort);

    const tdBuy = document.createElement("td");
    tdBuy.className = "numeric";
    tdBuy.textContent =
      row.buy_price_jpy !== null &&
      row.buy_price_jpy !== undefined
        ? formatMoney(row.buy_price_jpy)
        : "-";
    tr.appendChild(tdBuy);

    const tdSell = document.createElement("td");
    tdSell.className = "numeric";
    tdSell.textContent =
      row.sell_price_jpy !== null &&
      row.sell_price_jpy !== undefined
        ? formatMoney(row.sell_price_jpy)
        : "-";
    tr.appendChild(tdSell);

    const tdLinks = document.createElement("td");
    tdLinks.className = "links-cell";
    let hasLink = false;

    if (row.sell_url) {
      const aSell = document.createElement("a");
      aSell.href = row.sell_url;
      aSell.target = "_blank";
      aSell.rel = "noopener noreferrer";
      aSell.textContent = "販售";
      aSell.className = "link-btn";
      tdLinks.appendChild(aSell);
      hasLink = true;
    }

    if (row.buy_url) {
      const aBuy = document.createElement("a");
      aBuy.href = row.buy_url;
      aBuy.target = "_blank";
      aBuy.rel = "noopener noreferrer";
      aBuy.textContent = "收購";
      aBuy.className = "link-btn";
      tdLinks.appendChild(aBuy);
      hasLink = true;
    }

    if (!hasLink) {
      tdLinks.textContent = "-";
    }

    tr.appendChild(tdLinks);

    deckCompareBody.appendChild(tr);
  });
}

function handleDecklogCompareClick() {
  if (!decklogInput) return;
  const text = decklogInput.value.trim();
  if (!text) {
    alert("請先貼上 Decklog JSON。");
    return;
  }

  if (decklogStatusEl)
    decklogStatusEl.textContent = "解析與比對中…";

  try {
    const deck = parseDecklogJson(text);
    const result = buildDeckCompare(deck);
    currentDeck = deck;
    deckCompareRows = result.rows;
    deckCompareStat = result.stat;

    if (decklogStatusEl) {
      decklogStatusEl.textContent = `牌組 ${
        result.stat.deck_id || ""
      } 比對完成。`;
    }

    renderDeckCompare();
  } catch (err) {
    console.error(err);
    if (decklogStatusEl)
      decklogStatusEl.textContent =
        "比對失敗：" + err.message;
    if (deckCompareBody)
      deckCompareBody.innerHTML = "";
    if (decklogSummaryEl)
      decklogSummaryEl.textContent =
        "比對失敗，請檢查 JSON 內容。";
  }
}

function exportDeckCompareCsv() {
  if (!deckCompareRows.length) {
    alert("目前沒有 Decklog 比對結果。");
    return;
  }

  const header = [
    "card_code",
    "rarity",
    "name_ja",
    "need_total",
    "need_main",
    "need_sub",
    "need_partner",
    "owned_qty",
    "short_qty",
    "buy_price_jpy",
    "sell_price_jpy",
  ];

  const lines = [header.join(",")];

  deckCompareRows.forEach((row) => {
    const cols = [
      row.card_code,
      row.rarity_code,
      `"${String(row.name_ja || "").replace(
        /"/g,
        '""'
      )}"`,
      row.need_total,
      row.need_main,
      row.need_sub,
      row.need_partner,
      row.owned_qty,
      row.short_qty,
      row.buy_price_jpy ?? "",
      row.sell_price_jpy ?? "",
    ];
    lines.push(cols.join(","));
  });

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const deckId =
    (deckCompareStat && deckCompareStat.deck_id) ||
    "deck";
  a.href = url;
  a.download = `deck_compare_${deckId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// === 事件綁定 ===
if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilterAndRender();
  });
}

if (expansionFilter) {
  expansionFilter.addEventListener("change", () => {
    applyFilterAndRender();
  });
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    fetchPortfolio();
  });
}

if (pageSizeSelect) {
  pageSizeSelect.addEventListener("change", () => {
    pageSize =
      Number(pageSizeSelect.value) || pageSize || 10;
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
    const totalPages = Math.max(
      1,
      Math.ceil(filteredRows.length / pageSize)
    );
    if (currentPage < totalPages) {
      currentPage += 1;
      renderTable();
    }
  });
}

if (decklogBtn) {
  decklogBtn.addEventListener("click", () =>
    handleDecklogCompareClick()
  );
}

if (decklogExportBtn) {
  decklogExportBtn.addEventListener("click", () =>
    exportDeckCompareCsv()
  );
}

// === 啟動 ===
fetchPortfolio();
