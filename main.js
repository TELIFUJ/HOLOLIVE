// === 設定區：改成你自己的 Supabase URL / anon key ===
// Project URL: Supabase 後台 Settings → API → Project URL
const PROJECT_URL = "https://ktcupyeopcffmtzzpewm.supabase.co";
// anon key: Supabase 後台 Settings → API → Project API keys → anon public
const ANON_KEY = "sb_publishable_rEvRt6x4kT6pKBUqh06YhQ_jHHO3zWU";

// REST base
const REST_BASE = `${PROJECT_URL}/rest/v1`;

// DOM elements
const statusEl = document.getElementById("status");
const totalValueEl = document.getElementById("totalValue");
const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const reloadBtn = document.getElementById("reloadBtn");
const expansionFilter = document.getElementById("expansionFilter");
const nameFilter = document.getElementById("nameFilter");
const decklogInput = document.getElementById("decklogInput");
const decklogBtn = document.getElementById("decklogBtn");

// 分頁相關 DOM
const pageSizeSelect = document.getElementById("pageSize");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const pageInfoEl = document.getElementById("pageInfo");

// 圖片放大 modal
const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// 全部資料快取（用來做搜尋／篩選／分頁）
let allRows = [];
let filteredRows = [];

// 分頁狀態
let pageSize = 10;
let currentPage = 1;

// ---- 共用工具 ----

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("ja-JP");
}

// 專門給「賣價」用：優先用 view 的 sell_url，沒有就退回搜尋頁
function buildYuyuSellUrl(row) {
  if (row.sell_url) return row.sell_url;

  const code = row.card_code || "";
  if (!code) return null;
  const search = encodeURIComponent(code);
  return `https://yuyu-tei.jp/sell/hocg/s/search?search_word=${search}`;
}

// 專門給「收購」用：優先用 view 的 buy_url，沒有就退回搜尋頁
function buildYuyuBuyUrl(row) {
  if (row.buy_url) return row.buy_url;

  const code = row.card_code || "";
  if (!code) return null;
  const search = encodeURIComponent(code);
  return `https://yuyu-tei.jp/buy/hocg/s/search?search_word=${search}`;
}

// 根據稀有度決定 badge class（只是為了配色）
function rarityToClass(rarity) {
  if (!rarity) return "";
  const r = rarity.toUpperCase();
  if (r === "OSR" || r === "SEC") return "r-osr";
  if (r === "RR") return "r-rr";
  if (r === "SR") return "r-sr";
  if (r === "R") return "r-r";
  if (r === "U") return "r-u";
  if (r === "C") return "r-c";
  if (r === "P") return "r-p";
  return "";
}

// ---- 取資料 ----

