// === 設定區：改成你自己的 Supabase URL / anon key ===
// Project URL: Supabase 後台 Settings → API → Project URL
const PROJECT_URL = "https://ktcupyeopcffmtzzpewm.supabase.co";
// anon key: Supabase 後台 Settings → API → Project API keys → anon public
const ANON_KEY =
  "sb_publishable_rEvRt6x4kT6pKBUqh06YhQ_jHHO3zWU";

// REST base
const REST_BASE = `${PROJECT_URL}/rest/v1`;

// DOM elements
const statusEl = document.getElementById("status");
const tableBody = document.getElementById("tableBody");
const totalRowsEl = document.getElementById("totalRows");
const totalQtyEl = document.getElementById("totalQty");
const totalValueEl = document.getElementById("totalValue");
const totalValueTwdEl = document.getElementById("totalValueTwd");

const searchInput = document.getElementById("searchInput");
const reloadBtn = document.getElementById("reloadBtn");
const expansionFilter = document.getElementById("expansionFilter");
const nameFilter = document.getElementById("nameFilter");

const decklogInput = document.getElementById("decklogInput");
const decklogBtn = document.getElementById("decklogBtn");
const decklogSection = document.getElementById("decklogSection");
const decklogStatusEl = document.getElementById("decklogStatus");
const decklogTbody = document.getElementById("decklogTbody");

const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// 全部資料快取（用來做搜尋和篩選）
let allRows = [];

// 匯率（可之後改成 API 抓最新）
const JPY_TO_TWD_RATE = 0.22;

// ---- 共用工具 ----

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("zh-TW");
}

function formatCurrencyJpy(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return `¥${Number(n).toLocaleString("ja-JP")}`;
}

function formatCurrencyTwd(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return `NT$${Number(n).toLocaleString("zh-TW")}`;
}

function normalizeCardCode(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  // 允許 hBP01-001 / hbp01-001 / HBP01-001 這種，全部正規成「hBP01-001」
  const m = s.match(/^([hH][A-Z0-9]{2}\d?)-(\d{3})/);
  if (m) {
    const prefix = m[1];
    const num = m[2];
    // 保留中間兩碼大寫（BP / SD / Y0…）
    return `h${prefix.slice(1).toUpperCase()}-${num}`;
  }
  return s;
}

// ---- Supabase 請求 ----

