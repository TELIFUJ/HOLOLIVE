// === 設定區：改成你自己的 Supabase URL / anon key ===
// Project URL：Supabase 後台 Settings → API → Project URL
const PROJECT_URL = "https://你的專案代碼.supabase.co";
// anon key：Supabase 後台 Settings → API → anon public
const ANON_KEY = "在這裡貼你的 anon 公鑰";

const statusEl = document.getElementById("status");
const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const reloadBtn = document.getElementById("reloadBtn");

let allRows = [];

// 叫 Supabase REST 拿 portfolio_positions_jpy
async function fetchPortfolio() {
  statusEl.textContent = "載入中...";
  tableBody.innerHTML = "";

  const url = `${PROJECT_URL}/rest/v1/portfolio_positions_jpy?select=*`;

  const resp = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    statusEl.textContent = `讀取失敗：${resp.status} ${text}`;
    return;
  }

  const data = await resp.json();
  allRows = Array.isArray(data) ? data : [];
  statusEl.textContent = `已載入 ${allRows.length} 筆持有資料`;
  renderTable();
}

function renderTable() {
  const keyword = (searchInput.value || "").trim().toLowerCase();

  const rows = allRows.filter((row) => {
    if (!keyword) return true;
    const code = (row.card_code || "").toLowerCase();
    const name = (row.name_ja || "").toLowerCase();
    return code.includes(keyword) || name.includes(keyword);
  });

  // 依市值排序，高到低
  rows.sort((a, b) => {
    const av = a.market_value_jpy ?? 0;
    const bv = b.market_value_jpy ?? 0;
    return bv - av;
  });

  tableBody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");

    const market = row.market_value_jpy ?? null;
    const sell = row.sell_price_jpy ?? null;

    tr.innerHTML = `
      <td>${row.card_code || ""}</td>
      <td>${row.name_ja || ""}</td>
      <td><span class="badge">${row.rarity || ""}</span></td>
      <td class="num">${row.qty ?? ""}</td>
      <td class="num">${sell != null ? formatNumber(sell) : ""}</td>
      <td class="num">${market != null ? formatNumber(market) : ""}</td>
      <td>
        ${
          row.external_url
            ? `<button class="link-btn" data-url="${row.external_url}">開啟</button>`
            : ""
        }
      </td>
    `;

    tableBody.appendChild(tr);
  }

  // 綁定「開啟 YUYUTEI」按鈕
  tableBody.querySelectorAll("button.link-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      if (url) window.open(url, "_blank");
    });
  });
}

function formatNumber(n) {
  return Number(n).toLocaleString("ja-JP");
}

// 綁事件
searchInput.addEventListener("input", () => {
  renderTable();
});
reloadBtn.addEventListener("click", () => {
  fetchPortfolio().catch((e) => {
    console.error(e);
    statusEl.textContent = "重新載入失敗";
  });
});

// 進入頁面時自動載入一次
fetchPortfolio().catch((e) => {
  console.error(e);
  statusEl.textContent = "載入失敗";
});
