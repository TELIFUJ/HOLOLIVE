// === 設定區：改成你自己的 Supabase URL / anon key ===
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
const rowsPerPageSelect = document.getElementById("rowsPerPage");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const pageInfoEl = document.getElementById("pageInfo");

// Decklog DOM
const decklogInput = document.getElementById("decklogInput");
const decklogBtn = document.getElementById("decklogBtn");
const decklogSection = document.getElementById("decklogSection");
const decklogStatusEl = document.getElementById("decklogStatus");
const decklogTbody = document.getElementById("decklogTbody");

// 總市值顯示 DOM
const totalAllValueEl = document.getElementById("totalAllValue");
const totalFilteredValueEl = document.getElementById("totalFilteredValue");

// 圖片放大 modal
const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// 狀態
let allRows = [];
let filteredRows = [];
let pageSize = 20;
let currentPage = 1;
let currentDeckDiff = null;

// ---- 共用工具 ----

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("ja-JP");
}

// 把各種寫法的卡號（hBP01-001 / HBP01-001 / BP01-001）整理成統一格式
function normalizeCardCode(input) {
  if (input == null) return "";
  const s = String(input).trim().toUpperCase();

  // 先找有帶 H 的寫法，例如 HBP01-001
  const withH = s.match(/H[0-9A-Z]{2}\d{2}-\d{3}/);
  if (withH) {
    return "h" + withH[0].slice(1);
  }

  // 再找沒帶 H 的三碼開頭，例如 BP01-001 / SD01-001 / Y01-001
  const noH = s.match(/[A-Z]{3}\d{2}-\d{3}/);
  if (noH) {
    return "h" + noH[0];
  }

  // 找不到就原樣回傳（最後一層保險，不影響現有資料）
  return s;
}

// 專門給「賣價」用：優先用 view 的 sell_url，沒有就退回搜尋頁
function buildYuyuSellUrl(row) {
  if (row.sell_url) return row.sell_url;

  const code = row.card_code;
  if (!code) return "";
  const q = encodeURIComponent(code);
  return `https://yuyu-tei.jp/sell/hocg/s/search?search_word=${q}`;
}

// 專門給「收購價」用：優先用 view 的 buy_url，沒有就退回搜尋頁
function buildYuyuBuyUrl(row) {
  if (row.buy_url) return row.buy_url;

  const code = row.card_code;
  if (!code) return "";
  const q = encodeURIComponent(code);
  return `https://yuyu-tei.jp/buy/hocg/s/search?search_word=${q}`;
}

function rarityToClass(rarity) {
  if (!rarity) return "";
  const r = rarity.toUpperCase();
  if (r === "SEC") return "rarity-SEC";
  if (r === "OSR" || r === "SSR") return "rarity-OSR";
  if (r === "RR") return "rarity-RR";
  if (r === "R") return "rarity-R";
  if (r === "U") return "rarity-U";
  if (r === "C") return "rarity-C";
  return "";
}

// 只使用 view 給的 market_value_jpy 當市值
function calcTotalValue(rows) {
  if (!Array.isArray(rows)) return 0;
  let sum = 0;

  for (const row of rows) {
    const v = Number(row.market_value_jpy ?? 0);
    if (!Number.isNaN(v)) {
      sum += v;
    }
  }

  return sum;
}

// ---- Supabase 讀取 ----

async function fetchPortfolio() {
  setStatus("從 Supabase 載入 portfolio 資料中…");

  const params = new URLSearchParams({
    select: "*",
    order: "card_code.asc,rarity_code.asc",
  });

  const url = `${REST_BASE}/${VIEW_NAME}?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase 回應錯誤：${resp.status} ${text}`);
  }

  const data = await resp.json();
  allRows = Array.isArray(data) ? data : [];
  filteredRows = [...allRows];

  buildFilterOptions(allRows);

  // 總市值用全部 rows 的 market_value_jpy
  const totalAll = calcTotalValue(allRows);
  if (totalAllValueEl) totalAllValueEl.textContent = formatNumber(totalAll);

  applyFilter(); // 內部會順便更新 filtered total + 首頁
}

