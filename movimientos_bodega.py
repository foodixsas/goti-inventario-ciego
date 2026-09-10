"""
Solicitudes de movimiento entre bodegas.

Replica del formulario de Airtable "Registro de Egresos Emergentes entre Tiendas"
(base GLOG - Logistica, tabla tblpeKmVHSsMopxBQ).

Los datos viven en Azure PostgreSQL, esquema goti, igual que el resto de la app.
Antes estuvieron en Supabase; se migraron el 7-sep-2026 porque el plan Free no
daba espacio para las fotos y Azure ya estaba pagado.

Tablas que usa:
    goti.gfc_solicitudes_movimiento   las solicitudes
    goti.gfc_matriz_productos         catalogo de productos (migrado de Airtable)
    goti.gth_matriz_colaboradores     personal (migrado de Airtable)
"""
import os
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify

TZ_ECUADOR = timezone(timedelta(hours=-5))

bp_movimientos = Blueprint('movimientos', __name__)

# Catalogos fijos. Viven aqui y no en tablas propias: son listas cortas que
# casi nunca cambian, y las bodegas ya estaban declaradas en static/js/config.js.
# La base valida los mismos valores con CHECK, asi que no se pierde integridad.

# id interno -> (nombre en pantalla, codigo Contifico, id Contifico, nombre en Contifico)
# Los tres ultimos salen de contifico_bodegas (Azure, base movimientos), verificados
# uno por uno. El worker necesita el id: los nombres NO coinciden entre sistemas
# (aqui 'Real Audiencia', alla 'BODEGA REAL'), asi que cruzar por texto falla.
BODEGAS_CONTIFICO = [
    ('real_audiencia',        'Real Audiencia',        'BOD002',  'QEMaxD5QSPDoa5GB', 'BODEGA REAL'),
    ('floreana',              'Floreana',              'BOD003',  'GEjb2ZVOF0WzbVNW', 'BODEGA FLOREANA'),
    ('portugal',              'Portugal',              'BOD004',  'OjZdyE51cAK5dJ4m', 'BODEGA PORTUGAL'),
    ('santo_cachon_real',     'Santo Cachon Real',     'BOD009',  '91qdG66Gvh2E5bN8', 'SANTO CACHON REAL'),
    ('santo_cachon_portugal', 'Santo Cachon Portugal', 'BOD011',  '4pzb82q6MhBWpeEw', 'SANTO CACHON PORTUGAL'),
    ('simon_bolon',           'Simon Bolon',           'BOD007',  'gArb688MPTZ7YeyR', 'BODEGA SIMON BOLON'),
    ('bodega_principal',      'Bodega Principal',      'BOD001',  'pKBe1ZRBCLxNaXyO', 'BODEGA PRINCIPAL'),
    ('materia_prima',         'Materia Prima',         'BOD0010', 'xBleXDDjXTkjoerN', 'BODEGA MATERIA PRIMA'),
    ('planta',                'Planta de Produccion',  'BOD005',  'DKVeZ7xAhXA9a8Py', 'PLANTA DE PRODUCCION'),
]
# En Contifico existen ademas BOD006 (CALIDAD) y BOD008 (PULMON); quedan fuera
# por decision de Jonathan. Para incluirlas hay que agregarlas aqui Y al CHECK.

# Replicados de Airtable: base GLOG, "Motivo de Fallas en Abastecimiento"
MOTIVOS = [
    ('alta_demanda',         'Alta Demanda y Capacidad Operativa'),
    ('gestion_inventario',   'Gestion de Inventario y Disponibilidad'),
    ('errores_pedido',       'Errores en el Cumplimiento del Pedido'),
    ('proveedores_externos', 'Problemas con Proveedores Externos'),
    ('errores_sistema',      'Errores del Sistema'),
    ('comunicacion_tienda',  'Comunicacion y Procesos Internos en Tienda'),
    ('comunicacion_planta',  'Comunicacion y Procesos Internos en planta'),
    ('eventos_externos',     'Eventos en proceso y situaciones Externos'),
    ('otros',                'Otros/No Especificados'),
]

