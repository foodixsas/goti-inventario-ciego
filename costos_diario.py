# -*- coding: utf-8 -*-
"""Los movimientos de inventario, valorizados contra el costo real.

Reemplaza a costos_resumen_diario, que multiplicaba por costo_promedio y por
eso dejaba en cero todo lo que se mide en gramos: el 31,7% de sus filas valian
$0 sin estar en cero de verdad.

QUE CAMBIA
----------
1. El valor sale de costo_vigente_producto, no de costo_promedio. Ese costo
   tiene los 6 decimales que hacen falta para que 50 gramos de pimiento a
   $0,000900 valgan $0,045 y no $0,00.

2. Los traslados entran por partida doble. Antes un traslado se le cargaba
   solo a la bodega que envia, asi que al filtrar por la bodega que recibe el
   producto aparecia de la nada. Ahora deja dos filas:
       TRA_SALE   en la bodega de origen
       TRA_ENTRA  en la bodega de destino
   Para el consumo real se mira EGR; los TRA sirven para seguir el producto
   entre bodegas.

3. Guarda el codigo del documento en la fila de detalle, para que al hacer
   clic en una variacion se pueda llegar al movimiento exacto en Contifico.

DEDUPLICACION
-------------
La sincronizacion vuelve a insertar el mismo documento con un movimiento_id
nuevo en cada corrida, asi que la llave es el CODIGO del documento y no el
movimiento_id. Sin esto el consumo sale hasta un 47% inflado.

    python costos_diario.py                  <- desde el 1-ene-2026
    python costos_diario.py --desde AAAA-MM-DD
"""
import sys
from datetime import date, timedelta

import costo_vigente

DESDE_DEFECTO = date(2026, 1, 1)

SQL_CREAR = """
CREATE TABLE IF NOT EXISTS costos_diario (
    fecha          date    NOT NULL,
    bodega_id      text    NOT NULL,
    bodega         text    NOT NULL,
    centro_costo   text,
    categoria      text    NOT NULL,
    codigo_prod    text    NOT NULL,
    nombre_prod    text,
    unidad         text,
    tipo           text    NOT NULL,
    cantidad       numeric NOT NULL DEFAULT 0,
    valor          numeric NOT NULL DEFAULT 0,
    costo_unitario numeric(20,8),
    confianza      text,
    lineas         integer NOT NULL DEFAULT 0,
    sin_costo      integer NOT NULL DEFAULT 0,
    docs           text,
    actualizado_en timestamp DEFAULT now(),
    PRIMARY KEY (fecha, bodega_id, codigo_prod, tipo)
);
CREATE INDEX IF NOT EXISTS ix_cd_fecha   ON costos_diario (fecha);
CREATE INDEX IF NOT EXISTS ix_cd_bodega  ON costos_diario (bodega_id, fecha);
CREATE INDEX IF NOT EXISTS ix_cd_centro  ON costos_diario (centro_costo, fecha);
CREATE INDEX IF NOT EXISTS ix_cd_cat     ON costos_diario (categoria, fecha);
CREATE INDEX IF NOT EXISTS ix_cd_prod    ON costos_diario (codigo_prod, fecha);
CREATE INDEX IF NOT EXISTS ix_cd_tipo    ON costos_diario (tipo, fecha);
"""

