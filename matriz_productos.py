"""
Matriz General de Productos: el maestro de productos, editable desde la app.

Hasta ahora esta tabla solo se miraba (el desplegable de movimientos entre
bodegas). Vivia en Airtable y se migro a Azure; desde aqui se crea, modifica y
da de baja sin volver a Airtable.

Tabla: goti.gfc_matriz_productos  (PK = codigo, 1264 filas)

Dos cosas que conviene tener presentes:

- La tabla ya trae los flags `conteo_*` por bodega. NO son los que hoy usan el
  conteo diario ni el cruce operativo: esos leen goti.productos_por_marca, que
  se curo a mano y tiene otros numeros (Chios: 170 aqui contra 40 alla). Se
  editan aqui, pero nada se sincroniza solo hasta que se decida como.

- Borrar es de verdad: la fila desaparece. Por eso solo se permite cuando el
  producto no esta referenciado en ningun lado, y solo a un administrador. Para
  el resto de los casos esta `estado = 'Inactivo'`, que es lo que la operacion
  entiende como dar de baja.
"""
from flask import Blueprint, request, jsonify

bp_matriz = Blueprint('matriz', __name__)

TABLA = 'goti.gfc_matriz_productos'

# ---------------------------------------------------------------------------
# Definicion de campos. Es la unica fuente de verdad: de aqui salen el SELECT,
# el whitelist del INSERT/UPDATE y los grupos que el formulario dibuja. Ninguna
# columna llega a un SQL sin pasar por esta lista.
#
#   (columna, etiqueta, tipo, grupo)
#   tipo: texto | area | num | bool | array | fecha | ro (solo lectura)
# ---------------------------------------------------------------------------
CAMPOS = [
    # --- Identificacion
    ('codigo',                   'Codigo',              'texto', 'identificacion'),
    ('nombre_producto',          'Nombre del producto', 'texto', 'identificacion'),
    ('categoria',                'Categoria',           'texto', 'identificacion'),
    ('uso_producto',             'Uso del producto',    'texto', 'identificacion'),
    ('tipo_producto',            'Tipo de producto',    'texto', 'identificacion'),
    ('tipo_a_b_o_c',             'Tipo A/B/C',          'texto', 'identificacion'),
    ('estado',                   'Estado',              'texto', 'identificacion'),
    ('inventariable',            'Inventariable',       'texto', 'identificacion'),
    ('vida_util',                'Vida util',           'texto', 'identificacion'),
    ('marca',                    'Marca',               'array', 'identificacion'),
    ('descripcion',              'Descripcion',         'area',  'identificacion'),
    ('para_la_venta',            'Para la venta',       'bool',  'identificacion'),
    ('para_la_compra',           'Para la compra',      'bool',  'identificacion'),
    ('para_pos',                 'Para POS',            'bool',  'identificacion'),

    # --- Conteo por bodega (flag + unidad con la que se cuenta ahi)
    ('unidad_de_conteo_general',        'Unidad de conteo general', 'texto', 'conteo'),
    ('conteo_chios',                    'Chios',                'bool',  'conteo'),
    ('unidad_conteo_chios',             'Unidad Chios',         'texto', 'conteo'),
    ('conteo_simon_bolon',              'Simon Bolon',          'bool',  'conteo'),
    ('unidad_conteo_simon_bolon',       'Unidad Simon Bolon',   'texto', 'conteo'),
    ('conteo_santo_cachon',             'Santo Cachon',         'bool',  'conteo'),
    ('unidad_conteo_santo_cachon',      'Unidad Santo Cachon',  'texto', 'conteo'),
    ('conteo_planta_produccion',        'Planta de Produccion', 'bool',  'conteo'),
    ('unidad_conteo_planta_produccion', 'Unidad Planta',        'texto', 'conteo'),
    ('conteo_bodega_principal',         'Bodega Principal',     'bool',  'conteo'),
    ('unidad_conteo_bodega_principal',  'Unidad Bodega Principal', 'texto', 'conteo'),
    ('conteo_bodega_materia_prima',     'Bodega Materia Prima', 'bool',  'conteo'),
    ('unidad_conteo_bodega_materia_prima', 'Unidad Materia Prima', 'texto', 'conteo'),
    ('conteo_bodega_pulmon',            'Bodega Pulmon',        'bool',  'conteo'),
    ('unidad_conteo_bodega_pulmon',     'Unidad Bodega Pulmon', 'texto', 'conteo'),

    # --- Unidades y equivalencias
    ('und_min',                  'Unidad minima',        'texto', 'equivalencias'),
    ('unid_max',                 'Unidad maxima',        'texto', 'equivalencias'),
    ('unidad_contifico',         'Unidad Contifico',     'texto', 'equivalencias'),
    ('equivalencia_producto',    'Equivalencia producto','num',   'equivalencias'),
    ('equivalencia_envase',      'Equivalencia envase',  'num',   'equivalencias'),
    ('unidad_equivalencia',      'Unidad equivalencia',  'texto', 'equivalencias'),
    ('estado_de_equivalencia',   'Estado equivalencia',  'texto', 'equivalencias'),
    ('equivalencias_inventarios','Equivalencias inventarios', 'texto', 'equivalencias'),
    ('revision_equivalencia',    'Revision equivalencia','bool',  'equivalencias'),

    # --- Precios
    ('costo',                    'Costo',               'num', 'precios'),
    ('pvp1',                     'PVP 1',               'num', 'precios'),
    ('pvp1_iva',                 'PVP 1 + IVA',         'num', 'precios'),
    ('pvp2',                     'PVP 2',               'num', 'precios'),
    ('pvp2_iva',                 'PVP 2 + IVA',         'num', 'precios'),
    ('pvp3',                     'PVP 3',               'num', 'precios'),
    ('pvp3_iva',                 'PVP 3 + IVA',         'num', 'precios'),
    ('pvpdist',                  'PVP distribuidor',    'num', 'precios'),
    ('pvpdist_iva',              'PVP dist. + IVA',     'num', 'precios'),
    ('precio_maximo',            'Precio maximo',       'num', 'precios'),

    # --- Contable
    ('cuenta_venta',             'Cuenta de venta',     'texto', 'contable'),
    ('cuenta_compra',            'Cuenta de compra',    'texto', 'contable'),
    ('cuenta_costo',             'Cuenta de costo',     'texto', 'contable'),

    # --- Proveedor
    ('proveedores',              'Proveedor',           'texto', 'proveedor'),
    ('nombre_comercial',         'Nombre comercial',    'texto', 'proveedor'),
    ('codigo_proveedor',         'Codigo proveedor',    'texto', 'proveedor'),
    ('nombre_contacto',          'Contacto',            'texto', 'proveedor'),
    ('correo',                   'Correo',              'texto', 'proveedor'),
    ('celular_principal',        'Celular principal',   'texto', 'proveedor'),
    ('celular_secundario',       'Celular secundario',  'texto', 'proveedor'),
    ('lead_time',                'Lead time',           'texto', 'proveedor'),
    ('dia_recepcion',            'Dia de recepcion',    'texto', 'proveedor'),
    ('horario_recepcion',        'Horario de recepcion','texto', 'proveedor'),
    ('bodega_ingreso',           'Bodega de ingreso',   'array', 'proveedor'),

    # --- Auditoria (no se editan: las escribe el sistema)
    ('creado_por',                  'Creado por',          'ro', 'auditoria'),
    ('fecha_creacion',              'Fecha de creacion',   'ro', 'auditoria'),
    ('ultima_modificacion_persona', 'Modificado por',      'ro', 'auditoria'),
    ('ultima_modificacion',         'Ultima modificacion', 'ro', 'auditoria'),
    ('sincronizado_en',             'Sincronizado en',     'ro', 'auditoria'),
]

