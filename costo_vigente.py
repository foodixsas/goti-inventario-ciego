# -*- coding: utf-8 -*-
"""Costo unitario real de cada producto, dia por dia.

POR QUE EXISTE ESTE MODULO
--------------------------
La tabla de movimientos no trae el costo unitario de la linea:

  costo_promedio    llega redondeado a 2 decimales desde la API. Un producto
                    que vale $0,000900 el gramo se guarda como 0.00.
  total_movimiento  es el total del DOCUMENTO, repetido en cada linea. Solo
                    sirve dividido para la cantidad cuando el documento tiene
                    una sola linea, y eso pasa en el 0,6% de los egresos.

Asi que el costo hay que reconstruirlo. Contifico lo maneja como promedio
ponderado: solo cambia cuando entra mercaderia y se queda quieto hasta la
siguiente entrada. Es una funcion escalonada, y eso es lo que se arma aqui.

DE DONDE SALE CADA ESCALON
--------------------------
Tres fuentes, en este orden de preferencia:

  1. doc1      documentos de una sola linea -> total/cantidad da el costo
               exacto, con todos sus decimales, ya en la unidad del movimiento.
               Comprobado con TRA 202605001705: 24.000 g por $21,60 = $0,000900,
               identico a lo que muestra Contifico en pantalla.
  2. factura   fact_detallada_compras. NO se usa el precio de la linea: se usa
               el TOTAL de la factura partido para la cantidad que entro a
               bodega ese dia. El precio miente sobre la unidad -la misma
               tarrina se factura a 0,050400 por unidad y a 5,040000 el paquete
               de cien, y el kilo de pimiento aparece como 0,90 cuando el
               inventario se mueve en gramos-. El total no miente, y la
               cantidad del ingreso viene ya en la unidad del inventario, asi
               que el cociente cae solo donde debe.
  3. promedio  costo_promedio cuando llega >= 0,01. Redondeado, pero para un
               producto que vale $1,03 la unidad el error es del 0,5%.

Aun asi la factura se valida antes de usarse: si para ese producto ya hay
observaciones exactas y el resultado se aleja mas de 10 veces de ellas, se
descarta la fuente entera para ese producto y se avisa.

QUE DEJA
--------
  costo_observacion        cada observacion suelta, con su fuente. La usa el
                           detector de variaciones: son los datos crudos.
  costo_vigente_producto   los tramos ya armados: de tal fecha a tal fecha,
                           este producto valia esto. Es contra esto que se
                           valoriza cada movimiento.

    python costo_vigente.py              <- reconstruye desde el 1-ene-2026
    python costo_vigente.py --desde AAAA-MM-DD
"""
import os
import sys
from datetime import date

import psycopg2

DESDE_DEFECTO = date(2026, 1, 1)

# Cuanto puede alejarse el costo sacado de la factura de las observaciones
# exactas antes de darlo por malo.
TOPE_DESVIO_FACTURA = 10.0

# Un tramo cuyo costo se aleja tanto de la mediana del producto queda marcado:
# se usa igual para valorizar, pero el tablero puede mostrarlo como dudoso.
TOPE_CONFIANZA = 5.0

# Cuanto puede alejarse UNA observacion de la mediana de su propio producto
# antes de darla por imposible. Un precio real rara vez se multiplica por diez.
TOPE_ATIPICA = 10.0

SQL_CREAR = """
CREATE TABLE IF NOT EXISTS costo_observacion (
    producto_id text    NOT NULL,
    fecha       date    NOT NULL,
    costo       numeric(20,8) NOT NULL,
    fuente      text    NOT NULL,
    prioridad   int     NOT NULL,
    PRIMARY KEY (producto_id, fecha, fuente)
);
CREATE INDEX IF NOT EXISTS ix_cobs_prod ON costo_observacion (producto_id, fecha);

CREATE TABLE IF NOT EXISTS costo_vigente_producto (
    producto_id text    NOT NULL,
    codigo_prod text,
    desde       date    NOT NULL,
    hasta       date    NOT NULL,
    costo       numeric(20,8) NOT NULL,
    fuente      text    NOT NULL,
    confianza   text    NOT NULL DEFAULT 'alta',
    PRIMARY KEY (producto_id, desde)
);
CREATE INDEX IF NOT EXISTS ix_cvig_rango ON costo_vigente_producto (producto_id, desde, hasta);
"""

