import csv
import time
import re
import os
import requests
from bs4 import BeautifulSoup

BASE_SELL_SEARCH = "https://yuyu-tei.jp/sell/hocg/s/search"
BASE_BUY_SEARCH = "https://yuyu-tei.jp/buy/hocg/s/search"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

REQUEST_TIMEOUT = 15
SLEEP_BETWEEN_REQUESTS = 1.2


def normalize_expansion(code: str) -> str | None:
    """
    跟官網爬蟲同一邏輯，讓 HPR/HBP01/HSD2025summer 都變成
      hPR / hBP01 / hSD2025SUMMER
    """
    if not code:
        return None
    c = code.strip().replace(" ", "")
    if not c:
        return None
    c = c.lower()
    if not c.startswith("h"):
        c = "h" + c
    head = c[1:3].upper()
    tail = c[3:].upper()
    return "h" + head + tail


# ----------------- 共用小工具 ----------------- #
def http_get(url: str, params=None) -> str:
    last_err = None
    for attempt in range(3):
        try:
            resp = requests.get(
                url, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            last_err = e
            wait = 2**attempt
            print(f"    !! HTTP 失敗，{wait} 秒後重試（{attempt + 1}/3）: {e}")
            time.sleep(wait)
    raise last_err


def _normalize_code(code: str) -> str:
    return (code or "").replace("　", " ").replace(" ", "").lower()


def _extract_code_from_alt(alt_text: str):
    if not alt_text:
        return None
    m = re.search(r"h[0-9A-Za-z]+-\d{3}", alt_text)
    if m:
        return m.group(0)
    return None


def parse_card_list_from_search(html: str, card_code: str, mode: str):
    soup = BeautifulSoup(html, "html.parser")
    results = []

    target_norm = _normalize_code(card_code)

    for cards_block in soup.select("div.py-4.cards-list"):
        h3 = cards_block.select_one("h3")
        if not h3:
            continue

        rarity = None
        span = h3.find("span")
        if span:
            rarity = span.get_text(strip=True) or None
        if not rarity:
            title_text = h3.get_text(" ", strip=True)
            rarity = title_text.split()[0] if title_text else None

        for product in cards_block.select("div.card-product"):
            code_span = product.select_one("span.d-block.border.border-dark")
            if not code_span:
                continue
            code_text = code_span.get_text(strip=True)
            norm_code = _normalize_code(code_text)

            alt_code = None
            img = product.select_one("img[alt]")
            if img and img.has_attr("alt"):
                alt_text = img["alt"].strip()
                alt_code = _extract_code_from_alt(alt_text)
            norm_alt = _normalize_code(alt_code) if alt_code else None

            if norm_code != target_norm and norm_alt != target_norm:
                continue

            name_el = product.select_one("h4")
            name_ja = name_el.get_text(strip=True) if name_el else None
            is_parallel_name = 1 if (name_ja and "パラレル" in name_ja) else 0

            price_el = product.select_one("strong")
            raw_price_text = price_el.get_text(strip=True) if price_el else None
            price_jpy = None
            if raw_price_text:
                digits = "".join(ch for ch in raw_price_text if ch.isdigit())
                if digits:
                    price_jpy = int(digits)

            card_url = None
            for a in product.find_all("a", href=True):
                href = a["href"]
                if f"/{mode}/hocg/card/" in href:
                    card_url = href
                    break
            if card_url and card_url.startswith("/"):
                card_url = "https://yuyu-tei.jp" + card_url

            results.append(
                {
                    "card_code": card_code,
                    "rarity": rarity,
                    "name_ja": name_ja,
                    "is_parallel_name": is_parallel_name,
                    "price_jpy": price_jpy,
                    "raw_price_text": raw_price_text,
                    "url": card_url,
                }
            )

    return results


def fetch_yuyutei_for_code(card_code: str):
    error_message = None

    try:
        sell_html = http_get(BASE_SELL_SEARCH, params={"search_word": card_code})
        sell_rows_raw = parse_card_list_from_search(sell_html, card_code, mode="sell")
    except Exception as e:
        sell_rows_raw = []
        error_message = f"sell search error: {e}"

    time.sleep(SLEEP_BETWEEN_REQUESTS)

    try:
        buy_html = http_get(BASE_BUY_SEARCH, params={"search_word": card_code})
        buy_rows_raw = parse_card_list_from_search(buy_html, card_code, mode="buy")
    except Exception as e:
        buy_rows_raw = []
        if error_message:
            error_message = f"{error_message} | buy search error: {e}"
        else:
            error_message = f"buy search error: {e}"

    sell_by_key = {}
    for row in sell_rows_raw:
        key = ((row["rarity"] or "?"), row["is_parallel_name"])
        if key not in sell_by_key or (row["price_jpy"] or 0) > (
            sell_by_key[key]["price_jpy"] or 0
        ):
            sell_by_key[key] = row

    buy_by_key = {}
    for row in buy_rows_raw:
        key = ((row["rarity"] or "?"), row["is_parallel_name"])
        if key not in buy_by_key or (row["price_jpy"] or 0) > (
            buy_by_key[key]["price_jpy"] or 0
        ):
            buy_by_key[key] = row

    all_keys = sorted(set(sell_by_key.keys()) | set(buy_by_key.keys()))
    merged_rows = []

    for rarity, is_parallel_name in all_keys:
        s = sell_by_key.get((rarity, is_parallel_name))
        b = buy_by_key.get((rarity, is_parallel_name))

        sell_price = s["price_jpy"] if s else None
        buy_price = b["price_jpy"] if b else None

        row_error = error_message
        is_suspicious = 0
        if sell_price is not None and buy_price is not None and buy_price > sell_price:
            is_suspicious = 1
            if not row_error:
                row_error = "buy_price_jpy > sell_price_jpy，請人工確認"

        merged_rows.append(
            {
                "card_code": card_code,
                "rarity": rarity,
                "is_parallel_name": is_parallel_name,
                "name_ja": (s and s["name_ja"]) or (b and b["name_ja"]),
                "sell_price_jpy": sell_price,
                "buy_price_jpy": buy_price,
                "raw_sell_price_text": s["raw_price_text"] if s else None,
                "raw_buy_price_text": b["raw_price_text"] if b else None,
                "sell_url": s["url"] if s else None,
                "buy_url": b["url"] if b else None,
                "is_suspicious": is_suspicious,
                "error_message": row_error,
            }
        )

    if not merged_rows:
        merged_rows.append(
            {
                "card_code": card_code,
                "rarity": None,
                "is_parallel_name": 0,
                "name_ja": None,
                "sell_price_jpy": None,
                "buy_price_jpy": None,
                "raw_sell_price_text": None,
                "raw_buy_price_text": None,
                "sell_url": None,
                "buy_url": None,
                "is_suspicious": 1,
                "error_message": error_message
                or "no card-product matched on search page",
            }
        )

    return merged_rows


def run_for_expansion(exp: str):
    os.makedirs("data", exist_ok=True)

    candidates = [
        f"data/{exp}_cards_v2.csv",
        f"data/{exp.upper()}_cards_v2.csv",
        f"data/{exp}_cards.csv",
        f"data/{exp.upper()}_cards.csv",
    ]

    cards_csv = None
    for path in candidates:
        if os.path.exists(path):
            cards_csv = path
            break

    if not cards_csv:
        print(f"[{exp}] 找不到下列任何一個檔案，略過：")
        for p in candidates:
            print(" -", p)
        return

    output_csv = f"data/{exp}_yuyutei_prices.csv"

    card_codes = []
    with open(cards_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = (row.get("card_code") or row.get("code") or "").strip()
            if code:
                card_codes.append(code)

    card_codes = sorted(set(card_codes))
    total = len(card_codes)
    print(f"[{exp}] 在 {cards_csv} 中讀取到 {total} 張卡要處理。")

    fieldnames = [
        "card_code",
        "rarity",
        "is_parallel_name",
        "name_ja",
        "sell_price_jpy",
        "buy_price_jpy",
        "raw_sell_price_text",
        "raw_buy_price_text",
        "sell_url",
        "buy_url",
        "is_suspicious",
        "error_message",
    ]

    with open(output_csv, "w", newline="", encoding="utf-8") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()

        for idx, code in enumerate(card_codes, 1):
            print(f"[{exp}] [{idx}/{total}]  - 抓取 {code} ...")
            try:
                rows = fetch_yuyutei_for_code(code)
                for row in rows:
                    writer.writerow(row)
            except Exception as e:
                print(f"[{exp}]   !! 全卡錯誤：{e}")
                writer.writerow(
                    {
                        "card_code": code,
                        "rarity": None,
                        "is_parallel_name": 0,
                        "name_ja": None,
                        "sell_price_jpy": None,
                        "buy_price_jpy": None,
                        "raw_sell_price_text": None,
                        "raw_buy_price_text": None,
                        "sell_url": None,
                        "buy_url": None,
                        "is_suspicious": 1,
                        "error_message": f"fatal: {e}",
                    }
                )
            time.sleep(SLEEP_BETWEEN_REQUESTS)

    print(f"[{exp}] 完成，輸出：{output_csv}")


def main():
    raw = os.environ.get(
        "HOCG_EXPANSIONS",
        "HBP01",
    )
    raw_list = [x.strip() for x in raw.split(",") if x.strip()]
    expansions = []
    for r in raw_list:
        norm = normalize_expansion(r)
        if norm and norm not in expansions:
            expansions.append(norm)

    print("YUYU 價格爬蟲將處理系列：", ", ".join(expansions))

    for exp in expansions:
        run_for_expansion(exp)


if __name__ == "__main__":
    main()