// ---- Filter / Sort / Render ----

function buildFilterOptions(rows) {
  const expSet = new Set();
  const raritySet = new Set();

  for (const row of rows) {
    if (row.expansion) expSet.add(row.expansion);
    if (row.rarity_code) raritySet.add(row.rarity_code);
  }

  if (expansionFilter) {
    while (expansionFilter.options.length > 1) {
      expansionFilter.remove(1);
    }
    const exps = Array.from(expSet).sort();
    for (const exp of exps) {
      const opt = document.createElement("option");
      opt.value = exp;
      opt.textContent = exp;
      expansionFilter.appendChild(opt);
    }
  }

  if (rarityFilter) {
    while (rarityFilter.options.length > 1) {
      rarityFilter.remove(1);
    }
    const rarities = Array.from(raritySet).sort();
    for (const r of rarities) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      rarityFilter.appendChild(opt);
    }
  }
}

function applyFilter() {
  const q = (searchInput?.value || "").trim().toLowerCase();
  const expVal = (expansionFilter?.value || "").trim();
  const rarityVal = (rarityFilter?.value || "").trim();

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

  if (rarityVal) {
    rows = rows.filter((row) => row.rarity_code === rarityVal);
  }

  filteredRows = rows;
  currentPage = 1;

  const filteredTotal = calcTotalValue(filteredRows);
  if (totalFilteredValueEl) {
    totalFilteredValueEl.textContent = formatNumber(filteredTotal);
  }

  renderTablePage();
}

function renderTablePage() {
  const total = filteredRows.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageRows = filteredRows.slice(start, end);

  renderTable(pageRows);

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

  setStatus(
    `共 ${total} 筆卡片持有資料，顯示第 ${currentPage} / ${totalPages} 頁。`
  );
}

function renderTable(rows) {
  if (!tableBody) return;
  tableBody.innerHTML = "";

  const isMobile = window.innerWidth <= 768;

  for (const row of rows) {
    const tr = document.createElement("tr");

    // 卡號
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "";
    if (isMobile) tdCode.setAttribute("data-label", "卡號");
    tr.appendChild(tdCode);

    // 名稱
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    if (isMobile) tdName.setAttribute("data-label", "名稱");
    tr.appendChild(tdName);

    // 系列
    const tdExp = document.createElement("td");
    tdExp.textContent = row.expansion || "";
    if (isMobile) tdExp.setAttribute("data-label", "系列");
    tr.appendChild(tdExp);

    // 圖片
    const tdImg = document.createElement("td");
    tdImg.className = "img-cell";
    if (isMobile) tdImg.setAttribute("data-label", "圖片");

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
    tdRarity.className = "num";
    const rarity = row.rarity_code || "-";
    if (isMobile) tdRarity.setAttribute("data-label", "稀有度");

    const badge = document.createElement("span");
    badge.className = "badge";
    const rarityClass = rarityToClass(rarity);
    if (rarityClass) badge.classList.add(rarityClass);
    badge.textContent = rarity;
    tdRarity.appendChild(badge);
    tr.appendChild(tdRarity);

    // 持有張數
    const tdQty = document.createElement("td");
    tdQty.className = "num";
    tdQty.textContent = formatNumber(row.qty);
    if (isMobile) tdQty.setAttribute("data-label", "持有張數");
    tr.appendChild(tdQty);

    // 賣價
    const tdSell = document.createElement("td");
    tdSell.className = "num";
    tdSell.textContent =
      row.sell_price_jpy != null ? formatNumber(row.sell_price_jpy) : "-";
    if (isMobile) tdSell.setAttribute("data-label", "YUYU 賣價");
    tr.appendChild(tdSell);

    // 收購價
    const tdBuy = document.createElement("td");
    tdBuy.className = "num";
    tdBuy.textContent =
      row.buy_price_jpy != null ? formatNumber(row.buy_price_jpy) : "-";
    if (isMobile) tdBuy.setAttribute("data-label", "YUYU 收購價");
    tr.appendChild(tdBuy);

    // 市值（只吃 view 給的）
    const tdValue = document.createElement("td");
    tdValue.className = "num";
    tdValue.textContent =
      row.market_value_jpy != null ? formatNumber(row.market_value_jpy) : "-";
    if (isMobile) tdValue.setAttribute("data-label", "市值");
    tr.appendChild(tdValue);

    // YUYU 連結
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

// ---- Decklog 相關 ----

function parseDecklogId(input) {
  if (!input) return "";
  const s = String(input).trim();
  const m = s.match(/([0-9A-Z]{5})$/i);
  return m ? m[1].toUpperCase() : "";
}

async function fetchDecklogDeck(deckId) {
  // 這個 URL 是之前已經驗證過可以拿到 JSON 的
  const url = `https://decklog.bushimo.jp/api/deck/search?code=${deckId}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Decklog 回應錯誤：${resp.status} ${text}`);
  }
  const json = await resp.json();
  if (!json || !json.deck) {
    throw new Error("Decklog 回傳格式異常，找不到 deck 欄位。");
  }
  return json.deck;
}

