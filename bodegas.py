"""
Bodegas: el catalogo, con su vinculo al id que maneja Contifico.

Hasta ahora las bodegas estaban escritas a mano en tres lugares a la vez
(movimientos_bodega.py, static/js/config.js y un CHECK en la base). Agregar una
obligaba a tocar codigo y a correr un ALTER. Ahora viven en una tabla y se
administran desde la app.

Tabla: goti.gfc_bodegas

Por que el id de Contifico y no el nombre: los nombres NO coinciden entre los
dos sistemas -- aqui 'Real Audiencia', alla 'BODEGA REAL'. Cruzar por texto
falla, y el worker que ejecuta los traslados necesita el id exacto. El catalogo
de Contifico se lee de la base `movimientos` (tabla contifico_bodegas) para que
el id se elija de una lista y no se teclee.

Una bodega sin id de Contifico se puede crear igual: sirve para la operacion,
pero el worker no puede mover nada hacia ella ni desde ella, y la interfaz lo
avisa.
"""
from flask import Blueprint, request, jsonify

bp_bodegas = Blueprint('bodegas', __name__)

TABLA = 'goti.gfc_bodegas'

# Semilla: lo que estaba escrito a mano en movimientos_bodega.py, verificado uno
# por uno contra Contifico. Solo se usa la primera vez, para no arrancar vacio.
SEMILLA = [
    ('real_audiencia',        'Real Audiencia',        'QEMaxD5QSPDoa5GB', 'BOD002',  'BODEGA REAL',           10),
    ('floreana',              'Floreana',              'GEjb2ZVOF0WzbVNW', 'BOD003',  'BODEGA FLOREANA',       20),
    ('portugal',              'Portugal',              'OjZdyE51cAK5dJ4m', 'BOD004',  'BODEGA PORTUGAL',       30),
    ('santo_cachon_real',     'Santo Cachon Real',     '91qdG66Gvh2E5bN8', 'BOD009',  'SANTO CACHON REAL',     40),
    ('santo_cachon_portugal', 'Santo Cachon Portugal', '4pzb82q6MhBWpeEw', 'BOD011',  'SANTO CACHON PORTUGAL', 50),
    ('simon_bolon',           'Simon Bolon',           'gArb688MPTZ7YeyR', 'BOD007',  'BODEGA SIMON BOLON',    60),
    ('bodega_principal',      'Bodega Principal',      'pKBe1ZRBCLxNaXyO', 'BOD001',  'BODEGA PRINCIPAL',      70),
    ('materia_prima',         'Materia Prima',         'xBleXDDjXTkjoerN', 'BOD0010', 'BODEGA MATERIA PRIMA',  80),
    ('planta',                'Planta de Produccion',  'DKVeZ7xAhXA9a8Py', 'BOD005',  'PLANTA DE PRODUCCION',  90),
]


# ---------------------------------------------------------------- conexion

def _db():
    from app import get_db
    return get_db()


def _soltar(conn):
    if conn is None:
        return
    from app import release_db
    release_db(conn)


def _error(e, contexto):
    return jsonify({'success': False,
                    'error': '%s: %s' % (contexto, str(e)[:300])}), 500


def _es_admin(conn, usuario, clave):
    if not usuario or not clave:
        return False
    cur = conn.cursor()
    cur.execute("""SELECT 1 FROM goti.usuarios
                    WHERE username = %s AND password = %s
                      AND rol = 'admin' AND activo = TRUE""", (usuario, clave))
    return cur.fetchone() is not None


# ---------------------------------------------------------------- esquema