# --- Fuente 1: documentos de una sola linea -------------------------------
# El DISTINCT ON quita las reinserciones de la sincronizacion: el mismo
# documento vuelve a entrar con un movimiento_id nuevo en cada corrida.
SQL_DOC1 = """
INSERT INTO costo_observacion (producto_id, fecha, costo, fuente, prioridad)
WITH d AS (
    SELECT DISTINCT ON (m.codigo, m.producto_id)
           m.codigo, m.fecha, m.producto_id, m.cantidad, m.total_movimiento
    FROM contifico_movimientos m
    WHERE m.fecha >= %(desde)s AND m.cantidad > 0
    ORDER BY m.codigo, m.producto_id, m.id
),
doc AS (SELECT codigo, count(*) AS n FROM d GROUP BY codigo)
-- Un producto puede tener varios documentos de una linea el mismo dia. Se
-- toma la mediana: si uno de ellos vino con el costo mal, no arrastra al dia.
SELECT d.producto_id, d.fecha,
       percentile_cont(0.5) WITHIN GROUP
           (ORDER BY d.total_movimiento / d.cantidad)::numeric(20,8), 'doc1', 1
FROM d JOIN doc ON doc.codigo = d.codigo
WHERE doc.n = 1 AND d.total_movimiento > 0
GROUP BY d.producto_id, d.fecha
ON CONFLICT (producto_id, fecha, fuente) DO UPDATE SET costo = EXCLUDED.costo
"""

# --- Fuente 2: la factura de compra ---------------------------------------
# Total pagado / cantidad que entro. Nunca el precio de la linea: la tarrina
# DEAL057 se facturo cuatro veces como "1 x 5,040000" -el paquete- mientras
# la bodega recibia 100 unidades. Tomando el precio salia a 5,04 cada una,
# cien veces de mas, y el tablero lo mostraba como un desfase del 9100%.
SQL_FACTURA = """
INSERT INTO costo_observacion (producto_id, fecha, costo, fuente, prioridad)
WITH mov AS (
    SELECT DISTINCT ON (m.codigo, m.producto_id, m.cantidad,
                        m.bodega_origen_id, m.fecha)
           m.fecha, m.producto_id, m.cantidad
    FROM contifico_movimientos m
    WHERE m.fecha >= %(desde)s AND m.tipo = 'ING' AND m.cantidad > 0
    ORDER BY m.codigo, m.producto_id, m.cantidad, m.bodega_origen_id,
             m.fecha, m.id
),
-- Lo que entro de ese producto ese dia, en la unidad del inventario.
entrada AS (
    SELECT producto_id, fecha, sum(cantidad) AS qty FROM mov GROUP BY 1, 2
),
-- Lo que se pago por el, sumando las lineas que le correspondan.
gasto AS (
    SELECT p.id AS producto_id, f.fecha, sum(f.cantidad * f.precio) AS total
    FROM fact_detallada_compras f
    JOIN contifico_productos p ON p.codigo = f.cod_producto_cuenta
    WHERE f.fecha >= %(desde)s AND f.precio > 0 AND f.cantidad > 0
    GROUP BY 1, 2
)
SELECT g.producto_id, g.fecha, (g.total / e.qty)::numeric(20,8), 'factura', 2
FROM gasto g
JOIN entrada e ON e.producto_id = g.producto_id AND e.fecha = g.fecha
WHERE e.qty > 0 AND g.total > 0
ON CONFLICT (producto_id, fecha, fuente) DO UPDATE SET costo = EXCLUDED.costo
"""

# --- Fuente 3: costo_promedio cuando tiene decimales que sirvan -----------
SQL_PROMEDIO = """
INSERT INTO costo_observacion (producto_id, fecha, costo, fuente, prioridad)
SELECT producto_id, fecha, max(costo_promedio)::numeric(20,8), 'promedio', 3
FROM contifico_movimientos
WHERE fecha >= %(desde)s AND coalesce(costo_promedio, 0) >= 0.01
GROUP BY producto_id, fecha
ON CONFLICT (producto_id, fecha, fuente) DO UPDATE SET costo = EXCLUDED.costo
"""

