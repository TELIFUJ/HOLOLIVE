import csv
import os
import sys
from datetime import datetime, timezone

import requests


# 從環境變數拿 Supabase 資訊
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

CSV_PATH = "data/inventory_lots.csv"


def load_csv_rows(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            # 跳過空行
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
                    "card_code": raw["card_code"].strip(),
                    "acquisition_type": raw["acquisition_type"].strip(),
                    "source_name": (raw.get("source_name") or "").strip(),
                    "acquired_qty": qty,
                    "unit_cost": unit_cost,
                    "currency": (raw.get("currency") or "J").strip()[:1],
                    "note": (raw.get("note") or "").strip(),
                }
            )
    return rows


def supabase_headers(prefer=None):
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def fetch_card_ids(card_codes):
    """
    從 cards 表一次抓出所有需要的 card_id
    """
    if not card_codes:
        return {}

    # Supabase PostgREST 的 in() 語法
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
        print(
            f"[錯誤] 讀取 cards 失敗: {resp.status_code} {resp.text}",
            file=sys.stderr,
        )
        sys.exit(1)

    data = resp.json()
    mapping = {row["card_code"]: row["id"] for row in data}
    return mapping


def insert_inventory_lots(rows, code_to_id):
    """
    透過 REST API 寫入 inventory_lots
    """
    if not rows:
        print("CSV 沒有資料，不做任何事")
        return

    now_ts = datetime.now(timezone.utc).isoformat()
    payload = []
    skipped_codes = []

    for r in rows:
        card_id = code_to_id.get(r["card_code"])
        if not card_id:
            skipped_codes.append(r["card_code"])
            continue

        payload.append(
            {
                "card_id": card_id,
                "acquisition_type": r["acquisition_type"],
                "source_name": r["source_name"],
                "acquired_qty": r["acquired_qty"],
                "unit_cost": r["unit_cost"],
                "currency": r["currency"],
                "acquired_at": now_ts,
                "note": r["note"],
            }
        )

    if skipped_codes:
        print(
            f"[警告] cards 裡找不到以下卡號，已略過: {', '.join(sorted(set(skipped_codes)))}",
            file=sys.stderr,
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
    code_to_id = fetch_card_ids(card_codes)
    insert_inventory_lots(rows, code_to_id)


if __name__ == "__main__":
    main()