async function fetchPortfolio() {
  setStatus("從 Supabase 載入資料中…");

  const url = `${REST_BASE}/v_portfolio_positions_jpy_v8`;
  const resp = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Supabase 讀取失敗：${resp.status} ${text}`);
  }

  const data = await resp.json();
  allRows = Array.isArray(data) ? data : [];
  setStatus(`已載入 ${allRows.length} 列資料。`);
  return allRows;
}

// ---- 總表渲染 ----

function renderTable(rows) {
  if (!tableBody) return;
  tableBody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");

    // 卡號
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "";
    tr.appendChild(tdCode);

    // 稀有度
    const tdRarity = document.createElement("td");
    tdRarity.textContent = row.rarity_code || row.rarity || "";
    tr.appendChild(tdRarity);

    // 日文名稱
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    // 圖片
    const tdImg = document.createElement("td");
    tdImg.className = "img-cell";
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code || "";
      img.loading = "lazy";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        if (!imageModal || !modalImage) return;
        modalImage.src = row.image_url;
        imageModal.classList.add("active");
      });
      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    // 持有數量
    const tdQty = document.createElement("td");
    tdQty.className = "number";
    tdQty.textContent = formatNumber(row.owned_qty ?? row.qty ?? 0);
    tr.appendChild(tdQty);

    // YUYU 賣價
    const tdSell = document.createElement("td");
    tdSell.className = "number";
    tdSell.textContent = formatNumber(row.sell_price_jpy);
    tr.appendChild(tdSell);

    // YUYU 收購價
    const tdBuy = document.createElement("td");
    tdBuy.className = "number";
    tdBuy.textContent = formatNumber(row.buy_price_jpy);
    tr.appendChild(tdBuy);

    // 市值（買價）
    const tdValue = document.createElement("td");
    tdValue.className = "number";
    tdValue.textContent = formatNumber(row.market_value_jpy);
    tr.appendChild(tdValue);

    // 版本資訊（release_label）
    const tdRelease = document.createElement("td");
    tdRelease.textContent = row.release_label || "";
    tr.appendChild(tdRelease);

    // 備註
    const tdNote = document.createElement("td");
    tdNote.textContent = row.note || "";
    tr.appendChild(tdNote);

    tableBody.appendChild(tr);
  }
}

// ---- 總計計算 ----

function calcTotals(rows) {
  let totalQty = 0;
  let totalValue = 0;

  for (const row of rows) {
    const qty = Number(row.owned_qty ?? row.qty ?? 0);
    if (!Number.isNaN(qty)) {
      totalQty += qty;
    }

    let v = row.market_value_jpy;

    // 雙保險：如果 view 沒給 market_value_jpy，就用 qty * 買價（沒有買價就當 0）
    if (v === null || v === undefined) {
      const q = Number(row.qty || 0);
      const base = Number(
        row.buy_price_jpy != null ? row.buy_price_jpy : 0
      );
      if (!Number.isNaN(q) && !Number.isNaN(base)) {
        v = q * base;
      } else {
        v = 0;
      }
    }

    const num = Number(v);
    if (!Number.isNaN(num)) {
      totalValue += num;
    }
  }

  return { totalQty, totalValue };
}

function renderTotals(rows) {
  const { totalQty, totalValue } = calcTotals(rows);

  if (totalRowsEl) {
    totalRowsEl.textContent = `筆數：${rows.length}`;
  }
  if (totalQtyEl) {
    totalQtyEl.textContent = `總張數：${formatNumber(totalQty)}`;
  }
  if (totalValueEl) {
    totalValueEl.textContent = `總市值（日圓）：${formatCurrencyJpy(
      totalValue
    )}`;
  }
  if (totalValueTwdEl) {
    const twd = totalValue * JPY_TO_TWD_RATE;
    totalValueTwdEl.textContent = `約合新台幣：${formatCurrencyTwd(twd)}`;
  }
}

// ---- 搜尋與篩選 ----

function applyFilters() {
  const keyword = (searchInput?.value || "").trim().toLowerCase();
  const exp = expansionFilter?.value || "";
  const name = nameFilter?.value || "";

  let rows = allRows.slice();

  if (exp) {
    rows = rows.filter((row) => (row.expansion || "") === exp);
  }

  if (name) {
    rows = rows.filter((row) => (row.name_ja || "") === name);
  }

  if (keyword) {
    rows = rows.filter((row) => {
      const code = (row.card_code || "").toLowerCase();
      const nameJa = (row.name_ja || "").toLowerCase();
      const note = (row.note || "").toLowerCase();
      return (
        code.includes(keyword) ||
        nameJa.includes(keyword) ||
        note.includes(keyword)
      );
    });
  }

  renderTable(rows);
  renderTotals(rows);
}

function buildFiltersFromData() {
  if (!expansionFilter || !nameFilter) return;

  const expansions = new Set();
  const names = new Set();

  for (const row of allRows) {
    if (row.expansion) expansions.add(row.expansion);
    if (row.name_ja) names.add(row.name_ja);
  }

  // 版本下拉
  expansionFilter.innerHTML = "";
  const optAllExp = document.createElement("option");
  optAllExp.value = "";
  optAllExp.textContent = "全部版本";
  expansionFilter.appendChild(optAllExp);

  Array.from(expansions)
    .sort()
    .forEach((exp) => {
      const opt = document.createElement("option");
      opt.value = exp;
      opt.textContent = exp;
      expansionFilter.appendChild(opt);
    });

  // 名稱下拉
  nameFilter.innerHTML = "";
  const optAllName = document.createElement("option");
  optAllName.value = "";
  optAllName.textContent = "全部名稱";
  nameFilter.appendChild(optAllName);

  Array.from(names)
    .sort()
    .forEach((nm) => {
      const opt = document.createElement("option");
      opt.value = nm;
      opt.textContent = nm;
      nameFilter.appendChild(opt);
    });
}

// ---- 圖片 modal ----

if (imageModal && modalImage) {
  imageModal.addEventListener("click", () => {
    imageModal.classList.remove("active");
    modalImage.src = "";
  });
}

// ---- Decklog 相關 ----
//
// 支援兩種來源：
// 1) 書籤匯出的 summary JSON：{ deck_id, main: { code: qty, ... }, sub: {...}, partner: {...} }
// 2) 原始 Decklog API JSON：{ deck_id, list: [{ card_number, num }...], sub_list: [...], p_list: [...] }

function buildDeckRequirementMapFromSummary(summary) {
  const map = new Map();
  if (!summary || typeof summary !== "object") return map;

  function addBucket(bucket) {
    if (!bucket || typeof bucket !== "object") return;
    for (const [rawCode, rawQty] of Object.entries(bucket)) {
      const code = normalizeCardCode(rawCode);
      const n = Number(rawQty);
      if (!code || !Number.isFinite(n) || n <= 0) continue;
      map.set(code, (map.get(code) || 0) + n);
    }
  }

  addBucket(summary.main);
  addBucket(summary.sub);
  addBucket(summary.partner);
  return map;
}

function buildDeckRequirementMapFromRaw(deckJson) {
  const map = new Map();
  if (!deckJson || typeof deckJson !== "object") return map;

  function addList(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const rawCode =
        item.card_number ||
        item.cardno ||
        item.cardNo ||
        item.card_code ||
        item.code;
      const code = normalizeCardCode(rawCode);
      const rawNum =
        item.num != null
          ? item.num
          : item._num != null
          ? item._num
          : item.count != null
          ? item.count
          : 0;
      const n = Number(rawNum);
      if (!code || !Number.isFinite(n) || n <= 0) continue;
      map.set(code, (map.get(code) || 0) + n);
    }
  }

  addList(deckJson.list);
  addList(deckJson.sub_list);
  addList(deckJson.p_list);
  return map;
}

function buildDeckRequirementMap(json) {
  if (!json || typeof json !== "object") return new Map();

  // 書籤 summary 形式
  if (json.main || json.sub || json.partner) {
    return buildDeckRequirementMapFromSummary(json);
  }

  // 某些情況資料包在 deck 屬性裡
  if (json.deck && (json.deck.list || json.deck.sub_list || json.deck.p_list)) {
    return buildDeckRequirementMapFromRaw(json.deck);
  }

  // 預設當成原始 Decklog 結構
  return buildDeckRequirementMapFromRaw(json);
}

function diffDeckAndInventory(deckMap) {
  if (!deckMap || deckMap.size === 0) {
    if (decklogStatusEl) {
      decklogStatusEl.textContent = "Decklog JSON 內沒有卡片資料。";
    }
    return null;
  }

  // 先把庫存整理成：card_code -> { have, name_ja, image_url }
  const invMap = new Map();
  for (const row of allRows) {
    const rawCode = row.card_code || row.cardCode;
    const code = normalizeCardCode(rawCode);
    if (!code) continue;

    const qty = Number(
      row.qty != null
        ? row.qty
        : row.owned_qty != null
        ? row.owned_qty
        : 0
    );
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const existing =
      invMap.get(code) || {
        have: 0,
        name_ja: row.name_ja || "",
        image_url: row.image_url || "",
      };
    existing.have += qty;
    if (!existing.name_ja && row.name_ja) existing.name_ja = row.name_ja;
    if (!existing.image_url && row.image_url) {
      existing.image_url = row.image_url;
    }
    invMap.set(code, existing);
  }

  const rows = [];
  let missingKinds = 0;
  let totalMissing = 0;
  let deckCount = 0;

  for (const [code, needRaw] of deckMap.entries()) {
    const need = Number(needRaw);
    if (!Number.isFinite(need) || need <= 0) continue;
    deckCount += need;

    const info = invMap.get(code) || { have: 0, name_ja: "", image_url: "" };
    const have = Number(info.have) || 0;
    const missing = need > have ? need - have : 0;

    if (missing > 0) {
      missingKinds += 1;
      totalMissing += missing;
      rows.push({
        card_code: code,
        name_ja: info.name_ja || "",
        image_url: info.image_url || "",
        need,
        have,
        missing,
      });
    }
  }

  // 依缺少張數多寡排序，再依卡號
  rows.sort((a, b) => {
    if (b.missing !== a.missing) return b.missing - a.missing;
    return a.card_code.localeCompare(b.card_code);
  });

  return { rows, missingKinds, totalMissing, deckCount };
}

function renderDecklogDiff(diff) {
  if (!decklogTbody || !decklogStatusEl) return;

  const { rows, missingKinds, totalMissing, deckCount } = diff;

  decklogTbody.innerHTML = "";

  decklogStatusEl.textContent =
    rows.length === 0
      ? "這副牌組你已經全部湊齊了。"
      : `牌組總數 ${deckCount} 張；缺少 ${missingKinds} 種，共 ${totalMissing} 張。`;

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "沒有缺的卡片。";
    tr.appendChild(td);
    decklogTbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    // 卡號
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code;
    tr.appendChild(tdCode);

    // 日文名稱
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "";
    tr.appendChild(tdName);

    // 圖片
    const tdImg = document.createElement("td");
    if (row.image_url) {
      const img = document.createElement("img");
      img.src = row.image_url;
      img.alt = row.card_code;
      img.loading = "lazy";
      img.style.maxHeight = "52px";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        if (!imageModal || !modalImage) return;
        modalImage.src = row.image_url;
        imageModal.classList.add("active");
      });
      tdImg.appendChild(img);
    } else {
      tdImg.textContent = "-";
    }
    tr.appendChild(tdImg);

    // 需要張數
    const tdNeed = document.createElement("td");
    tdNeed.className = "number";
    tdNeed.textContent = String(row.need);
    tr.appendChild(tdNeed);

    // 現有張數
    const tdHave = document.createElement("td");
    tdHave.className = "number";
    tdHave.textContent = String(row.have);
    tr.appendChild(tdHave);

    // 還缺多少
    const tdMissing = document.createElement("td");
    tdMissing.className = "number";
    tdMissing.textContent = String(row.missing);
    tr.appendChild(tdMissing);

    decklogTbody.appendChild(tr);
  }
}

async function handleDecklogCompare() {
  try {
    if (!decklogInput) {
      alert("找不到 Decklog 輸入欄位。");
      return;
    }
    const raw = decklogInput.value.trim();
    if (!raw) {
      alert("請先貼上從 Decklog 書籤複製的 JSON。");
      return;
    }

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error(e);
      alert("無法解析 Decklog JSON，請確認已完整貼上。");
      return;
    }

    if (decklogStatusEl) {
      decklogStatusEl.textContent =
        "正在解析 Decklog JSON 並與庫存比對…";
    }

    const deckMap = buildDeckRequirementMap(json);
    const diff = diffDeckAndInventory(deckMap);
    if (!diff) return;

    renderDecklogDiff(diff);

    if (decklogSection) {
      decklogSection.style.display = "block";
      try {
        decklogSection.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      } catch (_) {
        // ignore
      }
    }
  } catch (err) {
    console.error(err);
    if (decklogStatusEl) {
      decklogStatusEl.textContent = `Decklog 比對失敗：${err.message}`;
    } else {
      alert(`Decklog 比對失敗：${err.message}`);
    }
  }
}

// ---- 初始化載入與事件綁定 ----

async function loadAndRender() {
  try {
    const rows = await fetchPortfolio();
    renderTable(rows);
    renderTotals(rows);
    buildFiltersFromData();
  } catch (err) {
    console.error(err);
    setStatus(`載入失敗：${err.message}`);
  }
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    loadAndRender().catch((err) => {
      console.error(err);
    });
  });
}

// 關鍵字搜尋
if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilters();
  });
}

// 版本／名稱篩選
if (expansionFilter) {
  expansionFilter.addEventListener("change", () => {
    applyFilters();
  });
}
if (nameFilter) {
  nameFilter.addEventListener("change", () => {
    applyFilters();
  });
}

// Decklog 比對按鈕
if (decklogBtn) {
  decklogBtn.addEventListener("click", () => {
    handleDecklogCompare().catch((err) => {
      console.error(err);
    });
  });
}

// Decklog 輸入按 Enter 也可以觸發
if (decklogInput) {
  decklogInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      handleDecklogCompare().catch((err) => {
        console.error(err);
      });
    }
  });
}

// 啟動
loadAndRender().catch((err) => {
  console.error(err);
});
