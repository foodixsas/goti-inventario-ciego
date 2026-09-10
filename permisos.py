"""
Catalogo de modulos para el panel de accesos.

El problema que resuelve: la app tiene 36 pantallas y solo 10 estaban
declaradas en goti.rol_modulos. Las otras 26 no se administraban desde ningun
lado -- estaban escritas a mano en static/js/app.js como "solo admin", asi que
no habia forma de darle Flujo de Caja a un gerente sin volverlo administrador.

Aqui vive la lista, agrupada igual que el menu, y desde aqui se siembran las
que falten. La pantalla de accesos se dibuja con lo que devuelve este catalogo,
asi que agregar una pantalla nueva es agregar una linea aca y nada mas.

Regla de la siembra: los modulos que se agregan arrancan SOLO para admin. Nadie
gana acceso a algo por el hecho de que el catalogo crezca; que un gerente vea
Flujo de Caja tiene que ser una decision tomada en la pantalla, no un efecto
secundario de un despliegue.
"""
from flask import Blueprint, request, jsonify

bp_permisos = Blueprint('permisos', __name__)

ROLES = ['subgerente', 'supervisor', 'gerente', 'admin']

# (grupo, etiqueta del grupo) -> [(modulo, etiqueta)]
# El orden es el mismo del menu para que la pantalla se lea igual que la app.
CATALOGO = [
    ('general', 'General', [
        ('dash-general',      'Dashboard general'),
    ]),
    ('inventario', 'Inventario', [
        ('conteo',            'Conteo'),
        ('observaciones',     'Observaciones'),
        ('historico',         'Historico'),
        ('dashboard',         'Dashboard de inventario'),
        ('cruce',             'Cruce operativo'),
        ('bajas',             'Bajas'),
        ('semanal',           'Semanal'),
        ('evaluacion',        'Evaluacion'),
        ('correccion',        'Corregir conteos'),
        ('descuentos-nomina', 'Descuentos de nomina'),
        ('carga-locales',     'Carga de locales'),
        ('telegram-avisos',   'Avisos de Telegram'),
    ]),
    ('depositos', 'Depositos', [
        ('dep-pendientes',    'Pendientes'),
        ('dep-historial',     'Historial'),
        ('dep-descuadres',    'Descuadres'),
        ('dep-dashboard',     'Dashboard'),
    ]),
    ('cuadres', 'Cuadres de caja', [
        ('caja-chica',        'Caja chica'),
        ('cuadre-registro',   'Registro'),
        ('cuadre-historial',  'Historial'),
        ('cuadre-dashboard',  'Dashboard'),
    ]),
    ('delivery', 'Logistica', [
        ('mov-solicitud',     'Solicitar movimiento'),
        ('mov-historial',     'Movimientos solicitados'),
    ]),
    ('retenciones', 'Retenciones', [
        ('retenciones',       'Consulta de RUC y calculo'),
    ]),
    ('flujocaja', 'Flujo de caja', [
        ('flujo-caja',        'Proyeccion'),
    ]),
    ('costos', 'Costos', [
        ('costos',            'Tablero de costos'),
    ]),
    ('configuracion', 'Configuracion', [
        ('matriz-productos',  'Matriz de productos'),
        ('bodegas',           'Bodegas'),
        ('config-productos',  'Productos por marca'),
        ('usuarios',          'Usuarios y accesos'),
    ]),
]

# Modulos que NUNCA se le pueden dar a alguien que no sea administrador: desde
# ahi se reparten los accesos y se tocan los catalogos maestros. Se muestran en
# la pantalla, pero bloqueados y explicados.
SOLO_ADMIN = {'usuarios', 'bodegas', 'matriz-productos', 'config-productos'}

TODOS = [m for _, _, mods in CATALOGO for m, _ in mods]
ETIQUETAS = {m: e for _, _, mods in CATALOGO for m, e in mods}


def _db():
    from app import get_db
    return get_db()


def _soltar(conn):
    if conn is None:
        return
    from app import release_db
    release_db(conn)


def sembrar_faltantes(cur):
    """Da de alta en rol_modulos los modulos del catalogo que aun no existan.

    Solo para admin y solo los que faltan: a los roles que ya tienen una fila
    no se les toca nada, y a los demas roles no se les regala acceso nuevo.
    Devuelve la lista de los que se agregaron.
    """
    cur.execute("SELECT DISTINCT modulo FROM goti.rol_modulos")
    conocidos = {r['modulo'] for r in cur.fetchall()}
    nuevos = [m for m in TODOS if m not in conocidos]
    for modulo in nuevos:
        cur.execute("""INSERT INTO goti.rol_modulos
                           (rol, modulo, puede_ver, puede_editar, puede_eliminar)
                       VALUES ('admin', %s, TRUE, TRUE, TRUE)
                       ON CONFLICT (rol, modulo) DO NOTHING""", (modulo,))
    return nuevos


@bp_permisos.route('/api/admin/modulos', methods=['GET'])
def permisos_catalogo():
    """El catalogo con el que se dibuja la pantalla de accesos.

    De paso siembra lo que falte, para que instalar una pantalla nueva no
    obligue a correr nada a mano.
    """
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        nuevos = sembrar_faltantes(cur)
        conn.commit()

        cur.execute("""SELECT rol, modulo, puede_ver, puede_editar, puede_eliminar
                         FROM goti.rol_modulos""")
        actuales = {}
        for r in cur.fetchall():
            actuales.setdefault(r['rol'], {})[r['modulo']] = {
                'ver': r['puede_ver'], 'editar': r['puede_editar'],
                'eliminar': r['puede_eliminar']}

        # Cuantos modulos ve cada rol, para el resumen de la pantalla
        resumen = {rol: sum(1 for p in mods.values() if p['ver'])
                   for rol, mods in actuales.items()}

        return jsonify({
            'success': True,
            'grupos': [{'id': g, 'etiqueta': e,
                        'modulos': [{'id': m, 'etiqueta': et,
                                     'solo_admin': m in SOLO_ADMIN}
                                    for m, et in mods]}
                       for g, e, mods in CATALOGO],
            'roles': ROLES,
            'permisos': actuales,
            'resumen': resumen,
            'total_modulos': len(TODOS),
            'sembrados': nuevos,
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False,
                        'error': 'catalogo de modulos: %s' % str(e)[:300]}), 500
    finally:
        _soltar(conn)
