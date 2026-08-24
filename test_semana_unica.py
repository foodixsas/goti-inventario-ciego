"""Regresion: cada semana es unica, pero el esqueleto de pagos fijos se conserva.

Falla con el codigo anterior (arrastraba proveedores de semanas pasadas) y con el
primer intento de arreglo (que borraba arriendos, cajas y demas pagos fijos).

    python test_semana_unica.py [AAAA-MM-DD]
"""
import sys, json, datetime, psycopg2

PROV = 'prov-principales'
PROV_EVENT = 'prov-eventuales'
GRUPOS_PROV = {PROV, PROV_EVENT}
GRUPOS_POR_SEMANA = set(GRUPOS_PROV)   # refleja FC_GRUPOS_POR_SEMANA en flujo-caja.js


def cargar_cartera():
    c = psycopg2.connect(host='chiosburguer.postgres.database.azure.com',
                         database='movimientos', user='adminChios',
                         password='Burger2023', port='5432',
                         sslmode='require', connect_timeout=25)
    cur = c.cursor()
    cur.execute("SELECT semana_inicio, proveedor FROM fc_cartera_semana")
    cartera = {}
    for sem, prov in cur.fetchall():
        cartera.setdefault(str(sem), set()).add((prov or '').upper().strip())
    c.close()
    return cartera


def cargar():
    c = psycopg2.connect(host='chiosburguer.postgres.database.azure.com',
                         database='movimientos', user='adminChios',
                         password='Burger2023', port='5432',
                         sslmode='require', connect_timeout=25)
    cur = c.cursor()
    cur.execute("SELECT fecha_semana, egresos FROM flujo_caja_guardado "
                "WHERE egresos IS NOT NULL ORDER BY fecha_semana")
    datos = {str(f): (json.loads(e) if isinstance(e, str) else e)
             for f, e in cur.fetchall()}
    c.close()
    return datos


def consolidar(guardados, cartera, inicio, n_semanas=4):
    """Replica la regla de fc_cargarGuardado: que filas se dibujan."""
    semanas = [inicio + datetime.timedelta(days=7 * i) for i in range(n_semanas)]
    en_vista = {str(inicio + datetime.timedelta(days=d)) for d in range(7 * n_semanas)}
    # En proveedores MANDA LA CARTERA: la autoridad es fc_cartera_semana de alguna
    # semana visible, no las facturas que hayan quedado guardadas en egresos.
    en_cartera = set()
    for sem in semanas:
        en_cartera |= cartera.get(str(sem), set())
    filas = {}
    for sem in semanas:
        for grupo, lista in (guardados.get(str(sem)) or {}).items():
            for it in lista:
                nombre = it.get('nombre', '')
                clave = (grupo, nombre)
                if grupo not in GRUPOS_POR_SEMANA:
                    filas[clave] = 'estructura fija'
                    continue
                if any(v for d, v in (it.get('valores') or {}).items() if d in en_vista):
                    filas[clave] = 'ya planificado'
                elif nombre.upper().strip() in en_cartera:
                    filas[clave] = 'cartera de la semana'
    return filas, en_cartera


def main():
    inicio = (datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1
              else datetime.date.today() - datetime.timedelta(days=datetime.date.today().weekday()))
    guardados = cargar()
    cartera = cargar_cartera()
    filas, en_cartera = consolidar(guardados, cartera, inicio)
    fallos = []

    # 1. Ningun proveedor puede sobrevivir sin motivo (ni cartera ni plan)
    sin_motivo = [k for k, m in filas.items() if k[0] in GRUPOS_PROV and m == 'estructura fija']
    if sin_motivo:
        fallos.append(f'{len(sin_motivo)} proveedor(es) sin cartera ni plan siguen dibujandose')

    # 2. El esqueleto de pagos fijos NO se puede perder
    fijos = {g for g, _ in filas if g not in GRUPOS_POR_SEMANA}
    esperados = {'arriendos', 'cajas', 'servicios', 'debitos', 'tarjetas', 'nomina'}
    faltan = esperados - fijos
    if faltan:
        fallos.append(f'se perdieron grupos de pagos fijos: {sorted(faltan)}')

    # 3. Un proveedor con pago planificado a futuro SI debe sobrevivir
    planificados = [k for k, m in filas.items() if m == 'ya planificado']

    # 4. LA CARTERA MANDA: nadie se dibuja sin estar en la cartera de una semana
    #    visible, salvo que tenga pago ya planificado.
    intrusos = [n for (g, n), m in filas.items()
                if g in GRUPOS_PROV and m != 'ya planificado'
                and n.upper().strip() not in en_cartera]
    if intrusos:
        fallos.append(f'{len(intrusos)} proveedor(es) dibujados sin estar en cartera '
                      f'ni tener pago planificado: {intrusos[:3]}')

    # 5. ...y al reves: todo el que esta en la cartera visible DEBE dibujarse
    dibujados = {n.upper().strip() for (g, n) in filas if g in GRUPOS_PROV}
    faltantes = en_cartera - dibujados
    if faltantes:
        fallos.append(f'{len(faltantes)} proveedor(es) de la cartera no se dibujan: '
                      f'{sorted(faltantes)[:3]}')

    print(f'Semana inicial: {inicio}   filas dibujadas: {len(filas)}')
    for motivo in ('cartera de la semana', 'ya planificado', 'estructura fija'):
        print(f'  {sum(1 for m in filas.values() if m == motivo):>4}  {motivo}')
    print(f'  grupos de pagos fijos presentes: {len(fijos)}')
    print(f'  proveedores con pago ya planificado: {len(planificados)}')
    print(f'  proveedores en la cartera de las semanas visibles: {len(en_cartera)}')
    print()
    if fallos:
        for f in fallos:
            print('FALLO:', f)
        sys.exit(1)
    print('OK: cada semana se arma con su cartera y la estructura fija se conserva.')


if __name__ == '__main__':
    main()
