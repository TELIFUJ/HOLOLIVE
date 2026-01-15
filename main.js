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
    `${REST_BASE}/v_portfolio_positions_jpy_v5` +
    "?select=card_code,name_ja,rarity_code,qty," +
    "sell_price_jpy,buy_price_jpy,market_value_jpy," +
    "image_url,sell_url,buy_url,print_id" +
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

// ---- 畫表格（只負責畫傳進來的 rows，不管分頁總量）----

function renderTable(rows) {
  tableBody.innerHTML = "";

  if (!rows || rows.length === 0) {
    // 不在這裡 setStatus，交給分頁函式統一處理
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

    // 市值
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
    if (row.expansion) expSet.add(row.expansion); // 若 view 沒有 expansion，這行不會產生任何值
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
    currentPage = 1;
    renderTablePage();
  } catch (err) {
    console.error(err);
    setStatus(`載入失敗：${err.message}`);
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
