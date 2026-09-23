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
    # El producto guarda solo A QUIEN le compra. Nombre comercial, contacto,
    # correo y celulares salian repetidos en cada producto del proveedor -- 28
    # copias del mismo telefono, que nunca coincidian. Ahora viven en la tabla
    # de proveedores y se editan desde la misma pestaña, pero se guardan una
    # sola vez. `codigo_proveedor` y `lead_time` se retiraron: el codigo unico
    # de un proveedor es su RUC, y el lead time nadie lo usaba.
    ('proveedores',              'Proveedor',           'texto', 'proveedor'),
    # El dia de recepcion NO esta aqui: es el mismo dato que el dia de despacho
    # del proveedor, y vive alla (fc_proveedores.dia_despacho). Tener los dos
    # era duplicarlo.
    ('horario_recepcion',        'Horario de recepcion','multi', 'proveedor'),
    ('bodega_ingreso',           'Bodega de ingreso',   'multi', 'proveedor'),

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
# Unidades. Escribirlas a mano era pedir el error: en la tabla ya convivian
# 'Kilogramos' y 'Kilogramos ' (con espacio al final), que para Postgres son
# dos cosas distintas y rompen cualquier filtro o cruce por unidad. La lista
# sale de los 12 valores que de verdad se usan, ya limpios.
UNIDADES = ['N/a', 'Unidad', 'Kilogramos', 'Gramos', 'Paquete', 'Caja',
            'Funda', 'Bidon', 'Rollo', 'Porcion', 'Minutos']

# Columnas que guardan una unidad. Todas se eligen, ninguna se escribe.
COLS_UNIDAD = (['unidad_de_conteo_general', 'unidad_contifico',
                'und_min', 'unid_max', 'unidad_equivalencia']
               + ['unidad_conteo_' + b for b in
                  ('chios', 'simon_bolon', 'santo_cachon', 'planta_produccion',
                   'bodega_principal', 'bodega_materia_prima', 'bodega_pulmon')])

# Los dias y los horarios se ELIGEN, y se puede marcar mas de uno: un
# proveedor que entrega martes y viernes antes tenia que escribirlo a mano.
DIAS_SEMANA = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes',
               'Sabado', 'Domingo']

# Quien no entrega en dias fijos. Es una opcion mas de la MISMA lista, no un
# campo aparte, y excluye a los dias. 'Debito Automatico' estaba aqui y se
# quito: es una forma de pago, no un dia de entrega.
DIAS_DESPACHO = DIAS_SEMANA + ['Bajo solicitud']

# Franjas de recepcion: bloques de dos horas desde las 09:00.
#
# Entre 13:00 y 14:00 el personal almuerza, asi que ESE tramo no existe en la
# lista. No es un olvido: si no se puede recibir, no se puede ofrecer. Por eso
# la manana termina a las 13:00 y la tarde arranca a las 14:00.
FRANJAS_RECEPCION = ['09:00 - 11:00', '11:00 - 13:00',
                     '14:00 - 16:00', '16:00 - 18:00', '18:00 - 20:00',
                     'Todo el dia', 'Bajo solicitud']

CERRADOS = {
    'estado':                 ['Activo', 'Inactivo'],
    'inventariable':          [u'Sí', 'No', 'No aplica'],
    'tipo_a_b_o_c':           ['A', 'B', 'C', 'No aplica'],
    'estado_de_equivalencia': ['Verificado', 'Pendiente Verificar', 'No Aplica'],
}
for _c in COLS_UNIDAD:
    CERRADOS[_c] = UNIDADES
CERRADOS['horario_recepcion'] = FRANJAS_RECEPCION

# Columnas que en Postgres son ARRAY de verdad. Las demas de tipo 'multi'
# guardan los valores separados por comas en una columna de texto.
COLS_ARRAY = ['marca', 'bodega_ingreso']

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

    if tipo == 'multi':
        # Llega una lista del navegador; se guarda como array de Postgres si la
        # columna lo es, o como texto separado por comas si es text.
        if bruto in (None, '', []):
            return None
        partes = ([str(x).strip() for x in bruto] if isinstance(bruto, list)
                  else [p.strip() for p in str(bruto).split(',')])
        partes = [p for p in partes if p]
        if not partes:
            return None
        return partes if columna in COLS_ARRAY else ', '.join(partes)

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
        # La bodega de ingreso se elige de NUESTRAS bodegas, no de un texto
        # libre: antes guardaba ids de Airtable que nadie sabia leer.
        cur.execute('SELECT nombre FROM goti.gfc_bodegas'
                    ' WHERE activo IS TRUE ORDER BY orden, nombre')
        salida['bodega_ingreso'] = [r['nombre'] for r in cur.fetchall()]

        for col in ('categoria', 'uso_producto', 'tipo_producto', 'estado',
                    'und_min', 'unid_max', 'unidad_contifico', 'inventariable',
                    'tipo_a_b_o_c', 'unidad_de_conteo_general',
                    'estado_de_equivalencia'):
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


# ===========================================================================
# SINCRONIZACION CON CONTIFICO
#
# Contifico es donde nacen los productos: alguien los crea alli para poder
# venderlos o comprarlos. La matriz es otra cosa -- es el maestro de inventario,
# con conteo por bodega, equivalencias y proveedor. Por eso NO se copia una en
# la otra: de Contifico se trae lo que las dos comparten y el resto lo llena
# una persona, que es la que sabe si algo se cuenta en Floreana o no.
#
# Dos preguntas responde esta seccion:
#   1. Que productos existen en Contifico y todavia no estan aqui.
#   2. Cuales cambiaron de estado alla y aqui siguen como estaban.
#
# NADA se aplica solo. Se revisa, se elige y recien ahi se aplica: inactivar
# 69 productos de golpe porque una API lo dijo es exactamente el tipo de cosa
# que despues no se sabe deshacer.
#
# El catalogo completo son 14 paginas y ~80 segundos. Gunicorn corta a los 30,
# asi que la revision va en un hilo aparte y la pantalla pregunta como va,
# igual que la precarga de personas en app.py.
# ===========================================================================
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

CF_URL = 'https://api.contifico.com/sistema/api/v2/producto/'

# Vocabulario. La matriz usa listas cerradas y los valores tienen que calzar
# letra por letra con lo que ya esta guardado, tilde incluida, o el desplegable
# del formulario llega vacio y al guardar borra lo que habia.
CF_ESTADO = {'A': 'Activo', 'I': 'Inactivo'}
CF_TIPO   = {'SIM': 'Simple', 'COP': 'Compuesto', 'PRO': 'De producción'}