async function fetchPortfolio() {
  setStatus("載入中（向 Supabase 取得資料）…");

  const url =
    `${REST_BASE}/v_portfolio_positions_jpy_v8` +
    "?select=" +
    [
      "card_code",
      "name_ja",
      "rarity_code",
      "qty",
      "sell_price_jpy",
      "buy_price_jpy",
      "market_value_jpy",
      "image_url",
      "sell_url",
      "buy_url",
      "print_id",
      "expansion",
      "release_label",
    ].join(",") +
    "&order=card_code.asc&order=rarity_code.asc&order=print_id.asc.nullslast";

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

// ---- 總市值：只算 YUYU 收購（view 已經算好 market_value_jpy）----

function updateTotalValue() {
  if (!totalValueEl) return;

  if (!allRows || allRows.length === 0) {
    totalValueEl.textContent = "總市值（僅 YUYU 收購）：0 JPY";
    return;
  }

  const total = allRows.reduce((sum, row) => {
    let v = 0;

    if (row.market_value_jpy != null && !isNaN(row.market_value_jpy)) {
      v = Number(row.market_value_jpy);
    } else {
      // 保險起見，再用 qty * buy_price_jpy 算一次
      const qty = Number(row.qty || 0);
      const buy = Number(row.buy_price_jpy || 0);
      v = qty * buy;
    }

    if (!Number.isFinite(v)) v = 0;
    return sum + v;
  }, 0);

  totalValueEl.textContent =
    "總市值（僅 YUYU 收購）：" + formatNumber(total) + " JPY";
}

// ---- 畫表格（只負責畫傳進來的 rows，不管分頁總量）----

function renderTable(rows) {
  tableBody.innerHTML = "";

  if (!rows || rows.length === 0) {
    return;
  }

  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  for (const row of rows) {
    const tr = document.createElement("tr");

    // 卡號
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "-";
    if (isMobile) tdCode.setAttribute("data-label", "卡號");
    tr.appendChild(tdCode);

    // 名稱（日文）
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "（暫時沒有日文名）";
    if (isMobile) tdName.setAttribute("data-label", "名稱");
    tr.appendChild(tdName);

    // 卡圖（小圖，可點擊放大）
    const tdImg = document.createElement("td");
    tdImg.className = "img-cell";
    if (isMobile) tdImg.setAttribute("data-label", "卡圖");

    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.name_ja || row.card_code || "";
      img.className = "card-img";
      img.loading = "lazy";

      img.addEventListener("click", () => {
        if (!imageModal || !modalImage) return;
        modalImage.src = row.image_url;
        modalImage.alt = img.alt;
        imageModal.classList.add("active");
      });

      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    // 稀有度
    const tdRarity = document.createElement("td");
    const rarity = row.rarity_code || "-";
    if (isMobile) tdRarity.setAttribute("data-label", "稀有度");

    const badge = document.createElement("span");
    badge.className = "badge";
    const rarityClass = rarityToClass(rarity);
    if (rarityClass) {
      badge.classList.add(rarityClass);
    }
    badge.textContent = rarity;
    tdRarity.appendChild(badge);
    tr.appendChild(tdRarity);

    // 持有張數
    const tdQty = document.createElement("td");
    tdQty.className = "num";
    tdQty.textContent = formatNumber(row.qty);
    if (isMobile) tdQty.setAttribute("data-label", "持有張數");
    tr.appendChild(tdQty);

    // YUYU 賣價
    const tdSell = document.createElement("td");
    tdSell.className = "num";
    tdSell.textContent =
      row.sell_price_jpy != null ? formatNumber(row.sell_price_jpy) : "-";
    if (isMobile) tdSell.setAttribute("data-label", "賣價");
    tr.appendChild(tdSell);

    // YUYU 收購價
    const tdBuy = document.createElement("td");
    tdBuy.className = "num";
    tdBuy.textContent =
      row.buy_price_jpy != null ? formatNumber(row.buy_price_jpy) : "-";
    if (isMobile) tdBuy.setAttribute("data-label", "收購價");
    tr.appendChild(tdBuy);

    // 市值（只算收購，已由 view 算好）
    const tdValue = document.createElement("td");
    tdValue.className = "num";
    tdValue.textContent =
      row.market_value_jpy != null ? formatNumber(row.market_value_jpy) : "-";
    if (isMobile) tdValue.setAttribute("data-label", "市值");
    tr.appendChild(tdValue);

    // YUYU 連結（賣價 / 收購）
    const tdLink = document.createElement("td");
    if (isMobile) tdLink.setAttribute("data-label", "YUYU");

    const sellUrl = buildYuyuSellUrl(row);
    const buyUrl = buildYuyuBuyUrl(row);

    if (sellUrl || buyUrl) {
      if (sellUrl) {
        const btnSell = document.createElement("button");
        btnSell.className = "link-btn";
        btnSell.textContent = "賣價";
        btnSell.addEventListener("click", () => {
          window.open(sellUrl, "_blank", "noopener");
        });
        tdLink.appendChild(btnSell);
      }

      if (buyUrl) {
        if (tdLink.firstChild) {
          tdLink.appendChild(document.createTextNode(" "));
        }
        const btnBuy = document.createElement("button");
        btnBuy.className = "link-btn";
        btnBuy.textContent = "收購";
        btnBuy.addEventListener("click", () => {
          window.open(buyUrl, "_blank", "noopener");
        });
        tdLink.appendChild(btnBuy);
      }
    } else {
      tdLink.textContent = "-";
    }
    tr.appendChild(tdLink);

    tableBody.appendChild(tr);
  }
}

// ---- 分頁：根據 filteredRows + pageSize + currentPage 決定顯示 ----

function renderTablePage() {
  const total = filteredRows.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageRows = filteredRows.slice(start, end);

  renderTable(pageRows);

  // 更新分頁資訊
  if (pageInfoEl) {
    const pageDisplay = total === 0 ? 0 : currentPage;
    pageInfoEl.textContent = `第 ${pageDisplay} / ${totalPages} 頁（共 ${total} 筆）`;
  }

  if (prevPageBtn) {
    prevPageBtn.disabled = currentPage <= 1 || total === 0;
  }
  if (nextPageBtn) {
    nextPageBtn.disabled = currentPage >= totalPages || total === 0;
  }

  setStatus(`共 ${total} 筆卡片持有資料，顯示第 ${currentPage} / ${totalPages} 頁。`);
}

// ---- 篩選器 options ----

function buildFilterOptions(rows) {
  const expSet = new Set();
  const nameSet = new Set();

  for (const row of rows) {
    if (row.expansion) expSet.add(row.expansion);
    if (row.name_ja) nameSet.add(row.name_ja);
  }

  if (expansionFilter) {
    while (expansionFilter.options.length > 1) {
      expansionFilter.remove(1);
    }
    const expansions = Array.from(expSet).sort();
    for (const exp of expansions) {
      const opt = document.createElement("option");
      opt.value = exp;
      opt.textContent = exp;
      expansionFilter.appendChild(opt);
    }
  }

  if (nameFilter) {
    while (nameFilter.options.length > 1) {
      nameFilter.remove(1);
    }
    const names = Array.from(nameSet).sort((a, b) => a.localeCompare(b, "ja"));
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      nameFilter.appendChild(opt);
    }
  }
}