# Un dia a la vez: sobre 1,15M de filas, hacerlo de golpe tumba la conexion.
SQL_DIA = """
INSERT INTO costos_diario
    (fecha, bodega_id, codigo_prod, tipo, bodega, centro_costo, categoria,
     nombre_prod, unidad, cantidad, valor, costo_unitario, confianza, lineas,
     sin_costo, docs)
WITH dedup AS (
    SELECT DISTINCT ON (m.codigo, m.producto_id, m.cantidad,
                        m.bodega_origen_id, m.fecha)
           m.codigo, m.fecha, m.tipo, m.producto_id, m.cantidad,
           m.unidad_id, m.bodega_origen_id, m.bodega_destino_id
    FROM contifico_movimientos m
    WHERE m.fecha = %(dia)s AND m.tipo IN ('ING', 'EGR', 'TRA')
    ORDER BY m.codigo, m.producto_id, m.cantidad, m.bodega_origen_id,
             m.fecha, m.id
),
-- El traslado se desdobla: sale de una bodega y entra en otra.
lado AS (
    SELECT codigo, fecha, producto_id, cantidad, unidad_id,
           CASE WHEN tipo = 'TRA' THEN 'TRA_SALE' ELSE tipo END AS tipo,
           bodega_origen_id AS bodega_id
    FROM dedup
    UNION ALL
    SELECT codigo, fecha, producto_id, cantidad, unidad_id,
           'TRA_ENTRA', bodega_destino_id
    FROM dedup
    WHERE tipo = 'TRA' AND bodega_destino_id IS NOT NULL
      AND bodega_destino_id <> ''
),
val AS (
    SELECT l.*, v.costo, v.confianza
    FROM lado l
    LEFT JOIN costo_vigente_producto v
           ON v.producto_id = l.producto_id
          AND l.fecha BETWEEN v.desde AND v.hasta
)
-- Se agrupa por la llave primaria y nada mas. Varios producto_id pueden caer
-- en el mismo codigo -y todos los que no estan en el catalogo caen juntos en
-- SIN_CODIGO-, asi que el resto de campos van agregados.
SELECT
    v.fecha,
    coalesce(v.bodega_id, '?')                                      AS bodega_id,
    coalesce(p.codigo, 'SIN_CODIGO')                                AS codigo_prod,
    v.tipo,
    min(coalesce(bo.nombre, '(SIN BODEGA)')),
    min(coalesce(cc.nombre, '(SIN CENTRO)')),
    min(upper(translate(coalesce(cat.nombre, '(SIN CATEGORIA)'),
                        'ÁÉÍÓÚÑáéíóúñ', 'AEIOUNaeioun'))),
    min(coalesce(p.nombre, '(SIN NOMBRE)')),
    min(btrim(coalesce(u.nombre, ''))),
    -- Hay lineas con cantidad nula (ING 202601000424, por ejemplo). Sin el
    -- coalesce el grupo entero sale nulo y la fila no entra.
    coalesce(sum(v.cantidad), 0),
    coalesce(sum(v.cantidad * coalesce(v.costo, 0)), 0),
    CASE WHEN coalesce(sum(v.cantidad), 0) <> 0
         THEN sum(v.cantidad * coalesce(v.costo, 0)) / sum(v.cantidad) END,
    min(v.confianza),
    count(*),
    count(*) FILTER (WHERE v.costo IS NULL),
    string_agg(DISTINCT v.codigo, ' | ')
FROM val v
LEFT JOIN contifico_productos  p   ON p.id  = v.producto_id
LEFT JOIN contifico_categorias cat ON cat.id = p.categoria_id
LEFT JOIN contifico_bodegas    bo  ON bo.id  = v.bodega_id
-- El centro de costo agrupa bodegas: Principal y Pulmon son el mismo centro.
-- Por eso no es un simple otro nombre de la bodega, es otra dimension.
LEFT JOIN mapeo_bodega_centro_costo mc ON mc.bodega_id = v.bodega_id
LEFT JOIN contifico_centros_costo   cc ON cc.id = mc.centro_costo_id
LEFT JOIN contifico_unidades   u   ON u.id   = v.unidad_id
GROUP BY 1, 2, 3, 4
ON CONFLICT (fecha, bodega_id, codigo_prod, tipo) DO UPDATE SET
    bodega         = EXCLUDED.bodega,
    centro_costo   = EXCLUDED.centro_costo,
    categoria      = EXCLUDED.categoria,
    nombre_prod    = EXCLUDED.nombre_prod,
    unidad         = EXCLUDED.unidad,
    cantidad       = EXCLUDED.cantidad,
    valor          = EXCLUDED.valor,
    costo_unitario = EXCLUDED.costo_unitario,
    confianza      = EXCLUDED.confianza,
    lineas         = EXCLUDED.lineas,
    sin_costo      = EXCLUDED.sin_costo,
    docs           = EXCLUDED.docs,
    actualizado_en = now()
"""


def refrescar(cur, desde, hasta, log=print):
    """Recalcula dia por dia. hasta es exclusivo."""
    cur.execute(SQL_CREAR)
    dia, total = desde, 0
    while dia < hasta:
        cur.execute(SQL_DIA, {'dia': dia})
        n = cur.rowcount
        total += n
        if n and log:
            log('    %s  %6s filas' % (dia, f'{n:,}'.replace(',', '.')))
        dia += timedelta(days=1)
    return total


def main():
    desde = DESDE_DEFECTO
    if '--desde' in sys.argv:
        desde = date.fromisoformat(sys.argv[sys.argv.index('--desde') + 1])
    hasta = date.today() + timedelta(days=1)

    conn = costo_vigente.conectar()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '600s'")

    print('=' * 70)
    print('  MOVIMIENTOS VALORIZADOS  -  del %s al %s' % (desde, hasta - timedelta(days=1)))
    print('=' * 70)

    cur.execute("SELECT to_regclass('costo_vigente_producto')")
    if not cur.fetchone()[0]:
        print('  Falta la tabla de costos. Primero:  python costo_vigente.py')
        return 1

    total = refrescar(cur, desde, hasta,
                      log=lambda s: print(s, flush=True))
    print()
    print('  %s filas de resumen' % f'{total:,}'.replace(',', '.'))

    print()
    print('  COMO QUEDO')
    cur.execute("""SELECT tipo, count(*), sum(cantidad)::numeric(18,2),
                          sum(valor)::numeric(16,2),
                          sum(sin_costo)
                   FROM costos_diario GROUP BY 1 ORDER BY 4 DESC NULLS LAST""")
    print('    %-10s %8s %18s %14s %10s' % ('tipo', 'filas', 'cantidad', 'valor', 'sin costo'))
    for t, n, c, v, sc in cur.fetchall():
        print('    %-10s %8s %18s %14s %10s'
              % (t, f'{n:,}'.replace(',', '.'), c, v, sc))

    cur.execute("""SELECT count(*) FILTER (WHERE valor = 0), count(*)
                   FROM costos_diario WHERE fecha >= current_date - 90""")
    z, t = cur.fetchone()
    print('    filas en cero (90d): %s de %s  (%.1f%%)' % (z, t, 100.0 * z / t if t else 0))

    cur.execute("SELECT count(DISTINCT bodega) FROM costos_diario")
    print('    bodegas:', cur.fetchone()[0])

    print()
    print('  PRUEBA  VER009 PIMIENTO VERDE, 30-abr (Contifico: 50 g a $0,000900 = $0,05)')
    cur.execute("""SELECT fecha, bodega, tipo, cantidad, costo_unitario, valor, docs
                   FROM costos_diario
                   WHERE codigo_prod = 'VER009' AND fecha = DATE '2026-04-30'""")
    for f, b, ti, c, cu, va, d in cur.fetchall():
        print('    %s %-22s %-10s %10s x %.8f = %8.2f   %s'
              % (f, b[:22], ti, c, cu or 0, va, (d or '')[:40]))

    cur.close()
    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
