"""Backup de conteos de inventario ciego (cantidad_contada, cantidad_contada_2).

NO respalda 'cantidad' ni 'costo_unitario': eso se re-descarga de Contifico.
Genera 3 archivos:
  .xlsx  una hoja por local + hoja TODOS   (para revisar a mano)
  .csv   plano                             (para reimportar)
  .sql   UPDATEs por id                    (para restaurar en caliente)

Pensado para correr en GitHub Actions, pero funciona igual en local.
Toda la configuracion entra por variables de entorno; no hay credenciales
en el codigo.

Variables:
  DB_HOST, DB_NAME, DB_USER, DB_PASSWORD   (obligatorias)
  DB_PORT       default 5432
  DB_SSLMODE    default require
  FECHA_DESDE   default 2026-04-01
  OUT_DIR       default ./backups
"""
import os
import re
import sys
import warnings
from datetime import datetime

import pandas as pd
import psycopg2

TABLA = "goti.inventario_ciego_conteos"


def env(nombre, default=None, obligatoria=False):
    valor = os.environ.get(nombre, default)
    if obligatoria and not valor:
        sys.exit(f"ERROR: falta la variable de entorno {nombre}")
    return valor


def main():
    fecha_desde = env("FECHA_DESDE", "2026-04-01")
    out_dir = env("OUT_DIR", os.path.join(os.getcwd(), "backups"))
    os.makedirs(out_dir, exist_ok=True)

    conn = psycopg2.connect(
        host=env("DB_HOST", obligatoria=True),
        database=env("DB_NAME", obligatoria=True),
        user=env("DB_USER", obligatoria=True),
        password=env("DB_PASSWORD", obligatoria=True),
        port=env("DB_PORT", "5432"),
        sslmode=env("DB_SSLMODE", "require"),
        connect_timeout=30,
    )

    # fecha_desde va parametrizada, no interpolada en el SQL
    sql = f"""
        SELECT id, fecha, local, codigo, nombre, unidad,
               cantidad_contada, cantidad_contada_2, observaciones, created_at
        FROM {TABLA}
        WHERE fecha >= %(desde)s
          AND (cantidad_contada IS NOT NULL OR cantidad_contada_2 IS NOT NULL)
        ORDER BY fecha, local, codigo
    """
    # pandas avisa que psycopg2 no es SQLAlchemy; el SELECT funciona igual
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        df = pd.read_sql(sql, conn, params={"desde": fecha_desde})

    if df.empty:
        print(f"AVISO: no hay conteos desde {fecha_desde}. No se genera backup.")
        conn.close()
        return 0

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = os.path.join(out_dir, f"BACKUP_CONTEOS_desde_{fecha_desde}_{ts}")
    out_xlsx, out_csv, out_sql = base + ".xlsx", base + ".csv", base + ".sql"

    # ---- Excel: hoja TODOS + una por local ----
    with pd.ExcelWriter(out_xlsx, engine="openpyxl") as w:
        df.to_excel(w, sheet_name="TODOS", index=False)
        for local, g in df.groupby("local"):
            g.to_excel(w, sheet_name=str(local)[:31], index=False)

    # ---- CSV ----
    df.to_csv(out_csv, index=False, encoding="utf-8-sig")

    # ---- SQL de restauracion ----
    cur = conn.cursor()

    def lit(valor):
        if pd.isna(valor):
            return "NULL"
        return cur.mogrify("%s", (valor,)).decode("utf-8")

    with open(out_sql, "w", encoding="utf-8") as f:
        f.write(f"-- Backup SOLO CONTEOS de {TABLA} desde {fecha_desde}\n")
        f.write(f"-- Generado: {datetime.now()}\n")
        f.write(f"-- Filas: {len(df)}\n")
        f.write("-- Para restaurar: ejecutar estos UPDATEs\n\n")
        f.write("BEGIN;\n")
        for _, row in df.iterrows():
            f.write(
                f"UPDATE {TABLA} SET "
                f"cantidad_contada={lit(row['cantidad_contada'])}, "
                f"cantidad_contada_2={lit(row['cantidad_contada_2'])}, "
                f"observaciones={lit(row['observaciones'])} "
                f"WHERE id={int(row['id'])};\n"
            )
        f.write("COMMIT;\n")

    cur.close()
    conn.close()

    # ---- Guarda contra la regresion del 'SET' pegado ----
    # (el backup de mayo-2026 salio con 'SETcantidad_contada=' y los 9756
    #  UPDATEs eran SQL invalido; esto lo detecta antes de confiar en el archivo)
    patron = re.compile(r"^UPDATE \S+ SET cantidad_contada=.* WHERE id=\d+;$")
    with open(out_sql, encoding="utf-8") as f:
        updates = [l.strip() for l in f if l.startswith("UPDATE ")]
    malos = [u for u in updates if not patron.match(u)]
    if malos or len(updates) != len(df):
        print(f"ERROR: el .sql salio mal formado ({len(malos)} lineas invalidas, "
              f"{len(updates)} UPDATEs vs {len(df)} filas)")
        if malos:
            print("  ejemplo:", malos[0][:120])
        return 1

    print(f"OK - {len(df)} filas respaldadas")
    print(f"  Fechas : {df['fecha'].min()} -> {df['fecha'].max()}")
    print(f"  Locales: {sorted(df['local'].unique())}")
    print(f"  Conteo 1: {int(df['cantidad_contada'].notna().sum())} | "
          f"Conteo 2: {int(df['cantidad_contada_2'].notna().sum())}")
    print(f"  {len(updates)} UPDATEs validados")
    for p in (out_xlsx, out_csv, out_sql):
        print(f"  {os.path.basename(p)}  ({os.path.getsize(p):,} bytes)")

    # Expone datos al resumen del workflow
    resumen = os.environ.get("GITHUB_OUTPUT")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write(f"filas={len(df)}\n")
            f.write(f"desde={df['fecha'].min()}\n")
            f.write(f"hasta={df['fecha'].max()}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
