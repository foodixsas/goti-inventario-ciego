"""
Toma de locales: la captura que hoy vive en inventario-chiosburger.netlify.app,
traida adentro de Control Contable.

Por que se migra: esa app resuelve el login en el JavaScript que sirve al
navegador. Los 11 usuarios y sus PIN viajan al cliente en texto plano, y el
backend nunca valida credenciales -- cualquiera con el link entra como Gerencia.
Aqui el servidor valida contra goti.usuarios en cada llamada, igual que el resto
de la app (ver _auth mas abajo).

LO QUE NO CAMBIA -- y es deliberado:

Las tablas destino son EXACTAMENTE las mismas que escribe el API viejo. No se
migra un solo registro y ningun lector se entera del cambio. Hay cinco aguas
abajo que dependen de ellas:

  - el cruce operativo            (app.py, tablas centrales)
  - worker_operativo.py           (registra la toma fisica en Contifico)
  - public.vista_tomas_unificada  (proyeccion de demanda)
  - INVENTARIOS/actualizar_inventarios.py
  - los informes semanales y mensuales

Se verifico que NINGUNO parsea la columna `usuario`: el worker lee solo
codigo, producto, total, unidad, categoria y "Tipo A,B o C" filtrando por fecha.
Aun asi este modulo reproduce el formato exacto del API viejo, porque no cuesta
nada y deja el historico homogeneo.

FORMATOS QUE HAY QUE RESPETAR (leidos de la base el 21-sep-2026, no inventados):

  usuario     'Bodega Principal - Bodega Principal - principal@chiosburger.com'
              'Planta Produccion - produccion@chiosburger.com'
              -> el correo es POR BODEGA y lo ponia el API, no el frontend.
                 Ver USUARIO_POR_BODEGA.

  id          '260828-1ALI006+1787950558868'
              -> AAMMDD - codigo + timestamp_ms de la sesion. El historico
                 agrupa por ese timestamp, asi que todas las filas de una
                 misma toma comparten el sufijo.

  cantidades  '21.694+'   '16+'
              -> las capturas unidas con '+', incluido el '+' final.
                 total = suma de las capturas.

  tomasFisicas  TODAS las columnas son text, incluida fecha. El nombre lleva
                mayusculas, asi que siempre entre comillas dobles.

TRES FORMAS DE TABLA, no una. Esto se descubrio corriendo la prueba de paridad
y es la trampa principal de este modulo:

  forma 'a'   toma_bodega, toma_materiaprima, toma_planta, toma_bodegapulmon
              id, codigo, producto, fecha, usuario, cantidades, total, unidad,
              categoria, "Tipo A,B o C"

  forma 'b'   toma_santo_cachon, toma_simon_bolon
              igual PERO la columna se llama `cantidad` (singular), la unidad
              es `uni_local`, y ademas traen `cant_pedir` y `uni_bod`.
              Son las que nacieron como locales de venta.

  forma 'tf'  tomasFisicas, para los Chios (Real Audiencia, Floreana, Portugal)
              TODO text, se distingue por la columna `local`.

Cada bodega declara su forma en BODEGAS y todos los SQL se arman a partir de
ahi. Escribir 'cantidades' en una tabla de forma 'b' revienta con
UndefinedColumn, que es exactamente lo que paso la primera vez.
"""
from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import os

bp_toma_locales = Blueprint('toma_locales', __name__)

MODULO = 'toma-locales'


# ---------------------------------------------------------------------------
# Mapa de bodegas. Es la unica fuente de verdad de este modulo: de aqui salen
# la tabla destino, el string de `usuario` y la lista que ve el frontend.
#
# Los ids 1..10 son los que usaba la app vieja; se conservan para que un
# acceso directo viejo o un informe que los mencione sigan significando lo
# mismo. La clave interna (bodega_principal, floreana...) es la que ya usan
# goti.usuario_bodegas y el cruce operativo.
# ---------------------------------------------------------------------------
BODEGAS = {
    'bodega_principal': {
        'id': 1, 'nombre': 'Bodega Principal', 'forma': 'a',
        'matriz': 'bodega_principal',
        'tabla': 'public.toma_bodega',
        'usuario': 'Bodega Principal - Bodega Principal - principal@chiosburger.com',
    },
    'materia_prima': {
        'id': 2, 'nombre': 'Bodega Materia Prima', 'forma': 'a',
        'matriz': 'bodega_materia_prima',
        'tabla': 'public.toma_materiaprima',
        'usuario': 'Bodega Materia Prima - materia@chiosburger.com',
    },
    'planta': {
        'id': 3, 'nombre': 'Planta Produccion', 'forma': 'a',
        'matriz': 'planta_produccion',
        'tabla': 'public.toma_planta',
        'usuario': 'Planta Producción - produccion@chiosburger.com',
    },
    'real_audiencia': {
        'id': 4, 'nombre': 'Chios Real Audiencia', 'forma': 'tf',
        'matriz': 'chios',
        'tabla': 'public."tomasFisicas"', 'local': 'Real Audiencia',
        'usuario': None,   # tomasFisicas no tiene columna usuario
    },
    'floreana': {
        'id': 5, 'nombre': 'Chios Floreana', 'forma': 'tf',
        'matriz': 'chios',
        'tabla': 'public."tomasFisicas"', 'local': 'Floreana',
        'usuario': None,
    },
    'portugal': {
        'id': 6, 'nombre': 'Chios Portugal', 'forma': 'tf',
        'matriz': 'chios',
        'tabla': 'public."tomasFisicas"', 'local': 'Portugal',
        'usuario': None,
    },
    'simon_bolon': {
        'id': 7, 'nombre': 'Simon Bolon', 'forma': 'b',
        'matriz': 'simon_bolon',
        'tabla': 'public.toma_simon_bolon',
        'usuario': 'Simón Bolón - simon@chiosburger.com',
    },
    'santo_cachon': {
        'id': 8, 'nombre': 'Santo Cachon', 'forma': 'b',
        'matriz': 'santo_cachon',
        'tabla': 'public.toma_santo_cachon',
        'usuario': 'Santo Cachón - santo@chiosburger.com',
        # goti.usuario_bodegas distingue Santo Cachon Real de Santo Cachon
        # Portugal (el cruce operativo los cuenta por separado), pero la toma
        # fisica tiene UNA sola tabla. Sin estos alias, gerentesantoreal y
        # subgerentesantop no veian ninguna bodega: su asignacion no coincidia
        # con ninguna clave de este mapa.
        'alias': ['santo_cachon_real', 'santo_cachon_portugal'],
    },
    # Bodega Pulmon: sin movimiento desde el 20-mar-2026. Queda declarada para
    # poder leer el historico, pero no se ofrece para contar hasta que Jonathan
    # confirme si revive o se da por cerrada.
    'bodega_pulmon': {
        'id': 9, 'nombre': 'Bodega Pulmon', 'forma': 'a',
        'matriz': 'bodega_pulmon',
        'tabla': 'public.toma_bodegapulmon',
        # Dice "Bodega Principal", no "Bodega Pulmon". No es un error de copia:
        # es literalmente lo que el API viejo grababa en esa tabla. Se respeta.
        'usuario': 'Bodega Principal - pulmon@chiosburger.com',
        'inactiva': True,
    },
}

# Nombre de la columna de capturas y de unidad segun la forma de la tabla.
COL_CANTIDADES = {'a': 'cantidades', 'b': 'cantidad'}
COL_UNIDAD = {'a': 'unidad', 'b': 'uni_local'}

# Las columnas de tipo/categoria llevan un nombre con comas que hay que citar
# tal cual en cada SQL.
COL_TIPO = '"Tipo A,B o C"'


def _log_error(ruta, e):
    """
    Traza el error a stderr y sin buffer.

    Con `print()` a stdout el mensaje se queda en el buffer y, si el servidor
    corre en ventana oculta, el traceback no aparece en ningun lado. Asi paso
    con el 500 de /api/toma/pedidos: hubo que deducir el bug leyendo el codigo.
    """
    import sys, traceback
    print("Error en %s: %s" % (ruta, e), file=sys.stderr, flush=True)
    traceback.print_exc(file=sys.stderr)
    sys.stderr.flush()


