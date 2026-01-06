import csv
import os
import sys
from datetime import datetime, timezone

import requests

# === Supabase 連線設定 ===

PROJECT_URL = os.environ.get("SUPABASE_PROJECT_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


if not PROJECT_URL:
    print("環境變數 SUPABASE_PROJECT_URL 未設定", file=sys.stderr)
    sys.exit(1)

if not SERVICE_ROLE_KEY:
    print("環境變數 SUPABASE_SERVICE_ROLE_KEY 未設定", file=sys.stderr)
    sys.exit(1)

PROJECT_URL = PROJECT_URL.rstrip("/")
REST_BASE = f"{PROJECT_URL}/rest/v1"

# v2 CSV 路徑
CSV_PATH = "data/inventory_lots_v2.csv"


# ---------- 載入 CSV ----------

def load_csv_rows(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        required = [
            "card_code",
            "print_hint",
            "acquisition_type",
            "source_name",
            "acquired_qty",
            "unit_cost",
            "currency",
            "acquired_at",
            "note",
        ]
        missing = [c for c in required if c not in reader.fieldnames]
        if missing:
            raise RuntimeError(f"CSV 欄位缺少：{', '.join(missing)}")

        for raw in reader:
            if not raw.get("card_code"):
                continue

            try:
                qty = int(raw["acquired_qty"])
            except ValueError:
                print(f"[略過] acquired_qty 不是整數: {raw}", file=sys.stderr)
                continue

            try:
                unit_cost = float(raw["unit_cost"])
            except ValueError:
                print(f"[略過] unit_cost 不是數字: {raw}", file=sys.stderr)
                continue

            rows.append(
                {
                    "card_code": (raw.get("card_code") or "").strip(),
                    "print_hint": (raw.get("print_hint") or "").strip(),  # 對應 rarity_code
                    "acquisition_type": (raw.get("acquisition_type") or "").strip(),
                    "source_name": (raw.get("source_name") or "").strip(),
                    "acquired_qty": qty,
                    "unit_cost": unit_cost,
                    "currency": (raw.get("currency") or "J").strip()[:1],  # 保留你原本 J / N 的設計
                    "acquired_at": (raw.get("acquired_at") or "").strip(),
                    "note": (raw.get("note") or "").strip(),
                }
            )
    return rows


# ---------- Supabase REST 小工具 ----------

def supabase_headers(prefer=None):
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def fetch_cards(card_codes):
    """從 cards 表一次抓出 card_id"""
    if not card_codes:
        return {}

    codes_clause = ",".join(card_codes)
    params = {
        "select": "id,card_code",
        "card_code": f"in.({codes_clause})",
    }

    resp = requests.get(
        f"{REST_BASE}/cards",
        headers=supabase_headers(),
        params=params,
        timeout=30,
    )
    if not resp.ok:
        print(f"[錯誤] 讀取 cards 失敗: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)

    data = resp.json()
    return {row["card_code"]: row["id"] for row in data}


def fetch_card_prints(card_codes):
    """從 card_prints 表抓出各卡的 print 資訊（id + rarity_code）"""
    if not card_codes:
        return {}

    codes_clause = ",".join(card_codes)
    params = {
        "select": "id,card_code,rarity_code",
        "card_code": f"in.({codes_clause})",
    }

    resp = requests.get(
        f"{REST_BASE}/card_prints",
        headers=supabase_headers(),
        params=params,
        timeout=30,
    )
    if not resp.ok:
        print(f"[錯誤] 讀取 card_prints 失敗: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)

    data = resp.json()
    prints_by_code = {}
    for row in data:
        code = row["card_code"]
        prints_by_code.setdefault(code, []).append(row)
    return prints_by_code


def resolve_print_id(prints_by_code, card_code, print_hint):
    """
    根據 card_code + print_hint(rarity_code) 找 print_id。
    若該卡只有一個 print，且找不到指定 rarity，就用唯一那一個。
    """
    prints = prints_by_code.get(card_code) or []
    if print_hint:
        for p in prints:
            if (p.get("rarity_code") or "") == print_hint:
                return p["id"]

    if len(prints) == 1:
        return prints[0]["id"]

    return None


# ---------- 寫入 inventory_lots ----------

def insert_inventory_lots(rows, code_to_id, prints_by_code):
    if not rows:
        print("CSV 沒有資料，不做任何事")
        return

    now_ts = datetime.now(timezone.utc).isoformat()
    payload = []
    skipped_cards = set()
    missing_prints = []

    for r in rows:
        card_code = r["card_code"]
        card_id = code_to_id.get(card_code)
        if not card_id:
            skipped_cards.add(card_code)
            continue

        print_id = resolve_print_id(prints_by_code, card_code, r["print_hint"])
        if not print_id:
            missing_prints.append(r)
            continue

        acquired_at = r["acquired_at"] or now_ts

        payload.append(
            {
                "card_id": card_id,
                "print_id": print_id,
                "acquisition_type": r["acquisition_type"],
                "source_name": r["source_name"],
                "acquired_qty": r["acquired_qty"],
                "unit_cost": r["unit_cost"],
                "currency": r["currency"],
                "acquired_at": acquired_at,
                "note": r["note"],
            }
        )

    if skipped_cards:
        print(
            "[警告] cards 裡找不到以下卡號，已略過: "
            + ", ".join(sorted(skipped_cards)),
            file=sys.stderr,
        )

    if missing_prints:
        print("[警告] 找不到對應印刷版本(card_prints) 的列：", file=sys.stderr)
        for r in missing_prints:
            print(f"  card_code={r['card_code']} print_hint={r['print_hint']}", file=sys.stderr)

        os.makedirs("data", exist_ok=True)
        with open("data/inventory_missing_prints.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "card_code",
                    "print_hint",
                    "acquisition_type",
                    "source_name",
                    "acquired_qty",
                    "unit_cost",
                    "currency",
                    "acquired_at",
                    "note",
                ]
            )
            for r in missing_prints:
                writer.writerow(
                    [
                        r["card_code"],
                        r["print_hint"],
                        r["acquisition_type"],
                        r["source_name"],
                        r["acquired_qty"],
                        r["unit_cost"],
                        r["currency"],
                        r["acquired_at"],
                        r["note"],
                    ]
                )

    if not payload:
        print("沒有任何有效資料可以寫入 inventory_lots")
        return

    resp = requests.post(
        f"{REST_BASE}/inventory_lots",
        headers=supabase_headers(prefer="return=minimal"),
        json=payload,
        timeout=60,
    )
    if not resp.ok:
        print(
            f"[錯誤] 寫入 inventory_lots 失敗: {resp.status_code} {resp.text}",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"成功寫入 {len(payload)} 筆 inventory_lots 記錄")


def main():
    rows = load_csv_rows(CSV_PATH)
    if not rows:
        print("CSV 沒有任何持有資料，結束")
        return

    card_codes = sorted({r["card_code"] for r in rows})

    code_to_id = fetch_cards(card_codes)
    prints_by_code = fetch_card_prints(card_codes)

    insert_inventory_lots(rows, code_to_id, prints_by_code)


if __name__ == "__main__":
    main()