# Lo que las dos bases comparten. El resto de columnas de la matriz (conteo por
# bodega, equivalencias, tipo A/B/C, proveedor, vida util...) Contifico no las
# tiene y no hay de donde sacarlas.
CF_DIRECTO = {
    'nombre':           'nombre_producto',
    'descripcion':      'descripcion',
    'pvp1':             'pvp1',
    'pvp2':             'pvp2',
    'pvp3':             'pvp3',
}

# Estos llegan como id (hash) y no como texto. Contifico no publica un endpoint
# para traducirlos -- /cuenta/ y /unidad/ dan 404 -- asi que el diccionario se
# APRENDE de los 1263 productos que ya estan en las dos bases: si 40 productos
# con cuenta_venta_id=xmbm... dicen "Venta de Entradas", ese id es esa cuenta.
CF_POR_ID = {
    'categoria_id':     'categoria',
    'cuenta_venta_id':  'cuenta_venta',
    'cuenta_compra_id': 'cuenta_compra',
    'cuenta_costo_id':  'cuenta_costo',
    'unidad':           'unidad_contifico',
}

# Estado de la revision en curso. Vive en memoria a proposito: es un borrador
# de trabajo, no un dato que valga la pena guardar en una tabla.
_cf = {'estado': 'nunca', 'inicio': None, 'fin': None,
       'paso': '', 'resultado': None, 'error': None}
_cf_lock = threading.Lock()


def _cf_llave():
    return os.environ.get('CONTIFICO_API_KEY', '').strip()


def _cf_pedir(url, intentos=3):
    for n in range(intentos):
        try:
            req = urllib.request.Request(
                url, headers={'Authorization': _cf_llave(),
                              'Accept': 'application/json'})
            return json.loads(urllib.request.urlopen(req, timeout=90).read())
        except urllib.error.HTTPError as e:
            # 429 es el limite de la API y 502/503 es Contifico reiniciando:
            # los tres pasan solos. El resto (401, 404) no mejora reintentando.
            if e.code in (429, 502, 503) and n < intentos - 1:
                time.sleep(5 * (n + 1))
                continue
            raise


def _cf_catalogo():
    """Las 14 paginas de productos. v2 y no v1: v1 deja fuera los que no son
    de punto de venta."""
    prods, url, pagina = [], CF_URL, 0
    while url:
        d = _cf_pedir(url)
        prods.extend(d.get('results', []))
        pagina += 1
        with _cf_lock:
            _cf['paso'] = 'Leyendo Contifico: %d productos' % len(prods)
        url = d.get('next') or None
    return prods


def _cf_diccionarios(pares):
    """id de Contifico -> texto de la matriz, aprendido de los que ya calzan.

    `pares` son (producto_contifico, fila_matriz) de los codigos que existen en
    las dos. Para cada id se elige el texto mas repetido. Se guarda tambien
    cuantas lecturas lo respaldan, para poder avisar cuando un id viene de un
    solo caso y puede estar mal.
    """
    crudo = {}
    for campo_cf, campo_mx in CF_POR_ID.items():
        cuentas = {}
        for p, m in pares:
            idv, val = p.get(campo_cf), m.get(campo_mx)
            if idv and val:
                cuentas.setdefault(idv, {})
                cuentas[idv][val] = cuentas[idv].get(val, 0) + 1
        dic = {}
        for idv, opciones in cuentas.items():
            texto, n = max(opciones.items(), key=lambda x: x[1])
            dic[idv] = {'valor': texto, 'apoyos': n, 'unico': len(opciones) == 1}
        crudo[campo_cf] = dic
    return crudo


def _cf_mapear(p, dics):
    """Producto de Contifico -> columnas de la matriz que SI se pueden llenar."""
    fila, dudosos = {}, []

    for cf, mx in CF_DIRECTO.items():
        v = p.get(cf)
        if v not in (None, ''):
            fila[mx] = v

    fila['estado'] = CF_ESTADO.get(p.get('estado'), 'Activo')
    tipo = CF_TIPO.get(p.get('tipo_producto'))
    if tipo:
        fila['tipo_producto'] = tipo
    if p.get('para_pos') is not None:
        fila['para_pos'] = bool(p.get('para_pos'))

    for campo_cf, campo_mx in CF_POR_ID.items():
        idv = p.get(campo_cf)
        if not idv:
            continue
        entrada = dics.get(campo_cf, {}).get(idv)
        if entrada:
            fila[campo_mx] = entrada['valor']
            if not entrada['unico'] or entrada['apoyos'] < 3:
                dudosos.append(campo_mx)

    return fila, dudosos


# Campos que se comparan contra Contifico cuando el producto YA existe aqui.
# No se comparan todos a proposito: nombre y categoria se editan aqui con
# criterio propio y pisarlos con Contifico seria perder trabajo.
CF_COMPARA_NUM = ['pvp1', 'pvp2', 'pvp3']
CF_COMPARA_ID = [('cuenta_venta', 'cuenta_venta_id'),
                 ('cuenta_compra', 'cuenta_compra_id'),
                 ('cuenta_costo', 'cuenta_costo_id')]

# Contifico trabaja con SEIS decimales y esa es la cifra buena: 2,19 aqui
# contra 2,1875 alla no es redondeo, es un precio desactualizado. Se compara y
# se guarda con esa precision. La tolerancia solo tapa el ruido de coma
# flotante (2.1875 que se lee 2.18749999...), nunca una diferencia real.
CF_DECIMALES = 6
CF_TOLERANCIA = 1e-7


def _cf_num(v):
    if v in (None, ''):
        return None
    try:
        return round(float(v), CF_DECIMALES)
    except (TypeError, ValueError):
        return None


def _cf_diferencias(p, m, dics):
    """Campos donde Contifico y la matriz no dicen lo mismo.

    Cada diferencia trae `vacio`: True cuando aqui no habia nada (o habia un 0)
    y Contifico si tiene valor. Eso no es un cambio de precio, es un hueco que
    se puede llenar, y conviene poder distinguirlos al elegir que aplicar.
    """
    difs = []
    for campo in CF_COMPARA_NUM:
        aqui, alla = _cf_num(m.get(campo)), _cf_num(p.get(campo))
        if alla is None:
            continue
        if aqui is not None and abs(aqui - alla) <= CF_TOLERANCIA:
            continue
        if aqui == alla:
            continue
        difs.append({'campo': campo, 'actual': aqui, 'nuevo': alla,
                     'vacio': aqui in (None, 0, 0.0)})

    for campo, clave in CF_COMPARA_ID:
        idv = p.get(clave)
        if not idv:
            continue
        entrada = dics.get(clave, {}).get(idv)
        if not entrada:
            continue
        nuevo = entrada['valor']
        aqui = (m.get(campo) or '').strip()
        if aqui == nuevo:
            continue
        difs.append({'campo': campo, 'actual': aqui or None, 'nuevo': nuevo,
                     'vacio': not aqui,
                     'dudoso': not entrada['unico'] or entrada['apoyos'] < 3})
    return difs


