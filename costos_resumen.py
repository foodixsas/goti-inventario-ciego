"""
Modulo Control de Costos - construccion de la tabla resumen.

Resuelve de raiz los tres problemas detectados en los datos:
  1. Duplicados     -> DISTINCT ON por la llave de negocio del movimiento
  2. valor_total    -> NO se usa (es el total del documento repetido); el valor
                       de linea se calcula como cantidad * costo_promedio
  3. Categorias con -> se normalizan (sin tildes, mayusculas) para que las
     tilde duplicada    gemelas no partan los totales

Se puede ejecutar directo (carga inicial) o importar desde app.py (refresco).
"""
import os
from datetime import date, timedelta

import psycopg2

# La llave de deduplicacion va por CODIGO de documento, no por movimiento_id:
# cada corrida de la sincronizacion vuelve a insertar el mismo documento con un
# movimiento_id nuevo. Verificado el 21-ago-2026 con EGR 202608124294, que estaba
# 3 veces (3 movimiento_id distintos, contenido identico, 3 horas de sync).
# Deduplicar por movimiento_id dejaba pasar ~47% de sobreconteo.
LLAVE_DEDUP = "m.codigo, m.producto_id, m.cantidad, m.costo_promedio, m.bodega_origen_id, m.fecha"

SQL_CREAR = """
CREATE TABLE IF NOT EXISTS costos_resumen_diario (
    fecha           date    NOT NULL,
    bodega          text    NOT NULL,
    categoria       text    NOT NULL,
    codigo_prod     text    NOT NULL,
    nombre_prod     text,
    tipo            text    NOT NULL,
    cantidad        numeric NOT NULL DEFAULT 0,
    valor           numeric NOT NULL DEFAULT 0,
    costo_unitario  numeric,
    lineas          integer NOT NULL DEFAULT 0,
    sin_costo       integer NOT NULL DEFAULT 0,
    actualizado_en  timestamp DEFAULT now(),
    PRIMARY KEY (fecha, bodega, codigo_prod, tipo)
);
CREATE INDEX IF NOT EXISTS idx_crd_fecha        ON costos_resumen_diario(fecha);
CREATE INDEX IF NOT EXISTS idx_crd_cat_fecha    ON costos_resumen_diario(categoria, fecha);
CREATE INDEX IF NOT EXISTS idx_crd_prod_fecha   ON costos_resumen_diario(codigo_prod, fecha);
CREATE INDEX IF NOT EXISTS idx_crd_bodega_fecha ON costos_resumen_diario(bodega, fecha);
"""

# translate() evita depender de la extension unaccent, que puede no estar instalada
SQL_REFRESCAR = f"""
INSERT INTO costos_resumen_diario
    (fecha, bodega, categoria, codigo_prod, nombre_prod, tipo,
     cantidad, valor, costo_unitario, lineas, sin_costo, actualizado_en)
WITH dedup AS (
    SELECT DISTINCT ON ({LLAVE_DEDUP})
           m.fecha, m.tipo, m.bodega_origen_id, m.producto_id,
           m.cantidad, m.costo_promedio
    FROM contifico_movimientos m
    WHERE m.fecha >= %s AND m.fecha < %s
    ORDER BY {LLAVE_DEDUP}, m.id
)
SELECT
    d.fecha,
    COALESCE(bo.nombre, '(SIN BODEGA)')                                   AS bodega,
    upper(translate(COALESCE(cat.nombre, '(SIN CATEGORIA)'),
                    'ÁÉÍÓÚÑáéíóúñ', 'AEIOUNaeioun'))                      AS categoria,
    COALESCE(p.codigo, 'SIN_CODIGO')                                      AS codigo_prod,
    COALESCE(p.nombre, '(SIN NOMBRE)')                                    AS nombre_prod,
    d.tipo,
    sum(d.cantidad)                                                       AS cantidad,
    sum(d.cantidad * COALESCE(d.costo_promedio, 0))                       AS valor,
    CASE WHEN sum(d.cantidad) > 0
         THEN sum(d.cantidad * COALESCE(d.costo_promedio, 0)) / sum(d.cantidad)
    END                                                                   AS costo_unitario,
    count(*)                                                              AS lineas,
    count(*) FILTER (WHERE COALESCE(d.costo_promedio, 0) = 0)             AS sin_costo,
    now()
FROM dedup d
LEFT JOIN contifico_productos  p   ON d.producto_id::text     = p.id::text
LEFT JOIN contifico_categorias cat ON p.categoria_id::text    = cat.id::text
LEFT JOIN contifico_bodegas    bo  ON d.bodega_origen_id::text = bo.id::text
GROUP BY 1, 2, 3, 4, 5, 6
ON CONFLICT (fecha, bodega, codigo_prod, tipo) DO UPDATE SET
    categoria      = EXCLUDED.categoria,
    nombre_prod    = EXCLUDED.nombre_prod,
    cantidad       = EXCLUDED.cantidad,
    valor          = EXCLUDED.valor,
    costo_unitario = EXCLUDED.costo_unitario,
    lineas         = EXCLUDED.lineas,
    sin_costo      = EXCLUDED.sin_costo,
    actualizado_en = now()
"""


def conectar():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
        dbname='movimientos',
        user=os.environ.get('DB_USER', 'adminChios'),
        password=os.environ.get('DB_PASSWORD', 'Burger2023'),
        port=os.environ.get('DB_PORT', '5432'),
        sslmode='require', connect_timeout=15,
    )


def asegurar_tabla(cur):
    cur.execute(SQL_CREAR)


def refrescar_rango(cur, desde, hasta):
    """Recalcula el resumen por dias. Devuelve filas escritas."""
    total = 0
    dia = desde
    while dia < hasta:
        sig = dia + timedelta(days=1)
        cur.execute(SQL_REFRESCAR, (dia, sig))
        total += cur.rowcount
        dia = sig
    return total


def main():
    dias = int(os.environ.get('COSTOS_DIAS', '120'))
    conn = conectar()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '300s'")

    asegurar_tabla(cur)
    # La llave de dedup cambio: hay que rehacer lo ya calculado, no solo agregar
    if os.environ.get('COSTOS_REHACER') == '1':
        cur.execute("TRUNCATE costos_resumen_diario")
        print('Tabla costos_resumen_diario vaciada (se recalcula con la llave nueva)')
    print('Tabla costos_resumen_diario lista')

    hasta = date.today() + timedelta(days=1)
    desde = hasta - timedelta(days=dias)
    print(f'Cargando desde {desde} hasta {hasta} (dia por dia)\n')

    dia = desde
    total = 0
    while dia < hasta:
        sig = dia + timedelta(days=1)
        try:
            cur.execute(SQL_REFRESCAR, (dia, sig))
            n = cur.rowcount
            total += n
            if n:
                print(f'  {dia}: {n:>6,} filas de resumen', flush=True)
        except Exception as e:
            print(f'  {dia}: ERROR {str(e)[:70]}', flush=True)
        dia = sig

    print(f'\nTOTAL filas de resumen: {total:,}')
    cur.execute("SELECT count(*), min(fecha), max(fecha) FROM costos_resumen_diario")
    print('Estado tabla:', cur.fetchone())
    conn.close()


if __name__ == '__main__':
    main()
