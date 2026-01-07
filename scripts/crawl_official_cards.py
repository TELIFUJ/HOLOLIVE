import requests
from bs4 import BeautifulSoup
import time
import os
import csv

API_URL = "https://hololive-official-cardgame.com/cardlist/cardsearch_ex"
BASE_URL = "https://hololive-official-cardgame.com"


def get_soup(url, params=None):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        )
    }
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"   ❌ 連線錯誤: {e}")
        return None
    return BeautifulSoup(resp.content, "html.parser")


def normalize_expansion(code: str) -> str | None:
    """
    接受 HPR / hbp01 / HSD2025summer 這種，統一轉成：
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
    head = c[1:3].upper()        # BP / PR / SD / YS / PC / CS...
    tail = c[3:].upper()         # 01 / 2025SUMMER...
    return "h" + head + tail


def fetch_card_urls(expansion: str):
    all_card_urls = []
    page = 1

    print(f"1. 利用 API 收集 {expansion} 卡片 URL 中...")

    while True:
        print(f"   讀取第 {page} 頁...", end="\r")

        params = {
            "expansion": expansion,
            "view": "image",
            "page": page,
            "t": int(time.time() * 1000),
        }

        soup = get_soup(API_URL, params)
        if not soup:
            break

        links = soup.find_all("a")
        if not links:
            print(f"\n   ✅ 第 {page-1} 頁是最後一頁。")
            break

        new_links_found = False
        for link in links:
            href = link.get("href")
            if href and "/cardlist/?id=" in href:
                full_url = BASE_URL + href
                if full_url not in all_card_urls:
                    all_card_urls.append(full_url)
                    new_links_found = True

        if not new_links_found and page > 1:
            print("\n   ⚠️ 偵測到重複內容，停止翻頁。")
            break

        page += 1
        time.sleep(0.5)

    print(f"📊 {expansion} 總共找到 {len(all_card_urls)} 個卡片 URL")
    return all_card_urls


def parse_products_and_dates(soup):
    products_box = soup.find("div", class_="cardlist-Detail_Products")
    products = []
    dates = set()

    if not products_box:
        return "", ""

    for prod in products_box.find_all("div", class_="products"):
        name = None
        p_tag = prod.find("p")
        if p_tag:
            name = p_tag.get_text(strip=True)
        if name:
            products.append(name)

        dl = prod.find("dl")
        if dl:
            dd = dl.find("dd")
            if dd:
                dates.add(dd.get_text(strip=True))

    products_str = " / ".join(products)
    dates_str = " / ".join(sorted(dates)) if dates else ""

    return products_str, dates_str


def fetch_card_detail(url: str, expansion: str):
    soup = get_soup(url)
    if not soup:
        return None

    name_tag = soup.find("h1", class_="name")
    card_name = name_tag.get_text(strip=True) if name_tag else ""

    number_tag = soup.find("p", class_="number")
    if number_tag and number_tag.find("span"):
        card_number = number_tag.find("span").get_text(strip=True)
    else:
        card_number = ""

    img_tag = soup.find("img", src=lambda s: s and "/cardlist/" in s)
    if img_tag and img_tag.get("src"):
        src = img_tag["src"]
        image_url = BASE_URL + src if src.startswith("/") else src
    else:
        image_url = ""

    illustrator_box = soup.find("div", class_="illustrator")
    illustrator_name = illustrator_box.get_text(strip=True) if illustrator_box else ""

    products_str, release_dates_str = parse_products_and_dates(soup)

    qa_items = soup.find_all("div", class_="qa-List_Item")
    qa_list = []
    for qa in qa_items:
        q = qa.find("p", class_="qa-List_Txt-Q")
        a = qa.find("p", class_="qa-List_Txt-A")
        q_text = q.get_text(" ", strip=True) if q else ""
        a_text = a.get_text(" ", strip=True) if a else ""
        if q_text or a_text:
            qa_list.append(f"Q: {q_text}\nA: {a_text}")
    qa_text = "\n\n".join(qa_list)
    qa_count = len(qa_list)

    skill_div = soup.find("div", class_="txt-Inner")
    effect_text = skill_div.get_text("\n", strip=True) if skill_div else ""

    return {
        "expansion": expansion,
        "card_code": card_number,
        "name_ja": card_name,
        "card_page_url": url,
        "image_url": image_url,
        "release_dates": release_dates_str,
        "products": products_str,
        "illustrator_name": illustrator_name,
        "qa_count": qa_count,
        "qa_text": qa_text,
        "effect_text": effect_text,
    }


def run_for_expansion(expansion: str):
    os.makedirs("data", exist_ok=True)

    print(f"🚀 啟動官網爬蟲 v2，目標系列：{expansion}")

    card_urls = fetch_card_urls(expansion)
    print("\n2. 開始抓取每張卡的詳細內容...\n")

    rows = []
    for i, url in enumerate(card_urls):
        print(f"[{i+1}/{len(card_urls)}] 取得 {url}", end="\r")
        data = fetch_card_detail(url, expansion)
        if data is None:
            print(f"\n   ⚠️ 解析失敗，略過：{url}")
            continue
        rows.append(data)
        time.sleep(0.2)

    if not rows:
        print(f"⚠️ {expansion} 沒有任何卡片資料，停止。")
        return

    output_file = f"data/{expansion}_cards_v2.csv"
    fieldnames = [
        "expansion",
        "card_code",
        "name_ja",
        "card_page_url",
        "image_url",
        "release_dates",
        "products",
        "illustrator_name",
        "qa_count",
        "qa_text",
        "effect_text",
    ]

    with open(output_file, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n🎉 完成！{expansion} 共輸出 {len(rows)} 筆資料 → {output_file}")


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

    print("本次將處理的系列：", ", ".join(expansions))

    for exp in expansions:
        run_for_expansion(exp)


if __name__ == "__main__":
    main()