def _cf_revisar_job():
    """Compara Contifico contra la matriz. Corre en un hilo; no toca la base."""
    conn = None
    try:
        with _cf_lock:
            _cf['paso'] = 'Conectando con Contifico'

        prods = _cf_catalogo()
        por_codigo = {}
        for p in prods:
            cod = (p.get('codigo') or '').strip().upper()
            if cod:
                por_codigo[cod] = p

        with _cf_lock:
            _cf['paso'] = 'Leyendo la matriz'

        conn = _db()
        cur = conn.cursor()
        cur.execute('SELECT %s FROM %s' % (', '.join(COLUMNAS), TABLA))
        matriz = {}
        for r in cur.fetchall():
            fila = dict(r)
            cod = (fila.get('codigo') or '').strip().upper()
            if cod:
                matriz[cod] = fila

        with _cf_lock:
            _cf['paso'] = 'Aprendiendo categorias y cuentas'

        pares = [(por_codigo[c], matriz[c]) for c in matriz if c in por_codigo]
        dics = _cf_diccionarios(pares)

        nuevos, cambios = [], []
        for cod, p in por_codigo.items():
            if cod in matriz:
                continue
            fila, dudosos = _cf_mapear(p, dics)
            faltan = [c for c in EDITABLES if c not in fila]
            nuevos.append({
                'codigo': cod,
                'nombre': p.get('nombre') or '',
                'estado_contifico': CF_ESTADO.get(p.get('estado'), ''),
                'tipo_contifico': p.get('tipo_producto') or '',
                'stock': p.get('cantidad_stock'),
                'creado_en_contifico': (p.get('fecha_creacion') or '')[:10],
                'datos': fila,
                'dudosos': dudosos,
                'faltan': faltan,
            })

        datos = []
        for cod, m in matriz.items():
            p = por_codigo.get(cod)
            if not p:
                continue

            difs = _cf_diferencias(p, m, dics)
            if difs:
                datos.append({
                    'codigo': cod,
                    'nombre': m.get('nombre_producto') or '',
                    'difs': difs,
                    'solo_huecos': all(x.get('vacio') for x in difs),
                })

            nuevo = CF_ESTADO.get(p.get('estado'))
            actual = (m.get('estado') or '').strip()
            if nuevo and actual != nuevo:
                cambios.append({
                    'codigo': cod,
                    'nombre': m.get('nombre_producto') or '',
                    'estado_matriz': actual or '(vacio)',
                    'estado_contifico': nuevo,
                })

        # Solo informativo: un codigo que esta aqui y no en Contifico casi
        # siempre es un producto viejo, no un error que haya que arreglar.
        huerfanos = sorted(c for c in matriz if c not in por_codigo)

        nuevos.sort(key=lambda x: (x['estado_contifico'] != 'Activo', x['codigo']))
        cambios.sort(key=lambda x: x['codigo'])
        # Primero los cambios de verdad, despues los huecos por llenar
        datos.sort(key=lambda x: (x['solo_huecos'], x['codigo']))

        with _cf_lock:
            _cf['resultado'] = {
                'contifico': len(por_codigo),
                'matriz': len(matriz),
                'nuevos': nuevos,
                'cambios_estado': cambios,
                'cambios_datos': datos,
                'huerfanos': huerfanos,
            }
            _cf['estado'] = 'listo'
            _cf['fin'] = time.time()
            _cf['paso'] = ''
    except Exception as e:
        with _cf_lock:
            _cf['estado'] = 'error'
            _cf['error'] = '%s: %s' % (type(e).__name__, str(e)[:300])
            _cf['fin'] = time.time()
    finally:
        _soltar(conn)


@bp_matriz.route('/api/matriz/contifico/revisar', methods=['POST'])
def matriz_cf_revisar():
    """Arranca la revision. Devuelve enseguida; la pantalla pregunta como va."""
    if not _cf_llave():
        return jsonify({
            'success': False,
            'error': 'Falta CONTIFICO_API_KEY en el servidor',
            'detalle': 'Definir la variable de entorno en Render antes de usar '
                       'la sincronizacion.'}), 503

    with _cf_lock:
        if _cf['estado'] == 'cargando':
            return jsonify({'success': True, 'estado': 'cargando',
                            'paso': _cf['paso']})
        _cf.update({'estado': 'cargando', 'inicio': time.time(), 'fin': None,
                    'paso': 'Arrancando', 'resultado': None, 'error': None})

    threading.Thread(target=_cf_revisar_job, daemon=True).start()
    return jsonify({'success': True, 'estado': 'cargando'})


@bp_matriz.route('/api/matriz/contifico/estado', methods=['GET'])
def matriz_cf_estado():
    with _cf_lock:
        r = {'success': True, 'estado': _cf['estado'], 'paso': _cf['paso'],
             'error': _cf['error']}
        if _cf['inicio']:
            fin = _cf['fin'] or time.time()
            r['segundos'] = round(fin - _cf['inicio'], 1)
        if _cf['estado'] == 'listo':
            r['resultado'] = _cf['resultado']
    return jsonify(r)


