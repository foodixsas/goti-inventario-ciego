# -*- coding: utf-8 -*-
"""
Respaldo de las tomas recientes, ANTES de probar el modulo Toma de Locales.

Por que existe: al probar la captura se escriben filas reales en las mismas
tablas que usa la operacion. Si algo sale mal, o si hay que distinguir lo de
prueba de lo bueno, este respaldo es la unica forma de volver atras sin
adivinar.

Genera dos archivos por corrida:

  BACKUP_TOMAS_<dias>d_<AAAAMMDD_HHMM>.csv   legible, para abrir y comparar
  BACKUP_TOMAS_<dias>d_<AAAAMMDD_HHMM>.sql   INSERTs listos para restaurar

Uso:
    python scripts/backup_tomas.py            # ultimos 30 dias
    python scripts/backup_tomas.py 60         # ultimos 60 dias

El .sql NO lleva DELETE: restaurar es insertar lo que falte, nunca borrar lo
que haya. Si hiciera falta reemplazar, se borra a mano y con criterio -- esa
decision no la toma un script.
"""
import csv
import io
import os
import sys
from datetime import datetime, timedelta

import psycopg2
from psycopg2.extras import RealDictCursor

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

DB = dict(
    host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
    database=os.environ.get('DB_NAME', 'InventariosLocales'),
    user=os.environ.get('DB_USER', 'adminChios'),
    password=os.environ.get('DB_PASSWORD', 'Burger2023'),
    sslmode='require',
    connect_timeout=30,
)

# (clave, tabla, columna_local)  -- el local solo aplica a tomasFisicas
TABLAS = [
    ('bodega_principal', 'public.toma_bodega',        None),
    ('materia_prima',    'public.toma_materiaprima',  None),
    ('planta',           'public.toma_planta',        None),
    ('simon_bolon',      'public.toma_simon_bolon',   None),
    ('santo_cachon',     'public.toma_santo_cachon',  None),
    ('bodega_pulmon',    'public.toma_bodegapulmon',  None),
    ('real_audiencia',   'public."tomasFisicas"',     'Real Audiencia'),
    ('floreana',         'public."tomasFisicas"',     'Floreana'),
    ('portugal',         'public."tomasFisicas"',     'Portugal'),
    ('santo_chios',      'public."tomasFisicas"',     'Santo Chios'),
]