# Campos de lista cerrada: se elige, no se escribe. Van aparte de los catalogos
# que se leen de los datos, porque en estos escribir cualquier cosa es un error:
# un producto con estado 'activo' en minuscula desaparece de todos los filtros.
# Los valores son los que ya estan en la tabla, escritos igual (incluida la
# tilde de 'Si'): si la opcion no coincide letra por letra con lo guardado, el
# desplegable llega vacio y al guardar borraria el valor que habia.
CERRADOS = {
    'estado':                 ['Activo', 'Inactivo'],
    'inventariable':          [u'Sí', 'No', 'No aplica'],
    'tipo_a_b_o_c':           ['A', 'B', 'C', 'No aplica'],
    'estado_de_equivalencia': ['Verificado', 'Pendiente Verificar', 'No Aplica'],
}

POR_COLUMNA = {c[0]: c for c in CAMPOS}
# Editables = todo menos el codigo (es la PK) y los de auditoria
EDITABLES   = [c[0] for c in CAMPOS if c[3] != 'auditoria' and c[0] != 'codigo']
COLUMNAS    = [c[0] for c in CAMPOS]

# Los flags de conteo, para el filtro "se cuenta en"
FLAGS_CONTEO = [c[0] for c in CAMPOS if c[0].startswith('conteo_')]

