# -*- coding: utf-8 -*-
"""
Prueba de paridad del modulo Toma de locales.

Compara los helpers de formato de toma_locales.py contra filas REALES escritas
por el API viejo (inventario-chiosburger-api). Si algo aqui falla, el modulo
nuevo escribiria distinto y el cruce operativo, el worker de Contifico o los
informes verian datos que no reconocen.

No escribe nada: solo lee. Se puede correr cuantas veces haga falta.

    python scripts/verificar_paridad_toma.py

Esta prueba ya encontro un bug real: el id lleva el numero de bodega pegado al
codigo del producto ('260918-1ALI006+...') y la primera version del modulo lo
omitia. Por eso existe.
"""
import io
import importlib.util
import os
import sys
from decimal import Decimal

import psycopg2

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

AQUI = os.path.dirname(os.path.abspath(__file__))
MODULO = os.path.join(os.path.dirname(AQUI), 'toma_locales.py')

DB = dict(
    host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
    database=os.environ.get('DB_NAME', 'InventariosLocales'),
    user=os.environ.get('DB_USER', 'adminChios'),
    password=os.environ.get('DB_PASSWORD', 'Burger2023'),
    sslmode='require',
    connect_timeout=20,
)

_spec = importlib.util.spec_from_file_location('toma_locales', MODULO)
tl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tl)

ok = 0
fallas = []


def chk(nombre, esperado, obtenido):
    global ok
    if esperado == obtenido:
        ok += 1
        print("   OK    %-22s %r" % (nombre, obtenido))
    else:
        fallas.append(nombre)
        print("   FALLA %-22s esperado=%r obtenido=%r" % (nombre, esperado, obtenido))


def main():
    conn = psycopg2.connect(**DB)
    cur = conn.cursor()

    print("1) id, cantidades y total contra filas reales\n")
    for clave in ('bodega_principal', 'materia_prima', 'planta',
                  'simon_bolon', 'santo_cachon'):
        cfg = tl.BODEGAS[clave]
        # La columna de capturas cambia de nombre segun la forma de la tabla:
        # 'cantidades' en toma_bodega/materiaprima/planta, 'cantidad' en
        # santo_cachon/simon_bolon. Leerla mal aborta con UndefinedColumn.
        cant = tl.COL_CANTIDADES[cfg['forma']]
        # Se piden a proposito filas normales Y filas raras (texto 'INACTIVO',
        # total NULL, ranuras vacias): son las que rompen una implementacion
        # ingenua, y son miles en la base.
        cur.execute(
            "SELECT id, codigo, fecha, %s, total FROM %s "
            "WHERE fecha >= current_date - 120 "
            "ORDER BY (total IS NULL) DESC, %s LIMIT 4"
            % (cant, cfg['tabla'], cant))
        filas = cur.fetchall()
        if not filas:
            print("   --    %-22s (sin datos recientes)" % clave)
            continue
        for id_real, codigo, fecha, cant_real, total_real in filas:
            # El sufijo del id es el timestamp de la sesion; va despues del
            # ULTIMO '+', porque las cantidades tambien usan ese separador.
            sesion = id_real.rsplit('+', 1)[1]
            chk("id %s" % clave, id_real, tl._id_fila(fecha, cfg['id'], codigo, sesion))

            if cant_real is None:
                continue
            # Se parte SIN filtrar: las ranuras vacias son significativas.
            capturas = cant_real.split('+')
            chk("cantidades", cant_real, tl._cantidades_txt(capturas))

            calculado = tl._total(capturas)
            if total_real is None:
                # Fila con 'INACTIVO' u otro texto: el API viejo deja total NULL.
                chk("total (NULL)", None, calculado)
            else:
                esperado = Decimal(str(total_real))
                chk("total", esperado,
                    None if calculado is None else calculado.quantize(esperado))

    print("\n1-bis) codtomas de tomasFisicas usa el MISMO formato de id\n")
    # Se escribia solo el timestamp ahi, y el historico agrupaba una "toma"
    # por producto. Esta comprobacion existe por ese fallo.
    for clave in ('floreana', 'real_audiencia', 'portugal'):
        cfg = tl.BODEGAS[clave]
        cur.execute('''SELECT codtomas, cod_prod, fecha FROM public."tomasFisicas"
                       WHERE local = %s ORDER BY fecha DESC LIMIT 1''', (cfg['local'],))
        r = cur.fetchone()
        if not r:
            print("   --    %-22s (sin datos)" % clave)
            continue
        codtomas, cod_prod, fecha_txt = r
        from datetime import datetime as _dt
        f = _dt.strptime(fecha_txt, '%Y-%m-%d').date()
        sesion = codtomas.rsplit('+', 1)[1]
        chk("codtomas %s" % clave, codtomas,
            tl._id_fila(f, cfg['id'], cod_prod, sesion))

    print("\n2) String de usuario por bodega\n")
    for clave, cfg in tl.BODEGAS.items():
        if not cfg.get('usuario'):
            continue
        cur.execute("SELECT usuario FROM %s WHERE usuario IS NOT NULL "
                    "ORDER BY fecha DESC LIMIT 1" % cfg['tabla'])
        r = cur.fetchone()
        if r:
            chk(clave, r[0], cfg['usuario'])
        else:
            print("   --    %-22s (sin datos)" % clave)

    print("\n3) Columnas del INSERT existen, por forma de tabla\n")
    # Una lista por forma. Las tres son distintas y confundirlas es el error
    # que esta prueba existe para atrapar.
    POR_FORMA = {
        'a': {'id', 'codigo', 'producto', 'fecha', 'usuario', 'cantidades',
              'total', 'unidad', 'categoria', 'Tipo A,B o C'},
        'b': {'id', 'fecha', 'usuario', 'codigo', 'producto', 'cantidad',
              'total', 'uni_local', 'cant_pedir', 'uni_bod',
              'categoria', 'Tipo A,B o C'},
        'tf': {'fecha', 'codtomas', 'cod_prod', 'productos', 'unidad', 'cantidad',
               'anotaciones', 'local', 'cantidadSolicitada', 'uni_bod',
               'categoria', 'Tipo A,B o C'},
    }
    vistas = set()
    for clave, cfg in tl.BODEGAS.items():
        tabla = cfg['tabla'].replace('public.', '').replace('"', '')
        if tabla in vistas:
            continue
        vistas.add(tabla)
        cur.execute("""SELECT column_name FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = %s""", (tabla,))
        cols = {x[0] for x in cur.fetchall()}
        necesarias = POR_FORMA[cfg['forma']]
        falta = necesarias - cols
        if falta:
            fallas.append(tabla)
            print("   FALLA %-22s faltan: %s" % (tabla, sorted(falta)))
        else:
            globals()['ok'] += 1
            print("   OK    %-22s las %d columnas existen" % (tabla, len(necesarias)))

    cur.close()
    conn.close()

    print("\n=== %d comprobaciones OK, %d fallas ===" % (ok, len(fallas)))
    if fallas:
        print("Fallaron:", ", ".join(sorted(set(fallas))))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