BODEGAS                 = [(b[0], b[1]) for b in BODEGAS_CONTIFICO]
BODEGAS_NOMBRE          = dict(BODEGAS)
BODEGA_CONTIFICO_ID     = {b[0]: b[3] for b in BODEGAS_CONTIFICO}
BODEGA_CONTIFICO_CODIGO = {b[0]: b[2] for b in BODEGAS_CONTIFICO}
BODEGA_CONTIFICO_NOMBRE = {b[0]: b[4] for b in BODEGAS_CONTIFICO}
MOTIVOS_NOMBRE          = dict(MOTIVOS)

ESTADOS = ('pendiente', 'ejecutado', 'error', 'anulado')

# Token del worker que ejecuta los traslados en Contifico
WORKER_TOKEN = os.environ.get('MOVIMIENTOS_WORKER_TOKEN', '')


# ---------------------------------------------------------------- conexion

def _db():
    """Conexion del pool de la app. El import va aqui adentro para evitar el
    ciclo: app.py importa este modulo, no al reves."""
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


# ---------------------------------------------------------------- bodegas
# Las bodegas ya no estan escritas aqui: viven en goti.gfc_bodegas y se
# administran desde Configuracion > Bodegas. Las constantes de arriba quedan
# solo como semilla de esa tabla la primera vez.

def _catalogo_bodegas(cur):
    from bodegas import asegurar_tabla
    asegurar_tabla(cur)
    cur.execute("""SELECT id, nombre, contifico_id, contifico_codigo,
                          contifico_nombre, activo
                     FROM goti.gfc_bodegas ORDER BY orden, nombre""")
    return [dict(r) for r in cur.fetchall()]


def _mapas_bodegas(cur):
    """(nombre, id_contifico, codigo_contifico, nombre_contifico) por bodega."""
    filas = _catalogo_bodegas(cur)
    return ({b['id']: b['nombre']           for b in filas},
            {b['id']: b['contifico_id']     for b in filas},
            {b['id']: b['contifico_codigo'] for b in filas},
            {b['id']: b['contifico_nombre'] for b in filas})


# ---------------------------------------------------------------- catalogos