# ---------------------------------------------------------------------------
# Orden alfabetico de verdad.
#
# El orden por defecto de Postgres ignora espacios y simbolos: pone 'AGUACATE'
# antes que 'AGUA COCO BOTELLA' y mete '+ AGRANDADO' entre las palabras con A.
# Ademas 21 nombres traen espacios de sobra al principio y 106 llevan tilde o
# enie, que con COLLATE "C" caerian despues de la Z.
#
# Por eso se ordena por una clave normalizada: sin espacios de borde, sin
# tildes, en mayusculas y comparada byte a byte. Asi el espacio pesa menos que
# cualquier letra y la lista se lee como la leeria una persona.
# ---------------------------------------------------------------------------
_TILDES     = u'ÁÉÍÓÚÜÑáéíóúüñ'
_SIN_TILDES = u'AEIOUUNAEIOUUN'


def _clave_alfabetica(columna):
    return (u"upper(translate(btrim(coalesce(%s, '')), '%s', '%s')) COLLATE \"C\""
            % (columna, _TILDES, _SIN_TILDES))


# El nombre del orden llega del navegador; se valida contra estas llaves y
# nunca se concatena lo que mande.
ORDENES = {
    # El de siempre: categoria en orden alfabetico y, dentro de cada una, por
    # codigo. Los codigos ya vienen agrupados por familia (AM = aceites,
    # SALX = salsas extra), asi que dentro de la categoria quedan ordenados
    # como estan en la cabeza de quien los usa.
    'categoria': u'%s, codigo' % _clave_alfabetica('categoria'),
    'nombre':    u'%s, codigo' % _clave_alfabetica('nombre_producto'),
    'codigo':    u'codigo',
}
ORDEN_POR_DEFECTO = 'categoria'

# Columnas que se muestran en la grilla del listado
RESUMEN = ['codigo', 'nombre_producto', 'categoria', 'uso_producto', 'estado',
           'und_min', 'unid_max', 'unidad_contifico', 'para_la_venta',
           'para_la_compra', 'equivalencia_producto', 'costo'] + FLAGS_CONTEO


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
    """Mismo criterio que el resto de la app: usuario + clave contra goti.usuarios."""
    if not usuario or not clave:
        return False
    cur = conn.cursor()
    cur.execute("""SELECT 1 FROM goti.usuarios
                    WHERE username = %s AND password = %s
                      AND rol = 'admin' AND activo = TRUE""", (usuario, clave))
    return cur.fetchone() is not None


# ---------------------------------------------------------------- conversion