@bp_matriz.route('/api/matriz/contifico/aplicar', methods=['POST'])
def matriz_cf_aplicar():
    """Crea los productos elegidos y/o alinea los estados elegidos.

    Se aplica SOLO lo que venga en las listas. No existe un "aplicar todo" del
    lado del servidor a proposito: la pantalla puede ofrecer seleccionar todo,
    pero aqui siempre llegan codigos, nunca una orden general.
    """
    d = request.get_json(silent=True) or {}
    crear = [str(c).strip().upper() for c in (d.get('crear') or []) if str(c).strip()]
    estados = [str(c).strip().upper() for c in (d.get('estados') or []) if str(c).strip()]
    datos = [str(c).strip().upper() for c in (d.get('datos') or []) if str(c).strip()]
    usuario = (d.get('usuario') or '').strip() or None

    if not crear and not estados and not datos:
        return jsonify({'success': False, 'error': 'No se eligio nada que aplicar'}), 400

    with _cf_lock:
        res = _cf['resultado']
    if not res:
        return jsonify({'success': False,
                        'error': 'No hay una revision reciente. Revisa primero.'}), 409

    por_codigo = {n['codigo']: n for n in res['nuevos']}
    cambios = {c['codigo']: c for c in res['cambios_estado']}
    con_difs = {x['codigo']: x for x in res.get('cambios_datos', [])}

    creados, actualizados, fallidos, refrescados = [], [], [], []
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()

        for cod in crear:
            n = por_codigo.get(cod)
            if not n:
                fallidos.append({'codigo': cod, 'motivo': 'no esta en la revision'})
                continue
            cols, vals = ['codigo'], [cod]
            for col, bruto in n['datos'].items():
                if col not in EDITABLES:
                    continue
                try:
                    vals.append(_valor_entrada(col, bruto))
                    cols.append(col)
                except ValueError:
                    pass          # un valor raro no tumba la importacion entera
            cols += ['creado_por', 'fecha_creacion', 'ultima_modificacion_persona',
                     'ultima_modificacion', 'sincronizado_en']
            vals += [usuario, None, usuario, None, None]
            marcas = ', '.join(
                ['now()' if c in ('fecha_creacion', 'ultima_modificacion',
                                  'sincronizado_en') else '%s' for c in cols])
            params = [v for c, v in zip(cols, vals)
                      if c not in ('fecha_creacion', 'ultima_modificacion',
                                   'sincronizado_en')]
            try:
                cur.execute('SELECT 1 FROM %s WHERE codigo = %%s' % TABLA, (cod,))
                if cur.fetchone():
                    fallidos.append({'codigo': cod, 'motivo': 'ya existe'})
                    continue
                cur.execute('INSERT INTO %s (%s) VALUES (%s)'
                            % (TABLA, ', '.join(cols), marcas), params)
                creados.append(cod)
            except Exception as e:
                conn.rollback()
                fallidos.append({'codigo': cod, 'motivo': str(e)[:120]})

        for cod in estados:
            c = cambios.get(cod)
            if not c:
                fallidos.append({'codigo': cod, 'motivo': 'no esta en la revision'})
                continue
            try:
                cur.execute(
                    'UPDATE %s SET estado = %%s, ultima_modificacion_persona = %%s,'
                    ' ultima_modificacion = now(), sincronizado_en = now()'
                    ' WHERE codigo = %%s' % TABLA,
                    (c['estado_contifico'], usuario, cod))
                if cur.rowcount:
                    actualizados.append({'codigo': cod,
                                         'de': c['estado_matriz'],
                                         'a': c['estado_contifico']})
                else:
                    fallidos.append({'codigo': cod, 'motivo': 'no se encontro'})
            except Exception as e:
                conn.rollback()
                fallidos.append({'codigo': cod, 'motivo': str(e)[:120]})

        for cod in datos:
            x = con_difs.get(cod)
            if not x:
                fallidos.append({'codigo': cod, 'motivo': 'no esta en la revision'})
                continue
            sets, vals = [], []
            for dif in x['difs']:
                campo = dif['campo']
                if campo not in EDITABLES:
                    continue
                sets.append('%s = %%s' % campo)
                vals.append(_valor_entrada(campo, dif['nuevo']))
            if not sets:
                continue
            sets += ['ultima_modificacion_persona = %s',
                     'ultima_modificacion = now()', 'sincronizado_en = now()']
            vals.append(usuario)
            vals.append(cod)
            try:
                cur.execute('UPDATE %s SET %s WHERE codigo = %%s'
                            % (TABLA, ', '.join(sets)), vals)
                if cur.rowcount:
                    refrescados.append({'codigo': cod,
                                        'campos': [y['campo'] for y in x['difs']]})
                else:
                    fallidos.append({'codigo': cod, 'motivo': 'no se encontro'})
            except Exception as e:
                conn.rollback()
                fallidos.append({'codigo': cod, 'motivo': str(e)[:120]})

        conn.commit()

        # Lo aplicado sale de la revision: si no, vuelve a aparecer como
        # pendiente hasta que alguien revise de nuevo.
        with _cf_lock:
            if _cf['resultado']:
                hechos = set(creados)
                _cf['resultado']['nuevos'] = [
                    n for n in _cf['resultado']['nuevos'] if n['codigo'] not in hechos]
                listos = set(a['codigo'] for a in actualizados)
                _cf['resultado']['cambios_estado'] = [
                    c for c in _cf['resultado']['cambios_estado']
                    if c['codigo'] not in listos]
                puestos = set(r['codigo'] for r in refrescados)
                _cf['resultado']['cambios_datos'] = [
                    x for x in _cf['resultado'].get('cambios_datos', [])
                    if x['codigo'] not in puestos]

        return jsonify({'success': True, 'creados': creados,
                        'actualizados': actualizados,
                        'refrescados': refrescados, 'fallidos': fallidos})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'aplicar sincronizacion')
    finally:
        _soltar(conn)


# ===========================================================================
# CONTEO DIARIO Y CRUCE OPERATIVO  (goti.productos_por_marca)
#
# Esta es la tabla que SI mueve la operacion: de aqui salen los productos que
# la gente cuenta cada dia y los que entran al cruce operativo. Los flags
# conteo_* de la matriz son otra cosa -- una parametrizacion que todavia no
# esta conectada -- y por eso los numeros no coinciden: la matriz marca 170
# productos para Chios y esta tabla tiene 40.
#
# Se administra desde la ficha del producto para no tener que ir a otro panel,
# pero NO se sincroniza sola con los flags conteo_*. Encender conteo_chios en
# 170 productos y dejar que eso se copie aqui cambiaria de golpe lo que la
# gente cuenta manana en el local. Eso lo decide una persona, producto por
# producto, que es justo lo que hace esta pantalla.
#
# La tabla lleva UNIQUE(marca, codigo): un producto puede estar en varias
# marcas con distinta unidad y distinto tipo de conteo.
# ===========================================================================
TABLA_CONTEO = 'goti.productos_por_marca'

# El orden es el de la pantalla: primero los locales, despues las bodegas.
MARCAS_CONTEO = ['CHIOS', 'CACHON', 'SIMON_BOLON',
                 'PLANTA', 'BODEGA_PRINCIPAL', 'MATERIA_PRIMA']

# Que significa cada tipo, tal como lo usa hoy el conteo operativo:
#   diario   - se cuenta todos los dias
#   cruce    - entra al cruce operativo contra Contifico
#   fijo     - de los que siempre caen en la muestra (los 14 de Bodega Principal)
#   variable - entra en la seleccion aleatoria del dia
TIPOS_CONTEO = ['diario', 'cruce', 'fijo', 'variable']