// ---- 搜尋 / 篩選 ----

function applyFilter() {
  const q = (searchInput?.value || "").trim().toLowerCase();
  const expVal = (expansionFilter?.value || "").trim();
  const nameVal = (nameFilter?.value || "").trim();

  let rows = allRows;

  if (q) {
    rows = rows.filter((row) => {
      const code = (row.card_code || "").toLowerCase();
      const name = (row.name_ja || "").toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }

  if (expVal) {
    rows = rows.filter((row) => row.expansion === expVal);
  }

  if (nameVal) {
    rows = rows.filter((row) => row.name_ja === nameVal);
  }

  filteredRows = rows;
  currentPage = 1;
  renderTablePage();
}

// ---- Decklog 相關（暫時維持 console + alert 版）----

// 解析輸入（可以是 693B7 或完整網址）
function parseDecklogId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const m = trimmed.match(/([0-9A-Z]{5})$/i);
  return m ? m[1].toUpperCase() : null;
}

async function fetchDecklogDeck(deckId) {
  const url = `https://decklog-en.bushiroad.com/api/deck/${deckId}`;
  const resp = await fetch(url, { mode: "cors" });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Decklog 回應錯誤: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  return json;
}

// 從 Decklog JSON 抓出 card_number -> 需求張數
function buildDeckRequirementMap(deckJson) {
  const map = new Map();

  function addList(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const code = item.card_number;
      const num = Number(item.num || 0);
      if (!code || !num) continue;
      map.set(code, (map.get(code) || 0) + num);
    }
  }

  addList(deckJson.list);
  addList(deckJson.sub_list);
  addList(deckJson.p_list);

  return map;
}