def _valor_entrada(columna, bruto):
    """Pasa lo que manda el navegador al tipo que espera la columna.

    El vacio siempre es NULL y no cadena vacia: '' y NULL conviviendo en la
    misma columna obliga a escribir coalesce() en cada consulta que venga
    despues.
    """
    tipo = POR_COLUMNA[columna][2]

    if tipo == 'bool':
        if bruto in (None, ''):
            return None
        if isinstance(bruto, bool):
            return bruto
        return str(bruto).strip().lower() in ('true', '1', 'si', 'sí', 'x')

    if tipo == 'array':
        if bruto in (None, ''):
            return None
        if isinstance(bruto, list):
            partes = [str(x).strip() for x in bruto]
        else:
            partes = [p.strip() for p in str(bruto).split(',')]
        partes = [p for p in partes if p]
        return partes or None

    if tipo == 'num':
        if bruto in (None, ''):
            return None
        try:
            # se acepta la coma decimal: aqui se escribe 1,5 y no 1.5
            return float(str(bruto).replace(',', '.'))
        except (TypeError, ValueError):
            raise ValueError('%s tiene que ser un numero' %
                             POR_COLUMNA[columna][1])

    v = ('' if bruto is None else str(bruto)).strip()
    return v or None


# ---------------------------------------------------------------- catalogos

@bp_matriz.route('/api/matriz/campos', methods=['GET'])
def matriz_campos():
    """La definicion de campos, para que el formulario se dibuje solo."""
    return jsonify({
        'success': True,
        'campos': [{'columna': c, 'etiqueta': e, 'tipo': t, 'grupo': g,
                    'opciones': CERRADOS.get(c)}
                   for c, e, t, g in CAMPOS],
        'resumen': RESUMEN,
        'flags_conteo': FLAGS_CONTEO,
    })


@bp_matriz.route('/api/matriz/catalogos', methods=['GET'])
def matriz_catalogos():
    """Valores que ya existen en la tabla, para los desplegables.

    Se leen de los datos y no de una lista fija: asi el desplegable no se queda
    corto cuando alguien crea una categoria nueva.
    """
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        salida = {}
        for col in ('categoria', 'uso_producto', 'tipo_producto', 'estado',
                    'und_min', 'unid_max', 'unidad_contifico', 'inventariable',
                    'tipo_a_b_o_c', 'unidad_de_conteo_general',
                    'estado_de_equivalencia', 'proveedores'):
            cur.execute("""SELECT DISTINCT %s AS v FROM %s
                            WHERE %s IS NOT NULL AND btrim(%s) <> ''
                            ORDER BY 1""" % (col, TABLA, col, col))
            salida[col] = [r['v'] for r in cur.fetchall()]
        return jsonify({'success': True, 'catalogos': salida})
    except Exception as e:
        return _error(e, 'catalogos')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- listado

