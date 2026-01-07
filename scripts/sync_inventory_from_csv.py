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

def load_csv_rows(path: str):
    """
    讀取 inventory_lots_v2.csv，欄位預期為：
    expansion,card_code,rarity,print_hint,acquisition_type,source_name,
    acquired_qty,unit_cost,currency,acquired_at,note
    （不再需要 print_id）
    """
    rows: list[dict] = []

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        required = [
            "expansion",
            "card_code",
            "rarity",
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
            card_code = (raw.get("card_code") or "").strip()
            if not card_code:
                # 空列直接略過
                continue

            # 數量
            try:
                qty = int(raw["acquired_qty"])
            except ValueError:
                print(f"[略過] acquired_qty 不是整數: {raw}", file=sys.stderr)
                continue

            # 單價
            try:
                unit_cost = float(raw["unit_cost"])
            except ValueError:
                print(f"[略過] unit_cost 不是數字: {raw}", file=sys.stderr)
                continue

            rows.append(
                {
                    "expansion": (raw.get("expansion") or "").strip(),
                    "card_code": card_code,
                    "rarity": (raw.get("rarity") or "").strip(),
                    "print_hint": (raw.get("print_hint") or "").strip(),
                    "acquisition_type": (raw.get("acquisition_type") or "").strip(),
                    "source_name": (raw.get("source_name") or "").strip(),
                    "acquired_qty": qty,
                    "unit_cost": unit_cost,
                    "currency": (raw.get("currency") or "J").strip()[:1],
                    "acquired_at": (raw.get("acquired_at") or "").strip(),
                    "note": (raw.get("note") or "").strip(),
                }
            )

    return rows


# ---------- Supabase REST 小工具 ----------

def supabase_headers(prefer: str | None = None):
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def clear_inventory_lots_raw():
    """每次同步前把 staging 表清空，避免舊資料殘留。"""
    resp = requests.delete(
        f"{REST_BASE}/inventory_lots_raw",
        headers=supabase_headers(prefer="return=minimal"),
        params={"id": "gt.0"},  # 一定要有條件，才不會噴 DELETE requires a WHERE clause
        timeout=30,
    )
    if not resp.ok:
        print(
            f"[錯誤] 清空 inventory_lots_raw 失敗: "
            f"{resp.status_code} {resp.text}",
            file=sys.stderr,
        )
        sys.exit(1)


def insert_inventory_lots_raw(rows: list[dict]):
    if not rows:
        print("CSV 沒有資料，不做任何事")
        return

    now_ts = datetime.now(timezone.utc).isoformat()
    payload = []

    for r in rows:
        acquired_at = r["acquired_at"] or now_ts

        payload.append(
            {
                "expansion": r["expansion"],
                "card_code": r["card_code"],
                "rarity": r["rarity"],
                "print_hint": r["print_hint"],
                "acquisition_type": r["acquisition_type"],
                "source_name": r["source_name"],
                "acquired_qty": r["acquired_qty"],
                "unit_cost": r["unit_cost"],
                "currency": r["currency"],
                "acquired_at": acquired_at,
                "note": r["note"],
            }
        )

    resp = requests.post(
        f"{REST_BASE}/inventory_lots_raw",
        headers=supabase_headers(prefer="return=minimal"),
        json=payload,
        timeout=60,
    )
    if not resp.ok:
        print(
            f"[錯誤] 寫入 inventory_lots_raw 失敗: "
            f"{resp.status_code} {resp.text}",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"成功寫入 {len(payload)} 筆 inventory_lots_raw 記錄")


def main():
    rows = load_csv_rows(CSV_PATH)
    if not rows:
        print("CSV 沒有任何持有資料，結束")
        return

    clear_inventory_lots_raw()
    insert_inventory_lots_raw(rows)


if __name__ == "__main__":
    main()