def asegurar_tabla(cur):
    """Crea la tabla y la siembra si hace falta. Idempotente: corre en cada
    llamada, igual que el resto de la app."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS goti.gfc_bodegas (
            id               text PRIMARY KEY,
            nombre           text NOT NULL,
            contifico_id     text,
            contifico_codigo text,
            contifico_nombre text,
            activo           boolean NOT NULL DEFAULT TRUE,
            orden            integer NOT NULL DEFAULT 100,
            nota             text,
            creado_en        timestamptz DEFAULT now(),
            modificado_en    timestamptz,
            modificado_por   text
        )
    """)
    # Dos bodegas distintas no pueden apuntar al mismo destino en Contifico: el
    # worker mandaria el traslado al lugar equivocado sin que nadie lo note.
    cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS gfc_bodegas_contifico_id_uk
                     ON goti.gfc_bodegas (contifico_id)
                  WHERE contifico_id IS NOT NULL""")

    cur.execute('SELECT count(*) AS n FROM goti.gfc_bodegas')
    if cur.fetchone()['n'] == 0:
        for fila in SEMILLA:
            cur.execute("""INSERT INTO goti.gfc_bodegas
                               (id, nombre, contifico_id, contifico_codigo,
                                contifico_nombre, orden)
                           VALUES (%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (id) DO NOTHING""", fila)


def _liberar_check(cur):
    """Cambia el CHECK de lista fija de las solicitudes por una llave foranea.

    Con el CHECK, agregar una bodega desde la app no servia de nada: la base
    seguia rechazando la solicitud. La foranea da la misma garantia y ademas se
    actualiza sola cuando el catalogo crece.
    """
    for nombre in ('chk_bodega_origen', 'chk_bodega_destino'):
        cur.execute("""ALTER TABLE goti.gfc_solicitudes_movimiento
                        DROP CONSTRAINT IF EXISTS %s""" % nombre)

    cur.execute("""
        SELECT conname FROM pg_constraint con
          JOIN pg_class t ON t.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'goti' AND t.relname = 'gfc_solicitudes_movimiento'
           AND con.conname IN ('fk_bodega_origen', 'fk_bodega_destino')
    """)
    ya = {r['conname'] for r in cur.fetchall()}

    if 'fk_bodega_origen' not in ya:
        cur.execute("""ALTER TABLE goti.gfc_solicitudes_movimiento
                        ADD CONSTRAINT fk_bodega_origen
                        FOREIGN KEY (bodega_origen) REFERENCES goti.gfc_bodegas(id)""")
    if 'fk_bodega_destino' not in ya:
        cur.execute("""ALTER TABLE goti.gfc_solicitudes_movimiento
                        ADD CONSTRAINT fk_bodega_destino
                        FOREIGN KEY (bodega_destino) REFERENCES goti.gfc_bodegas(id)""")


# ---------------------------------------------------------------- listado

@bp_bodegas.route('/api/bodegas', methods=['GET'])
def bodegas_listar():
    solo_activas = (request.args.get('activas') or '').strip() == '1'
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)
        conn.commit()
        cur.execute("""SELECT * FROM goti.gfc_bodegas %s
                        ORDER BY orden, nombre"""
                    % ('WHERE activo IS TRUE' if solo_activas else ''))
        filas = [dict(r) for r in cur.fetchall()]
        return jsonify({'success': True, 'bodegas': filas, 'total': len(filas),
                        'sin_contifico': sum(1 for f in filas if not f['contifico_id'])})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'listar bodegas')
    finally:
        _soltar(conn)


@bp_bodegas.route('/api/bodegas/contifico', methods=['GET'])
def bodegas_contifico():
    """El catalogo de Contifico, para elegir el id en vez de teclearlo.

    Vive en otra base (movimientos), por eso la conexion aparte. Se marca cual
    ya esta tomada por una bodega nuestra.
    """
    conn = conn_mov = None
    try:
        from app import fc_get_movimientos_db, fc_release_movimientos_db
        conn_mov = fc_get_movimientos_db()
        # Ojo: esta conexion NO usa RealDictCursor, devuelve tuplas. Se arma el
        # diccionario por posicion.
        cur = conn_mov.cursor()
        cur.execute("""SELECT id, codigo, nombre FROM public.contifico_bodegas
                        ORDER BY codigo""")
        catalogo = [{'id': r[0], 'codigo': r[1], 'nombre': r[2]} for r in cur.fetchall()]
        fc_release_movimientos_db(conn_mov)
        conn_mov = None

        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)
        conn.commit()
        cur.execute("""SELECT contifico_id, id, nombre FROM goti.gfc_bodegas
                        WHERE contifico_id IS NOT NULL""")
        tomadas = {r['contifico_id']: r for r in cur.fetchall()}

        for c in catalogo:
            usada = tomadas.get(c['id'])
            c['usada_por'] = usada['nombre'] if usada else None
            c['bodega_id'] = usada['id'] if usada else None

        return jsonify({'success': True, 'contifico': catalogo,
                        'total': len(catalogo),
                        'libres': sum(1 for c in catalogo if not c['usada_por'])})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'catalogo de Contifico')
    finally:
        if conn_mov is not None:
            from app import fc_release_movimientos_db
            fc_release_movimientos_db(conn_mov)
        _soltar(conn)


# ---------------------------------------------------------------- crear

def _limpio(d, campo):
    v = (d.get(campo) or '')
    v = str(v).strip()
    return v or None


def _identificador(texto):
    """'Santo Cachon Real' -> 'santo_cachon_real'. El id es interno y se usa en
    la base y en las URLs, asi que va sin tildes, espacios ni mayusculas."""
    tildes = {u'á': 'a', u'é': 'e', u'í': 'i', u'ó': 'o', u'ú': 'u', u'ñ': 'n',
              u'Á': 'a', u'É': 'e', u'Í': 'i', u'Ó': 'o', u'Ú': 'u', u'Ñ': 'n'}
    salida = []
    for ch in (texto or '').strip().lower():
        ch = tildes.get(ch, ch)
        if ch.isalnum():
            salida.append(ch)
        elif ch in ' -_/.':
            salida.append('_')
    limpio = ''.join(salida)
    while '__' in limpio:
        limpio = limpio.replace('__', '_')
    return limpio.strip('_')


@bp_bodegas.route('/api/bodegas', methods=['POST'])
def bodegas_crear():
    d = request.get_json(silent=True) or {}
    nombre = _limpio(d, 'nombre')
    if not nombre:
        return jsonify({'success': False, 'error': 'El nombre es obligatorio'}), 400

    bid = _limpio(d, 'id') or _identificador(nombre)
    if not bid:
        return jsonify({'success': False,
                        'error': 'No se pudo armar un identificador con ese nombre'}), 400

    try:
        orden = int(d.get('orden') or 100)
    except (TypeError, ValueError):
        orden = 100

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)

        cur.execute('SELECT 1 FROM goti.gfc_bodegas WHERE id = %s', (bid,))
        if cur.fetchone():
            conn.rollback()
            return jsonify({'success': False,
                            'error': 'Ya existe una bodega con el identificador ' + bid}), 409

        cont_id = _limpio(d, 'contifico_id')
        if cont_id:
            cur.execute("""SELECT nombre FROM goti.gfc_bodegas
                            WHERE contifico_id = %s""", (cont_id,))
            choque = cur.fetchone()
            if choque:
                conn.rollback()
                return jsonify({'success': False,
                                'error': 'Ese id de Contifico ya lo usa la bodega "%s"'
                                         % choque['nombre']}), 409

        cur.execute("""INSERT INTO goti.gfc_bodegas
                           (id, nombre, contifico_id, contifico_codigo, contifico_nombre,
                            activo, orden, nota, modificado_en, modificado_por)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now(),%s)
                       RETURNING *""",
                    (bid, nombre, cont_id, _limpio(d, 'contifico_codigo'),
                     _limpio(d, 'contifico_nombre'),
                     d.get('activo', True) is not False, orden,
                     _limpio(d, 'nota'), _limpio(d, 'usuario')))
        fila = dict(cur.fetchone())
        _liberar_check(cur)          # que la bodega nueva se pueda usar de verdad
        conn.commit()
        return jsonify({'success': True, 'bodega': fila})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'crear bodega')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- modificar

CAMPOS_EDITABLES = ['nombre', 'contifico_id', 'contifico_codigo',
                    'contifico_nombre', 'activo', 'orden', 'nota']


@bp_bodegas.route('/api/bodegas/<bid>', methods=['PUT'])
def bodegas_modificar(bid):
    d = request.get_json(silent=True) or {}

    sets, params = [], []
    for col in CAMPOS_EDITABLES:
        if col not in d:
            continue
        if col == 'activo':
            valor = bool(d[col])
        elif col == 'orden':
            try:
                valor = int(d[col] or 100)
            except (TypeError, ValueError):
                valor = 100
        else:
            valor = _limpio(d, col)
        sets.append('%s = %%s' % col)
        params.append(valor)

    if not sets:
        return jsonify({'success': False, 'error': 'No se mando ningun cambio'}), 400
    if 'nombre' in d and not _limpio(d, 'nombre'):
        return jsonify({'success': False, 'error': 'El nombre no puede quedar vacio'}), 400

    sets += ['modificado_en = now()', 'modificado_por = %s']
    params.append(_limpio(d, 'usuario'))

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)

        cont_id = _limpio(d, 'contifico_id') if 'contifico_id' in d else None
        if cont_id:
            cur.execute("""SELECT nombre FROM goti.gfc_bodegas
                            WHERE contifico_id = %s AND id <> %s""", (cont_id, bid))
            choque = cur.fetchone()
            if choque:
                conn.rollback()
                return jsonify({'success': False,
                                'error': 'Ese id de Contifico ya lo usa la bodega "%s"'
                                         % choque['nombre']}), 409

        cur.execute('UPDATE goti.gfc_bodegas SET %s WHERE id = %%s RETURNING *'
                    % ', '.join(sets), params + [bid])
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            return jsonify({'success': False, 'error': 'No existe la bodega ' + bid}), 404
        conn.commit()
        return jsonify({'success': True, 'bodega': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'modificar bodega')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- borrar

@bp_bodegas.route('/api/bodegas/<bid>/uso', methods=['GET'])
def bodegas_uso(bid):
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute("""SELECT count(*) AS n FROM goti.gfc_solicitudes_movimiento
                        WHERE bodega_origen = %s OR bodega_destino = %s""", (bid, bid))
        n = cur.fetchone()['n']
        usos = [{'donde': 'solicitudes de movimiento', 'registros': n}] if n else []
        return jsonify({'success': True, 'usos': usos, 'se_puede_borrar': not usos})
    except Exception as e:
        return _error(e, 'uso de la bodega')
    finally:
        _soltar(conn)


@bp_bodegas.route('/api/bodegas/<bid>', methods=['DELETE'])
def bodegas_borrar(bid):
    """Borra una bodega. Solo administrador, y solo si no la usa ninguna solicitud.

    Cuando ya se movio mercaderia con ella, la baja correcta es desactivarla:
    deja de ofrecerse en los desplegables y el historico sigue leyendose.
    """
    d = request.get_json(silent=True) or {}
    conn = None
    try:
        conn = _db()
        if not _es_admin(conn, (d.get('admin_user') or '').strip(),
                         d.get('admin_pass') or ''):
            return jsonify({'success': False,
                            'error': 'Solo un administrador puede borrar bodegas'}), 403

        cur = conn.cursor()
        cur.execute("""SELECT count(*) AS n FROM goti.gfc_solicitudes_movimiento
                        WHERE bodega_origen = %s OR bodega_destino = %s""", (bid, bid))
        n = cur.fetchone()['n']
        if n:
            return jsonify({'success': False,
                            'error': 'No se puede borrar: la bodega esta en %d solicitud(es) '
                                     'de movimiento. Desactivala en vez de borrarla.' % n}), 409

        cur.execute('DELETE FROM goti.gfc_bodegas WHERE id = %s RETURNING id, nombre', (bid,))
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            return jsonify({'success': False, 'error': 'No existe la bodega ' + bid}), 404
        conn.commit()
        return jsonify({'success': True, 'borrada': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'borrar bodega')
    finally:
        _soltar(conn)


# ===========================================================================
# SINCRONIZAR BODEGAS CON CONTIFICO
#
# Antes, para vincular una bodega habia que entrar a Contifico, buscar el hash
# del id y copiarlo a mano. Eso es justo donde se cuela un error que despues
# manda un traslado a la bodega equivocada sin que nadie lo note.
#
# Aqui se leen las bodegas directo de la API de Contifico (son 12 y vienen en
# una sola llamada, no hace falta hilo de fondo como en los productos) y se
# comparan contra goti.gfc_bodegas. De lo que falte se puede crear la bodega
# con el id ya puesto.
#
# Ojo: el endpoint /api/bodegas/contifico lee de public.contifico_bodegas, que
# es un espejo en la base `movimientos` y puede estar atrasado. Este va a la
# fuente.
# ===========================================================================
import json
import os
import re
import unicodedata
import urllib.error
import urllib.request

CF_BODEGA_URL = 'https://api.contifico.com/sistema/api/v1/bodega/'


def _cf_llave_bod():
    return os.environ.get('CONTIFICO_API_KEY', '').strip()


def _cf_bodegas():
    req = urllib.request.Request(
        CF_BODEGA_URL, headers={'Authorization': _cf_llave_bod(),
                                'Accept': 'application/json'})
    d = json.loads(urllib.request.urlopen(req, timeout=60).read())
    return d if isinstance(d, list) else d.get('results', [])


# Los conectores van en minuscula: 'Planta de Produccion', no 'Planta De
# Produccion'. Nunca la primera palabra.
_MENORES = {'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a'}


def _titulo(t):
    """'BODEGA PULMON' -> 'Bodega Pulmon'.

    Contifico devuelve los nombres TODO EN MAYUSCULAS y asi se quedaban al
    crear la bodega, conviviendo con las que ya estaban en nombre propio.
    """
    palabras = ' '.join(str(t or '').split()).split(' ')
    fuera = []
    for i, p in enumerate(palabras):
        b = p.lower()
        fuera.append(b if (i > 0 and b in _MENORES) else b[:1].upper() + b[1:])
    return ' '.join(fuera)


def _clave_sugerida(nombre, usadas):
    """'BODEGA SANTO CACHON' -> 'santo_cachon'.

    El id de gfc_bodegas es texto y lo eligio una persona (bodega_principal,
    floreana...). Se propone uno con el mismo estilo para no tener que
    inventarlo, pero se puede cambiar antes de crear.
    """
    t = unicodedata.normalize('NFKD', nombre or '')
    t = ''.join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r'^bodega\s+', '', t.strip())
    t = re.sub(r'[^a-z0-9]+', '_', t).strip('_') or 'bodega'
    base, n = t, 2
    while t in usadas:
        t = '%s_%d' % (base, n)
        n += 1
    return t


@bp_bodegas.route('/api/bodegas/sincronizar', methods=['GET'])
def bodegas_sincronizar():
    """Que bodegas hay en Contifico que aqui todavia no estan."""
    if not _cf_llave_bod():
        return jsonify({'success': False,
                        'error': 'Falta CONTIFICO_API_KEY en el servidor',
                        'detalle': 'Definir la variable de entorno en Render.'}), 503
    conn = None
    try:
        try:
            catalogo = _cf_bodegas()
        except urllib.error.HTTPError as e:
            return jsonify({'success': False,
                            'error': 'Contifico respondio %s' % e.code}), 502

        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)
        conn.commit()
        cur.execute('SELECT id, nombre, contifico_id, contifico_codigo, activo'
                    ' FROM %s' % TABLA)
        mias = [dict(r) for r in cur.fetchall()]
        por_cf = {m['contifico_id']: m for m in mias if m['contifico_id']}
        usadas = set(m['id'] for m in mias)

        nuevas, vinculadas = [], []
        for c in catalogo:
            cid = c.get('id')
            mia = por_cf.get(cid)
            if mia:
                vinculadas.append({
                    'contifico_id': cid,
                    'codigo': c.get('codigo'),
                    'nombre_contifico': c.get('nombre'),
                    'bodega': mia['id'],
                    'nombre': mia['nombre'],
                    'activo': mia['activo'],
                    # El nombre pudo cambiar en Contifico despues de vincular
                    'nombre_cambio': (mia.get('contifico_codigo') or '') != (c.get('codigo') or ''),
                })
            else:
                sug = _clave_sugerida(c.get('nombre'), usadas)
                usadas.add(sug)
                nuevas.append({
                    'contifico_id': cid,
                    'codigo': c.get('codigo'),
                    'nombre_contifico': c.get('nombre'),
                    'nombre_sugerido': _titulo(c.get('nombre')),
                    'id_sugerido': sug,
                    'venta': c.get('venta'),
                    'compra': c.get('compra'),
                    'produccion': c.get('produccion'),
                })

        # Bodegas nuestras que apuntan a un id que ya no existe en Contifico:
        # el traslado fallaria y conviene verlo.
        ids_cf = set(c.get('id') for c in catalogo)
        rotas = [{'bodega': m['id'], 'nombre': m['nombre'],
                  'contifico_id': m['contifico_id']}
                 for m in mias if m['contifico_id'] and m['contifico_id'] not in ids_cf]

        sin_vincular = [{'bodega': m['id'], 'nombre': m['nombre']}
                        for m in mias if not m['contifico_id']]

        return jsonify({'success': True, 'contifico': len(catalogo),
                        'nuevas': nuevas, 'vinculadas': vinculadas,
                        'rotas': rotas, 'sin_vincular': sin_vincular})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'sincronizar bodegas')
    finally:
        _soltar(conn)


@bp_bodegas.route('/api/bodegas/sincronizar', methods=['POST'])
def bodegas_sincronizar_crear():
    """Crea las bodegas elegidas, con el id de Contifico ya puesto.

    Solo admin, igual que crear una bodega a mano: una bodega mal vinculada
    manda mercaderia al lugar equivocado.
    """
    d = request.get_json(silent=True) or {}
    pedidas = d.get('crear') or []
    if not pedidas:
        return jsonify({'success': False, 'error': 'No se eligio ninguna bodega'}), 400

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        if not _es_admin(conn, (d.get('admin_user') or '').strip(),
                         (d.get('admin_pass') or '').strip()):
            return jsonify({'success': False,
                            'error': 'Solo un administrador puede crear bodegas'}), 403

        asegurar_tabla(cur)
        catalogo = {c.get('id'): c for c in _cf_bodegas()}

        cur.execute('SELECT COALESCE(MAX(orden), 100) AS m FROM %s' % TABLA)
        orden = (cur.fetchone()['m'] or 100)

        creadas, fallidas = [], []
        for p in pedidas:
            cid = (p.get('contifico_id') or '').strip()
            bid = (p.get('id') or '').strip().lower()
            c = catalogo.get(cid)
            if not c:
                fallidas.append({'id': bid or cid,
                                 'motivo': 'ese id ya no esta en Contifico'})
                continue
            if not bid:
                fallidas.append({'id': cid, 'motivo': 'falta la clave de la bodega'})
                continue
            if not re.match(r'^[a-z][a-z0-9_]*$', bid):
                fallidas.append({'id': bid, 'motivo': 'la clave solo admite '
                                 'minusculas, numeros y guion bajo'})
                continue
            orden += 10
            try:
                cur.execute(
                    'INSERT INTO %s (id, nombre, contifico_id, contifico_codigo,'
                    ' contifico_nombre, orden, modificado_por, modificado_en)'
                    ' VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,now())' % TABLA,
                    (bid, _titulo(p.get('nombre') or c.get('nombre')), cid,
                     c.get('codigo'), c.get('nombre'), orden,
                     (d.get('admin_user') or '').strip() or None))
                creadas.append({'id': bid, 'nombre': p.get('nombre') or c.get('nombre'),
                                'contifico_id': cid})
            except Exception as e:
                conn.rollback()
                motivo = str(e)[:120]
                if 'gfc_bodegas_contifico_id_uk' in motivo:
                    motivo = 'esa bodega de Contifico ya esta vinculada'
                elif 'pkey' in motivo:
                    motivo = 'ya existe una bodega con la clave ' + bid
                fallidas.append({'id': bid, 'motivo': motivo})

        conn.commit()
        return jsonify({'success': True, 'creadas': creadas, 'fallidas': fallidas})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'crear bodegas desde Contifico')
    finally:
        _soltar(conn)