@bp_matriz.route('/api/matriz/productos/<codigo>/conteo', methods=['GET'])
def matriz_conteo_ver(codigo):
    """Como esta parametrizado este producto en cada marca."""
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute(
            'SELECT marca, nombre, activo, unidad, equivalencia, tipo_conteo'
            ' FROM %s WHERE upper(btrim(codigo)) = upper(btrim(%%s))' % TABLA_CONTEO,
            (codigo,))
        por_marca = {}
        for r in cur.fetchall():
            f = dict(r)
            if f.get('equivalencia') is not None:
                f['equivalencia'] = float(f['equivalencia'])
            por_marca[f['marca']] = f

        filas = []
        for m in MARCAS_CONTEO:
            f = por_marca.get(m)
            filas.append({
                'marca': m,
                'participa': f is not None,
                'activo': f['activo'] if f else True,
                'tipo_conteo': (f or {}).get('tipo_conteo') or 'diario',
                'unidad': (f or {}).get('unidad') or '',
                'equivalencia': (f or {}).get('equivalencia'),
            })
        return jsonify({'success': True, 'filas': filas,
                        'tipos': TIPOS_CONTEO, 'unidades': UNIDADES})
    except Exception as e:
        return _error(e, 'leer conteo por marca')
    finally:
        _soltar(conn)


@bp_matriz.route('/api/matriz/productos/<codigo>/conteo', methods=['PUT'])
def matriz_conteo_guardar(codigo):
    """Agrega, cambia o quita al producto de cada marca.

    Quitar una marca BORRA la fila, que es lo que deja de pedirla en el conteo
    del dia siguiente. Por eso la pantalla pide confirmacion antes: aqui no hay
    forma de distinguir un destildado a proposito de uno por accidente.
    """
    d = request.get_json(silent=True) or {}
    filas = d.get('filas') or {}
    if not isinstance(filas, dict):
        return jsonify({'success': False, 'error': 'Formato invalido'}), 400

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute('SELECT nombre_producto FROM %s WHERE codigo = %%s' % TABLA,
                    (codigo,))
        fila = cur.fetchone()
        if not fila:
            return jsonify({'success': False,
                            'error': 'El producto %s no esta en la matriz' % codigo}), 404
        nombre = fila['nombre_producto'] or codigo

        agregadas, cambiadas, quitadas = [], [], []
        for marca, v in filas.items():
            if marca not in MARCAS_CONTEO:
                continue
            v = v or {}
            if not v.get('participa'):
                cur.execute('DELETE FROM %s WHERE marca = %%s'
                            ' AND upper(btrim(codigo)) = upper(btrim(%%s))'
                            % TABLA_CONTEO, (marca, codigo))
                if cur.rowcount:
                    quitadas.append(marca)
                continue

            tipo = v.get('tipo_conteo') or 'diario'
            if tipo not in TIPOS_CONTEO:
                return jsonify({'success': False,
                                'error': 'Tipo de conteo invalido: %s' % tipo}), 400
            unidad = (v.get('unidad') or '').strip() or 'Unidad'
            if unidad not in UNIDADES:
                return jsonify({'success': False,
                                'error': 'Unidad invalida: %s' % unidad}), 400
            try:
                equiv = float(str(v.get('equivalencia') or 1).replace(',', '.'))
            except (TypeError, ValueError):
                return jsonify({'success': False,
                                'error': 'La equivalencia de %s no es un numero' % marca}), 400
            activo = bool(v.get('activo', True))

            # El nombre se copia de la matriz a proposito: esta tabla lo guarda
            # duplicado y asi no se quedan dos nombres distintos del mismo
            # producto en dos pantallas.
            cur.execute(
                'INSERT INTO %s (marca, codigo, nombre, activo, unidad,'
                ' equivalencia, tipo_conteo) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s)'
                ' ON CONFLICT (marca, codigo) DO UPDATE SET'
                '   nombre = EXCLUDED.nombre, activo = EXCLUDED.activo,'
                '   unidad = EXCLUDED.unidad, equivalencia = EXCLUDED.equivalencia,'
                '   tipo_conteo = EXCLUDED.tipo_conteo'
                ' RETURNING (xmax = 0) AS es_nueva' % TABLA_CONTEO,
                (marca, codigo.strip(), nombre, activo, unidad, equiv, tipo))
            r = cur.fetchone()
            (agregadas if r and r['es_nueva'] else cambiadas).append(marca)

        conn.commit()
        return jsonify({'success': True, 'agregadas': agregadas,
                        'cambiadas': cambiadas, 'quitadas': quitadas})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'guardar conteo por marca')
    finally:
        _soltar(conn)



# ===========================================================================
# PROVEEDORES  ->  public.fc_proveedores  (base `movimientos`)
#
# UNA sola tabla para todo el sistema. Habia tres y eso es justo lo que no
# puede pasar: Flujo de Caja usaba fc_proveedores (209 filas, todas con RUC y
# con dias de credito) mientras la matriz de productos leia dos espejos
# muertos de Airtable de 107 filas. Por eso INDUSTRIA ALIMENTICIA INMEAT no
# aparecia al buscarlo: existia, pero en la otra tabla.
#
# Se unificaron el 22-sep-2026: se migraron los 48 que vivian solo en Airtable
# y se remapearon 76 productos cuyo proveedor estaba escrito distinto (MARJORIE
# PABON era DOGGIES CAKE, mismo RUC). Quedaron 257 proveedores y cero productos
# apuntando a un proveedor inexistente.
#
# OJO: esta tabla vive en la base `movimientos`, no en InventariosLocales, y su
# conexion NO usa RealDictCursor -- devuelve TUPLAS. Por eso cada consulta
# arma el diccionario a mano con COLS_PROV.
# ===========================================================================
COLS_PROV = ['id', 'nombre', 'razon_social', 'nombre_comercial', 'ruc', 'telefono',
             'sri_estado', 'sri_tipo_persona', 'sri_regimen', 'sri_verificado_en',
             'celular_secundario', 'nombre_contacto', 'correo',
             'tipo_proveedor', 'criticidad', 'dias_credito', 'dia_despacho',
             'bodega_ingreso', 'horario_recepcion',
             'productos_servicios', 'observaciones',
             'banco_codigo', 'banco_tipo_cuenta', 'banco_cuenta',
             'benef_tipo_doc', 'benef_documento', 'benef_nombre', 'banco_correo']

