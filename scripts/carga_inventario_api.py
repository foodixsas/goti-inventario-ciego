"""Carga de inventario por API de Contifico — version para GitHub Actions.

Toda la configuracion entra por variables de entorno; no hay credenciales en el codigo.

  CONTIFICO_API_KEY                        (obligatoria)
  DB_HOST / DB_NAME / DB_USER / DB_PASSWORD (obligatorias)
  FECHA        YYYY-MM-DD   (vacio = hoy en Ecuador)
  ESCRIBIR     '1' para cargar de verdad; cualquier otra cosa = simulacion

La conexion a la BD se abre SOLO para leer al inicio y para escribir al final.
Durante las llamadas a Contifico (varios minutos) queda cerrada, para no dejar
una transaccion colgada que ponga lenta la aplicacion.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras

API = os.environ.get('CONTIFICO_API_KEY')
ESCRIBIR = os.environ.get('ESCRIBIR') == '1'

ECUADOR = timezone(timedelta(hours=-5))
FECHA = os.environ.get('FECHA') or datetime.now(ECUADOR).strftime('%Y-%m-%d')

BODEGAS = {
    'real_audiencia':        ('CHIOS',       'BODEGA CHIOS REAL'),
    'floreana':              ('CHIOS',       'BODEGA CHIOS FLOREANA'),
    'portugal':              ('CHIOS',       'BODEGA CHIOS PORTUGAL'),
    'santo_cachon_real':     ('CACHON',      'BODEGA SANTO CACHON REAL'),
    'santo_cachon_portugal': ('CACHON',      'BODEGA SANTO CACHON PORTUGAL'),
    'simon_bolon':           ('SIMON_BOLON', 'BODEGA SIMON BOLON'),
}


def env(n):
    v = os.environ.get(n)
    if not v:
        sys.exit(f"::error::Falta la variable {n}")
    return v


def conectar():
    return psycopg2.connect(host=env('DB_HOST'), dbname=env('DB_NAME'),
                            user=env('DB_USER'), password=env('DB_PASSWORD'),
                            port=5432, sslmode='require', connect_timeout=30,
                            cursor_factory=psycopg2.extras.RealDictCursor)


def api(ruta):
    req = urllib.request.Request('https://api.contifico.com' + ruta,
                                 headers={'Authorization': API, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def resumen(txt):
    ruta = os.environ.get('GITHUB_STEP_SUMMARY')
    if ruta:
        with open(ruta, 'a', encoding='utf-8') as f:
            f.write(txt + '\n')


def main():
    if not API:
        sys.exit("::error::Falta CONTIFICO_API_KEY")

    inicio = datetime.now(ECUADOR)
    modo = "CARGA REAL" if ESCRIBIR else "SIMULACION (no escribe)"
    print(f"Arranque automatico: {inicio:%Y-%m-%d %H:%M:%S} Ecuador")
    print(f"Fecha objetivo: {FECHA}   |   Modo: {modo}\n")

    # ---------- lectura inicial ----------
    con = conectar()
    cur = con.cursor()
    cur.execute("""SELECT local, COUNT(cantidad_contada) c1, COUNT(cantidad_contada_2) c2
                   FROM goti.inventario_ciego_conteos
                   WHERE fecha=%s AND local = ANY(%s) GROUP BY local""",
                (FECHA, list(BODEGAS)))
    for r in cur.fetchall():
        if r['c1'] or r['c2']:
            sys.exit(f"::error::{r['local']} ya tiene conteos para {FECHA}. Abortado.")

    por_bodega, codigos = {}, set()
    for bod, (marca, _) in BODEGAS.items():
        cur.execute("""SELECT codigo, nombre, unidad FROM goti.productos_por_marca
                       WHERE marca=%s AND activo=TRUE ORDER BY codigo""", (marca,))
        por_bodega[bod] = cur.fetchall()
        codigos |= {p['codigo'] for p in por_bodega[bod]}
    con.close()
    print(f"Conexion cerrada. Productos distintos a consultar: {len(codigos)}\n")

    # ---------- Contifico (sin conexion a la BD abierta) ----------
    t0 = time.time()
    mapa, url = {}, '/sistema/api/v2/producto/'
    while url:
        d = api(url)
        for p in d['results']:
            if p.get('codigo'):
                mapa[p['codigo']] = p['id']
        url = (d.get('next') or '').replace('https://api.contifico.com', '') or None
    print(f"Catalogo: {len(mapa)} productos en {time.time()-t0:.0f}s")

    t0, stock, sin_id = time.time(), {}, []
    for i, cod in enumerate(sorted(codigos), 1):
        pid = mapa.get(cod)
        if not pid:
            sin_id.append(cod)
            continue
        stock[cod] = {b['bodega_nombre']: float(b.get('cantidad') or 0)
                      for b in api(f"/sistema/api/v2/producto/{pid}/stock/")}
        if i % 25 == 0:
            print(f"  {i}/{len(codigos)}...")
    print(f"Stock: {len(stock)} productos en {time.time()-t0:.0f}s")
    if sin_id:
        print(f"Sin equivalente en Contifico: {sin_id}")

    # ---------- escritura ----------
    con = conectar()
    cur = con.cursor()
    lineas, total = [], 0
    for bod, (_, nombre_cont) in BODEGAS.items():
        filas = [(FECHA, bod, p['codigo'], p['nombre'], p['unidad'],
                  stock[p['codigo']].get(nombre_cont, 0.0))
                 for p in por_bodega[bod] if p['codigo'] in stock]
        con_stock = sum(1 for f in filas if f[5] > 0)
        total += len(filas)
        lineas.append(f"| {bod} | {len(filas)} | {con_stock} |")
        print(f"  {bod:<24} {len(filas):>3} filas | con stock {con_stock}")
        if ESCRIBIR:
            cur.execute("DELETE FROM goti.inventario_ciego_conteos WHERE fecha=%s AND local=%s",
                        (FECHA, bod))
            psycopg2.extras.execute_values(cur, """
                INSERT INTO goti.inventario_ciego_conteos
                    (fecha, local, codigo, nombre, unidad, cantidad) VALUES %s""", filas)
    if ESCRIBIR:
        con.commit()
        print("\nESCRITO en la base de datos.")
    else:
        print("\nSIMULACION: no se escribio nada.")
    con.close()

    fin = datetime.now(ECUADOR)
    resumen(f"### Carga de inventario por API — {FECHA}\n")
    resumen(f"**Arranco solo a las {inicio:%H:%M:%S} (Ecuador)** y termino "
            f"{fin:%H:%M:%S} — {(fin-inicio).seconds//60}m {(fin-inicio).seconds%60}s\n")
    resumen(f"Modo: **{modo}**\n")
    resumen("| Bodega | Filas | Con stock |\n|---|---|---|")
    for l in lineas:
        resumen(l)
    resumen(f"\n**Total: {total} filas** — {len(codigos)} consultas a Contifico "
            f"(en vez de {sum(len(v) for v in por_bodega.values())}).\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
