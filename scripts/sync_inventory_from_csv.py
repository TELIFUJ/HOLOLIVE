import csv
import os
import sys
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values


# 從環境變數拿資料庫連線字串
DB_URL = os.environ.get("SUPABASE_DB_URL")
if not DB_URL:
    print("環境變數 SUPABASE_DB_URL 未設定", file=sys.stderr)
    sys.exit(1)

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
                print(f"acquired_qty 不是整數: {raw}", file=sys.stderr)
                continue

            try:
                unit_cost = float(raw["unit_cost"])
            except ValueError:
                print(f"unit_cost 不是數字: {raw}", file=sys.stderr)
                continue

            rows.append(
                {
                    "card_code": raw["card_code"].strip(),
                    "acquisition_type": raw["acquisition_type"].strip(),
                    "source_name": raw.get("source_name", "").strip(),
                    "acquired_qty": qty,
                    "unit_cost": unit_cost,
                    "currency": (raw.get("currency") or "J").strip()[:1],
                    "note": raw.get("note", "").strip(),
                }
            )
    return rows


def main():
    rows = load_csv_rows(CSV_PATH)
    if not rows:
        print("CSV 沒有資料，不做任何事")
        return

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # 先用卡號一次拿到所有 card_id
    card_codes = sorted({r["card_code"] for r in rows})
    cur.execute(
        """
        SELECT card_code, id
        FROM public.cards
        WHERE card_code = ANY(%s)
        """,
        (card_codes,),
    )
    code_to_id = {code: cid for code, cid in cur.fetchall()}

    # 準備要 insert 的資料
    insert_values = []
    now_ts = datetime.now(timezone.utc)

    for r in rows:
        card_id = code_to_id.get(r["card_code"])
        if not card_id:
            print(f"[警告] cards 裡找不到卡號: {r['card_code']}，略過", file=sys.stderr)
            continue

        insert_values.append(
            (
                card_id,
                r["acquisition_type"],  # enum acquisition_type
                r["source_name"],
                r["acquired_qty"],
                r["unit_cost"],
                r["currency"],
                now_ts,
                r["note"],
            )
        )

    if not insert_values:
        print("沒有任何有效資料可以寫入 inventory_lots")
        return

    # 每次 run 就新增一批交易（lot）
    execute_values(
        cur,
        """
        INSERT INTO public.inventory_lots (
          card_id,
          acquisition_type,
          source_name,
          acquired_qty,
          unit_cost,
          currency,
          acquired_at,
          note
        )
        VALUES %s
        """,
        insert_values,
    )

    conn.commit()
    cur.close()
    conn.close()

    print(f"成功寫入 {len(insert_values)} 筆 inventory_lots 記錄")


if __name__ == "__main__":
    main()