# Lo que se puede editar del proveedor desde la ficha del producto.
PROV_EDITABLES = ['razon_social', 'nombre_comercial', 'ruc', 'telefono',
                  'celular_secundario',
                  'nombre_contacto', 'correo', 'tipo_proveedor', 'criticidad',
                  'dias_credito', 'dia_despacho', 'bodega_ingreso',
                  'horario_recepcion', 'productos_servicios', 'observaciones',
                  'banco_codigo', 'banco_tipo_cuenta', 'banco_cuenta',
                  'benef_tipo_doc', 'benef_documento', 'benef_nombre',
                  'banco_correo']


# ===========================================================================
# DATOS BANCARIOS
#
# Con esto se arma el TXT que se le sube a Produbanco. El archivo es de campos
# separados por tabulador y sin cabecera, y estas siete columnas son las que
# salen de la ficha del proveedor:
#
#     banco_codigo       en CUATRO digitos (36 -> 0036); lo pone codigo_txt()
#     banco_tipo_cuenta  CTE o AHO
#     banco_cuenta       TEXTO. '0034020035' guardado como numero pierde el
#                        cero de adelante y el banco rechaza la transferencia
#     benef_tipo_doc     C cedula / R ruc / P pasaporte
#     benef_documento
#     benef_nombre
#     banco_correo       ahi llega el aviso de pago
#
# El beneficiario NO es siempre el proveedor: 6 de los 99 cargados cobran a
# nombre de un tercero (PUBLIJOB paga a OLIMPO CARDENAS). Por eso sus cuatro
# campos son propios y no se deducen del RUC.
# ===========================================================================
TIPOS_CUENTA = ['CTE', 'AHO']
TIPOS_DOC_BENEF = [('C', 'Cedula'), ('R', 'RUC'), ('P', 'Pasaporte')]


def _prov_db():
    from app import fc_get_movimientos_db
    return fc_get_movimientos_db()


def _prov_soltar(conn):
    if conn is None:
        return
    from app import fc_release_movimientos_db
    fc_release_movimientos_db(conn)


def _prov_filas(cur):
    return [dict(zip(COLS_PROV, f)) for f in cur.fetchall()]


def _prov_revisar_banco(d):
    """Lo que el banco rechaza, mejor no dejarlo guardar.

    Devuelve el mensaje de error, o None si todo esta bien. Un campo que no
    viene en la peticion no se revisa: la ficha manda solo lo que se edito.
    """
    from bancos_spi import BANCOS_POR_CODIGO

    if d.get('banco_codigo'):
        cod = re.sub(r'[^0-9]', '', str(d['banco_codigo']))
        if cod not in BANCOS_POR_CODIGO:
            return 'Ese codigo de banco no esta en el catalogo del SPI'
        d['banco_codigo'] = cod

    if d.get('banco_tipo_cuenta'):
        t = str(d['banco_tipo_cuenta']).strip().upper()
        if t not in TIPOS_CUENTA:
            return 'El tipo de cuenta tiene que ser CTE o AHO'
        d['banco_tipo_cuenta'] = t

    if d.get('benef_tipo_doc'):
        t = str(d['benef_tipo_doc']).strip().upper()
        if t not in [x for x, _n in TIPOS_DOC_BENEF]:
            return 'El tipo de documento tiene que ser C, R o P'
        d['benef_tipo_doc'] = t

    if d.get('benef_documento'):
        # El pasaporte lleva letras; la cedula y el RUC no
        doc = str(d['benef_documento']).strip()
        if str(d.get('benef_tipo_doc') or '').upper() != 'P':
            doc = re.sub(r'[^0-9]', '', doc)
            if len(doc) not in (10, 13):
                return 'La cedula lleva 10 digitos y el RUC 13'
        d['benef_documento'] = doc

    # La cuenta se guarda tal cual: los ceros de adelante son parte del numero.
    # Solo se le quitan los espacios, que es basura de copiar y pegar.
    if d.get('banco_cuenta'):
        cta = re.sub(r'\s', '', str(d['banco_cuenta']))
        if not re.match(r'^[0-9]{4,20}$', cta):
            return 'El numero de cuenta son solo digitos (entre 4 y 20)'
        d['banco_cuenta'] = cta

    # Una cuenta sin banco no se puede pagar: el TXT sale incompleto
    if d.get('banco_cuenta') and 'banco_codigo' in d and not d.get('banco_codigo'):
        return 'Si pones numero de cuenta tienes que elegir el banco'
    return None


@bp_matriz.route('/api/matriz/proveedores', methods=['GET'])
def matriz_proveedores():
    """Todos los proveedores. Para el desplegable y la ficha."""
    conn = None
    try:
        conn = _prov_db()
        cur = conn.cursor()
        _sri_columnas(cur)
        conn.commit()
        cur.execute('SELECT %s FROM public.fc_proveedores ORDER BY nombre'
                    % ', '.join(COLS_PROV))
        filas = _prov_filas(cur)
        _prov_soltar(conn)
        conn = None

        # Las bodegas viven en la OTRA base, asi que van en su propia consulta
        otra = _db()
        c2 = otra.cursor()
        c2.execute('SELECT nombre FROM goti.gfc_bodegas'
                   ' WHERE activo IS TRUE ORDER BY orden, nombre')
        bodegas = [r['nombre'] for r in c2.fetchall()]
        _soltar(otra)

        from bancos_spi import BANCOS_ACTIVOS
        return jsonify({'success': True, 'proveedores': filas,
                        'bodegas': bodegas, 'franjas': FRANJAS_RECEPCION,
                        'dias': DIAS_DESPACHO,
                        'bancos': [{'codigo': c, 'nombre': n}
                                   for c, n in BANCOS_ACTIVOS],
                        'tipos_cuenta': TIPOS_CUENTA,
                        'tipos_doc': [{'codigo': c, 'nombre': n}
                                      for c, n in TIPOS_DOC_BENEF]})
    except Exception as e:
        return _error(e, 'proveedores')
    finally:
        _prov_soltar(conn)