@bp_matriz.route('/api/matriz/productos', methods=['GET'])
def matriz_listar():
    q         = (request.args.get('q') or '').strip()
    estado    = (request.args.get('estado') or '').strip()
    categoria = (request.args.get('categoria') or '').strip()
    uso       = (request.args.get('uso') or '').strip()
    venta     = (request.args.get('venta') or '').strip()      # si | no
    cuenta_en = (request.args.get('cuenta_en') or '').strip()  # una columna conteo_*
    orden     = (request.args.get('orden') or '').strip()
    if orden not in ORDENES:
        orden = ORDEN_POR_DEFECTO

    try:
        pagina = max(int(request.args.get('pagina', 1)), 1)
    except ValueError:
        pagina = 1
    try:
        por_pagina = min(max(int(request.args.get('por_pagina', 50)), 1), 3000)
    except ValueError:
        por_pagina = 50

    where, params = ['1=1'], []
    if q:
        where.append('(nombre_producto ILIKE %s OR codigo ILIKE %s '
                     'OR categoria ILIKE %s OR proveedores ILIKE %s)')
        params += ['%' + q + '%'] * 4
    if estado:
        where.append('estado = %s');     params.append(estado)
    if categoria:
        where.append('categoria = %s');  params.append(categoria)
    if uso:
        where.append('uso_producto = %s'); params.append(uso)
    if venta == 'si':
        where.append('para_la_venta IS TRUE')
    elif venta == 'no':
        where.append('para_la_venta IS NOT TRUE')
    if cuenta_en in FLAGS_CONTEO:        # se valida contra la lista, no se concatena
        where.append('%s IS TRUE' % cuenta_en)

    filtro = ' AND '.join(where)
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute('SELECT count(*) AS n FROM %s WHERE %s' % (TABLA, filtro), params)
        total = cur.fetchone()['n']
        cur.execute(u"""SELECT %s FROM %s WHERE %s
                         ORDER BY %s
                         LIMIT %%s OFFSET %%s"""
                    % (', '.join(RESUMEN), TABLA, filtro, ORDENES[orden]),
                    params + [por_pagina, (pagina - 1) * por_pagina])
        productos = [dict(r) for r in cur.fetchall()]
        return jsonify({'success': True, 'productos': productos, 'total': total,
                        'pagina': pagina, 'por_pagina': por_pagina, 'orden': orden,
                        'paginas': (total + por_pagina - 1) // por_pagina})
    except Exception as e:
        return _error(e, 'listar productos')
    finally:
        _soltar(conn)


@bp_matriz.route('/api/matriz/productos/<codigo>', methods=['GET'])
def matriz_ver(codigo):
    """La ficha completa de un producto."""
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute('SELECT %s FROM %s WHERE codigo = %%s'
                    % (', '.join(COLUMNAS), TABLA), (codigo,))
        fila = cur.fetchone()
        if not fila:
            return jsonify({'success': False, 'error': 'No existe el producto ' + codigo}), 404
        return jsonify({'success': True, 'producto': dict(fila)})
    except Exception as e:
        return _error(e, 'ver producto')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- crear

@bp_matriz.route('/api/matriz/productos', methods=['POST'])
def matriz_crear():
    d = request.get_json(silent=True) or {}
    codigo = (d.get('codigo') or '').strip()
    nombre = (d.get('nombre_producto') or '').strip()

    if not codigo:
        return jsonify({'success': False, 'error': 'El codigo es obligatorio'}), 400
    if not nombre:
        return jsonify({'success': False, 'error': 'El nombre del producto es obligatorio'}), 400

    usuario = (d.get('usuario') or '').strip() or None

    cols, vals = ['codigo'], [codigo]
    try:
        for col in EDITABLES:
            if col in d:
                cols.append(col)
                vals.append(_valor_entrada(col, d[col]))
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    if 'estado' not in cols:            # sin estado no entra en ningun listado
        cols.append('estado'); vals.append('Activo')

    cols += ['creado_por', 'fecha_creacion', 'ultima_modificacion_persona',
             'ultima_modificacion']
    vals += [usuario, None, usuario, None]      # las fechas las pone now()

    marcas = ', '.join(['now()' if c in ('fecha_creacion', 'ultima_modificacion')
                        else '%s' for c in cols])
    params = [v for c, v in zip(cols, vals)
              if c not in ('fecha_creacion', 'ultima_modificacion')]

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute('SELECT 1 FROM %s WHERE codigo = %%s' % TABLA, (codigo,))
        if cur.fetchone():
            return jsonify({'success': False,
                            'error': 'Ya existe un producto con el codigo ' + codigo}), 409
        cur.execute('INSERT INTO %s (%s) VALUES (%s) RETURNING %s'
                    % (TABLA, ', '.join(cols), marcas, ', '.join(COLUMNAS)), params)
        fila = dict(cur.fetchone())
        conn.commit()
        return jsonify({'success': True, 'producto': fila})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'crear producto')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- modificar

@bp_matriz.route('/api/matriz/productos/<codigo>', methods=['PUT'])
def matriz_modificar(codigo):
    d = request.get_json(silent=True) or {}
    usuario = (d.get('usuario') or '').strip() or None

    sets, params = [], []
    try:
        for col in EDITABLES:
            if col in d:
                sets.append('%s = %%s' % col)
                params.append(_valor_entrada(col, d[col]))
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    if not sets:
        return jsonify({'success': False, 'error': 'No se mando ningun cambio'}), 400

    if 'nombre_producto' in d and not (d.get('nombre_producto') or '').strip():
        return jsonify({'success': False, 'error': 'El nombre no puede quedar vacio'}), 400

    sets += ['ultima_modificacion_persona = %s', 'ultima_modificacion = now()']
    params.append(usuario)

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute('UPDATE %s SET %s WHERE codigo = %%s RETURNING %s'
                    % (TABLA, ', '.join(sets), ', '.join(COLUMNAS)),
                    params + [codigo])
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            return jsonify({'success': False, 'error': 'No existe el producto ' + codigo}), 404
        conn.commit()
        return jsonify({'success': True, 'producto': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'modificar producto')
    finally:
        _soltar(conn)


# ---------------------------------------------------------------- borrar

# Donde mas se nombra un producto por su codigo. Si aparece en alguna, borrarlo
# dejaria ese registro apuntando al vacio.
REFERENCIAS = [
    ('goti.gfc_solicitudes_movimiento', 'producto_codigo', 'solicitudes de movimiento'),
    ('goti.productos_por_marca',        'codigo',          'productos por marca'),
]


@bp_matriz.route('/api/matriz/productos/<codigo>/uso', methods=['GET'])
def matriz_uso(codigo):
    """Donde esta usado el producto. El front lo consulta antes de ofrecer borrar."""
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        usos = []
        for tabla, col, etiqueta in REFERENCIAS:
            cur.execute('SELECT count(*) AS n FROM %s WHERE %s = %%s' % (tabla, col), (codigo,))
            n = cur.fetchone()['n']
            if n:
                usos.append({'donde': etiqueta, 'registros': n})
        return jsonify({'success': True, 'usos': usos, 'se_puede_borrar': not usos})
    except Exception as e:
        return _error(e, 'uso del producto')
    finally:
        _soltar(conn)


@bp_matriz.route('/api/matriz/productos/<codigo>', methods=['DELETE'])
def matriz_borrar(codigo):
    """Borra un producto. Solo administrador, y solo si nadie lo referencia.

    El borrado es definitivo. Cuando el producto ya se uso, la baja correcta es
    estado = 'Inactivo': deja de ofrecerse, pero el historico sigue teniendo a
    que apuntar.
    """
    d = request.get_json(silent=True) or {}
    conn = None
    try:
        conn = _db()
        if not _es_admin(conn, (d.get('admin_user') or '').strip(),
                         d.get('admin_pass') or ''):
            return jsonify({'success': False,
                            'error': 'Solo un administrador puede borrar productos'}), 403

        cur = conn.cursor()
        bloqueos = []
        for tabla, col, etiqueta in REFERENCIAS:
            cur.execute('SELECT count(*) AS n FROM %s WHERE %s = %%s' % (tabla, col), (codigo,))
            n = cur.fetchone()['n']
            if n:
                bloqueos.append('%s (%d)' % (etiqueta, n))
        if bloqueos:
            return jsonify({'success': False,
                            'error': 'No se puede borrar: el producto esta usado en '
                                     + ', '.join(bloqueos)
                                     + '. Marcalo como Inactivo en vez de borrarlo.'}), 409

        cur.execute('DELETE FROM %s WHERE codigo = %%s RETURNING codigo, nombre_producto'
                    % TABLA, (codigo,))
        fila = cur.fetchone()
        if not fila:
            conn.rollback()
            return jsonify({'success': False, 'error': 'No existe el producto ' + codigo}), 404
        conn.commit()
        return jsonify({'success': True, 'borrado': dict(fila)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'borrar producto')
    finally:
        _soltar(conn)
