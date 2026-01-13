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

// 圖片放大 modal
const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");

// 全部資料快取（用來做搜尋）
let allRows = [];

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

// ---- 取資料 ----

async function fetchPortfolio() {
  setStatus("載入中（向 Supabase 取得資料）…");

  const url =
    `${REST_BASE}/v_portfolio_positions_jpy_v4` +
    "?select=card_code,name_ja,rarity_code,qty," +
    "sell_price_jpy,buy_price_jpy,market_value_jpy," +
    "image_url,sell_url,buy_url" +
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

    // 卡號
    const tdCode = document.createElement("td");
    tdCode.textContent = row.card_code || "-";
    tr.appendChild(tdCode);

    // 名稱（日文）
    const tdName = document.createElement("td");
    tdName.textContent = row.name_ja || "（暫時沒有日文名）";
    tr.appendChild(tdName);

    // 卡圖（小圖，可點擊放大）
    const tdImg = document.createElement("td");
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
    const tdSell = document.createElement("td");
    tdSell.className = "num";
    tdSell.textContent =
      row.sell_price_jpy != null ? formatNumber(row.sell_price_jpy) : "-";
    tr.appendChild(tdSell);

    // YUYU 收購價
    const tdBuy = document.createElement("td");
    tdBuy.className = "num";
    tdBuy.textContent =
      row.buy_price_jpy != null ? formatNumber(row.buy_price_jpy) : "-";
    tr.appendChild(tdBuy);

    // 市值
    const tdValue = document.createElement("td");
    tdValue.className = "num";
    tdValue.textContent =
      row.market_value_jpy != null ? formatNumber(row.market_value_jpy) : "-";
    tr.appendChild(tdValue);

    // YUYU 連結（賣價 / 收購）
    const tdLink = document.createElement("td");
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

// 關鍵字搜尋
if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilter();
  });
}

// 重新載入
if (reloadBtn) {
  reloadBtn.addEventListener("click", () => {
    loadAndRender();
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