@bp_matriz.route('/api/matriz/proveedores/buscar', methods=['GET'])
def matriz_proveedores_buscar():
    """Busca mientras se escribe, por nombre O por RUC.

    Ademas de los registrados ofrece los emisores del SRI de los ultimos dos
    anios que todavia no estan dados de alta: ahi esta a quien se le compra de
    verdad. Vienen con `registrado: false` y no se crean solos.
    """
    q = (request.args.get('q') or '').strip()
    patron = '%' + q.upper() + '%'
    digitos = re.sub(r'[^0-9]', '', q)
    pat_ruc = ('%' + digitos + '%') if digitos else '%~nada~%'

    conn = sri = None
    try:
        conn = _prov_db()
        cur = conn.cursor()
        cur.execute(
            'SELECT %s FROM public.fc_proveedores'
            ' WHERE %%s = %%s OR upper(nombre) LIKE %%s'
            "   OR upper(coalesce(nombre_comercial,'')) LIKE %%s"
            "   OR upper(coalesce(razon_social,'')) LIKE %%s"
            "   OR coalesce(ruc,'') LIKE %%s"
            ' ORDER BY nombre LIMIT 40' % ', '.join(COLS_PROV),
            (q, '', patron, patron, patron, pat_ruc))
        registrados = _prov_filas(cur)
        for r in registrados:
            r['registrado'] = True
        _prov_soltar(conn)
        conn = None

        ya_ruc = set((r['ruc'] or '').strip() for r in registrados if r['ruc'])
        ya_nom = set((r['nombre'] or '').strip().upper() for r in registrados)

        del_sri = []
        if q:
            sri = _db()
            c2 = sri.cursor()
            c2.execute("""
                SELECT ruc_emisor AS ruc, max(razon_social_emisor) AS nombre,
                       count(*) AS facturas, max(fecha_emision)::text AS ultima
                  FROM goti.gfc_sri_comprobantes
                 WHERE ruc_emisor IS NOT NULL
                   AND fecha_emision >= (CURRENT_DATE - 730)
                   AND (upper(razon_social_emisor) LIKE %s OR ruc_emisor LIKE %s)
                 GROUP BY ruc_emisor
                 ORDER BY max(fecha_emision) DESC LIMIT 25
            """, (patron, pat_ruc))
            for r in c2.fetchall():
                f = dict(r)
                if (f['ruc'] or '').strip() in ya_ruc:
                    continue
                if (f['nombre'] or '').strip().upper() in ya_nom:
                    continue
                f['registrado'] = False
                del_sri.append(f)

        return jsonify({'success': True, 'proveedores': registrados + del_sri,
                        'registrados': len(registrados), 'del_sri': len(del_sri)})
    except Exception as e:
        return _error(e, 'buscar proveedores')
    finally:
        _prov_soltar(conn)
        _soltar(sri)


@bp_matriz.route('/api/matriz/proveedores', methods=['POST'])
def matriz_proveedor_crear():
    """Da de alta un proveedor, normalmente uno que salio del SRI."""
    d = request.get_json(silent=True) or {}
    nombre = (d.get('nombre') or '').strip()
    ruc = re.sub(r'[^0-9]', '', d.get('ruc') or '')
    if not nombre:
        return jsonify({'success': False, 'error': 'Falta el nombre'}), 400
    if ruc and len(ruc) not in (10, 13):
        return jsonify({'success': False,
                        'error': 'El RUC debe tener 10 o 13 digitos'}), 400
    conn = None
    try:
        conn = _prov_db()
        cur = conn.cursor()
        cur.execute('SELECT 1 FROM public.fc_proveedores'
                    ' WHERE btrim(upper(nombre)) = btrim(upper(%s))', (nombre,))
        if cur.fetchone():
            return jsonify({'success': False,
                            'error': 'Ya existe el proveedor ' + nombre}), 409
        cur.execute("INSERT INTO public.fc_proveedores"
                    " (nombre, ruc, criticidad, tipo_proveedor, created_at,"
                    "  updated_at) VALUES (%s, %s, '', '', now(), now())",
                    (nombre, ruc or None))
        conn.commit()
        return jsonify({'success': True, 'nombre': nombre, 'ruc': ruc or None})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'crear proveedor')
    finally:
        _prov_soltar(conn)


@bp_matriz.route('/api/matriz/proveedores/<path:nombre>', methods=['PUT'])
def matriz_proveedor_guardar(nombre):
    """Cambia los datos del proveedor. Se guardan en SU tabla, no en el producto.

    Lo que se edita aqui lo ve tambien Flujo de Caja: es la misma tabla.
    """
    d = request.get_json(silent=True) or {}
    nombre = (nombre or '').strip()
    if not nombre:
        return jsonify({'success': False, 'error': 'Falta el proveedor'}), 400

    if 'ruc' in d:
        ruc = re.sub(r'[^0-9]', '', d.get('ruc') or '')
        if ruc and len(ruc) not in (10, 13):
            return jsonify({'success': False,
                            'error': 'El RUC debe tener 10 o 13 digitos'}), 400
        d['ruc'] = ruc or None

    err = _prov_revisar_banco(d)
    if err:
        return jsonify({'success': False, 'error': err}), 400

    conn = None
    try:
        conn = _prov_db()
        cur = conn.cursor()
        sets, vals = [], []
        for col in PROV_EDITABLES:
            if col not in d:
                continue
            v = d.get(col)
            if col == 'dias_credito':
                try:
                    v = int(str(v).strip()) if str(v).strip() else None
                except ValueError:
                    return jsonify({'success': False,
                                    'error': 'Los dias de credito deben ser un numero'}), 400
            elif isinstance(v, str):
                v = v.strip() or None
            sets.append('%s = %%s' % col)
            vals.append(v)
        if not sets:
            return jsonify({'success': True})
        sets.append('updated_at = now()')
        vals.append(nombre)
        cur.execute('UPDATE public.fc_proveedores SET %s'
                    ' WHERE btrim(upper(nombre)) = btrim(upper(%%s))'
                    % ', '.join(sets), vals)
        if not cur.rowcount:
            return jsonify({'success': False,
                            'error': 'No existe el proveedor ' + nombre}), 404
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'guardar proveedor')
    finally:
        _prov_soltar(conn)


# ===========================================================================
# ESTADO DE LOS PROVEEDORES EN EL SRI
#
# El catastro del SRI dice si un RUC esta ACTIVO o SUSPENDIDO, y eso cambia
# solo: nadie avisa cuando a un proveedor le suspenden el RUC. Facturarle a uno
# suspendido trae problemas, asi que conviene poder volver a preguntar.
#
# Se guarda lo que la API devuelve -- estado, tipo de persona y regimen -- mas
# la fecha de la consulta, para saber que tan viejo es el dato. El tipo y el
# regimen ademas hacen falta despues para calcular retenciones.
#
# Son 253 RUC, uno por llamada (el catastro no acepta comas), unos dos minutos.
# Gunicorn corta a los 30 segundos, asi que va en un hilo igual que la
# sincronizacion de Contifico.
# ===========================================================================
_sri = {'estado': 'nunca', 'inicio': None, 'fin': None, 'paso': '',
        'resultado': None, 'error': None}
_sri_lock = threading.Lock()