@bp_movimientos.route('/api/movimientos/catalogos', methods=['GET'])
def movimientos_catalogos():
    """Bodegas y motivos para los desplegables.

    Las bodegas salen de la tabla y solo las activas: una bodega desactivada no
    tiene que poder elegirse en una solicitud nueva, aunque siga en el historial.
    """
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        filas = _catalogo_bodegas(cur)
        conn.commit()
        return jsonify({
            'success': True,
            'bodegas': [{'id': b['id'], 'nombre': b['nombre'],
                         'sin_contifico': not b['contifico_id']}
                        for b in filas if b['activo']],
            'motivos': [{'id': i, 'nombre': n} for i, n in MOTIVOS],
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'catalogos')
    finally:
        _soltar(conn)


@bp_movimientos.route('/api/movimientos/colaboradores', methods=['GET'])
def movimientos_colaboradores():
    """Personas para 'Quien envia' y 'Quien recibe'.

    Salen de la Matriz de Colaboradores de Talento Humano. SOLO los Activos:
    quien ya salio de la empresa no puede entregar ni recibir mercaderia.
    Se agrupa por nombre porque la matriz repite personas por recontrataciones.
    """
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT ON (btrim(nombre))
                   btrim(nombre) AS nombre,
                   coalesce(btrim(cargo), '') AS cargo,
                   coalesce(array_to_string(tienda, ', '), '') AS tienda
              FROM goti.gth_matriz_colaboradores
             WHERE estado = 'Activo'
               AND nombre IS NOT NULL AND btrim(nombre) <> ''
             ORDER BY btrim(nombre)
        """)
        personas = [dict(r) for r in cur.fetchall()]
        return jsonify({'success': True, 'colaboradores': personas, 'total': len(personas)})
    except Exception as e:
        return _error(e, 'colaboradores')
    finally:
        _soltar(conn)


@bp_movimientos.route('/api/movimientos/productos', methods=['GET'])
def movimientos_productos():
    """Productos que se pueden mover entre bodegas.

    Solo los Activos que NO son para la venta: se traslada materia prima e
    insumos, no producto terminado de menu.
    """
    q = (request.args.get('q') or '').strip()
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        sql = """
            SELECT codigo, nombre_producto, und_min, unid_max,
                   unidad_contifico, categoria, uso_producto
              FROM goti.gfc_matriz_productos
             WHERE estado = 'Activo'
               AND para_la_venta IS FALSE
        """
        params = []
        if q:
            sql += " AND (nombre_producto ILIKE %s OR codigo ILIKE %s)"
            params += ['%' + q + '%', '%' + q + '%']
        sql += " ORDER BY nombre_producto LIMIT 2000"
        cur.execute(sql, params)
        productos = [dict(r) for r in cur.fetchall()]
        return jsonify({'success': True, 'productos': productos, 'total': len(productos)})
    except Exception as e:
        return _error(e, 'productos')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- solicitudes

CAMPOS_OBLIGATORIOS = [
    ('fecha_registro',  'Fecha de registro'),
    ('bodega_origen',   'Origen'),
    ('bodega_destino',  'Destino'),
    ('quien_envia',     'Quien envia'),
    ('quien_recibe',    'Quien recibe'),
    ('producto_codigo', 'Producto'),
    ('cantidad',        'Cantidad'),
    ('motivo_id',       'Motivo'),
]


@bp_movimientos.route('/api/movimientos/solicitar', methods=['POST'])
def movimientos_solicitar():
    d = request.get_json(silent=True) or {}

    faltan = [etiqueta for campo, etiqueta in CAMPOS_OBLIGATORIOS if not d.get(campo)]
    if faltan:
        return jsonify({'success': False,
                        'error': 'Faltan campos: ' + ', '.join(faltan)}), 400

    if d['bodega_origen'] == d['bodega_destino']:
        return jsonify({'success': False,
                        'error': 'El origen y el destino no pueden ser la misma bodega'}), 400

    try:
        cantidad = float(str(d['cantidad']).replace(',', '.'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'La cantidad debe ser un numero'}), 400
    if cantidad <= 0:
        return jsonify({'success': False, 'error': 'La cantidad debe ser mayor a cero'}), 400

    def limpio(campo):
        v = (d.get(campo) or '').strip()
        return v or None

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.gfc_solicitudes_movimiento
                (fecha_registro, bodega_origen, bodega_destino, quien_envia, quien_recibe,
                 producto_codigo, producto_nombre, cantidad, unidad, motivo_id,
                 observacion, registrado_por, estado)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pendiente')
            RETURNING *
        """, (d['fecha_registro'], d['bodega_origen'], d['bodega_destino'],
              (d.get('quien_envia') or '').strip(), (d.get('quien_recibe') or '').strip(),
              d['producto_codigo'], (d.get('producto_nombre') or '').strip(),
              cantidad, limpio('unidad'), d['motivo_id'],
              limpio('observacion'), limpio('registrado_por')))
        fila = dict(cur.fetchone())
        conn.commit()
        return jsonify({'success': True, 'solicitud': fila})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'guardar solicitud')
    finally:
        _soltar(conn)


@bp_movimientos.route('/api/movimientos/solicitudes', methods=['GET'])
def movimientos_listar():
    desde  = request.args.get('desde')
    hasta  = request.args.get('hasta')
    estado = request.args.get('estado')
    bodega = request.args.get('bodega')

    if not desde:
        desde = (datetime.now(TZ_ECUADOR) - timedelta(days=30)).strftime('%Y-%m-%d')

    sql = "SELECT * FROM goti.gfc_solicitudes_movimiento WHERE fecha_registro >= %s"
    params = [desde]
    if hasta:
        sql += " AND fecha_registro <= %s";       params.append(hasta)
    if estado:
        sql += " AND estado = %s";                params.append(estado)
    if bodega:
        sql += " AND (bodega_origen = %s OR bodega_destino = %s)"
        params += [bodega, bodega]
    sql += " ORDER BY fecha_registro DESC, id DESC LIMIT 500"

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        nombres = _mapas_bodegas(cur)[0]
        conn.commit()
        cur.execute(sql, params)
        filas = []
        for r in cur.fetchall():
            f = dict(r)
            f['motivo_nombre']          = MOTIVOS_NOMBRE.get(f.get('motivo_id'), f.get('motivo_id'))
            f['bodega_origen_nombre']   = nombres.get(f.get('bodega_origen'), f.get('bodega_origen'))
            f['bodega_destino_nombre']  = nombres.get(f.get('bodega_destino'), f.get('bodega_destino'))
            filas.append(f)
        return jsonify({'success': True, 'solicitudes': filas, 'total': len(filas)})
    except Exception as e:
        return _error(e, 'listar solicitudes')
    finally:
        _soltar(conn)