# Facturas cuyo precio convertido no se parece a lo que dicen las lineas
# exactas del mismo producto. Casi siempre significa que el factor de unidad
# esta mal para ese producto.
SQL_FACTURA_SOSPECHOSA = """
WITH exacto AS (
    SELECT producto_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY costo) AS med
    FROM costo_observacion WHERE fuente = 'doc1' GROUP BY producto_id
),
fac AS (
    SELECT producto_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY costo) AS med
    FROM costo_observacion WHERE fuente = 'factura' GROUP BY producto_id
)
SELECT f.producto_id, p.codigo, p.nombre, e.med, f.med
FROM fac f JOIN exacto e USING (producto_id)
LEFT JOIN contifico_productos p ON p.id = f.producto_id
WHERE e.med > 0 AND f.med > 0
  AND (f.med / e.med > %(tope)s OR e.med / f.med > %(tope)s)
"""

# Observaciones sueltas que se salen de toda escala respecto al propio
# producto. La guarda anterior comparaba MEDIANAS por producto, asi que un dia
# malo entre veinte buenos pasaba sin que nadie lo viera:
#
#   BMP003 JARABE SPRITE  la factura del 21-ago se dividio para un ingreso de
#                         ~1 unidad y dio 51,483 el mililitro, contra los
#                         0,005110 que vale. El tablero lo mostraba como un
#                         desfase del millon por ciento y $186.555 de daño.
#   EMB002 TOCINO         entra unos dias en unidades (8, 1, 6) y otros en
#                         gramos (4000). Dividir por la cantidad equivocada da
#                         3,95 contra los 0,085 reales.
#
# La mediana aguanta que una minoria de observaciones sea basura, asi que
# sirve de ancla para descartarlas una por una.
#
# Pero solo se tocan factura y promedio, NUNCA doc1. doc1 sale del movimiento
# mismo -total del documento partido para su unica linea-, asi que es exacto
# por construccion: si dice que un producto costo cien veces mas, eso paso de
# verdad y es justo el desfase que hay que mostrar. Tapar eso seria esconder
# el hallazgo. Los descuadres de unidad viven en la factura, que es otro
# sistema y no sabe en que unidad mueve el inventario.
SQL_ATIPICAS = """
WITH med AS (
    SELECT producto_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY costo) AS m
    FROM costo_observacion GROUP BY producto_id
)
DELETE FROM costo_observacion o USING med
WHERE med.producto_id = o.producto_id AND med.m > 0
  AND o.fuente <> 'doc1'
  AND (o.costo / med.m > %(tope)s OR med.m / o.costo > %(tope)s)
RETURNING o.producto_id, o.fecha, o.costo, o.fuente, med.m
"""

SQL_TRAMOS = """
INSERT INTO costo_vigente_producto (producto_id, codigo_prod, desde, hasta, costo, fuente)
WITH mejor AS (
    SELECT DISTINCT ON (producto_id, fecha) producto_id, fecha, costo, fuente
    FROM costo_observacion
    ORDER BY producto_id, fecha, prioridad
)
SELECT m.producto_id, p.codigo, m.fecha,
       coalesce(lead(m.fecha) OVER w - 1, DATE '9999-12-31'),
       m.costo, m.fuente
FROM mejor m
LEFT JOIN contifico_productos p ON p.id = m.producto_id
WINDOW w AS (PARTITION BY m.producto_id ORDER BY m.fecha)
"""

# El primer tramo se estira hacia atras: un movimiento anterior a la primera
# observacion se valoriza con ella y no se queda sin costo.
SQL_BACKFILL = """
UPDATE costo_vigente_producto v SET desde = DATE '2000-01-01'
WHERE v.desde = (SELECT min(desde) FROM costo_vigente_producto x
                 WHERE x.producto_id = v.producto_id)
"""