def _get_db():
    from app import get_db
    return get_db()


def _release_db(conn):
    from app import release_db
    release_db(conn)


# ---------------------------------------------------------------------------
# Autenticacion y permisos.
#
# Mismo criterio que el resto de la app (_es_admin en matriz_productos.py y
# movimientos_bodega.py): el cliente reenvia usuario + clave y el servidor los
# verifica contra goti.usuarios en CADA llamada. No hay nada que el navegador
# pueda afirmar por su cuenta.
#
# Pendiente de fondo, comun a toda la app: goti.usuarios guarda la clave sin
# cifrar y no hay token de sesion. Esto no lo arregla este modulo, pero tampoco
# lo empeora; queda anotado para el endurecimiento general.
# ---------------------------------------------------------------------------
def _auth(conn, usuario, clave):
    """Usuario valido con clave. Solo para las acciones destructivas."""
    if not usuario or not clave:
        return None
    cur = conn.cursor()
    cur.execute("""
        SELECT id, username, nombre, rol
        FROM goti.usuarios
        WHERE username = %s AND password = %s AND activo = TRUE
    """, (usuario, clave))
    return cur.fetchone()


def _identificar(conn, usuario):
    """
    Resuelve el usuario por su nombre, sin pedir la clave otra vez.

    Es el criterio que ya usa el resto de la app: el login (/api/login) valida
    usuario y contrasena una vez, el navegador guarda la sesion, y los modulos
    identifican al usuario por su nombre. La clave solo se vuelve a pedir para
    lo destructivo -- igual que la Matriz de Productos la pide para borrar.

    Aun asi el servidor NO acepta lo que el navegador afirme: comprueba que el
    usuario exista y este activo, y de ahi saca el rol, los permisos y las
    bodegas. El navegador no puede darse un rol que la base no le reconozca.
    """
    if not usuario:
        return None
    cur = conn.cursor()
    cur.execute("""
        SELECT id, username, nombre, rol
        FROM goti.usuarios
        WHERE username = %s AND activo = TRUE
    """, (usuario,))
    return cur.fetchone()


def _permiso(conn, rol, accion='ver'):
    """Lee goti.rol_modulos para el modulo de esta pantalla."""
    cur = conn.cursor()
    cur.execute("""
        SELECT puede_ver, puede_editar, COALESCE(puede_eliminar, FALSE) AS puede_eliminar
        FROM goti.rol_modulos WHERE rol = %s AND modulo = %s
    """, (rol, MODULO))
    r = cur.fetchone()
    if not r:
        return False
    return {'ver': r['puede_ver'], 'editar': r['puede_editar'],
            'eliminar': r['puede_eliminar']}.get(accion, False)


def _bodegas_de(conn, usuario_id, rol):
    """
    Bodegas que este usuario puede tocar, segun goti.usuario_bodegas.

    El admin las ve todas -- mismo criterio que el resto de la app. Pero eso
    solo aplica a un admin de verdad: cuando se usa "Ver como...", el frontend
    manda el usuario SIMULADO, asi que aqui llega su rol (gerente, subgerente)
    y el atajo de admin no se activa. Es lo que hace que la simulacion sirva
    para comprobar de verdad lo que ve un local.

    Una bodega entra si el usuario tiene asignada su clave O cualquiera de sus
    alias (ver 'alias' en BODEGAS: Santo Cachon Real y Portugal apuntan a la
    misma tabla de toma fisica).
    """
    activas = [k for k, v in BODEGAS.items() if not v.get('inactiva')]
    if rol == 'admin':
        return activas
    cur = conn.cursor()
    cur.execute("SELECT bodega FROM goti.usuario_bodegas WHERE usuario_id = %s", (usuario_id,))
    propias = {r['bodega'] for r in cur.fetchall()}
    return [b for b in activas
            if b in propias or (set(BODEGAS[b].get('alias', [])) & propias)]


def _cred():
    """Las credenciales llegan por body en POST/PUT/DELETE y por query en GET."""
    if request.method == 'GET':
        return request.args.get('usuario'), request.args.get('clave')
    d = request.json or {}
    return d.get('usuario'), d.get('clave')


def _entrar(accion='ver', bodega=None, exigir_clave=False):
    """
    Portero unico: identifica al usuario, y comprueba permiso de modulo y de
    bodega. Devuelve (conn, user, None) si pasa, o (conn, None, error).
    Quien llama SIEMPRE debe liberar la conexion.

    `exigir_clave` solo lo pide lo destructivo (eliminar una toma). Para el
    resto basta el usuario de la sesion, como en los demas modulos: a nadie se
    le vuelve a pedir la contrasena para contar o consultar.
    """
    conn = _get_db()
    usuario, clave = _cred()
    user = _auth(conn, usuario, clave) if exigir_clave else _identificar(conn, usuario)
    if not user:
        return conn, None, (jsonify({
            'error': 'Credenciales invalidas' if exigir_clave else 'Usuario no reconocido'
        }), 401)
    if not _permiso(conn, user['rol'], accion):
        return conn, None, (jsonify({'error': 'Sin permiso para esta accion'}), 403)
    if bodega is not None:
        if bodega not in BODEGAS:
            return conn, None, (jsonify({'error': 'Bodega invalida'}), 400)
        if bodega not in _bodegas_de(conn, user['id'], user['rol']):
            return conn, None, (jsonify({'error': 'Sin acceso a esa bodega'}), 403)
    return conn, user, None


# ---------------------------------------------------------------------------
# Helpers de formato. Reproducen byte a byte lo que escribia el API viejo.
# ---------------------------------------------------------------------------
def _id_fila(fecha, id_bodega, codigo, sesion_ms):
    """
    '260918-1ALI006+1789770088942'

    AAMMDD - <id_bodega><codigo> + <timestamp_ms de la sesion>.

    El id de bodega va PEGADO al codigo, sin separador. Se verifico en las seis
    tablas: toma_bodega->1, materiaprima->2, planta->3, simon_bolon->7,
    santo_cachon->8, bodegapulmon->9. Sin ese digito el id queda distinto al
    del API viejo y el historico dejaria de agrupar igual.
    """
    return '%s-%s%s+%s' % (fecha.strftime('%y%m%d'), id_bodega, codigo, sesion_ms)


def _cantidades_txt(capturas):
    """
    Une las ranuras de captura con '+', TAL CUAL vienen, vacias incluidas.

        ['9', '']          -> '9+'
        ['', '0']          -> '+0'
        ['INACTIVO', '0']  -> 'INACTIVO+0'
        ['21.694']         -> '21.694'

    Nada de "quitar vacias y agregar un + al final": ese fue el primer intento y
    la prueba de paridad lo tumbo. En la base hay campos con 0, 1, 2 y hasta 3
    signos '+', asi que el numero de ranuras es variable y la posicion importa.
    Se guarda la forma exacta que mando el contador.
    """
    return '+'.join(str(c) for c in capturas)


def _total(capturas):
    """
    Suma las capturas, o None si alguna no es un numero.

    'INACTIVO' es un centinela que la operacion usa para marcar un producto que
    ya no se cuenta; en la base esas filas tienen total NULL (48 en toma_bodega,
    413 en materiaprima, 528 en simon_bolon). Se respeta ese criterio: si una
    sola ranura no es numerica, el total queda NULL en vez de inventar un cero,
    porque un cero significa "conte y no habia" y eso es otra cosa.
    """
    total = Decimal('0')
    for c in capturas:
        s = str(c).strip()
        if s == '':
            continue          # ranura vacia = cero, no invalida la fila
        try:
            total += Decimal(s)
        except (InvalidOperation, ValueError):
            return None       # texto como 'INACTIVO': el total queda NULL
    return total