// 從 Decklog JSON 抓出 card_number -> 需求張數（先做卡號正規化）
function buildDeckRequirementMap(deckJson) {
  const map = new Map();

  function addList(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const code = normalizeCardCode(item.card_number);
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

// 比對：牌組需求 vs 目前庫存，並把結果記在 currentDeckDiff 給畫面用
function diffDeckAndInventory(deckMap) {
  // 先整理庫存：同一張卡（不分稀有度）合併
  const invMap = new Map();
  const metaMap = new Map();

  for (const row of allRows) {
    const code = normalizeCardCode(row.card_code);
    const qty = Number(row.qty || 0);
    if (!code || !qty) continue;

    invMap.set(code, (invMap.get(code) || 0) + qty);

    if (!metaMap.has(code)) {
      metaMap.set(code, {
        name_ja: row.name_ja || "",
        image_url: row.image_url || "",
      });
    }
  }

  const rows = [];
  let missingKinds = 0;
  let totalMissing = 0;
  let deckCount = 0;

  for (const [code, need] of deckMap.entries()) {
    const have = invMap.get(code) || 0;
    const missing = Math.max(need - have, 0);
    deckCount += need;
    if (missing > 0) {
      missingKinds += 1;
      totalMissing += missing;
    }
    const meta = metaMap.get(code) || { name_ja: "", image_url: "" };
    rows.push({
      card_code: code,
      need,
      have,
      missing,
      name_ja: meta.name_ja,
      image_url: meta.image_url,
    });
  }

  rows.sort((a, b) => {
    if (b.missing !== a.missing) return b.missing - a.missing;
    return a.card_code.localeCompare(b.card_code);
  });

  currentDeckDiff = {
    deckCount,
    distinctCount: deckMap.size,
    missingKinds,
    totalMissing,
    rows,
  };

  renderDecklogDiff();

  return rows;
}

function renderDecklogDiff() {
  if (!decklogStatusEl || !decklogTbody) return;

  decklogTbody.innerHTML = "";

  if (!currentDeckDiff) {
    decklogStatusEl.textContent = "尚未載入任何 Decklog。";
    return;
  }

  const info = currentDeckDiff;
  const parts = [];
  parts.push(`牌組總張數 ${info.deckCount} 張，包含 ${info.distinctCount} 種卡。`);
  if (info.totalMissing === 0) {
    parts.push("目前庫存已完全滿足這副牌組。");
  } else {
    parts.push(
      `尚缺 ${info.missingKinds} 種、合計 ${info.totalMissing} 張（不分稀有度統計）。`
    );
  }
  decklogStatusEl.textContent = parts.join(" ");

  for (const row of info.rows) {
    const tr = document.createElement("tr");

    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code;
    tdCode.setAttribute("data-label", "卡號");
    tr.appendChild(tdCode);

    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tdName.setAttribute("data-label", "名稱");
    tr.appendChild(tdName);

    const tdImg = document.createElement("td");
    tdImg.className = "img-cell";
    tdImg.setAttribute("data-label", "卡圖");
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.name_ja || row.card_code;
      img.className = "card-img";
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

    const tdNeed = document.createElement("td");
    tdNeed.className = "num";
    tdNeed.textContent = row.need;
    tdNeed.setAttribute("data-label", "牌組需求");
    tr.appendChild(tdNeed);

    const tdHave = document.createElement("td");
    tdHave.className = "num";
    tdHave.textContent = row.have;
    tdHave.setAttribute("data-label", "目前持有");
    tr.appendChild(tdHave);

    const tdMissing = document.createElement("td");
    tdMissing.className = "num";
    tdMissing.textContent = row.missing > 0 ? row.missing : "-";
    tdMissing.setAttribute("data-label", "缺少");
    if (row.missing > 0) {
      tdMissing.style.color = "#c62828";
      tdMissing.style.fontWeight = "600";
    }
    tr.appendChild(tdMissing);

    decklogTbody.appendChild(tr);
  }
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

    if (
      !diff ||
      diff.length === 0 ||
      (currentDeckDiff && currentDeckDiff.totalMissing === 0)
    ) {
      setStatus(`牌組 ${deckId} 所需卡片你都已有足夠庫存。`);
      alert(`牌組 ${deckId} 所需卡片你都已有足夠庫存。`);
    } else {
      console.table(diff);
      const lines = diff
        .filter((d) => d.missing > 0)
        .slice(0, 10)
        .map(
          (d) => `${d.card_code}: 需要 ${d.need}，目前 ${d.have}，缺少 ${d.missing}`
        );
      alert(
        `牌組 ${deckId} 有 ${currentDeckDiff.missingKinds} 種卡片庫存不足（前 10 筆）：\n` +
          lines.join("\n")
      );
      setStatus(
        `牌組 ${deckId} 比對完成，有 ${currentDeckDiff.missingKinds} 種卡片庫存不足（詳細見下方表格與 console）。`
      );
    }
  } catch (err) {
    console.error(err);
    setStatus(`Decklog 比對失敗：${err.message}`);
    alert(`Decklog 比對失敗：${err.message}`);
  }
}

// ---- 事件綁定與初始化 ----

if (imageModal && modalImage) {
  imageModal.addEventListener("click", () => {
    imageModal.classList.remove("active");
  });
}

if (searchInput) {
  searchInput.addEventListener("input", () => applyFilter());
}
if (expansionFilter) {
  expansionFilter.addEventListener("change", () => applyFilter());
}
if (rarityFilter) {
  rarityFilter.addEventListener("change", () => applyFilter());
}
if (rowsPerPageSelect) {
  pageSize = Number(rowsPerPageSelect.value || 20);
  rowsPerPageSelect.addEventListener("change", () => {
    pageSize = Number(rowsPerPageSelect.value || 20) || 20;
    currentPage = 1;
    renderTablePage();
  });
}
if (prevPageBtn) {
  prevPageBtn.addEventListener("click", () => {
    currentPage -= 1;
    renderTablePage();
  });
}
if (nextPageBtn) {
  nextPageBtn.addEventListener("click", () => {
    currentPage += 1;
    renderTablePage();
  });
}
if (decklogBtn) {
  decklogBtn.addEventListener("click", () => {
    handleDecklogCompare();
  });
}
if (decklogInput) {
  decklogInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      handleDecklogCompare();
    }
  });
}

fetchPortfolio().catch((err) => {
  console.error(err);
  setStatus(`載入失敗：${err.message}`);
});