// 比對：牌組需求 vs 目前庫存
function diffDeckAndInventory(deckMap) {
  const invMap = new Map();
  for (const row of allRows) {
    const code = row.card_code;
    const qty = Number(row.qty || 0);
    if (!code || !qty) continue;
    invMap.set(code, (invMap.get(code) || 0) + qty);
  }

  const result = [];

  for (const [code, need] of deckMap.entries()) {
    const have = invMap.get(code) || 0;
    if (have < need) {
      result.push({
        card_code: code,
        need,
        have,
        short: need - have,
      });
    }
  }

  return result;
}

async function handleDecklogCompare() {
  try {
    const raw = decklogInput?.value;
    const deckId = parseDecklogId(raw);
    if (!deckId) {
      alert("請輸入正確的 Decklog ID 或網址（結尾 5 碼）。");
      return;
    }

    setStatus(`從 Decklog 取得牌組 ${deckId} 中…`);
    const deckJson = await fetchDecklogDeck(deckId);
    const deckMap = buildDeckRequirementMap(deckJson);
    const diff = diffDeckAndInventory(deckMap);

    if (diff.length === 0) {
      setStatus(`牌組 ${deckId} 所需卡片你都已有足夠庫存。`);
    } else {
      console.table(diff);
      const lines = diff
        .slice(0, 10)
        .map(
          (d) =>
            `${d.card_code}: 需要 ${d.need}，目前 ${d.have}，缺少 ${d.short}`
        );
      alert(
        `牌組 ${deckId} 有 ${diff.length} 種卡片庫存不足（前 10 筆）：\n` +
          lines.join("\n")
      );
      setStatus(
        `牌組 ${deckId} 比對完成，有 ${diff.length} 種卡片庫存不足（詳細見 console）。`
      );
    }
  } catch (err) {
    console.error(err);
    setStatus(`Decklog 比對失敗：${err.message}`);
    alert(`Decklog 比對失敗：${err.message}`);
  }
}

// ---- 入口 ----

async function loadAndRender() {
  try {
    setStatus("載入中…");
    tableBody.innerHTML = "";
    allRows = await fetchPortfolio();
    buildFilterOptions(allRows);
    filteredRows = allRows;
    updateTotalValue(); // ★ 更新總市值（只算收購）
    currentPage = 1;
    renderTablePage();
  } catch (err) {
    console.error(err);
    setStatus(`載入失敗：${err.message}`);
    if (totalValueEl) {
      totalValueEl.textContent = "總市值（僅 YUYU 收購）：-";
    }
  }
}

// 關鍵字搜尋
if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilter();
  });
}

// 版本／名稱篩選
if (expansionFilter) {
  expansionFilter.addEventListener("change", () => {
    applyFilter();
  });
}
if (nameFilter) {
  nameFilter.addEventListener("change", () => {
    applyFilter();
  });
}

// 重新載入
if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    loadAndRender();
  });
}

// Decklog 比對
if (decklogBtn) {
  decklogBtn.addEventListener("click", () => {
    handleDecklogCompare();
  });
}

// 分頁：每頁筆數切換
if (pageSizeSelect) {
  pageSizeSelect.addEventListener("change", () => {
    const v = Number(pageSizeSelect.value);
    pageSize = Number.isFinite(v) && v > 0 ? v : 10;
    currentPage = 1;
    renderTablePage();
  });
}

// 分頁：上一頁／下一頁
if (prevPageBtn) {
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderTablePage();
    }
  });
}
if (nextPageBtn) {
  nextPageBtn.addEventListener("click", () => {
    const totalPages =
      filteredRows.length === 0
        ? 1
        : Math.ceil(filteredRows.length / pageSize);
    if (currentPage < totalPages) {
      currentPage += 1;
      renderTablePage();
    }
  });
}

// 點擊遮罩關閉圖片
if (imageModal) {
  imageModal.addEventListener("click", () => {
    imageModal.classList.remove("active");
    if (modalImage) {
      modalImage.src = "";
    }
  });
}

// 首次載入
loadAndRender();
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