def _num(v):
    """
    Devuelve el valor como numero limpio, o None si no lo es.

    Dos problemas distintos, los dos visibles en el Excel:

    1. La base arrastra ruido de coma flotante de la app vieja, que sumaba en
       JavaScript: en tomasFisicas hay literalmente '4.404999999999999' donde
       el contador escribio 1.5 y 2.905. Se redondea a 4 decimales, que es la
       precision que ya usan las tablas toma_* (numeric(12,4)), y se quitan los
       ceros de relleno. NO se toca el dato guardado: esto es presentacion.

    2. Escribirlo como TEXTO en el Excel hace que Excel lo interprete con la
       configuracion regional del equipo. En es-EC el punto es separador de
       MILES, asi que '4.405' se lee 4405 y '4.404999999999999' se convierte en
       ese 4.404.999.999.999.990. Devolviendo un numero de verdad, Excel lo
       formatea solo y el problema desaparece.
    """
    if v is None or v == '':
        return None
    try:
        d = Decimal(str(v).strip().replace(',', '.'))
    except (InvalidOperation, ValueError):
        return None
    d = d.quantize(Decimal('0.0001'))
    return d.normalize() if d == d.to_integral_value() or True else d


def _num_txt(v, dec=','):
    """
    El mismo numero, como texto y con el separador decimal que toque.

    Para un CSV que se abre en Excel es-EC el separador decimal es la COMA.
    Con punto, la celda se lee como miles y el numero queda destrozado.
    """
    n = _num(v)
    if n is None:
        return '' if v is None else str(v)
    return format(n, 'f').replace('.', dec)


def _sesion_ms():
    """Timestamp en milisegundos que agrupa todas las filas de una misma toma."""
    return int(datetime.now().timestamp() * 1000)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@bp_toma_locales.route('/api/toma/bodegas', methods=['GET'])