DESTINO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def sql_valor(v):
    """Literal SQL. None -> NULL; el resto entre comillas, escapadas."""
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def main():
    dias = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    corte = (datetime.now().date() - timedelta(days=dias)).strftime('%Y-%m-%d')
    sello = datetime.now().strftime('%Y%m%d_%H%M')
    base = os.path.join(DESTINO, 'BACKUP_TOMAS_%dd_%s' % (dias, sello))

    conn = psycopg2.connect(cursor_factory=RealDictCursor, **DB)
    cur = conn.cursor()

    total = 0
    resumen = []
    f_csv = io.open(base + '.csv', 'w', encoding='utf-8-sig', newline='')
    w = csv.writer(f_csv, delimiter=';')
    w.writerow(['bodega', 'tabla', 'fecha', 'id', 'codigo', 'producto',
                'cantidades', 'total', 'unidad', 'uni_bod', 'cant_pedir',
                'categoria', 'tipo_abc', 'usuario'])

    f_sql = io.open(base + '.sql', 'w', encoding='utf-8')
    f_sql.write('-- Respaldo de tomas, ultimos %d dias (desde %s)\n' % (dias, corte))
    f_sql.write('-- Generado %s\n' % datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    f_sql.write('-- Restaurar: ejecutar este archivo. NO borra nada, solo inserta.\n\n')

    for clave, tabla, local in TABLAS:
        # Cada forma de tabla tiene sus propios nombres de columna; se
        # normalizan aqui para que el CSV sea comparable entre bodegas.
        if local:
            sel = ('SELECT fecha::text AS fecha, codtomas AS id, cod_prod AS codigo, '
                   'productos AS producto, cantidad AS cantidades, '
                   'cantidad AS total, unidad, uni_bod, '
                   '"cantidadSolicitada" AS cant_pedir, categoria, '
                   '"Tipo A,B o C" AS tipo_abc, NULL::varchar AS usuario, '
                   'anotaciones '
                   'FROM %s WHERE local = %%s AND fecha >= %%s ORDER BY fecha, cod_prod' % tabla)
            cur.execute(sel, (local, corte))
        elif clave in ('simon_bolon', 'santo_cachon'):
            sel = ('SELECT fecha::text AS fecha, id, codigo, producto, '
                   'cantidad AS cantidades, total, uni_local AS unidad, uni_bod, '
                   'cant_pedir::text AS cant_pedir, categoria, '
                   '"Tipo A,B o C" AS tipo_abc, usuario '
                   'FROM %s WHERE fecha >= %%s ORDER BY fecha, codigo' % tabla)
            cur.execute(sel, (corte,))
        else:
            sel = ('SELECT fecha::text AS fecha, id, codigo, producto, cantidades, '
                   'total, unidad, NULL::varchar AS uni_bod, '
                   'NULL::text AS cant_pedir, categoria, '
                   '"Tipo A,B o C" AS tipo_abc, usuario '
                   'FROM %s WHERE fecha >= %%s ORDER BY fecha, codigo' % tabla)
            cur.execute(sel, (corte,))

        filas = cur.fetchall()
        if not filas:
            resumen.append((clave, 0, '-'))
            continue

        fechas = sorted({f['fecha'] for f in filas})
        resumen.append((clave, len(filas), '%s a %s' % (fechas[0], fechas[-1])))
        total += len(filas)

        for f in filas:
            w.writerow([clave, tabla, f['fecha'], f['id'], f['codigo'], f['producto'],
                        f['cantidades'], f['total'], f['unidad'], f['uni_bod'],
                        f['cant_pedir'], f['categoria'], f['tipo_abc'], f['usuario']])

        # INSERT con los nombres REALES de cada tabla, no los normalizados:
        # el .sql tiene que poder ejecutarse tal cual.
        f_sql.write('\n-- %s  (%d filas)\n' % (clave, len(filas)))
        for f in filas:
            if local:
                f_sql.write(
                    'INSERT INTO public."tomasFisicas" (fecha, codtomas, cod_prod, '
                    'productos, unidad, cantidad, anotaciones, local, '
                    '"cantidadSolicitada", uni_bod, categoria, "Tipo A,B o C") VALUES '
                    '(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);\n' % (
                        sql_valor(f['fecha']), sql_valor(f['id']), sql_valor(f['codigo']),
                        sql_valor(f['producto']), sql_valor(f['unidad']),
                        sql_valor(f['cantidades']), sql_valor(f.get('anotaciones')),
                        sql_valor(local), sql_valor(f['cant_pedir']),
                        sql_valor(f['uni_bod']), sql_valor(f['categoria']),
                        sql_valor(f['tipo_abc'])))
            elif clave in ('simon_bolon', 'santo_cachon'):
                f_sql.write(
                    'INSERT INTO %s (id, fecha, usuario, codigo, producto, cantidad, '
                    'total, uni_local, cant_pedir, uni_bod, categoria, "Tipo A,B o C") '
                    'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);\n' % (
                        tabla,
                        sql_valor(f['id']), sql_valor(f['fecha']), sql_valor(f['usuario']),
                        sql_valor(f['codigo']), sql_valor(f['producto']),
                        sql_valor(f['cantidades']),
                        'NULL' if f['total'] is None else str(f['total']),
                        sql_valor(f['unidad']), sql_valor(f['cant_pedir']),
                        sql_valor(f['uni_bod']), sql_valor(f['categoria']),
                        sql_valor(f['tipo_abc'])))
            else:
                f_sql.write(
                    'INSERT INTO %s (id, codigo, producto, fecha, usuario, cantidades, '
                    'total, unidad, categoria, "Tipo A,B o C") '
                    'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);\n' % (
                        tabla,
                        sql_valor(f['id']), sql_valor(f['codigo']), sql_valor(f['producto']),
                        sql_valor(f['fecha']), sql_valor(f['usuario']),
                        sql_valor(f['cantidades']),
                        'NULL' if f['total'] is None else str(f['total']),
                        sql_valor(f['unidad']), sql_valor(f['categoria']),
                        sql_valor(f['tipo_abc'])))

    f_csv.close()
    f_sql.close()
    cur.close()
    conn.close()

    print('RESPALDO DE TOMAS -- ultimos %d dias (desde %s)\n' % (dias, corte))
    print('%-18s %8s  %s' % ('BODEGA', 'FILAS', 'RANGO'))
    for clave, n, rango in resumen:
        print('%-18s %8d  %s' % (clave, n, rango))
    print('\n%-18s %8d filas en total' % ('TOTAL', total))
    print('\nArchivos:')
    for ext in ('.csv', '.sql'):
        p = base + ext
        print('  %s  (%.1f KB)' % (os.path.basename(p), os.path.getsize(p) / 1024.0))
    print('\nCarpeta: %s' % DESTINO)
    return 0


if __name__ == '__main__':
    sys.exit(main())