@bp_movimientos.route('/api/movimientos/solicitudes/<int:sol_id>/reprocesar', methods=['POST'])
def movimientos_reprocesar(sol_id):
    """Devuelve a la cola una solicitud que fallo.

    Es lo unico que puede hacer una persona sobre el estado. Marcar ejecutado o
    error le corresponde al worker: si alguien pudiera escribir 'ejecutado' a
    mano, el numero de traslado dejaria de ser una prueba.
    """
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.gfc_solicitudes_movimiento
               SET estado = 'pendiente', num_documento = NULL, nota_estado = NULL
             WHERE id = %s AND estado = 'error'
            RETURNING *
        """, (sol_id,))
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            return jsonify({'success': False,
                            'error': 'Solo se pueden reprocesar las que quedaron en error'}), 409
        conn.commit()
        return jsonify({'success': True, 'solicitud': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'reprocesar')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- anular

def _asegurar_anulacion(cur):
    """Agrega lo que hace falta para anular. Es idempotente: corre en cada
    llamada y no hace nada si ya esta puesto, igual que el resto de la app."""
    cur.execute("""
        ALTER TABLE goti.gfc_solicitudes_movimiento
              ADD COLUMN IF NOT EXISTS anulado_por      text,
              ADD COLUMN IF NOT EXISTS anulado_en       timestamptz,
              ADD COLUMN IF NOT EXISTS motivo_anulacion text
    """)
    # El CHECK original solo conocia pendiente/ejecutado/error
    cur.execute("""
        SELECT 1 FROM pg_constraint con
          JOIN pg_class t ON t.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'goti'
           AND t.relname = 'gfc_solicitudes_movimiento'
           AND con.conname = 'chk_estado'
           AND pg_get_constraintdef(con.oid) LIKE '%anulado%'
    """)
    if not cur.fetchone():
        cur.execute("""ALTER TABLE goti.gfc_solicitudes_movimiento
                        DROP CONSTRAINT IF EXISTS chk_estado""")
        cur.execute("""ALTER TABLE goti.gfc_solicitudes_movimiento
                        ADD CONSTRAINT chk_estado CHECK (estado = ANY (ARRAY[
                            'pendiente'::text, 'ejecutado'::text,
                            'error'::text, 'anulado'::text]))""")


def _es_admin(conn, usuario, clave):
    if not usuario or not clave:
        return False
    cur = conn.cursor()
    cur.execute("""SELECT 1 FROM goti.usuarios
                    WHERE username = %s AND password = %s
                      AND rol = 'admin' AND activo = TRUE""", (usuario, clave))
    return cur.fetchone() is not None


@bp_movimientos.route('/api/movimientos/solicitudes/<int:sol_id>/anular', methods=['POST'])
def movimientos_anular(sol_id):
    """Cancela una solicitud para que el worker no la ejecute. Solo administrador.

    No se borra la fila: queda en estado 'anulado' con quien la anulo y por que.
    Una solicitud que existio y se decidio parar es informacion, y borrarla
    dejaria el hueco sin explicacion.

    Una ya 'ejecutado' NO se puede anular: el traslado ya existe en Contifico y
    marcarla aqui no lo deshace. Para eso hay que reversar el traslado alla.
    """
    d = request.get_json(silent=True) or {}
    motivo = (d.get('motivo') or '').strip() or None

    conn = None
    try:
        conn = _db()
        if not _es_admin(conn, (d.get('admin_user') or '').strip(),
                         d.get('admin_pass') or ''):
            return jsonify({'success': False,
                            'error': 'Solo un administrador puede anular movimientos'}), 403

        cur = conn.cursor()
        _asegurar_anulacion(cur)
        cur.execute("""
            UPDATE goti.gfc_solicitudes_movimiento
               SET estado = 'anulado', anulado_por = %s, anulado_en = now(),
                   motivo_anulacion = %s
             WHERE id = %s AND estado IN ('pendiente', 'error')
            RETURNING *
        """, ((d.get('admin_user') or '').strip(), motivo, sol_id))
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            cur.execute("""SELECT estado FROM goti.gfc_solicitudes_movimiento
                            WHERE id = %s""", (sol_id,))
            actual = cur.fetchone()
            if not actual:
                return jsonify({'success': False, 'error': 'Esa solicitud no existe'}), 404
            if actual['estado'] == 'ejecutado':
                return jsonify({'success': False,
                                'error': 'Ya se ejecuto en Contifico: el traslado existe. '
                                         'Hay que reversarlo alla, no anularlo aqui.'}), 409
            return jsonify({'success': False,
                            'error': 'Ya estaba anulada'}), 409
        conn.commit()
        return jsonify({'success': True, 'solicitud': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'anular')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- cola del worker
# El estado NO lo pone una persona: lo pone el worker que ejecuta el traslado en
# Contifico. Estos dos endpoints son su contrato.

def _worker_autorizado():
    if not WORKER_TOKEN:
        return False
    return request.headers.get('X-Worker-Token', '') == WORKER_TOKEN


@bp_movimientos.route('/api/movimientos/cola', methods=['GET'])
def movimientos_cola():
    """Pendientes en orden de llegada, con las bodegas ya resueltas a Contifico."""
    if not _worker_autorizado():
        return jsonify({'success': False, 'error': 'No autorizado'}), 401
    try:
        limite = min(int(request.args.get('limite', 20)), 100)
    except ValueError:
        limite = 20

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        nombres, cont_id, cont_cod, cont_nom = _mapas_bodegas(cur)
        conn.commit()
        cur.execute("""
            SELECT * FROM goti.gfc_solicitudes_movimiento
             WHERE estado = 'pendiente'
             ORDER BY creado_en ASC
             LIMIT %s
        """, (limite,))
        listas, sin_mapeo = [], 0
        for r in cur.fetchall():
            f = dict(r)
            org, des = f.get('bodega_origen'), f.get('bodega_destino')
            f['bodega_origen_nombre']  = nombres.get(org)
            f['bodega_destino_nombre'] = nombres.get(des)
            f['motivo_nombre'] = MOTIVOS_NOMBRE.get(f.get('motivo_id'), f.get('motivo_id'))
            f['origen_contifico'] = {'id':     cont_id.get(org),
                                     'codigo': cont_cod.get(org),
                                     'nombre': cont_nom.get(org)}
            f['destino_contifico'] = {'id':     cont_id.get(des),
                                      'codigo': cont_cod.get(des),
                                      'nombre': cont_nom.get(des)}
            if f['origen_contifico']['id'] and f['destino_contifico']['id']:
                listas.append(f)
            else:
                sin_mapeo += 1     # no se entregan: el worker no sabria a donde mover
        return jsonify({'success': True, 'pendientes': listas,
                        'total': len(listas), 'sin_mapeo': sin_mapeo})
    except Exception as e:
        return _error(e, 'cola')
    finally:
        _soltar(conn)


@bp_movimientos.route('/api/movimientos/solicitudes/<int:sol_id>/resultado', methods=['POST'])
def movimientos_resultado(sol_id):
    """El worker reporta como le fue con un traslado.

    Exito -> {"ok": true,  "num_documento": "TRA 202609000123"}
    Fallo -> {"ok": false, "error": "Producto sin codigo Contifico"}

    Solo acepta el reporte si la solicitud sigue pendiente, para que dos
    ejecuciones del worker no pisen un resultado anterior.
    """
    if not _worker_autorizado():
        return jsonify({'success': False, 'error': 'No autorizado'}), 401

    d = request.get_json(silent=True) or {}
    ok = bool(d.get('ok'))

    if ok:
        doc = (d.get('num_documento') or '').strip()
        if not doc:
            return jsonify({'success': False,
                            'error': 'Un traslado ejecutado tiene que traer su numero '
                                     'de documento'}), 400
        sets, params = "estado='ejecutado', num_documento=%s, nota_estado=NULL", [doc]
    else:
        sets = "estado='error', nota_estado=%s"
        params = [(d.get('error') or 'Fallo sin detalle')[:500]]

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.gfc_solicitudes_movimiento SET %s
             WHERE id = %%s AND estado = 'pendiente'
            RETURNING *
        """ % sets, params + [sol_id])
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            return jsonify({'success': False,
                            'error': 'Esa solicitud no existe o ya no estaba pendiente'}), 409
        conn.commit()
        return jsonify({'success': True, 'solicitud': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'reportar resultado')
    finally:
        _soltar(conn)