def toma_bodegas():
    """Las bodegas que este usuario puede contar. Alimenta la primera pantalla."""
    conn = None
    try:
        conn, user, err = _entrar('ver')
        if err:
            return err
        permitidas = _bodegas_de(conn, user['id'], user['rol'])
        return jsonify({'bodegas': [
            {'clave': b, 'id': BODEGAS[b]['id'], 'nombre': BODEGAS[b]['nombre']}
            for b in permitidas
        ]})
    except Exception as e:
        _log_error("/api/toma/bodegas", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


def _extras_fuera_matriz(cur, bodega, ya_estan):
    """
    Productos que esa bodega SI esta contando pero la matriz no ofrece.

    Existe para que apagar Airtable no borre productos vivos de la hoja de
    conteo. Se mira la ULTIMA toma de esa bodega y se devuelve lo que no venga
    ya en el catalogo de la matriz.

    Por que la ultima toma y no una ventana de dias: con 60 dias la red
    rescataba 13 productos en vez de 8, porque revivia cosas que se habian
    retirado de la matriz A PROPOSITO (materia_prima traia 6 asi). La ultima
    toma es exactamente "lo que esta bodega cuenta hoy", y hace que la red se
    limpie sola: en cuanto un producto deja de contarse, deja de aparecer.

    Cada fila sale con `fuera_matriz: True` para que la pantalla lo pueda
    señalar: no es un producto normal, es uno al que le falta el flag (o la
    ficha entera) en la Matriz de Productos.
    """
    cfg = BODEGAS[bodega]
    forma = cfg['forma']

    if forma == 'tf':
        sql = """
            SELECT DISTINCT ON (cod_prod)
                   cod_prod AS codigo, productos AS producto, categoria,
                   "Tipo A,B o C" AS tipo_abc, unidad, uni_bod
            FROM public."tomasFisicas"
            WHERE local = %s AND cod_prod IS NOT NULL
              AND fecha::text = (SELECT MAX(fecha::text) FROM public."tomasFisicas"
                                  WHERE local = %s)
            ORDER BY cod_prod, fecha::text DESC
        """
        cur.execute(sql, (cfg['local'], cfg['local']))
    else:
        col_cant_uni = COL_UNIDAD[forma]
        # uni_bod solo existe en la forma 'b'
        uni_bod = 'uni_bod' if forma == 'b' else 'NULL::text AS uni_bod'
        sql = f"""
            SELECT DISTINCT ON (codigo)
                   codigo, producto, categoria,
                   "Tipo A,B o C" AS tipo_abc, {col_cant_uni} AS unidad, {uni_bod}
            FROM {cfg['tabla']}
            WHERE codigo IS NOT NULL
              AND fecha::text = (SELECT MAX(fecha::text) FROM {cfg['tabla']})
            ORDER BY codigo, fecha::text DESC
        """
        cur.execute(sql)

    extras = []
    for r in cur.fetchall():
        if r['codigo'] in ya_estan:
            continue
        r['equivalencia'] = None
        r['fuera_matriz'] = True
        extras.append(r)
    return extras


@bp_toma_locales.route('/api/toma/catalogo', methods=['GET'])
def toma_catalogo():
    """
    Productos a contar en una bodega.

    La fuente es `goti.gfc_matriz_productos` y NADA MAS. Airtable quedo fuera a
    proposito (22-sep-2026): sus tablas se van a borrar, y el API viejo ademas
    pegaba a Airtable DESDE EL NAVEGADOR con el token incrustado en el bundle
    publico. Aqui el catalogo sale de la misma base que ya edita el modulo
    Matriz de Productos, asi que lo que Jonathan cambia ahi se ve aqui al
    instante y no hay token que revocar ni servicio de terceros que se caiga.

    La matriz trae un flag y una unidad POR BODEGA (conteo_chios /
    unidad_conteo_chios, etc.), asi que el catalogo sale filtrado a lo que de
    verdad se cuenta en ese sitio.

    RED DE SEGURIDAD: si un producto se conto en esa bodega en los ultimos 60
    dias pero la matriz no lo ofrece, igual aparece, marcado con
    `fuera_matriz: true`. Sin esto, al apagar Airtable se caian de la hoja de
    conteo productos vivos: al 22-sep-2026 eran DEAL071 y DEAL072 (no existen
    en la matriz), COND012 y MPC020 (existen, sin ningun flag encendido),
    DEAL009 (falta el flag de santo_cachon) y QL021 (falta el de chios).
    La red evita perderlos; el arreglo de fondo es corregir la matriz, y
    mientras tanto el marcador deja ver cuales faltan.
    """
    bodega = request.args.get('bodega')
    conn = None
    try:
        conn, user, err = _entrar('ver', bodega)
        if err:
            return err

        cfg = BODEGAS[bodega]

        # OJO con los nombres: en gfc_matriz_productos la columna del tipo se
        # llama `tipo_a_b_o_c`, NO "Tipo A,B o C" como en las tablas toma_*.
        # Son dos convenciones distintas en la misma base.
        cfg_m = cfg['matriz']
        flag = 'conteo_%s' % cfg_m
        uni = 'unidad_conteo_%s' % cfg_m

        cur = conn.cursor()
        cur.execute(f"""
            SELECT codigo,
                   nombre_producto AS producto,
                   categoria,
                   tipo_a_b_o_c AS tipo_abc,
                   {uni} AS unidad,
                   unidad_contifico AS uni_bod,
                   equivalencias_inventarios AS equivalencia
            FROM goti.gfc_matriz_productos
            WHERE estado = 'Activo' AND {flag} IS TRUE
            ORDER BY categoria, nombre_producto
        """)
        productos = cur.fetchall()
        for p in productos:
            p['fuera_matriz'] = False

        extras = _extras_fuera_matriz(cur, bodega, {p['codigo'] for p in productos})
        productos.extend(extras)

        return jsonify({
            'fuente': 'matriz',
            'productos': productos,
            'fuera_matriz': [e['codigo'] for e in extras],
        })

    except Exception as e:
        _log_error("/api/toma/catalogo", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/guardar', methods=['POST'])
def toma_guardar():
    """
    Graba una toma completa.

    Body:
      usuario, clave, bodega, fecha (YYYY-MM-DD, opcional = hoy),
      productos: [{codigo, producto, capturas:[..], unidad, categoria,
                   tipo_abc, anotaciones, cantidad_solicitada, uni_bod}]

    Todo en UNA transaccion: o entra la toma completa o no entra nada. Una toma
    a medias es peor que ninguna, porque el cruce la leeria como conteo real.
    """
    d = request.json or {}
    bodega = d.get('bodega')
    productos = d.get('productos') or []
    conn = None
    try:
        conn, user, err = _entrar('editar', bodega)
        if err:
            return err
        if not productos:
            return jsonify({'error': 'La toma no trae productos'}), 400

        cfg = BODEGAS[bodega]
        if cfg.get('inactiva'):
            return jsonify({'error': 'Esa bodega esta fuera de uso'}), 400

        try:
            fecha = (datetime.strptime(d['fecha'], '%Y-%m-%d').date()
                     if d.get('fecha') else datetime.now().date())
        except ValueError:
            return jsonify({'error': 'Fecha invalida, se espera YYYY-MM-DD'}), 400

        sesion = _sesion_ms()
        cur = conn.cursor()

        # Un mismo dia y bodega no puede tener dos tomas: durante la transicion
        # alguien podria contar en la app vieja y aqui, y el cruce sumaria doble.
        if cfg['tabla'] == 'public."tomasFisicas"':
            cur.execute('SELECT 1 FROM public."tomasFisicas" WHERE local = %s AND fecha = %s LIMIT 1',
                        (cfg['local'], fecha.strftime('%Y-%m-%d')))
        else:
            cur.execute(f"SELECT 1 FROM {cfg['tabla']} WHERE fecha = %s LIMIT 1", (fecha,))
        if cur.fetchone():
            return jsonify({
                'error': 'Ya existe una toma para esa bodega y fecha',
                'detalle': 'Si hay que rehacerla, primero eliminala desde el historico'
            }), 409

        insertadas = 0
        for p in productos:
            codigo = (p.get('codigo') or '').strip()
            if not codigo:
                return jsonify({'error': 'Hay un producto sin codigo'}), 400
            capturas = p.get('capturas') or []
            # Se conservan las ranuras vacias (la posicion es informacion: '+0'
            # no es lo mismo que '0+'). Solo se descarta el producto cuando el
            # contador no toco NINGUNA ranura.
            if not any(str(c).strip() != '' for c in capturas):
                continue
            total = _total(capturas)   # None si hay 'INACTIVO' u otro texto

            if cfg['tabla'] == 'public."tomasFisicas"':
                # Ojo: aqui TODO es text, incluida la fecha.
                cur.execute(f'''
                    INSERT INTO public."tomasFisicas"
                        (fecha, codtomas, cod_prod, productos, unidad, cantidad,
                         anotaciones, local, "cantidadSolicitada", uni_bod,
                         categoria, {COL_TIPO})
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ''', (
                    fecha.strftime('%Y-%m-%d'),
                    # `codtomas` NO es el timestamp suelto: lleva el mismo
                    # formato de id que las tablas toma_*
                    # ('260921-5ALMP002+1790004370000'). Verificado en
                    # tomasFisicas, donde hay un codtomas por fila, no por toma.
                    _id_fila(fecha, cfg['id'], codigo, sesion),
                    codigo,
                    p.get('producto'),
                    p.get('unidad'),
                    None if total is None else str(total),
                    p.get('anotaciones'),
                    cfg['local'],
                    str(p.get('cantidad_solicitada') or ''),
                    p.get('uni_bod'),
                    p.get('categoria'),
                    p.get('tipo_abc'),
                ))
            elif cfg['forma'] == 'a':
                cur.execute(f'''
                    INSERT INTO {cfg['tabla']}
                        (id, codigo, producto, fecha, usuario, cantidades,
                         total, unidad, categoria, {COL_TIPO})
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ''', (
                    _id_fila(fecha, cfg['id'], codigo, sesion),
                    codigo,
                    p.get('producto'),
                    fecha,
                    cfg['usuario'],
                    _cantidades_txt(capturas),
                    total,
                    p.get('unidad'),
                    p.get('categoria'),
                    p.get('tipo_abc'),
                ))
            else:
                # forma 'b': santo_cachon y simon_bolon. Columna `cantidad` en
                # singular, unidad en `uni_local`, y dos campos propios de los
                # locales de venta: cant_pedir (el pedido del dia) y uni_bod.
                cur.execute(f'''
                    INSERT INTO {cfg['tabla']}
                        (id, fecha, usuario, codigo, producto, cantidad,
                         total, uni_local, cant_pedir, uni_bod,
                         categoria, {COL_TIPO})
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ''', (
                    _id_fila(fecha, cfg['id'], codigo, sesion),
                    fecha,
                    cfg['usuario'],
                    codigo,
                    p.get('producto'),
                    _cantidades_txt(capturas),
                    total,
                    p.get('unidad'),
                    p.get('cantidad_solicitada'),
                    p.get('uni_bod'),
                    p.get('categoria'),
                    p.get('tipo_abc'),
                ))
            insertadas += 1

        conn.commit()
        print(f"[toma-locales] {user['username']} guardo {insertadas} productos "
              f"en {bodega} ({fecha}), sesion {sesion}")
        return jsonify({'ok': True, 'sesion': str(sesion),
                        'productos': insertadas, 'fecha': fecha.strftime('%Y-%m-%d')})

    except Exception as e:
        if conn:
            conn.rollback()
        _log_error("/api/toma/guardar", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/historico', methods=['GET'])
def toma_historico():
    """Tomas de una bodega, agrupadas por sesion, mas reciente primero."""
    bodega = request.args.get('bodega')
    try:
        limite = min(int(request.args.get('limite', 30)), 200)
    except ValueError:
        limite = 30
    conn = None
    try:
        conn, user, err = _entrar('ver', bodega)
        if err:
            return err
        desde = request.args.get('desde')
        hasta = request.args.get('hasta')
        cfg = BODEGAS[bodega]
        cur = conn.cursor()

        if cfg['forma'] == 'tf':
            # En tomasFisicas la fecha es text, asi que el rango se compara
            # como texto. Funciona porque el formato es YYYY-MM-DD, que ordena
            # igual alfabeticamente que cronologicamente.
            # Agrupar por `codtomas` a secas daria una "toma" por producto:
            # hay un codtomas por FILA. La sesion es lo que va tras el ultimo
            # '+', igual que en el id de las tablas toma_*.
            ses_tf = "reverse(split_part(reverse(codtomas), '+', 1))"
            sql = [f'SELECT fecha, {ses_tf} AS sesion, COUNT(*) AS productos,',
                   'SUM(CASE WHEN cantidad ~ %s THEN cantidad::numeric ELSE 0 END) AS suma_total,',
                   'COUNT(*) FILTER (WHERE cantidad = %s) AS en_cero,',
                   'COUNT(*) FILTER (WHERE cantidad !~ %s) AS inactivos,',
                   'NULL AS usuario',
                   'FROM public."tomasFisicas" WHERE local = %s']
            args = [r'^\d+(\.\d+)?$', '0', r'^[\d.]*$', cfg['local']]
            if desde:
                sql.append('AND fecha >= %s'); args.append(desde)
            if hasta:
                sql.append('AND fecha <= %s'); args.append(hasta)
            sql.append(f'GROUP BY fecha, {ses_tf} ORDER BY fecha DESC LIMIT %s')
            args.append(limite)
            cur.execute(' '.join(sql), args)
        else:
            cant = COL_CANTIDADES[cfg['forma']]
            # El sufijo de sesion va tras el ULTIMO '+', porque las cantidades
            # tambien usan ese separador: split_part(id,'+',2) se equivoca en
            # cuanto la fila tiene dos o tres conteos.
            ses = "reverse(split_part(reverse(id), '+', 1))"
            # fecha::text SIEMPRE. Sin el cast, psycopg2 devuelve un date y
            # Flask lo serializa como "Fri, 18 Sep 2026 00:00:00 GMT", mientras
            # que tomasFisicas (donde la columna ya es text) devuelve
            # "2026-09-21". Dos formatos distintos en la misma pantalla.
            sql = [f'SELECT fecha::text AS fecha, {ses} AS sesion, COUNT(*) AS productos,',
                   'SUM(total) AS suma_total,',
                   'COUNT(*) FILTER (WHERE total = 0) AS en_cero,',
                   f'COUNT(*) FILTER (WHERE {cant} !~ %s) AS inactivos,',
                   'MAX(usuario) AS usuario',
                   f'FROM {cfg["tabla"]} WHERE 1=1']
            args = [r'^[\d.+]*$']
            if desde:
                sql.append('AND fecha >= %s'); args.append(desde)
            if hasta:
                sql.append('AND fecha <= %s'); args.append(hasta)
            sql.append(f'GROUP BY fecha, {ses} ORDER BY fecha DESC LIMIT %s')
            args.append(limite)
            cur.execute(' '.join(sql), args)

        return jsonify({'bodega': bodega, 'tomas': cur.fetchall()})
    except Exception as e:
        _log_error("/api/toma/historico", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/detalle', methods=['GET'])
def toma_detalle():
    """El desglose de una toma concreta (bodega + fecha)."""
    bodega = request.args.get('bodega')
    fecha = request.args.get('fecha')
    conn = None
    try:
        conn, user, err = _entrar('ver', bodega)
        if err:
            return err
        if not fecha:
            return jsonify({'error': 'Falta la fecha'}), 400
        cfg = BODEGAS[bodega]
        cur = conn.cursor()
        if cfg['tabla'] == 'public."tomasFisicas"':
            # Los nombres de columna tienen que salir IGUAL que en las otras
            # dos formas: la pantalla lee `cantidades`, `total`, `cant_pedir` y
            # `uni_bod`. Sin estos alias la tabla se dibujaba con Conteos,
            # Total y Pedir en blanco -- habia datos, pero con otro nombre.
            #
            # En tomasFisicas no hay columna `total` aparte: la toma se guarda
            # ya sumada en `cantidad`, asi que esa misma columna hace de las
            # dos cosas.
            cur.execute(f'''
                SELECT cod_prod AS codigo, productos AS producto,
                       cantidad AS cantidades,
                       cantidad AS total,
                       "cantidadSolicitada" AS cant_pedir,
                       unidad, uni_bod, categoria,
                       {COL_TIPO} AS tipo_abc, anotaciones,
                       NULL::varchar AS usuario
                FROM public."tomasFisicas"
                WHERE local = %s AND fecha = %s
                ORDER BY categoria, productos
            ''', (cfg['local'], fecha))
        elif cfg['forma'] == 'b':
            cur.execute(f'''
                SELECT codigo, producto, cantidad AS cantidades, total,
                       uni_local AS unidad, uni_bod, cant_pedir,
                       categoria, {COL_TIPO} AS tipo_abc, usuario
                FROM {cfg['tabla']}
                WHERE fecha = %s
                ORDER BY categoria, producto
            ''', (fecha,))
        else:
            cur.execute(f'''
                SELECT codigo, producto, cantidades, total,
                       unidad, NULL AS uni_bod, NULL AS cant_pedir,
                       categoria, {COL_TIPO} AS tipo_abc, usuario
                FROM {cfg['tabla']}
                WHERE fecha = %s
                ORDER BY categoria, producto
            ''', (fecha,))
        return jsonify({'bodega': bodega, 'fecha': fecha, 'productos': cur.fetchall()})
    except Exception as e:
        _log_error("/api/toma/detalle", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/eliminar', methods=['POST'])
def toma_eliminar():
    """
    Borra una toma completa (bodega + fecha).

    Se pide permiso 'eliminar' del modulo, que arranca solo en admin. La regla
    de la app vieja -- el local podia borrar lo suyo el mismo dia -- se deja
    para cuando Jonathan defina los roles; mientras tanto el criterio estricto
    es el seguro, porque borrar una toma que el cruce ya consumio descuadra el
    inventario.
    """
    d = request.json or {}
    bodega = d.get('bodega')
    fecha = d.get('fecha')
    conn = None
    try:
        # Lo unico que vuelve a pedir la contrasena. Borrar una toma que el
        # cruce ya consumio descuadra el inventario, asi que aqui si se exige,
        # igual que la Matriz de Productos la exige para borrar un producto.
        conn, user, err = _entrar('eliminar', bodega, exigir_clave=True)
        if err:
            return err
        if not fecha:
            return jsonify({'error': 'Falta la fecha'}), 400
        cfg = BODEGAS[bodega]
        cur = conn.cursor()
        if cfg['tabla'] == 'public."tomasFisicas"':
            cur.execute('DELETE FROM public."tomasFisicas" WHERE local = %s AND fecha = %s',
                        (cfg['local'], fecha))
        else:
            cur.execute(f"DELETE FROM {cfg['tabla']} WHERE fecha = %s", (fecha,))
        borradas = cur.rowcount
        conn.commit()
        print(f"[toma-locales] {user['username']} elimino la toma de {bodega} "
              f"del {fecha}: {borradas} filas")
        return jsonify({'ok': True, 'filas': borradas})
    except Exception as e:
        if conn:
            conn.rollback()
        _log_error("/api/toma/eliminar", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


def _sql_una_bodega(clave, cfg):
    """
    SELECT normalizado de una bodega, para poder unir las tres formas de tabla
    en una sola consulta. Devuelve (sql, args).

    Las tres formas usan nombres distintos para lo mismo (cantidades/cantidad,
    unidad/uni_local) y tomasFisicas ademas guarda todo como texto. Aqui se
    traducen a un juego unico de columnas.
    """
    if cfg['forma'] == 'tf':
        return (f'''
            SELECT %s AS bodega, %s AS bodega_nombre,
                   fecha::text AS fecha,
                   reverse(split_part(reverse(codtomas), '+', 1)) AS sesion,
                   cod_prod AS codigo, productos AS producto, categoria,
                   {COL_TIPO} AS tipo_abc,
                   cantidad AS cantidades,
                   CASE WHEN cantidad ~ '^[0-9]+(\\.[0-9]+)?$'
                        THEN cantidad::numeric END AS total,
                   "cantidadSolicitada" AS cant_pedir,
                   unidad, uni_bod, NULL::varchar AS usuario
            FROM public."tomasFisicas" WHERE local = %s
        ''', [clave, cfg['nombre'], cfg['local']])
    if cfg['forma'] == 'b':
        return (f'''
            SELECT %s AS bodega, %s AS bodega_nombre,
                   fecha::text AS fecha,
                   reverse(split_part(reverse(id), '+', 1)) AS sesion,
                   codigo, producto, categoria, {COL_TIPO} AS tipo_abc,
                   cantidad AS cantidades, total, cant_pedir::text AS cant_pedir,
                   uni_local AS unidad, uni_bod, usuario
            FROM {cfg['tabla']} WHERE 1=1
        ''', [clave, cfg['nombre']])
    return (f'''
        SELECT %s AS bodega, %s AS bodega_nombre,
               fecha::text AS fecha,
               reverse(split_part(reverse(id), '+', 1)) AS sesion,
               codigo, producto, categoria, {COL_TIPO} AS tipo_abc,
               cantidades, total, NULL::text AS cant_pedir,
               unidad, NULL::varchar AS uni_bod, usuario
        FROM {cfg['tabla']} WHERE 1=1
    ''', [clave, cfg['nombre']])


def _union_crudo(claves):
    """UNION ALL de varias bodegas, SIN alias. Para meterlo en un CTE."""
    trozos, args = [], []
    for k in claves:
        sql, a = _sql_una_bodega(k, BODEGAS[k])
        trozos.append(sql)
        args.extend(a)
    return ' UNION ALL '.join(trozos), args


def _union_bodegas(claves):
    """
    Lo mismo pero ya aliasado como `t`, para usarlo directo en un FROM.

    OJO: solo sirve si la union aparece UNA vez en la consulta. Si hay que
    referenciarla dos veces (por ejemplo una subconsulta con el maximo por
    bodega), usar _union_crudo dentro de un CTE: incrustar este `base` dos
    veces duplica los parametros y obliga a inventar alias que no existen.
    """
    crudo, args = _union_crudo(claves)
    return '(' + crudo + ') AS t', args


@bp_toma_locales.route('/api/toma/buscar', methods=['GET'])
def toma_buscar():
    """
    Historico global, que es como lo presenta la app vieja: los filtros son
    "Todas las bodegas / Todos los usuarios / Todos los tipos", no una bodega
    a la vez.

    Filtros (todos opcionales): bodega, q (nombre/codigo/categoria), usuario,
    tipo, desde, hasta, solo_cero, orden (fecha|producto|total), limite.

    Devuelve filas de producto y, aparte, el resumen por sesion, para poder
    dibujar las tarjetas y el detalle con una sola llamada.
    """
    conn = None
    try:
        conn, user, err = _entrar('ver')
        if err:
            return err

        permitidas = _bodegas_de(conn, user['id'], user['rol'])
        pedida = request.args.get('bodega') or ''
        if pedida:
            if pedida not in permitidas:
                return jsonify({'error': 'Sin acceso a esa bodega'}), 403
            claves = [pedida]
        else:
            claves = permitidas
        if not claves:
            return jsonify({'tomas': [], 'productos': []})

        base, args = _union_bodegas(claves)
        cond, ca = [], []
        q = (request.args.get('q') or '').strip()
        if q:
            cond.append('(t.producto ILIKE %s OR t.codigo ILIKE %s '
                        'OR t.categoria ILIKE %s)')
            ca += ['%%%s%%' % q] * 3
        # OJO con el nombre: NO puede llamarse `usuario`. Ese nombre ya lo usa
        # la credencial que lee _cred(), y el filtro lo pisaba: al mandar
        # "Todos los usuarios" (vacio) el portero recibia usuario='' y
        # respondia 401. Se llama `filtro_usuario` por eso.
        if request.args.get('filtro_usuario'):
            cond.append('t.usuario = %s'); ca.append(request.args['filtro_usuario'])
        if request.args.get('tipo'):
            cond.append('upper(t.tipo_abc) = %s'); ca.append(request.args['tipo'].upper())
        if request.args.get('desde'):
            cond.append('t.fecha >= %s'); ca.append(request.args['desde'])
        if request.args.get('hasta'):
            cond.append('t.fecha <= %s'); ca.append(request.args['hasta'])
        if request.args.get('solo_cero') in ('1', 'true', 'si'):
            cond.append('t.total = 0')
        where = (' WHERE ' + ' AND '.join(cond)) if cond else ''

        orden = {'fecha': 't.fecha DESC, t.producto',
                 'producto': 't.producto, t.fecha DESC',
                 'total': 't.total DESC NULLS LAST'}.get(
                     request.args.get('orden', 'fecha'), 't.fecha DESC, t.producto')
        try:
            limite = min(int(request.args.get('limite', 500)), 2000)
        except ValueError:
            limite = 500

        cur = conn.cursor()
        cur.execute(f'SELECT t.* FROM {base}{where} ORDER BY {orden} LIMIT %s',
                    args + ca + [limite])
        productos = cur.fetchall()

        # Resumen por sesion: es lo que la app vieja dibuja como tarjetas.
        cur.execute(f'''
            SELECT t.bodega, t.bodega_nombre, t.fecha, t.sesion,
                   COUNT(*) AS productos,
                   SUM(t.total) AS suma_total,
                   COUNT(*) FILTER (WHERE t.total = 0) AS en_cero,
                   COUNT(*) FILTER (WHERE t.total IS NULL) AS inactivos,
                   MAX(t.usuario) AS usuario
            FROM {base}{where}
            GROUP BY t.bodega, t.bodega_nombre, t.fecha, t.sesion
            ORDER BY t.fecha DESC
            LIMIT 200
        ''', args + ca)
        tomas = cur.fetchall()

        return jsonify({'tomas': tomas, 'productos': productos,
                        'bodegas_consultadas': claves})
    except Exception as e:
        _log_error("/api/toma/buscar", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/pedidos', methods=['GET'])
def toma_pedidos():
    """
    Pedidos del Dia: que hay que pedir, segun la ultima toma de cada bodega.

    Solo lo devuelven las bodegas cuya tabla guarda `cant_pedir` (forma 'b') o
    `cantidadSolicitada` (tomasFisicas). Las centrales -- bodega principal,
    materia prima, planta -- no tienen esa columna, asi que no aparecen aqui:
    no es un olvido, es que su tabla no lo registra.
    """
    conn = None
    try:
        conn, user, err = _entrar('ver')
        if err:
            return err
        fecha = request.args.get('fecha')
        # Solo las bodegas cuya tabla guarda la cantidad a pedir. Las centrales
        # (principal, materia prima, planta) no tienen esa columna.
        permitidas = [k for k in _bodegas_de(conn, user['id'], user['rol'])
                      if BODEGAS[k]['forma'] in ('b', 'tf')]
        if not permitidas:
            return jsonify({'pedidos': [], 'locales': [],
                            'nota': 'Ninguna de tus bodegas registra pedidos'})

        # Lista de locales para el desplegable "Todos los locales". Se devuelve
        # siempre, aunque el filtro deje la tabla vacia: si no, al elegir un
        # local sin pedidos el desplegable se quedaria sin opciones.
        locales = [{'clave': k, 'nombre': BODEGAS[k]['nombre']} for k in permitidas]

        pedida = request.args.get('bodega') or ''
        if pedida:
            if pedida not in permitidas:
                return jsonify({'error': 'Sin acceso a ese local'}), 403
            permitidas = [pedida]

        # La union va en un CTE, no repetida dentro de una subconsulta.
        # Antes se incrustaba `base` dos veces y la subconsulta usaba el alias
        # `t2`, que no existia -- la union entera se llama `t`. Resultado: 500.
        # Con el CTE la union se declara una sola vez, se puede referenciar con
        # el alias que haga falta, y los parametros no se duplican.
        crudo, args = _union_crudo(permitidas)
        cur = conn.cursor()
        # Techo de 30s. Sin el, una consulta mal planteada sigue viva en el
        # servidor aunque el navegador ya se haya rendido: la primera version de
        # este endpoint quedo 7 minutos corriendo y dejo encolados detras los
        # ALTER TABLE del arranque, con lo que la app entera dejo de levantar.
        # Que falle rapido y ruidoso es mejor que un timeout invisible.
        cur.execute("SET LOCAL statement_timeout = '30s'")
        filtro = ["t.cant_pedir IS NOT NULL", "t.cant_pedir <> ''", "t.cant_pedir <> '0'"]
        fa = []

        # Mismos filtros que el historico, para que las dos pantallas se
        # manejen igual: texto libre, categoria y orden.
        q = (request.args.get('q') or '').strip()
        if q:
            filtro.append('(t.producto ILIKE %s OR t.codigo ILIKE %s '
                          'OR t.categoria ILIKE %s)')
            fa += ['%%%s%%' % q] * 3
        if request.args.get('categoria'):
            filtro.append('t.categoria = %s')
            fa.append(request.args['categoria'])

        orden = {
            'local':     't.bodega_nombre, t.categoria, t.producto',
            'producto':  't.producto, t.bodega_nombre',
            'categoria': 't.categoria, t.producto',
            'cantidad':  "NULLIF(regexp_replace(t.cant_pedir, '[^0-9.]', '', 'g'), '')"
                         '::numeric DESC NULLS LAST',
        }.get(request.args.get('orden', 'local'),
              't.bodega_nombre, t.categoria, t.producto')

        if fecha:
            cur.execute(f'''WITH datos AS ({crudo})
                            SELECT t.bodega_nombre, t.fecha, t.codigo, t.producto,
                                   t.categoria, t.cant_pedir, t.uni_bod, t.total
                            FROM datos t
                            WHERE t.fecha = %s AND {' AND '.join(filtro)}
                            ORDER BY {orden}
                            LIMIT 1000''', args + [fecha] + fa)
            pedidos = cur.fetchall()
            cats = sorted({p['categoria'] for p in pedidos if p['categoria']})
            return jsonify({'pedidos': pedidos, 'locales': locales,
                            'categorias': cats})

        # Sin fecha: la ultima toma de cada bodega.
        #
        # La primera version usaba una subconsulta correlacionada
        # (SELECT MAX(fecha) ... WHERE u.bodega = t.bodega) sobre el CTE, y se
        # colgaba: Postgres materializa la union -- mas de 215.000 filas solo en
        # tomasFisicas -- y vuelve a recorrerla por CADA fila candidata.
        #
        # Ahora son dos pasadas: una agrega el maximo por bodega y la otra une
        # contra el. Ademas se acota a los ultimos 120 dias: "Pedidos del Dia"
        # solo mira la toma mas reciente, asi que recorrer el historico completo
        # es trabajo tirado.
        corte = (datetime.now().date() - timedelta(days=120)).strftime('%Y-%m-%d')
        cur.execute(f'''
            WITH datos AS (
                SELECT * FROM ({crudo}) x WHERE x.fecha >= %s
            ),
            ult AS (
                SELECT bodega, MAX(fecha) AS fecha FROM datos GROUP BY bodega
            )
            SELECT t.bodega_nombre, t.fecha, t.codigo, t.producto,
                   t.categoria, t.cant_pedir, t.uni_bod, t.total
            FROM datos t
            JOIN ult ON ult.bodega = t.bodega AND ult.fecha = t.fecha
            WHERE {' AND '.join(filtro)}
            ORDER BY {orden}
            LIMIT 1000''', args + [corte] + fa)
        pedidos = cur.fetchall()

        # Categorias presentes, para llenar el desplegable sin una consulta mas.
        cats = sorted({p['categoria'] for p in pedidos if p['categoria']})
        return jsonify({'pedidos': pedidos, 'locales': locales, 'categorias': cats})
    except Exception as e:
        _log_error("/api/toma/pedidos", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/resumen', methods=['GET'])
def toma_resumen():
    """Sesiones de hoy y productos en cero: las dos cifras de la cabecera."""
    conn = None
    try:
        conn, user, err = _entrar('ver')
        if err:
            return err
        claves = _bodegas_de(conn, user['id'], user['rol'])
        if not claves:
            return jsonify({'sesiones_hoy': 0, 'productos_cero': 0})
        base, args = _union_bodegas(claves)
        cur = conn.cursor()
        cur.execute(f'''SELECT COUNT(DISTINCT (t.bodega, t.sesion)) AS sesiones,
                               COUNT(*) FILTER (WHERE t.total = 0) AS ceros
                        FROM {base} WHERE t.fecha = %s''',
                    args + [datetime.now().date().strftime('%Y-%m-%d')])
        r = cur.fetchone()
        return jsonify({'sesiones_hoy': r['sesiones'] or 0,
                        'productos_cero': r['ceros'] or 0})
    except Exception as e:
        _log_error("/api/toma/resumen", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/editar', methods=['POST'])
def toma_editar():
    """
    Corrige una fila ya guardada: el total y, donde exista, la cantidad a pedir.

    La app vieja permitia esto desde el historico ("Editar Producto", con
    "Nuevo total", "Nueva cantidad a pedir" y un "Motivo (opcional)"). Se
    replica, con dos diferencias a favor:

      - pide permiso 'editar' del modulo, verificado en el servidor;
      - deja rastro. El motivo y quien edito se anotan en goti.auditoria_ediciones
        si esa tabla existe; la app vieja no registraba nada.

    No se toca `cantidades`: esa columna es el testimonio de lo que el contador
    tecleo. Si el total cambia, lo que cambia es el total.
    """
    d = request.json or {}
    bodega = d.get('bodega')
    fecha = d.get('fecha')
    codigo = d.get('codigo')
    conn = None
    try:
        conn, user, err = _entrar('editar', bodega)
        if err:
            return err
        if not (fecha and codigo):
            return jsonify({'error': 'Faltan fecha o codigo'}), 400

        cfg = BODEGAS[bodega]
        nuevo_total = d.get('total')
        nuevo_pedir = d.get('cant_pedir')
        motivo = (d.get('motivo') or '').strip() or None
        cur = conn.cursor()

        if cfg['forma'] == 'tf':
            cur.execute('''UPDATE public."tomasFisicas"
                           SET cantidad = %s
                           WHERE local = %s AND fecha = %s AND cod_prod = %s''',
                        (None if nuevo_total is None else str(nuevo_total),
                         cfg['local'], fecha, codigo))
        elif cfg['forma'] == 'b':
            cur.execute(f"""UPDATE {cfg['tabla']}
                            SET total = %s, cant_pedir = %s
                            WHERE fecha = %s AND codigo = %s""",
                        (nuevo_total, nuevo_pedir, fecha, codigo))
        else:
            cur.execute(f"""UPDATE {cfg['tabla']} SET total = %s
                            WHERE fecha = %s AND codigo = %s""",
                        (nuevo_total, fecha, codigo))
        tocadas = cur.rowcount

        if tocadas:
            # La auditoria es best-effort: si la tabla no esta, la correccion
            # igual vale. No se aborta una correccion legitima por no poder
            # anotarla.
            try:
                cur.execute("""
                    INSERT INTO goti.auditoria_ediciones
                        (usuario, modulo, detalle, fecha_edicion)
                    VALUES (%s, %s, %s, now())
                """, (user['username'], MODULO,
                      'toma %s %s %s -> total=%s pedir=%s. Motivo: %s' % (
                          bodega, fecha, codigo, nuevo_total, nuevo_pedir,
                          motivo or 'sin motivo')))
            except Exception as ae:
                conn.rollback()
                # Se repite el UPDATE porque el rollback lo deshizo.
                if cfg['forma'] == 'tf':
                    cur.execute('''UPDATE public."tomasFisicas" SET cantidad = %s
                                   WHERE local = %s AND fecha = %s AND cod_prod = %s''',
                                (None if nuevo_total is None else str(nuevo_total),
                                 cfg['local'], fecha, codigo))
                elif cfg['forma'] == 'b':
                    cur.execute(f"""UPDATE {cfg['tabla']} SET total = %s, cant_pedir = %s
                                    WHERE fecha = %s AND codigo = %s""",
                                (nuevo_total, nuevo_pedir, fecha, codigo))
                else:
                    cur.execute(f"""UPDATE {cfg['tabla']} SET total = %s
                                    WHERE fecha = %s AND codigo = %s""",
                                (nuevo_total, fecha, codigo))
                print(f"[toma-locales] sin auditoria ({ae})")

        conn.commit()
        print(f"[toma-locales] {user['username']} edito {codigo} de {bodega} "
              f"({fecha}): total={nuevo_total} motivo={motivo}")
        return jsonify({'ok': True, 'filas': tocadas})
    except Exception as e:
        if conn:
            conn.rollback()
        _log_error("/api/toma/editar", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/exportar', methods=['GET'])
def toma_exportar():
    """
    Excel de una toma, con las mismas columnas que exportaba la app vieja:

        Codigo | Producto | Categoria | Tipo | Conteo 1 | Conteo 2 | Conteo 3 |
        Total | Cantidad a Pedir | Unidad | Unidad Bodega

    Se genera en el servidor (openpyxl, que la app ya usa) y no en el navegador.
    Asi el telefono no tiene que cargar una libreria de 900 KB para exportar, y
    de paso el export pasa por el mismo portero que todo lo demas.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from flask import send_file, Response
    from io import BytesIO

    bodega = request.args.get('bodega')
    fecha = request.args.get('fecha')
    formato = (request.args.get('formato') or 'xlsx').lower()
    conn = None
    try:
        conn, user, err = _entrar('ver', bodega)
        if err:
            return err
        if not fecha:
            return jsonify({'error': 'Falta la fecha'}), 400

        cfg = BODEGAS[bodega]
        cur = conn.cursor()
        if cfg['forma'] == 'tf':
            cur.execute(f'''
                SELECT cod_prod AS codigo, productos AS producto, categoria,
                       {COL_TIPO} AS tipo_abc, cantidad AS cantidades,
                       cantidad AS total, "cantidadSolicitada" AS cant_pedir,
                       unidad, uni_bod
                FROM public."tomasFisicas"
                WHERE local = %s AND fecha = %s
                ORDER BY categoria, productos
            ''', (cfg['local'], fecha))
        elif cfg['forma'] == 'b':
            cur.execute(f'''
                SELECT codigo, producto, categoria, {COL_TIPO} AS tipo_abc,
                       cantidad AS cantidades, total, cant_pedir,
                       uni_local AS unidad, uni_bod
                FROM {cfg['tabla']}
                WHERE fecha = %s ORDER BY categoria, producto
            ''', (fecha,))
        else:
            cur.execute(f'''
                SELECT codigo, producto, categoria, {COL_TIPO} AS tipo_abc,
                       cantidades, total, NULL AS cant_pedir,
                       unidad, NULL AS uni_bod
                FROM {cfg['tabla']}
                WHERE fecha = %s ORDER BY categoria, producto
            ''', (fecha,))
        filas = cur.fetchall()

        # Las 11 columnas son exactamente las del export de la app vieja.
        cabecera = ['Codigo', 'Producto', 'Categoria', 'Tipo', 'Conteo 1',
                    'Conteo 2', 'Conteo 3', 'Total', 'Cantidad a Pedir',
                    'Unidad', 'Unidad Bodega']

        def _ranuras(f):
            """Reparte 'c1+c2+c3' en las tres columnas de conteo."""
            r = str(f['cantidades'] or '').split('+')
            return (r + ['', '', ''])[:3]

        if formato == 'csv':
            # La app vieja ofrecia "Exportar CSV" ademas del Excel. Se genera
            # con BOM para que Excel en Windows respete las tildes.
            import csv
            from io import StringIO
            buf = StringIO()
            w = csv.writer(buf, delimiter=';')
            w.writerow(cabecera)
            for f in filas:
                r = _ranuras(f)
                # Coma decimal: es un CSV para abrir en Excel es-EC
                w.writerow([f['codigo'], f['producto'], f['categoria'],
                            f['tipo_abc'],
                            _num_txt(r[0]), _num_txt(r[1]), _num_txt(r[2]),
                            _num_txt(f['total']), _num_txt(f['cant_pedir']),
                            f['unidad'], f['uni_bod']])
            datos = '﻿' + buf.getvalue()
            return Response(datos, mimetype='text/csv; charset=utf-8',
                            headers={'Content-Disposition':
                                     'attachment; filename=toma_%s_%s.csv'
                                     % (bodega, fecha)})

        wb = Workbook()
        ws = wb.active
        ws.title = 'Toma'
        ws.append(cabecera)
        for i, _ in enumerate(cabecera, start=1):
            celda = ws.cell(row=1, column=i)
            celda.font = Font(bold=True, color='FFFFFF')
            celda.fill = PatternFill('solid', fgColor='123450')   # navy de marca

        for f in filas:
            r = _ranuras(f)
            # Los conteos y totales van como NUMERO. Escritos como texto, Excel
            # los interpreta con la config regional y el punto pasa a ser
            # separador de miles: de ahi salia 4.404.999.999.999.990.
            ws.append([f['codigo'], f['producto'], f['categoria'], f['tipo_abc'],
                       _num(r[0]), _num(r[1]), _num(r[2]),
                       _num(f['total']), _num(f['cant_pedir']),
                       f['unidad'], f['uni_bod']])

        anchos = [14, 42, 20, 8, 10, 10, 10, 12, 16, 12, 14]
        for i, a in enumerate(anchos, start=1):
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = a
        ws.freeze_panes = 'A2'

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        nombre = 'toma_%s_%s.xlsx' % (bodega, fecha)
        return send_file(buf, as_attachment=True, download_name=nombre,
                         mimetype='application/vnd.openxmlformats-officedocument.'
                                  'spreadsheetml.sheet')
    except Exception as e:
        _log_error("/api/toma/exportar", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/exportar-todo', methods=['GET'])
def toma_exportar_todo():
    """
    "Exportar Todo" del original: un solo Excel con TODO lo que devuelven los
    filtros del historico, de todas las bodegas, con la bodega como columna.

    Acepta los mismos filtros que /api/toma/buscar.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from flask import send_file
    from io import BytesIO

    conn = None
    try:
        conn, user, err = _entrar('ver')
        if err:
            return err

        permitidas = _bodegas_de(conn, user['id'], user['rol'])
        pedida = request.args.get('bodega') or ''
        claves = [pedida] if pedida and pedida in permitidas else permitidas
        if not claves:
            return jsonify({'error': 'Sin bodegas asignadas'}), 403

        base, args = _union_bodegas(claves)
        cond, ca = [], []
        q = (request.args.get('q') or '').strip()
        if q:
            cond.append('(t.producto ILIKE %s OR t.codigo ILIKE %s OR t.categoria ILIKE %s)')
            ca += ['%%%s%%' % q] * 3
        if request.args.get('filtro_usuario'):
            cond.append('t.usuario = %s'); ca.append(request.args['filtro_usuario'])
        if request.args.get('tipo'):
            cond.append('upper(t.tipo_abc) = %s'); ca.append(request.args['tipo'].upper())
        if request.args.get('desde'):
            cond.append('t.fecha >= %s'); ca.append(request.args['desde'])
        if request.args.get('hasta'):
            cond.append('t.fecha <= %s'); ca.append(request.args['hasta'])
        if request.args.get('solo_cero') in ('1', 'true', 'si'):
            cond.append('t.total = 0')
        where = (' WHERE ' + ' AND '.join(cond)) if cond else ''

        cur = conn.cursor()
        cur.execute(f'SELECT t.* FROM {base}{where} '
                    f'ORDER BY t.fecha DESC, t.bodega_nombre, t.producto LIMIT 20000',
                    args + ca)
        filas = cur.fetchall()

        wb = Workbook()
        ws = wb.active
        ws.title = 'Tomas'
        cabecera = ['Bodega', 'Fecha', 'Codigo', 'Producto', 'Categoria', 'Tipo',
                    'Conteo 1', 'Conteo 2', 'Conteo 3', 'Total',
                    'Cantidad a Pedir', 'Unidad', 'Unidad Bodega']
        ws.append(cabecera)
        for i, _ in enumerate(cabecera, start=1):
            c = ws.cell(row=1, column=i)
            c.font = Font(bold=True, color='FFFFFF')
            c.fill = PatternFill('solid', fgColor='123450')   # navy de marca

        for f in filas:
            r = (str(f['cantidades'] or '').split('+') + ['', '', ''])[:3]
            ws.append([f['bodega_nombre'], f['fecha'], f['codigo'], f['producto'],
                       f['categoria'], f['tipo_abc'],
                       _num(r[0]), _num(r[1]), _num(r[2]),
                       _num(f['total']), _num(f['cant_pedir']),
                       f['unidad'], f['uni_bod']])

        for i, a in enumerate([22, 12, 14, 42, 20, 8, 10, 10, 10, 12, 16, 12, 14], start=1):
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = a
        ws.freeze_panes = 'A2'

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        return send_file(buf, as_attachment=True,
                         download_name='tomas_%s.xlsx' % (request.args.get('desde') or 'todas'),
                         mimetype='application/vnd.openxmlformats-officedocument.'
                                  'spreadsheetml.sheet')
    except Exception as e:
        _log_error("/api/toma/exportar-todo", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)


@bp_toma_locales.route('/api/toma/paridad', methods=['GET'])
def toma_paridad():
    """
    Herramienta del piloto (fase F4): compara como quedo una toma grabada por
    este modulo contra una grabada por el API viejo, columna por columna.

    No es una pantalla: se consulta durante la transicion para demostrar que el
    formato es identico antes de cortar el resto de las bodegas.
    """
    bodega = request.args.get('bodega')
    conn = None
    try:
        conn, user, err = _entrar('ver', bodega)
        if err:
            return err
        cfg = BODEGAS[bodega]
        if cfg['tabla'] == 'public."tomasFisicas"':
            return jsonify({'error': 'La paridad se mide en las tablas toma_*'}), 400
        cur = conn.cursor()
        cant = COL_CANTIDADES[cfg['forma']]
        cur.execute(f'''
            SELECT fecha, usuario,
                   COUNT(*) AS productos,
                   SUM(total) AS suma_total,
                   MIN(id) AS id_muestra,
                   MIN({cant}) AS cantidades_muestra
            FROM {cfg['tabla']}
            WHERE fecha >= CURRENT_DATE - 30
            GROUP BY fecha, usuario
            ORDER BY fecha DESC
        ''')
        return jsonify({'bodega': bodega, 'dias': cur.fetchall()})
    except Exception as e:
        _log_error("/api/toma/paridad", e)
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            _release_db(conn)