def _sri_columnas(cur):
    """Idempotente, como el resto de la app."""
    for col in ('sri_estado text', 'sri_tipo_persona text',
                'sri_regimen text', 'sri_verificado_en timestamptz'):
        cur.execute('ALTER TABLE public.fc_proveedores'
                    ' ADD COLUMN IF NOT EXISTS %s' % col)


def _sri_job():
    from sri_ruc import consultar_ruc
    conn = None
    try:
        conn = _prov_db()
        cur = conn.cursor()
        _sri_columnas(cur)
        conn.commit()
        cur.execute("SELECT id, nombre, ruc, razon_social FROM public.fc_proveedores"
                    " WHERE coalesce(btrim(ruc),'') <> '' ORDER BY nombre")
        filas = [dict(zip(['id', 'nombre', 'ruc', 'razon_social'], f))
                 for f in cur.fetchall()]

        suspendidos, sin_catastro, cambiaron, revisados = [], [], [], 0
        for n, f in enumerate(filas, 1):
            ruc = re.sub(r'[^0-9]', '', f['ruc'] or '')
            if len(ruc) != 13:
                sin_catastro.append({'nombre': f['nombre'], 'ruc': f['ruc'],
                                     'motivo': 'RUC de %d digitos' % len(ruc)})
                continue
            try:
                d = consultar_ruc(ruc)
            except Exception as e:
                sin_catastro.append({'nombre': f['nombre'], 'ruc': ruc,
                                     'motivo': 'el SRI no contesto: %s' % str(e)[:40]})
                continue
            if not d or not d.get('razon_social'):
                sin_catastro.append({'nombre': f['nombre'], 'ruc': ruc,
                                     'motivo': 'no existe en el catastro'})
                cur.execute("UPDATE public.fc_proveedores SET sri_estado = 'NO EXISTE',"
                            ' sri_verificado_en = now() WHERE id = %s', (f['id'],))
                continue

            estado = (d.get('estado') or '').upper()
            rs = (d.get('razon_social') or '').strip()
            if estado and estado != 'ACTIVO':
                suspendidos.append({'nombre': f['nombre'], 'ruc': ruc,
                                    'estado': estado, 'razon_social': rs})
            if rs and rs.upper() != (f['razon_social'] or '').strip().upper():
                cambiaron.append({'nombre': f['nombre'],
                                  'antes': f['razon_social'], 'ahora': rs})

            cur.execute('UPDATE public.fc_proveedores SET razon_social = %s,'
                        ' sri_estado = %s, sri_tipo_persona = %s, sri_regimen = %s,'
                        ' sri_verificado_en = now(), updated_at = now()'
                        ' WHERE id = %s',
                        (rs, estado or None, d.get('tipo_persona') or None,
                         d.get('regimen') or None, f['id']))
            revisados += 1

            if n % 10 == 0:
                conn.commit()
                with _sri_lock:
                    _sri['paso'] = 'Consultando el SRI: %d de %d' % (n, len(filas))
            time.sleep(0.12)          # no atropellar al catastro

        conn.commit()
        with _sri_lock:
            _sri['resultado'] = {
                'revisados': revisados, 'total': len(filas),
                'suspendidos': suspendidos, 'sin_catastro': sin_catastro,
                'cambiaron': cambiaron,
            }
            _sri['estado'] = 'listo'
            _sri['fin'] = time.time()
            _sri['paso'] = ''
    except Exception as e:
        if conn:
            conn.rollback()
        with _sri_lock:
            _sri['estado'] = 'error'
            _sri['error'] = '%s: %s' % (type(e).__name__, str(e)[:300])
            _sri['fin'] = time.time()
    finally:
        _prov_soltar(conn)


@bp_matriz.route('/api/matriz/proveedores/sri/<ruc>', methods=['GET'])
def matriz_prov_consultar_sri(ruc):
    """Consulta un RUC en el catastro, para llenar la ficha al crear.

    Responde en menos de un segundo y no pide login. Si el RUC ya esta dado de
    alta se avisa, para no crear el mismo proveedor dos veces.
    """
    from sri_ruc import consultar_ruc
    limpio = re.sub(r'[^0-9]', '', ruc or '')
    if len(limpio) not in (10, 13):
        return jsonify({'success': False,
                        'error': 'El RUC debe tener 10 o 13 digitos'}), 400
    # Una cedula de 10 digitos se vuelve RUC con 001 al final
    if len(limpio) == 10:
        limpio += '001'
    try:
        d = consultar_ruc(limpio)
    except Exception as e:
        return jsonify({'success': False,
                        'error': 'El SRI no contesto: %s' % str(e)[:80]}), 502
    if not d or not d.get('razon_social'):
        return jsonify({'success': False,
                        'error': 'Ese RUC no existe en el catastro del SRI'}), 404

    conn = None
    try:
        conn = _prov_db()
        cur = conn.cursor()
        cur.execute('SELECT nombre FROM public.fc_proveedores WHERE ruc = %s',
                    (limpio,))
        ya = cur.fetchone()
        return jsonify({'success': True, 'ruc': limpio,
                        'razon_social': (d.get('razon_social') or '').strip(),
                        'estado': d.get('estado'),
                        'tipo_persona': d.get('tipo_persona'),
                        'regimen': d.get('regimen'),
                        'ya_existe': ya[0] if ya else None})
    except Exception as e:
        return _error(e, 'consultar RUC')
    finally:
        _prov_soltar(conn)


@bp_matriz.route('/api/matriz/proveedores/verificar-sri', methods=['POST'])
def matriz_prov_verificar_sri():
    """Arranca la verificacion. Devuelve enseguida."""
    with _sri_lock:
        if _sri['estado'] == 'cargando':
            return jsonify({'success': True, 'estado': 'cargando',
                            'paso': _sri['paso']})
        _sri.update({'estado': 'cargando', 'inicio': time.time(), 'fin': None,
                     'paso': 'Arrancando', 'resultado': None, 'error': None})
    threading.Thread(target=_sri_job, daemon=True).start()
    return jsonify({'success': True, 'estado': 'cargando'})


@bp_matriz.route('/api/matriz/proveedores/verificar-sri', methods=['GET'])
def matriz_prov_verificar_sri_estado():
    with _sri_lock:
        r = {'success': True, 'estado': _sri['estado'], 'paso': _sri['paso'],
             'error': _sri['error']}
        if _sri['inicio']:
            fin = _sri['fin'] or time.time()
            r['segundos'] = round(fin - _sri['inicio'], 1)
        if _sri['estado'] == 'listo':
            r['resultado'] = _sri['resultado']
    return jsonify(r)