# Un mismo costo visto por dos fuentes distintas no es un cambio de costo.
# doc1 dice 0,052341 y promedio dice 0,05: es el mismo precio, redondeado. Sin
# esto el tablero mostraria un cambio de costo cada vez que alterna la fuente.
#
# La tolerancia depende de la fuente, y esto importa: el medio centavo del
# redondeo solo existe en costo_promedio. Aplicarlo a todos borraba cambios de
# precio de verdad -la tarrina paso de 0,054783 a 0,050400, ocho por ciento
# menos, y como la diferencia no llegaba a medio centavo los tramos se fundian
# y el costo se quedaba congelado-. Entre fuentes exactas basta con absorber el
# ruido de los decimales: medio por ciento.
SQL_COMPACTAR = """
CREATE TEMP TABLE cv_unido AS
WITH ord AS (
    SELECT producto_id, codigo_prod, desde, hasta, costo, fuente, confianza,
           lag(costo)  OVER w AS previo,
           lag(fuente) OVER w AS fuente_previa
    FROM costo_vigente_producto
    WINDOW w AS (PARTITION BY producto_id ORDER BY desde)
),
marca AS (
    SELECT *, CASE WHEN previo IS NULL
                    OR abs(costo - previo) > CASE
                           WHEN fuente = 'promedio' OR fuente_previa = 'promedio'
                                THEN greatest(0.005, 0.02 * previo)
                           ELSE 0.005 * previo
                       END
                   THEN 1 ELSE 0 END AS arranca
    FROM ord
),
grupo AS (
    SELECT *, sum(arranca) OVER (PARTITION BY producto_id ORDER BY desde) AS g
    FROM marca
)
SELECT producto_id,
       min(codigo_prod)                                  AS codigo_prod,
       min(desde)                                        AS desde,
       max(hasta)                                        AS hasta,
       (array_agg(costo  ORDER BY desde))[1]             AS costo,
       -- se queda con la fuente mas fiable que respalda el tramo
       min(fuente)                                       AS fuente,
       min(confianza)                                    AS confianza
FROM grupo GROUP BY producto_id, g
"""

SQL_CONFIANZA = """
WITH med AS (
    SELECT producto_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY costo) AS m
    FROM costo_vigente_producto GROUP BY producto_id
)
UPDATE costo_vigente_producto v
SET confianza = CASE
        WHEN v.fuente = 'promedio' THEN 'media'
        WHEN med.m > 0 AND (v.costo / med.m > %(tope)s OR med.m / v.costo > %(tope)s)
             THEN 'baja'
        ELSE 'alta' END
FROM med WHERE med.producto_id = v.producto_id
"""


def conectar():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
        dbname='movimientos',
        user=os.environ.get('DB_USER', 'adminChios'),
        password=os.environ.get('DB_PASSWORD', 'Burger2023'),
        port=os.environ.get('DB_PORT', '5432'),
        sslmode='require', connect_timeout=30,
        keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5,
    )


def miles(n):
    return f'{n:,}'.replace(',', '.')


