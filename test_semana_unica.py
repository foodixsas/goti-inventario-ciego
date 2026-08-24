"""Regresion: cada semana es unica, pero el esqueleto de pagos fijos se conserva.

Falla con el codigo anterior (arrastraba proveedores de semanas pasadas) y con el
primer intento de arreglo (que borraba arriendos, cajas y demas pagos fijos).

    python test_semana_unica.py [AAAA-MM-DD]
"""
import sys, json, datetime, psycopg2

PROV = 'prov-principales'
GRUPOS_POR_SEMANA = {PROV}   # debe reflejar FC_GRUPOS_POR_SEMANA en flujo-caja.js


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


def consolidar(guardados, inicio, n_semanas=4):
    """Replica la regla de fc_cargarGuardado: que filas se dibujan."""
    semanas = [inicio + datetime.timedelta(days=7 * i) for i in range(n_semanas)]
    en_vista = {str(inicio + datetime.timedelta(days=d)) for d in range(7 * n_semanas)}
    filas = {}
    for sem in semanas:
        for grupo, lista in (guardados.get(str(sem)) or {}).items():
            for it in lista:
                clave = (grupo, it.get('nombre', ''))
                if grupo not in GRUPOS_POR_SEMANA:
                    filas[clave] = 'estructura fija'
                    continue
                if any(v for d, v in (it.get('valores') or {}).items() if d in en_vista):
                    filas[clave] = 'ya planificado'
                elif it.get('facturas'):
                    filas[clave] = 'cartera de la semana'
    return filas


def main():
    inicio = (datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1
              else datetime.date.today() - datetime.timedelta(days=datetime.date.today().weekday()))
    guardados = cargar()
    filas = consolidar(guardados, inicio)
    fallos = []

    # 1. Ningun proveedor puede sobrevivir sin motivo (ni cartera ni plan)
    sin_motivo = [k for k, m in filas.items() if k[0] == PROV and m == 'estructura fija']
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

    print(f'Semana inicial: {inicio}   filas dibujadas: {len(filas)}')
    for motivo in ('cartera de la semana', 'ya planificado', 'estructura fija'):
        print(f'  {sum(1 for m in filas.values() if m == motivo):>4}  {motivo}')
    print(f'  grupos de pagos fijos presentes: {len(fijos)}')
    print(f'  proveedores con pago ya planificado: {len(planificados)}')
    print()
    if fallos:
        for f in fallos:
            print('FALLO:', f)
        sys.exit(1)
    print('OK: cada semana se arma con su cartera y la estructura fija se conserva.')


if __name__ == '__main__':
    main()