def construir(cur, desde, log=print):
    p = {'desde': desde}
    cur.execute(SQL_CREAR)
    cur.execute("DELETE FROM costo_observacion WHERE fecha >= %(desde)s", p)

    log('  Fuente 1/3  documentos de una sola linea...')
    cur.execute(SQL_DOC1, p)
    log('              %s observaciones exactas' % miles(cur.rowcount))

    log('  Fuente 2/3  facturas de compra...')
    cur.execute(SQL_FACTURA, p)
    log('              %s observaciones' % miles(cur.rowcount))

    cur.execute(SQL_FACTURA_SOSPECHOSA, {'tope': TOPE_DESVIO_FACTURA})
    malas = cur.fetchall()
    if malas:
        log('              %d producto(s) con la factura fuera de escala, se descartan:'
            % len(malas))
        for _, cod, nom, exa, fac in malas[:10]:
            log('                %-10s %-30s exacto %.6f  factura %.6f'
                % (cod or '?', (nom or '')[:30], exa, fac))
        cur.execute("DELETE FROM costo_observacion WHERE fuente='factura' "
                    "AND producto_id = ANY(%s)", ([m[0] for m in malas],))
        log('              %s observaciones descartadas' % miles(cur.rowcount))

    log('  Fuente 3/3  costo_promedio con decimales utiles...')
    cur.execute(SQL_PROMEDIO, p)
    log('              %s observaciones' % miles(cur.rowcount))

    # costo_promedio solo sirve donde no hay nada mejor, y la decision es POR
    # PRODUCTO, no por fecha. Mezclarlos dentro de un mismo producto inventa
    # caidas del 99%: los patacones pasaban de 0,350000 -leido de un
    # costo_promedio redondeado- a 0,001914 -el costo real por gramo-, y el
    # tablero lo mostraba como si el precio se hubiera desplomado.
    cur.execute("""
        DELETE FROM costo_observacion o
        WHERE o.fuente = 'promedio'
          AND EXISTS (SELECT 1 FROM costo_observacion x
                      WHERE x.producto_id = o.producto_id
                        AND x.fuente IN ('doc1', 'factura'))
    """)
    log('              %s descartadas: ese producto ya tiene fuente exacta'
        % miles(cur.rowcount))

    cur.execute(SQL_ATIPICAS, {'tope': TOPE_ATIPICA})
    raras = cur.fetchall()
    if raras:
        log('  %s observacion(es) fuera de toda escala, descartadas:' % miles(len(raras)))
        cur.execute("""SELECT id::text, codigo, nombre FROM contifico_productos
                       WHERE id::text = ANY(%s)""",
                    ([str(r[0]) for r in raras],))
        nom = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        for pid, fecha, costo, fuente, m in raras[:12]:
            cod, nm = nom.get(str(pid), ('?', ''))
            log('    %-10s %-26s %s  %.6f  contra %.6f  (%s)'
                % (cod, (nm or '')[:26], fecha, costo, m, fuente))

    log('  Armando los tramos...')
    cur.execute("TRUNCATE costo_vigente_producto")
    cur.execute(SQL_TRAMOS)
    crudos = cur.rowcount
    cur.execute(SQL_BACKFILL)

    cur.execute("DROP TABLE IF EXISTS cv_unido")
    cur.execute(SQL_COMPACTAR)
    cur.execute("TRUNCATE costo_vigente_producto")
    cur.execute("""INSERT INTO costo_vigente_producto
                       (producto_id, codigo_prod, desde, hasta, costo, fuente, confianza)
                   SELECT producto_id, codigo_prod, desde, hasta, costo, fuente, confianza
                   FROM cv_unido""")
    tramos = cur.rowcount
    cur.execute("DROP TABLE IF EXISTS cv_unido")

    cur.execute(SQL_CONFIANZA, {'tope': TOPE_CONFIANZA})
    log('  %s tramos (%s antes de unir los que son el mismo precio)'
        % (miles(tramos), miles(crudos)))
    return tramos


def main():
    desde = DESDE_DEFECTO
    if '--desde' in sys.argv:
        desde = date.fromisoformat(sys.argv[sys.argv.index('--desde') + 1])

    conn = conectar()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '1800s'")

    print('=' * 70)
    print('  COSTO UNITARIO VIGENTE  -  desde el %s' % desde)
    print('=' * 70)
    construir(cur, desde)

    print()
    print('  COMO QUEDO')
    cur.execute("""SELECT fuente, count(*), count(DISTINCT producto_id)
                   FROM costo_vigente_producto GROUP BY 1 ORDER BY 2 DESC""")
    print('    %-10s %10s %10s' % ('fuente', 'tramos', 'productos'))
    for f, n, pr in cur.fetchall():
        print('    %-10s %10s %10s' % (f, miles(n), miles(pr)))

    cur.execute("""SELECT confianza, count(*) FROM costo_vigente_producto
                   GROUP BY 1 ORDER BY 2 DESC""")
    print('    confianza:', dict(cur.fetchall()))

    cur.execute("""SELECT count(DISTINCT m.producto_id)
                   FROM contifico_movimientos m
                   WHERE m.fecha >= current_date - 90 AND m.tipo = 'EGR'
                     AND NOT EXISTS (SELECT 1 FROM costo_vigente_producto v
                                     WHERE v.producto_id = m.producto_id)""")
    print('    productos con salida y SIN costo:', cur.fetchone()[0])

    print()
    print('  PRUEBA  VER009 PIMIENTO VERDE (Contifico muestra $0,000900 el gramo)')
    cur.execute("""SELECT v.desde, v.hasta, v.costo, v.fuente, v.confianza
                   FROM costo_vigente_producto v
                   WHERE v.codigo_prod = 'VER009' ORDER BY v.desde DESC LIMIT 6""")
    for r in cur.fetchall():
        print('    %s a %s  %.8f  %-9s %s' % r)

    cur.close()
    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
