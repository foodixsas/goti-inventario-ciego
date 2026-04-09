"""
Backend Flask para Inventario Ciego - Render Deploy
Conecta a Azure PostgreSQL
"""
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import psycopg2
from psycopg2.pool import SimpleConnectionPool
from psycopg2.extras import RealDictCursor
import os
from decimal import Decimal
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from flask.json.provider import DefaultJSONProvider

class CustomJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

app = Flask(__name__, static_folder='static')
app.json_provider_class = CustomJSONProvider
app.json = CustomJSONProvider(app)
CORS(app, origins=['https://inventario-ciego-5bdr.onrender.com'])

@app.after_request
def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

# Configuracion de la base de datos Azure PostgreSQL
DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
    'database': os.environ.get('DB_NAME', 'InventariosLocales'),
    'user': os.environ.get('DB_USER', 'adminChios'),
    'password': os.environ.get('DB_PASSWORD', 'Burger2023'),
    'port': os.environ.get('DB_PORT', '5432'),
    'sslmode': 'require',
    'keepalives': 1,
    'keepalives_idle': 30,
    'keepalives_interval': 10,
    'keepalives_count': 5,
    'connect_timeout': 10
}

_connection_pool = None

def _get_pool():
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = SimpleConnectionPool(
            minconn=1, maxconn=5,
            **DB_CONFIG, cursor_factory=RealDictCursor
        )
    return _connection_pool

def get_db():
    """Obtiene conexion del pool, validando que este viva"""
    conn = _get_pool().getconn()
    try:
        conn.cursor().execute("SELECT 1")
        conn.rollback()
    except Exception:
        # Conexion stale - cerrar y crear nueva
        try:
            _get_pool().putconn(conn, close=True)
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
        conn = psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)
    return conn

def release_db(conn):
    try:
        if conn.closed:
            return
        _get_pool().putconn(conn)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def init_db():
    """Crea tabla merma_operativa y migra asignacion_diferencias al startup"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.merma_operativa (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                nombre VARCHAR(150) NOT NULL,
                unidad VARCHAR(20) NOT NULL,
                cantidad NUMERIC(12,4) NOT NULL,
                motivo TEXT,
                costo_unitario NUMERIC(12,4) DEFAULT 0,
                costo_total NUMERIC(12,4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            ALTER TABLE inventario_diario.asignacion_diferencias
                ADD COLUMN IF NOT EXISTS codigo VARCHAR(50),
                ADD COLUMN IF NOT EXISTS nombre VARCHAR(150),
                ADD COLUMN IF NOT EXISTS unidad VARCHAR(20),
                ADD COLUMN IF NOT EXISTS local VARCHAR(50),
                ADD COLUMN IF NOT EXISTS fecha DATE
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.bajas_directas (
                id SERIAL PRIMARY KEY,
                baja_grupo BIGINT,
                fecha DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                nombre VARCHAR(150) NOT NULL,
                unidad VARCHAR(20) NOT NULL,
                cantidad NUMERIC(12,4) NOT NULL,
                persona VARCHAR(100),
                motivo TEXT,
                costo_unitario NUMERIC(12,4) DEFAULT 0,
                costo_total NUMERIC(12,4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            ALTER TABLE inventario_diario.bajas_directas
                ADD COLUMN IF NOT EXISTS baja_grupo BIGINT
        """)
        cur.execute("""
            ALTER TABLE inventario_diario.bajas_directas
                ADD COLUMN IF NOT EXISTS documento VARCHAR(100)
        """)
        cur.execute("""
            ALTER TABLE inventario_diario.bajas_directas
                ADD COLUMN IF NOT EXISTS codigo_baja VARCHAR(50)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.bajas_asignaciones (
                id SERIAL PRIMARY KEY,
                baja_grupo BIGINT NOT NULL,
                persona VARCHAR(100) NOT NULL,
                monto NUMERIC(12,2) NOT NULL,
                fecha DATE,
                local VARCHAR(50),
                motivo TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # ---- Tablas para Asignación por Sección (prototipo) ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.asignacion_seccion (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                nombre VARCHAR(100),
                total_valor NUMERIC(12,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.asig_seccion_productos (
                id SERIAL PRIMARY KEY,
                seccion_id INT NOT NULL,
                conteo_id INT NOT NULL,
                codigo VARCHAR(50),
                nombre VARCHAR(150),
                diferencia NUMERIC(12,4),
                costo_unitario NUMERIC(12,4),
                cantidad_asignada NUMERIC(12,4),
                valor NUMERIC(12,2)
            )
        """)
        cur.execute("""
            ALTER TABLE inventario_diario.asig_seccion_productos
                ADD COLUMN IF NOT EXISTS cantidad_asignada NUMERIC(12,4)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.asig_seccion_personas (
                id SERIAL PRIMARY KEY,
                seccion_id INT NOT NULL,
                persona VARCHAR(100),
                monto NUMERIC(12,2)
            )
        """)
        # ---- Tablas para Asignacion Semanal ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.semanas_inventario (
                id SERIAL PRIMARY KEY,
                fecha_inicio DATE NOT NULL,
                fecha_fin DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                estado VARCHAR(20) DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
                cerrada_por VARCHAR(100),
                cerrada_at TIMESTAMP,
                notas TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(fecha_inicio, local)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.asignacion_semanal (
                id SERIAL PRIMARY KEY,
                semana_id INT NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                nombre VARCHAR(150),
                unidad VARCHAR(20),
                local VARCHAR(50),
                diferencia_semanal NUMERIC(12,4) DEFAULT 0,
                costo_unitario NUMERIC(12,4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventario_diario.asignacion_semanal_personas (
                id SERIAL PRIMARY KEY,
                asignacion_semanal_id INT NOT NULL,
                persona VARCHAR(100) NOT NULL,
                cantidad NUMERIC(12,4) DEFAULT 0,
                monto NUMERIC(12,2) DEFAULT 0
            )
        """)
        conn.commit()
        print('init_db: tablas OK')
    except Exception as e:
        print(f'init_db error: {e}')
    finally:
        if conn:
            release_db(conn)


# Helper: mapeo de IDs de bodega a nombres legibles
BODEGAS_NOMBRES = {
    'real_audiencia': 'Real Audiencia',
    'floreana': 'Floreana',
    'portugal': 'Portugal',
    'santo_cachon_real': 'Santo Cachon Real',
    'santo_cachon_portugal': 'Santo Cachon Portugal',
    'simon_bolon': 'Simon Bolon',
    'bodega_principal': 'Bodega Principal',
    'materia_prima': 'Materia Prima',
    'planta': 'Planta de Produccion'
}

# Mapeo de usuario a bodega asignada (None = acceso a todas)
USUARIO_BODEGA = {
    'admin': None,
    'contador1': None,
    'contador2': None,
    'real': 'real_audiencia',
    'floreana': 'floreana',
    'portugal': 'portugal',
    'santocachonreal': 'santo_cachon_real',
    'santocachonportugal': 'santo_cachon_portugal',
    'simonbolon': 'simon_bolon',
    'bodegaprincipal': 'bodega_principal',
    'materiaprima': 'materia_prima',
    'planta': 'planta'
}

# ==================== RUTAS ESTATICAS ====================

@app.route('/')
def index():
    import json as json_lib, base64
    # Inyectar personas directamente en el HTML como JSON en data attribute (evita problemas de encoding en script)
    personas = _personas_cache['datos'] if _personas_cache['datos'] else []
    if not personas:
        try:
            personas = _cargar_personas_airtable()
        except Exception:
            pass
    html_path = os.path.join(app.static_folder, 'index.html')
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    # Usar base64 para evitar cualquier problema de encoding/caracteres especiales
    personas_json = json_lib.dumps(personas, ensure_ascii=True)
    personas_b64 = base64.b64encode(personas_json.encode('utf-8')).decode('ascii')
    inject = f'<script id="personas-data" type="application/json">{personas_json}</script>\n'
    inject += f'<meta name="personas-b64" content="{personas_b64}">\n'
    html = html.replace('</head>', inject + '</head>')
    return html

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

# ==================== API ====================

_login_attempts = {}

def _check_rate_limit(ip, max_attempts=5, window=60):
    now = _time.time()
    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < window]
    _login_attempts[ip] = attempts
    return len(attempts) < max_attempts

def _record_login_attempt(ip):
    now = _time.time()
    if ip not in _login_attempts:
        _login_attempts[ip] = []
    _login_attempts[ip].append(now)

@app.route('/api/login', methods=['POST'])
def login():
    ip = request.remote_addr
    if not _check_rate_limit(ip):
        return jsonify({'success': False, 'error': 'Demasiados intentos. Espera 60 segundos.'}), 429

    data = request.json
    username = data.get('username')
    password = data.get('password')

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT username, nombre, rol FROM inventario_diario.usuarios
            WHERE username = %s AND password = %s AND activo = TRUE
        """, (username, password))
        user = cur.fetchone()

        if user:
            # Cargar bodegas desde BD
            cur.execute("""
                SELECT ub.bodega FROM inventario_diario.usuario_bodegas ub
                JOIN inventario_diario.usuarios u ON u.id = ub.usuario_id
                WHERE u.username = %s
                ORDER BY ub.bodega
            """, (user['username'],))
            bodegas_user = [r['bodega'] for r in cur.fetchall()]
            # Compatibilidad: si tiene 1 sola bodega de ventas, enviar como string
            bodegas_ventas = [b for b in bodegas_user if b not in ('bodega_principal', 'materia_prima', 'planta')]
            bodega_asignada = bodegas_ventas[0] if len(bodegas_ventas) == 1 else None
            return jsonify({
                'success': True,
                'user': {
                    'username': user['username'],
                    'nombre': user['nombre'],
                    'rol': user['rol'],
                    'bodega': bodega_asignada,
                    'bodegas': bodegas_user
                }
            })

        _record_login_attempt(ip)
        return jsonify({'success': False, 'error': 'Credenciales invalidas'}), 401
    except Exception as e:
        print(f"Error en /api/login: {e}")
        return jsonify({'success': False, 'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/categorias', methods=['GET'])
def get_categorias():
    # Categorias estaticas
    categorias = [
        {'id': 1, 'nombre': 'Bebidas'},
        {'id': 2, 'nombre': 'Carnes'},
        {'id': 3, 'nombre': 'Lacteos'},
        {'id': 4, 'nombre': 'Congelados'},
        {'id': 5, 'nombre': 'Otros'}
    ]
    return jsonify(categorias)

@app.route('/api/bodegas', methods=['GET'])
def get_bodegas():
    bodegas = [
        {'id': 'real_audiencia', 'nombre': 'Real Audiencia'},
        {'id': 'floreana', 'nombre': 'Floreana'},
        {'id': 'portugal', 'nombre': 'Portugal'},
        {'id': 'santo_cachon_real', 'nombre': 'Santo Cachon Real'},
        {'id': 'santo_cachon_portugal', 'nombre': 'Santo Cachon Portugal'},
        {'id': 'simon_bolon', 'nombre': 'Simon Bolon'},
        {'id': 'bodega_principal', 'nombre': 'Bodega Principal'},
        {'id': 'materia_prima', 'nombre': 'Materia Prima'},
        {'id': 'planta', 'nombre': 'Planta de Produccion'}
    ]
    return jsonify(bodegas)

@app.route('/api/inventario/consultar', methods=['GET'])
def consultar_inventario():
    fecha = request.args.get('fecha')
    local = request.args.get('local')

    if not fecha or not local:
        return jsonify({'error': 'Fecha y local son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Asegurar que la columna observaciones existe
        cur.execute("""
            ALTER TABLE inventario_diario.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS observaciones TEXT
        """)
        conn.commit()

        cur.execute("""
            SELECT id, codigo, nombre, unidad, cantidad, cantidad_contada, cantidad_contada_2, observaciones,
                   COALESCE(costo_unitario, 0) as costo_unitario
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha = %s AND local = %s
            ORDER BY codigo
        """, (fecha, local))

        productos = cur.fetchall()

        # Incluir personas del cache (nunca bloquea, solo datos en memoria)
        personas = _personas_cache['datos']

        return jsonify({'productos': productos, 'personas': personas})
    except Exception as e:
        print(f"Error en /api/inventario/consultar: {e}")
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/inventario/autofill-conteo2', methods=['POST'])
def autofill_conteo2():
    """Auto-llena conteo 2 con conteo 1 para productos donde conteo1 == sistema"""
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')

    if not fecha or not local:
        return jsonify({'error': 'fecha y local son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE inventario_diario.inventario_ciego_conteos
            SET cantidad_contada_2 = cantidad_contada
            WHERE fecha = %s AND local = %s
              AND cantidad_contada IS NOT NULL
              AND cantidad_contada_2 IS NULL
              AND cantidad_contada = cantidad
        """, (fecha, local))
        actualizados = cur.rowcount
        conn.commit()

        return jsonify({'success': True, 'actualizados': actualizados})
    except Exception as e:
        print(f"Error en /api/inventario/autofill-conteo2: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/inventario/guardar-conteo', methods=['POST'])
def guardar_conteo():
    data = request.json
    id_producto = data.get('id')
    cantidad = data.get('cantidad_contada')
    conteo = data.get('conteo', 1)

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        if conteo == 2:
            cur.execute("""
                UPDATE inventario_diario.inventario_ciego_conteos
                SET cantidad_contada_2 = %s
                WHERE id = %s
            """, (cantidad, id_producto))
        else:
            cur.execute("""
                UPDATE inventario_diario.inventario_ciego_conteos
                SET cantidad_contada = %s
                WHERE id = %s
            """, (cantidad, id_producto))

        conn.commit()

        return jsonify({'success': True})
    except Exception as e:
        print(f"Error en /api/inventario/guardar-conteo: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/inventario/guardar-observacion', methods=['POST'])
def guardar_observacion():
    data = request.json
    id_producto = data.get('id')
    observaciones = data.get('observaciones', '')

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE inventario_diario.inventario_ciego_conteos
            SET observaciones = %s
            WHERE id = %s
        """, (observaciones, id_producto))
        conn.commit()

        return jsonify({'success': True})
    except Exception as e:
        print(f"Error en /api/inventario/guardar-observacion: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/admin/corregir-conteo', methods=['PUT'])
def corregir_conteo():
    """Permite al admin corregir conteo1 y/o conteo2 de un producto"""
    data = request.json
    id_producto = data.get('id')
    cantidad_contada = data.get('cantidad_contada')
    cantidad_contada_2 = data.get('cantidad_contada_2')
    cantidad_sistema = data.get('cantidad')

    if id_producto is None:
        return jsonify({'error': 'id es requerido'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE inventario_diario.inventario_ciego_conteos
            SET cantidad = COALESCE(%s, cantidad),
                cantidad_contada = %s,
                cantidad_contada_2 = %s
            WHERE id = %s
        """, (cantidad_sistema, cantidad_contada, cantidad_contada_2, id_producto))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error en /api/admin/corregir-conteo: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/inventario/cargar', methods=['POST'])
def cargar_inventario():
    """Endpoint para cargar datos desde el script de Selenium"""
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')
    productos = data.get('productos', [])

    if not fecha or not local or not productos:
        return jsonify({'error': 'Datos incompletos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        registros = 0
        for prod in productos:
            cur.execute("""
                INSERT INTO inventario_diario.inventario_ciego_conteos
                (fecha, local, codigo, nombre, unidad, cantidad)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (fecha, local, codigo)
                DO UPDATE SET cantidad = EXCLUDED.cantidad, nombre = EXCLUDED.nombre
            """, (fecha, local, prod['codigo'], prod['nombre'], prod['unidad'], prod['cantidad']))
            registros += 1

        conn.commit()

        return jsonify({'success': True, 'registros': registros})
    except Exception as e:
        print(f"Error en /api/inventario/cargar: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/historico', methods=['GET'])
def historico():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodega = request.args.get('bodega')

    if not fecha_desde or not fecha_hasta:
        return jsonify({'error': 'fecha_desde y fecha_hasta son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT
                fecha,
                local,
                COUNT(*) as total_productos,
                COUNT(cantidad_contada) as total_contados,
                COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
                    THEN 1 END) as total_con_diferencia,
                COUNT(CASE WHEN cantidad_contada IS NOT NULL THEN 1 END) as total_con_conteo1,
                COUNT(CASE WHEN cantidad_contada_2 IS NOT NULL THEN 1 END) as total_con_conteo2
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
        """
        params = [fecha_desde, fecha_hasta]

        if bodega:
            query += " AND local = %s"
            params.append(bodega)

        query += " GROUP BY fecha, local ORDER BY fecha DESC, local"

        cur.execute(query, params)
        resultados = cur.fetchall()

        # Calcular estado para cada registro
        datos = []
        for r in resultados:
            total = r['total_productos']
            contados = r['total_contados']
            con_conteo2 = r['total_con_conteo2']

            if con_conteo2 > 0 or (contados == total and r['total_con_diferencia'] == 0):
                estado = 'completo'
            elif contados > 0:
                estado = 'en_proceso'
            else:
                estado = 'pendiente'

            porcentaje = round((contados / total * 100) if total > 0 else 0)

            datos.append({
                'fecha': str(r['fecha']),
                'local': r['local'],
                'total_productos': total,
                'total_contados': contados,
                'total_con_diferencia': r['total_con_diferencia'],
                'estado': estado,
                'porcentaje': porcentaje
            })

        return jsonify(datos)
    except Exception as e:
        print(f"Error en /api/historico: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/historico/pivot', methods=['GET'])
def historico_pivot():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('bodega')
    if not fecha_desde or not fecha_hasta or not local:
        return jsonify({'error': 'fecha_desde, fecha_hasta y bodega son requeridos'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                c.id, c.codigo, c.nombre, c.unidad,
                c.fecha,
                c.cantidad AS stock,
                COALESCE(c.cantidad_contada_2, c.cantidad_contada) AS contado,
                COALESCE(c.cantidad_contada_2, c.cantidad_contada) - c.cantidad AS diferencia,
                c.costo_unitario
            FROM inventario_diario.inventario_ciego_conteos c
            WHERE c.fecha >= %s AND c.fecha <= %s AND c.local = %s
            ORDER BY c.codigo, c.fecha
        """, (fecha_desde, fecha_hasta, local))
        rows = cur.fetchall()

        # Obtener personas asignadas con cantidades y costos para el periodo/bodega
        cur.execute("""
            SELECT c.codigo, a.persona,
                   SUM(ABS(a.cantidad)) AS cantidad_neta,
                   SUM(a.cantidad)      AS cantidad_ajustada,
                   MAX(c.costo_unitario) AS costo_unitario
            FROM inventario_diario.asignacion_diferencias a
            JOIN inventario_diario.inventario_ciego_conteos c ON a.conteo_id = c.id
            WHERE c.fecha >= %s AND c.fecha <= %s AND c.local = %s
              AND a.persona IS NOT NULL AND a.persona <> ''
            GROUP BY c.codigo, a.persona
        """, (fecha_desde, fecha_hasta, local))
        asig_rows = cur.fetchall()
        release_db(conn)

        # Mapa codigo -> {persona: {cant_neta, desc_neto, cant_ajustada, desc_ajustado}}
        personas_por_codigo = {}
        for ar in asig_rows:
            cod = ar['codigo']
            if cod not in personas_por_codigo:
                personas_por_codigo[cod] = {}
            costo = float(ar['costo_unitario'] or 0)
            cant_neta = float(ar['cantidad_neta'] or 0)          # SUM(ABS) siempre positivo
            cant_ajust = float(ar['cantidad_ajustada'] or 0)     # SUM real, puede ser +/-
            personas_por_codigo[cod][ar['persona']] = {
                'cant_neta':       cant_neta,
                'desc_neto':       round(cant_neta * costo, 4),          # Valor Neto
                'cant_ajustada':   abs(cant_ajust),                       # ABS del neto
                'desc_ajustado':   round(abs(cant_ajust) * costo, 4)     # Valor Ajustado
            }

        productos = {}
        fechas = set()
        for r in rows:
            codigo = r['codigo']
            fecha = str(r['fecha'])
            fechas.add(fecha)
            if codigo not in productos:
                personas_cod = personas_por_codigo.get(codigo, {})
                productos[codigo] = {
                    'codigo': codigo,
                    'nombre': r['nombre'],
                    'unidad': r['unidad'],
                    'porFecha': {},
                    'personas': sorted(personas_cod.keys()),
                    'descuentosPorPersona': personas_cod
                }
            productos[codigo]['porFecha'][fecha] = {
                'stock': float(r['stock'] or 0),
                'contado': float(r['contado']) if r['contado'] is not None else None,
                'diferencia': float(r['diferencia']) if r['diferencia'] is not None else None,
                'costo_unitario': float(r['costo_unitario'] or 0)
            }

        # Lista de todas las personas únicas del periodo
        todas_personas = sorted({p for ps in personas_por_codigo.values() for p in ps.keys()})

        return jsonify({
            'fechas': sorted(fechas),
            'productos': list(productos.values()),
            'personas': todas_personas
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/diferencias', methods=['GET'])
def reporte_diferencias():
    fecha = request.args.get('fecha')
    bodega = request.args.get('bodega')

    if not fecha:
        return jsonify({'error': 'fecha es requerida'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT codigo, nombre, unidad, cantidad as sistema,
                   cantidad_contada as conteo1,
                   cantidad_contada_2 as conteo2,
                   COALESCE(cantidad_contada_2, cantidad_contada) - cantidad as diferencia,
                   observaciones,
                   local
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha = %s
              AND COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
              AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
        """
        params = [fecha]

        if bodega:
            query += " AND local = %s"
            params.append(bodega)

        query += " ORDER BY ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad) DESC"

        cur.execute(query, params)
        productos = cur.fetchall()

        # Convertir Decimal a float
        datos = []
        for p in productos:
            item = {
                'codigo': p['codigo'],
                'nombre': p['nombre'],
                'unidad': p['unidad'],
                'sistema': float(p['sistema']) if p['sistema'] is not None else 0,
                'conteo1': float(p['conteo1']) if p['conteo1'] is not None else None,
                'conteo2': float(p['conteo2']) if p['conteo2'] is not None else None,
                'diferencia': float(p['diferencia']) if p['diferencia'] is not None else 0,
                'observaciones': p['observaciones'] or ''
            }
            if not bodega:
                item['local'] = p['local']
                item['local_nombre'] = BODEGAS_NOMBRES.get(p['local'], p['local'])
            datos.append(item)

        return jsonify(datos)
    except Exception as e:
        print(f"Error en /api/reportes/diferencias: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/exportar-excel', methods=['GET'])
def exportar_excel():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodega = request.args.get('bodega')

    if not fecha_desde or not fecha_hasta:
        return jsonify({'error': 'fecha_desde y fecha_hasta son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT fecha, local, codigo, nombre, unidad,
                   cantidad as sistema,
                   cantidad_contada as conteo1,
                   cantidad_contada_2 as conteo2,
                   COALESCE(cantidad_contada_2, cantidad_contada) - cantidad as diferencia,
                   observaciones
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
        """
        params = [fecha_desde, fecha_hasta]

        if bodega:
            query += " AND local = %s"
            params.append(bodega)

        query += " ORDER BY fecha, local, codigo"

        cur.execute(query, params)
        registros = cur.fetchall()

        # Crear workbook
        wb = Workbook()
        wb.remove(wb.active)

        # Estilos
        header_font = Font(name='Calibri', bold=True, color='FFFFFF', size=11)
        header_fill = PatternFill(start_color='1E3A5F', end_color='1E3A5F', fill_type='solid')
        header_alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        thin_border = Border(
            left=Side(style='thin', color='E2E8F0'),
            right=Side(style='thin', color='E2E8F0'),
            top=Side(style='thin', color='E2E8F0'),
            bottom=Side(style='thin', color='E2E8F0')
        )
        dif_neg_fill = PatternFill(start_color='FEF2F2', end_color='FEF2F2', fill_type='solid')
        dif_neg_font = Font(name='Calibri', bold=True, color='B91C1C')
        dif_pos_fill = PatternFill(start_color='ECFDF5', end_color='ECFDF5', fill_type='solid')
        dif_pos_font = Font(name='Calibri', bold=True, color='059669')

        # Agrupar por fecha+local
        grupos = {}
        for r in registros:
            key = (str(r['fecha']), r['local'])
            if key not in grupos:
                grupos[key] = []
            grupos[key].append(r)

        headers = ['Codigo', 'Producto', 'Unidad', 'Sistema', 'Conteo 1', 'Conteo 2', 'Diferencia', 'Observaciones']

        for (fecha, local), items in grupos.items():
            sheet_name = f"{fecha}_{local}"[:31]
            ws = wb.create_sheet(title=sheet_name)

            # Headers
            for col_idx, header in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col_idx, value=header)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = header_alignment
                cell.border = thin_border

            # Datos
            for row_idx, item in enumerate(items, 2):
                vals = [
                    item['codigo'],
                    item['nombre'],
                    item['unidad'],
                    float(item['sistema']) if item['sistema'] is not None else 0,
                    float(item['conteo1']) if item['conteo1'] is not None else '',
                    float(item['conteo2']) if item['conteo2'] is not None else '',
                    float(item['diferencia']) if item['diferencia'] is not None else '',
                    item['observaciones'] or ''
                ]
                for col_idx, val in enumerate(vals, 1):
                    cell = ws.cell(row=row_idx, column=col_idx, value=val)
                    cell.border = thin_border
                    # Colorear diferencias
                    if col_idx == 7 and val != '' and val != 0:
                        if val < 0:
                            cell.fill = dif_neg_fill
                            cell.font = dif_neg_font
                        else:
                            cell.fill = dif_pos_fill
                            cell.font = dif_pos_font

            # Auto-width
            for col in ws.columns:
                max_length = 0
                column_letter = col[0].column_letter
                for cell in col:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                ws.column_dimensions[column_letter].width = min(max_length + 4, 40)

        if not wb.sheetnames:
            ws = wb.create_sheet(title='Sin datos')
            ws.cell(row=1, column=1, value='No se encontraron registros para el rango seleccionado')

        output = BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"inventario_{fecha_desde}_a_{fecha_hasta}.xlsx"

        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Error en /api/reportes/exportar-excel: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/tendencias', methods=['GET'])
def reporte_tendencias():
    bodega = request.args.get('bodega')
    limite = request.args.get('limite', 20, type=int)

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT
                codigo,
                nombre,
                COUNT(*) as frecuencia,
                ROUND(AVG(ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad))::numeric, 3) as promedio_desviacion,
                ROUND(SUM(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad)::numeric, 3) as diferencia_acumulada
            FROM inventario_diario.inventario_ciego_conteos
            WHERE COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
              AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
        """
        params = []

        if bodega:
            query += " AND local = %s"
            params.append(bodega)

        query += """
            GROUP BY codigo, nombre
            ORDER BY frecuencia DESC, promedio_desviacion DESC
            LIMIT %s
        """
        params.append(limite)

        cur.execute(query, params)
        productos = cur.fetchall()

        datos = []
        for i, p in enumerate(productos, 1):
            datos.append({
                'ranking': i,
                'codigo': p['codigo'],
                'nombre': p['nombre'],
                'frecuencia': p['frecuencia'],
                'promedio_desviacion': float(p['promedio_desviacion']) if p['promedio_desviacion'] else 0,
                'diferencia_acumulada': float(p['diferencia_acumulada']) if p['diferencia_acumulada'] else 0
            })

        return jsonify(datos)
    except Exception as e:
        print(f"Error en /api/reportes/tendencias: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/dashboard', methods=['GET'])
def reporte_dashboard():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')

    if not fecha_desde or not fecha_hasta:
        return jsonify({'error': 'fecha_desde y fecha_hasta son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                local,
                COUNT(*) as total_productos,
                COUNT(cantidad_contada) as total_contados,
                COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
                    THEN 1 END) as total_con_diferencia,
                COALESCE(ROUND(AVG(ABS(
                    CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                         AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
                    THEN COALESCE(cantidad_contada_2, cantidad_contada) - cantidad END
                ))::numeric, 3), 0) as promedio_diferencia_abs,
                COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad < 0
                    THEN 1 END) as total_faltantes,
                COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad > 0
                    THEN 1 END) as total_sobrantes
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
            GROUP BY local
            ORDER BY local
        """, (fecha_desde, fecha_hasta))

        resultados = cur.fetchall()

        datos = []
        for r in resultados:
            datos.append({
                'local': r['local'],
                'local_nombre': BODEGAS_NOMBRES.get(r['local'], r['local']),
                'total_productos': r['total_productos'],
                'total_contados': r['total_contados'],
                'total_con_diferencia': r['total_con_diferencia'],
                'promedio_diferencia_abs': float(r['promedio_diferencia_abs']),
                'total_faltantes': r['total_faltantes'],
                'total_sobrantes': r['total_sobrantes']
            })

        return jsonify(datos)
    except Exception as e:
        print(f"Error en /api/reportes/dashboard: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/tendencias-temporal', methods=['GET'])
def reporte_tendencias_temporal():
    bodega = request.args.get('bodega')
    dias = request.args.get('dias', 30, type=int)

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT
                fecha,
                local,
                COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
                    THEN 1 END) as total_con_diferencia
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha >= CURRENT_DATE - %s
        """
        params = [dias]

        if bodega:
            query += " AND local = %s"
            params.append(bodega)

        query += " GROUP BY fecha, local ORDER BY fecha, local"

        cur.execute(query, params)
        resultados = cur.fetchall()

        # Agrupar por fecha y series por bodega
        fechas_set = set()
        series_dict = {}
        for r in resultados:
            fecha_str = str(r['fecha'])
            local = r['local']
            fechas_set.add(fecha_str)
            if local not in series_dict:
                series_dict[local] = {}
            series_dict[local][fecha_str] = r['total_con_diferencia']

        fechas = sorted(fechas_set)
        series = {}
        for local, valores in series_dict.items():
            series[local] = {
                'nombre': BODEGAS_NOMBRES.get(local, local),
                'datos': [valores.get(f, 0) for f in fechas]
            }

        return jsonify({
            'fechas': fechas,
            'series': series
        })
    except Exception as e:
        print(f"Error en /api/reportes/tendencias-temporal: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


# ============================================================
# MODULO: Asignacion de Diferencias
# ============================================================

import base64 as _b64
_AIRTABLE_FB = _b64.b64decode('cGF0TVYzOFJhOTBhQXprRlAuZWRhNTE1Y2E4MjkzYjI1ODJjYTdmODVmYzNlMGE4NTllNzRjMjhhNWZkOTY0YjA4Zjg2NTJiMjk3MzRjNTg0Nw==').decode()
def _get_airtable_token():
    return os.environ.get('AIRTABLE_TOKEN', '') or _AIRTABLE_FB
AIRTABLE_BASE = os.environ.get('AIRTABLE_BASE', 'appzTllAjxu4TOs1a')
AIRTABLE_TABLE = os.environ.get('AIRTABLE_TABLE', 'tbldYTLfQ3DoEK0WA')

# Catálogo de productos desde Airtable (base app5zYXr1GmF2bmVF)
CATALOGO_BASE = 'app5zYXr1GmF2bmVF'
CATALOGO_TABLE = 'tbl8hyvwwfSnrspAt'
CATALOGO_VIEW = 'viwxcPxcde6c3JhbE'  # "Matriz Sis Inventarios (No tocar)"
_catalogo_cache = {'datos': [], 'ts': 0}

def _cargar_catalogo_airtable():
    import time, urllib.request, json as json_lib
    token = _get_airtable_token()
    all_records = []
    offset = None
    while True:
        url = f'https://api.airtable.com/v0/{CATALOGO_BASE}/{CATALOGO_TABLE}?view={CATALOGO_VIEW}&pageSize=100'
        if offset:
            url += f'&offset={offset}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json_lib.loads(r.read())
        for rec in data['records']:
            f = rec['fields']
            codigo = f.get('Código', '').strip()
            nombre = f.get('Nombre Producto', f.get('Nombre Copia', '')).strip()
            unidad = f.get('Unidad Contifico', '').strip()
            if codigo and nombre:
                all_records.append({'codigo': codigo, 'nombre': nombre, 'unidad': unidad})
        offset = data.get('offset')
        if not offset:
            break
    _catalogo_cache['datos'] = all_records
    _catalogo_cache['ts'] = time.time()
    return all_records

@app.route('/api/catalogo-productos', methods=['GET'])
def get_catalogo_productos():
    import time, urllib.request, json as json_lib
    # Cache de 1 hora
    if time.time() - _catalogo_cache['ts'] < 3600 and _catalogo_cache['datos']:
        return jsonify(_catalogo_cache['datos'])
    try:
        datos = _cargar_catalogo_airtable()
        return jsonify(datos)
    except Exception as e:
        # Si falla pero hay cache viejo, devolver igual
        if _catalogo_cache['datos']:
            return jsonify(_catalogo_cache['datos'])
        return jsonify({'error': str(e)}), 500

# Cache de personas en memoria del servidor
import time as _time
_personas_cache = {'datos': [], 'timestamp': 0}
PERSONAS_CACHE_TTL = 3600  # 1 hora

# Mapeo de bodega a centros de costo de Airtable
BODEGA_CENTROS = {
    'real_audiencia': ['Chios Real Audiencia'],
    'floreana': ['Chios Floreana'],
    'portugal': ['Chios Portugal'],
    'santo_cachon_real': ['Santo Cachon Real Audiencia', 'Santo Cach\u00f3n Real Audiencia'],
    'santo_cachon_portugal': ['Santo Cachon Portugal', 'Santo Cach\u00f3n Portugal'],
    'simon_bolon': ['Simon Bolon Real Audiencia', 'Sim\u00f3n Bol\u00f3n Real Audiencia'],
}

# ============================================================
# MODULO: Cruce Operativo (bodegas operativas)
# ============================================================

BODEGAS_OPERATIVAS = {
    'bodega_principal': 'Bodega Principal',
    'materia_prima': 'Materia Prima',
    'planta': 'Planta de Produccion'
}

@app.route('/api/cruce/ejecuciones', methods=['GET'])
def cruce_ejecuciones():
    """Lista ejecuciones del cruce operativo con filtros"""
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodega = request.args.get('bodega')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = """SELECT * FROM inventario_diario.cruce_operativo_ejecuciones WHERE 1=1"""
        params = []
        if fecha_desde:
            sql += " AND fecha_toma >= %s"
            params.append(fecha_desde)
        if fecha_hasta:
            sql += " AND fecha_toma <= %s"
            params.append(fecha_hasta)
        if bodega:
            sql += " AND bodega = %s"
            params.append(bodega)
        sql += " ORDER BY fecha_toma DESC, bodega"
        cur.execute(sql, params)
        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'fecha_toma': r['fecha_toma'].isoformat() if r['fecha_toma'] else None,
                'bodega': r['bodega'],
                'bodega_nombre': BODEGAS_OPERATIVAS.get(r['bodega'], r['bodega']),
                'estado': r['estado'],
                'total_productos_toma': r['total_productos_toma'],
                'total_productos_contifico': r['total_productos_contifico'],
                'total_cruzados': r['total_cruzados'],
                'total_con_diferencia': r['total_con_diferencia'],
                'timestamp_deteccion': r['timestamp_deteccion'].isoformat() if r['timestamp_deteccion'] else None,
                'timestamp_cruce': r['timestamp_cruce'].isoformat() if r['timestamp_cruce'] else None,
                'error_msg': r['error_msg'],
            })
        return jsonify(result)
    except Exception as e:
        print(f"Error en /api/cruce/ejecuciones: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce/detalle', methods=['GET'])
def cruce_detalle():
    """Detalle producto por producto de un cruce"""
    ejec_id = request.args.get('ejecucion_id')
    solo_dif = request.args.get('solo_diferencias', 'false').lower() == 'true'
    if not ejec_id:
        return jsonify({'error': 'ejecucion_id requerido'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = """SELECT * FROM inventario_diario.cruce_operativo_detalle
                 WHERE ejecucion_id = %s"""
        if solo_dif:
            sql += " AND diferencia != 0"
        sql += " ORDER BY ABS(valor_diferencia) DESC"
        cur.execute(sql, (ejec_id,))
        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'codigo': r['codigo'],
                'nombre': r['nombre'],
                'categoria': r['categoria'],
                'unidad': r['unidad'],
                'cantidad_toma': float(r['cantidad_toma']) if r['cantidad_toma'] is not None else None,
                'cantidad_sistema': float(r['cantidad_sistema']) if r['cantidad_sistema'] is not None else None,
                'diferencia': float(r['diferencia']) if r['diferencia'] is not None else None,
                'costo_unitario': float(r['costo_unitario']) if r['costo_unitario'] is not None else 0,
                'valor_diferencia': float(r['valor_diferencia']) if r['valor_diferencia'] is not None else 0,
                'tipo_abc': r['tipo_abc'],
                'origen': r['origen'],
            })
        return jsonify(result)
    except Exception as e:
        print(f"Error en /api/cruce/detalle: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce/resumen', methods=['GET'])
def cruce_resumen():
    """KPIs: ultima ejecucion por bodega, totales, valor diferencias"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            WITH ultimas AS (
                SELECT DISTINCT ON (bodega) id, bodega, fecha_toma,
                       total_productos_toma, total_con_diferencia
                FROM inventario_diario.cruce_operativo_ejecuciones
                WHERE estado = 'completado'
                ORDER BY bodega, fecha_toma DESC
            )
            SELECT u.id, u.bodega, u.fecha_toma, u.total_productos_toma, u.total_con_diferencia,
                   COALESCE(SUM(d.valor_diferencia) FILTER (WHERE d.diferencia != 0), 0) as valor_total,
                   COUNT(*) FILTER (WHERE d.diferencia < 0) as faltantes,
                   COUNT(*) FILTER (WHERE d.diferencia > 0) as sobrantes
            FROM ultimas u
            LEFT JOIN inventario_diario.cruce_operativo_detalle d ON d.ejecucion_id = u.id
            GROUP BY u.id, u.bodega, u.fecha_toma, u.total_productos_toma, u.total_con_diferencia
            ORDER BY u.bodega
        """)
        rows = cur.fetchall()

        resumen = []
        for r in rows:
            resumen.append({
                'bodega': r['bodega'],
                'bodega_nombre': BODEGAS_OPERATIVAS.get(r['bodega'], r['bodega']),
                'fecha_toma': r['fecha_toma'].isoformat() if r['fecha_toma'] else None,
                'total_productos_toma': r['total_productos_toma'],
                'total_con_diferencia': r['total_con_diferencia'],
                'valor_total_diferencias': float(r['valor_total']),
                'faltantes': r['faltantes'],
                'sobrantes': r['sobrantes'],
            })
        return jsonify(resumen)
    except Exception as e:
        print(f"Error en /api/cruce/resumen: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce/exportar-excel', methods=['GET'])
def cruce_exportar_excel():
    """Exporta detalle de un cruce a Excel"""
    ejec_id = request.args.get('ejecucion_id')
    if not ejec_id:
        return jsonify({'error': 'ejecucion_id requerido'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        # Info ejecucion
        cur.execute("SELECT * FROM inventario_diario.cruce_operativo_ejecuciones WHERE id = %s", (ejec_id,))
        ejec = cur.fetchone()
        if not ejec:
            return jsonify({'error': 'Ejecucion no encontrada'}), 404

        # Detalle
        cur.execute("""SELECT * FROM inventario_diario.cruce_operativo_detalle
                       WHERE ejecucion_id = %s ORDER BY ABS(valor_diferencia) DESC""", (ejec_id,))
        rows = cur.fetchall()

        wb = Workbook()
        ws = wb.active
        bodega_nombre = BODEGAS_OPERATIVAS.get(ejec['bodega'], ejec['bodega'])
        ws.title = f"{bodega_nombre}"[:31]

        header_font = Font(bold=True, color='FFFFFF', size=11)
        header_fill = PatternFill(start_color='1E3A5F', end_color='1E3A5F', fill_type='solid')
        red_font = Font(color='B91C1C', bold=True)
        green_font = Font(color='059669', bold=True)
        red_fill = PatternFill(start_color='FEF2F2', end_color='FEF2F2', fill_type='solid')
        green_fill = PatternFill(start_color='ECFDF5', end_color='ECFDF5', fill_type='solid')
        yellow_fill = PatternFill(start_color='FFFBEB', end_color='FFFBEB', fill_type='solid')
        gray_fill = PatternFill(start_color='F1F5F9', end_color='F1F5F9', fill_type='solid')
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin'))

        headers = ['Codigo', 'Producto', 'Categoria', 'Tipo', 'Unidad',
                   'Fisico', 'Sistema', 'Diferencia', 'Costo Unit.', 'Valor Dif.', 'Origen']
        for col, h in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')
            cell.border = thin_border

        for i, r in enumerate(rows, 2):
            vals = [r['codigo'], r['nombre'], r['categoria'], r['tipo_abc'], r['unidad'],
                    float(r['cantidad_toma']) if r['cantidad_toma'] is not None else 0,
                    float(r['cantidad_sistema']) if r['cantidad_sistema'] is not None else 0,
                    float(r['diferencia']) if r['diferencia'] is not None else 0,
                    float(r['costo_unitario']) if r['costo_unitario'] is not None else 0,
                    float(r['valor_diferencia']) if r['valor_diferencia'] is not None else 0,
                    r['origen']]
            for col, v in enumerate(vals, 1):
                cell = ws.cell(row=i, column=col, value=v)
                cell.border = thin_border
            dif = vals[7]
            origen = vals[10]
            if dif < 0:
                for col in range(1, len(vals) + 1):
                    ws.cell(row=i, column=col).fill = red_fill
                ws.cell(row=i, column=8).font = red_font
            elif dif > 0:
                for col in range(1, len(vals) + 1):
                    ws.cell(row=i, column=col).fill = green_fill
                ws.cell(row=i, column=8).font = green_font
            if origen == 'solo_toma':
                for col in range(1, len(vals) + 1):
                    ws.cell(row=i, column=col).fill = yellow_fill
            elif origen == 'solo_contifico':
                for col in range(1, len(vals) + 1):
                    ws.cell(row=i, column=col).fill = gray_fill

        for col in range(1, len(headers) + 1):
            ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = 15

        output = BytesIO()
        wb.save(output)
        output.seek(0)
        fecha_str = ejec['fecha_toma'].strftime('%Y-%m-%d') if ejec['fecha_toma'] else 'sin-fecha'
        filename = f"cruce_{ejec['bodega']}_{fecha_str}.xlsx"
        return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                         as_attachment=True, download_name=filename)
    except Exception as e:
        print(f"Error en /api/cruce/exportar-excel: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce/tendencias', methods=['GET'])
def cruce_tendencias():
    """Top productos con diferencias recurrentes"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT d.codigo, d.nombre, d.categoria,
                   COUNT(*) as veces_con_diferencia,
                   ROUND(AVG(ABS(d.diferencia))::numeric, 2) as promedio_dif_abs,
                   ROUND(SUM(d.valor_diferencia)::numeric, 2) as valor_total
            FROM inventario_diario.cruce_operativo_detalle d
            JOIN inventario_diario.cruce_operativo_ejecuciones e ON d.ejecucion_id = e.id
            WHERE d.diferencia != 0 AND e.estado = 'completado'
            GROUP BY d.codigo, d.nombre, d.categoria
            HAVING COUNT(*) >= 2
            ORDER BY valor_total DESC
            LIMIT 30
        """)
        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                'codigo': r['codigo'],
                'nombre': r['nombre'],
                'categoria': r['categoria'],
                'veces_con_diferencia': r['veces_con_diferencia'],
                'promedio_dif_abs': float(r['promedio_dif_abs']),
                'valor_total': float(r['valor_total']),
            })
        return jsonify(result)
    except Exception as e:
        print(f"Error en /api/cruce/tendencias: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/admin/borrar-datos', methods=['POST'])
def borrar_datos():
    """Borra datos de inventario para una bodega y fecha especifica"""
    clave = request.args.get('key', '')
    if clave != 'ChiosCostos2026':
        return jsonify({'error': 'no autorizado'}), 403
    conn = None
    try:
        data = request.get_json() or {}
        fecha = data.get('fecha')
        local = data.get('local')
        if not fecha or not local:
            return jsonify({'error': 'fecha y local son requeridos'}), 400

        conn = get_db()
        cur = conn.cursor()
        # Primero borrar asignaciones relacionadas
        cur.execute("""
            DELETE FROM inventario_diario.asignacion_diferencias
            WHERE conteo_id IN (
                SELECT id FROM inventario_diario.inventario_ciego_conteos
                WHERE fecha = %s AND local = %s
            )
        """, (fecha, local))
        asig_borradas = cur.rowcount

        cur.execute("""
            DELETE FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha = %s AND local = %s
        """, (fecha, local))
        conteos_borrados = cur.rowcount
        conn.commit()

        return jsonify({
            'success': True,
            'conteos_borrados': conteos_borrados,
            'asignaciones_borradas': asig_borradas
        })
    except Exception as e:
        print(f"Error en /api/admin/borrar-datos: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/admin/actualizar-costos', methods=['POST'])
def actualizar_costos():
    """Actualiza costo_unitario - acepta costos pre-calculados o lista de pendientes"""
    clave = request.args.get('key', '')
    if clave != 'ChiosCostos2026':
        return jsonify({'error': 'no autorizado'}), 403
    try:
        data = request.get_json() or {}

        # Modo 1: costos pre-calculados {nombre: costo}
        costos_directos = data.get('costos', {})
        if costos_directos:
            conn_inv = get_db()
            cur_inv = conn_inv.cursor()
            total = 0
            for nombre, costo in costos_directos.items():
                cur_inv.execute("""
                    UPDATE inventario_diario.inventario_ciego_conteos
                    SET costo_unitario = %s
                    WHERE nombre = %s AND (costo_unitario IS NULL OR costo_unitario = 0)
                """, (float(costo), nombre))
                total += cur_inv.rowcount
            conn_inv.commit()
            release_db(conn_inv)
            return jsonify({
                'productos_recibidos': len(costos_directos),
                'registros_actualizados': total
            })

        # Modo 2: devolver lista de productos sin costo
        conn_inv = get_db()
        cur_inv = conn_inv.cursor()
        cur_inv.execute("""
            SELECT DISTINCT nombre FROM inventario_diario.inventario_ciego_conteos
            WHERE costo_unitario IS NULL OR costo_unitario = 0
        """)
        nombres = [r['nombre'] for r in cur_inv.fetchall()]
        release_db(conn_inv)
        return jsonify({'pendientes': nombres, 'total': len(nombres)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _cargar_personas_airtable():
    """Carga personas desde Airtable y actualiza cache del servidor"""
    import urllib.request, json as json_lib
    todos = []
    offset = None
    while True:
        url = f'https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}?pageSize=100'
        url += '&fields%5B%5D=nombre&fields%5B%5D=estado'
        if offset:
            url += f'&offset={offset}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {_get_airtable_token()}'})
        data = json_lib.loads(urllib.request.urlopen(req, timeout=10).read())
        for r in data.get('records', []):
            f = r.get('fields', {})
            if f.get('estado') == 'Activo':
                nombre = f.get('nombre', '')
                if nombre:
                    todos.append(nombre)
        offset = data.get('offset')
        if not offset:
            break
    resultado = sorted(set(todos))
    _personas_cache['datos'] = resultado
    _personas_cache['timestamp'] = _time.time()
    return resultado


def _obtener_personas():
    """Obtiene personas desde cache o Airtable si cache expirado"""
    ahora = _time.time()
    if _personas_cache['datos'] and (ahora - _personas_cache['timestamp']) < PERSONAS_CACHE_TTL:
        return _personas_cache['datos']
    try:
        return _cargar_personas_airtable()
    except Exception as e:
        print(f'Error cargando personas de Airtable: {e}')
        # Devolver cache viejo si existe
        return _personas_cache['datos'] if _personas_cache['datos'] else []


@app.route('/api/personas', methods=['GET'])
def get_personas():
    try:
        personas = _obtener_personas()
        return jsonify(personas)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/inventario/asignaciones', methods=['GET'])
def get_asignaciones():
    fecha = request.args.get('fecha')
    local = request.args.get('local')
    if not fecha or not local:
        return jsonify({'error': 'fecha y local son requeridos'}), 400
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT a.id, a.conteo_id, a.persona, a.cantidad
            FROM inventario_diario.asignacion_diferencias a
            JOIN inventario_diario.inventario_ciego_conteos c ON a.conteo_id = c.id
            WHERE c.fecha = %s AND c.local = %s
            ORDER BY a.conteo_id, a.id
        """, (fecha, local))
        rows = cur.fetchall()
        release_db(conn)
        result = {}
        for r in rows:
            cid = str(r['conteo_id'])
            if cid not in result:
                result[cid] = []
            result[cid].append({
                'id': r['id'],
                'persona': r['persona'],
                'cantidad': float(r['cantidad'])
            })
        return jsonify({'asignaciones': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/inventario/guardar-asignaciones', methods=['POST'])
def guardar_asignaciones():
    data = request.json
    conteo_id = data.get('conteo_id')
    asignaciones = data.get('asignaciones', [])
    if not conteo_id:
        return jsonify({'error': 'conteo_id es requerido'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            DELETE FROM inventario_diario.asignacion_diferencias
            WHERE conteo_id = %s
        """, (conteo_id,))
        # Obtener info del producto para guardar datos auto-contenidos
        cur.execute("""
            SELECT codigo, nombre, unidad, local, fecha
            FROM inventario_diario.inventario_ciego_conteos
            WHERE id = %s
        """, (conteo_id,))
        conteo_info = cur.fetchone()
        for a in asignaciones:
            if a.get('persona') and a.get('cantidad') and float(a['cantidad']) > 0:
                if conteo_info:
                    cur.execute("""
                        INSERT INTO inventario_diario.asignacion_diferencias
                            (conteo_id, persona, cantidad, codigo, nombre, unidad, local, fecha)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (conteo_id, a['persona'].strip(), float(a['cantidad']),
                          conteo_info['codigo'], conteo_info['nombre'], conteo_info['unidad'],
                          conteo_info['local'], conteo_info['fecha']))
                else:
                    cur.execute("""
                        INSERT INTO inventario_diario.asignacion_diferencias (conteo_id, persona, cantidad)
                        VALUES (%s, %s, %s)
                    """, (conteo_id, a['persona'].strip(), float(a['cantidad'])))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


# ============================================================
# MÓDULO: Asignación por Sección (prototipo)
# ============================================================

@app.route('/api/conteo/secciones', methods=['GET'])
def listar_secciones_conteo():
    fecha = request.args.get('fecha')
    local = request.args.get('local')
    if not fecha or not local:
        return jsonify([])
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, nombre, total_valor
            FROM inventario_diario.asignacion_seccion
            WHERE fecha = %s AND local = %s
            ORDER BY created_at
        """, (fecha, local))
        secciones = cur.fetchall()
        result = []
        for s in secciones:
            cur.execute("""
                SELECT conteo_id, codigo, nombre, diferencia, costo_unitario, cantidad_asignada, valor
                FROM inventario_diario.asig_seccion_productos
                WHERE seccion_id = %s ORDER BY id
            """, (s['id'],))
            productos = [{'conteo_id': r['conteo_id'], 'codigo': r['codigo'],
                          'nombre': r['nombre'], 'diferencia': float(r['diferencia'] or 0),
                          'costo_unitario': float(r['costo_unitario'] or 0),
                          'cantidad_asignada': float(r['cantidad_asignada'] or 0),
                          'valor': float(r['valor'] or 0)} for r in cur.fetchall()]
            cur.execute("""
                SELECT persona, monto
                FROM inventario_diario.asig_seccion_personas
                WHERE seccion_id = %s ORDER BY id
            """, (s['id'],))
            personas = [{'persona': r['persona'], 'monto': float(r['monto'] or 0)} for r in cur.fetchall()]
            result.append({'id': s['id'], 'nombre': s['nombre'] or '',
                           'total_valor': float(s['total_valor'] or 0),
                           'productos': productos, 'personas': personas})
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/conteo/secciones/guardar', methods=['POST'])
def guardar_seccion_conteo():
    """Divide productos equitativamente entre personas y guarda en asignacion_diferencias"""
    data = request.json
    productos = data.get('productos', [])
    personas = data.get('personas', [])  # lista de strings (nombres)
    if not productos:
        return jsonify({'error': 'Sin productos'}), 400
    if not personas:
        return jsonify({'error': 'Sin personas'}), 400
    n_personas = len(personas)
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        for p in productos:
            conteo_id = p['conteo_id']
            cantidad_por_persona = float(p.get('cantidad_asignada', 0)) / n_personas
            # Borrar asignaciones previas para este conteo
            cur.execute("""
                DELETE FROM inventario_diario.asignacion_diferencias
                WHERE conteo_id = %s
            """, (conteo_id,))
            # Obtener info del producto para guardar datos auto-contenidos
            cur.execute("""
                SELECT codigo, nombre, unidad, local, fecha
                FROM inventario_diario.inventario_ciego_conteos WHERE id = %s
            """, (conteo_id,))
            info = cur.fetchone()
            for nombre_persona in personas:
                if info:
                    cur.execute("""
                        INSERT INTO inventario_diario.asignacion_diferencias
                            (conteo_id, persona, cantidad, codigo, nombre, unidad, local, fecha)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (conteo_id, nombre_persona.strip(), cantidad_por_persona,
                          info['codigo'], info['nombre'], info['unidad'],
                          info['local'], info['fecha']))
                else:
                    cur.execute("""
                        INSERT INTO inventario_diario.asignacion_diferencias (conteo_id, persona, cantidad)
                        VALUES (%s, %s, %s)
                    """, (conteo_id, nombre_persona.strip(), cantidad_por_persona))
        conn.commit()
        return jsonify({'success': True, 'productos': len(productos), 'personas': n_personas})
    except Exception as e:
        if conn:
            try: conn.rollback()
            except: pass
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/conteo/secciones/<int:seccion_id>', methods=['DELETE'])
def eliminar_seccion_conteo(seccion_id):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM inventario_diario.asig_seccion_productos WHERE seccion_id=%s", (seccion_id,))
        cur.execute("DELETE FROM inventario_diario.asig_seccion_personas WHERE seccion_id=%s", (seccion_id,))
        cur.execute("DELETE FROM inventario_diario.asignacion_seccion WHERE id=%s", (seccion_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/debug-db', methods=['GET'])
def debug_db():
    """Diagnostico de conexion a BD"""
    import traceback
    result = {'pool_status': 'unknown', 'direct_conn': 'unknown'}
    # Test 1: pool connection
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT 1 as test, current_timestamp as ts, version() as ver")
        row = cur.fetchone()
        result['pool_status'] = 'ok'
        result['pool_data'] = {'test': row['test'], 'ts': str(row['ts']), 'ver': row['ver'][:60]}
        release_db(conn)
    except Exception as e:
        result['pool_status'] = 'error'
        result['pool_error'] = str(e)
        result['pool_traceback'] = traceback.format_exc()
    # Test 2: direct connection (bypass pool)
    try:
        conn2 = psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)
        cur2 = conn2.cursor()
        cur2.execute("SELECT COUNT(*) as cnt FROM inventario_diario.usuarios")
        row2 = cur2.fetchone()
        result['direct_conn'] = 'ok'
        result['direct_data'] = {'usuarios_count': row2['cnt']}
        conn2.close()
    except Exception as e:
        result['direct_conn'] = 'error'
        result['direct_error'] = str(e)
        result['direct_traceback'] = traceback.format_exc()
    result['db_config_host'] = DB_CONFIG['host']
    result['db_config_db'] = DB_CONFIG['database']
    return jsonify(result)


@app.route('/api/debug-personas', methods=['GET'])
def debug_personas():
    """Endpoint de diagnostico para el cache de personas"""
    ahora = _time.time()
    cache_age = ahora - _personas_cache['timestamp'] if _personas_cache['timestamp'] > 0 else -1
    token = _get_airtable_token()
    return jsonify({
        'cache_count': len(_personas_cache['datos']),
        'cache_age_seconds': round(cache_age, 1),
        'cache_ttl': PERSONAS_CACHE_TTL,
        'cache_expired': cache_age > PERSONAS_CACHE_TTL if cache_age >= 0 else True,
        'airtable_token_configured': bool(token),
        'token_length': len(token) if token else 0,
        'env_keys_with_air': [k for k in os.environ.keys() if 'AIR' in k.upper()],
        'primeras_3': _personas_cache['datos'][:3] if _personas_cache['datos'] else []
    })

# ==================== MERMA OPERATIVA ====================

@app.route('/api/merma', methods=['GET'])
def listar_mermas():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        filtros = []
        params = []
        if fecha_desde:
            filtros.append("fecha >= %s")
            params.append(fecha_desde)
        if fecha_hasta:
            filtros.append("fecha <= %s")
            params.append(fecha_hasta)
        if local:
            filtros.append("local = %s")
            params.append(local)
        where = ("WHERE " + " AND ".join(filtros)) if filtros else ""
        cur.execute(f"""
            SELECT id, fecha, local, codigo, nombre, unidad, cantidad, motivo,
                   costo_unitario, costo_total, created_at
            FROM inventario_diario.merma_operativa
            {where}
            ORDER BY fecha DESC, created_at DESC
        """, params)
        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'fecha': str(r['fecha']),
                'local': r['local'],
                'codigo': r['codigo'],
                'nombre': r['nombre'],
                'unidad': r['unidad'],
                'cantidad': float(r['cantidad']),
                'motivo': r['motivo'] or '',
                'costo_unitario': float(r['costo_unitario'] or 0),
                'costo_total': float(r['costo_total'] or 0),
                'created_at': str(r['created_at'])
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/merma/registrar', methods=['POST'])
def registrar_merma():
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')
    codigo = data.get('codigo', '').strip()
    nombre = data.get('nombre', '').strip()
    unidad = data.get('unidad', '').strip()
    cantidad = data.get('cantidad')
    motivo = data.get('motivo', '').strip()
    costo_unitario = float(data.get('costo_unitario') or 0)
    if not all([fecha, local, codigo, nombre, cantidad]):
        return jsonify({'error': 'Faltan campos requeridos: fecha, local, codigo, nombre, cantidad'}), 400
    costo_total = float(cantidad) * costo_unitario
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO inventario_diario.merma_operativa
                (fecha, local, codigo, nombre, unidad, cantidad, motivo, costo_unitario, costo_total)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (fecha, local, codigo, nombre, unidad, float(cantidad), motivo, costo_unitario, costo_total))
        nuevo_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'success': True, 'id': nuevo_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/merma/<int:merma_id>', methods=['DELETE'])
def eliminar_merma(merma_id):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM inventario_diario.merma_operativa WHERE id = %s", (merma_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/bajas', methods=['GET'])
def listar_bajas():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        filtros = []
        params = []
        if fecha_desde:
            filtros.append("b.fecha >= %s"); params.append(fecha_desde)
        if fecha_hasta:
            filtros.append("b.fecha <= %s"); params.append(fecha_hasta)
        if local:
            filtros.append("b.local = %s"); params.append(local)
        where = ("WHERE " + " AND ".join(filtros)) if filtros else ""
        # Traer grupos con sus productos y asignaciones
        cur.execute(f"""
            SELECT b.baja_grupo,
                   MIN(b.fecha) AS fecha,
                   MIN(b.local) AS local,
                   MIN(b.motivo) AS motivo,
                   MIN(b.documento) AS documento,
                   MIN(b.codigo_baja) AS codigo_baja,
                   SUM(b.costo_total) AS total_costo,
                   MIN(b.created_at) AS created_at
            FROM inventario_diario.bajas_directas b
            {where}
            GROUP BY b.baja_grupo
            ORDER BY MIN(b.created_at) DESC
        """, params)
        grupos = cur.fetchall()
        result = []
        for g in grupos:
            grp = g['baja_grupo']
            # Productos del grupo
            cur.execute("""
                SELECT id, codigo, nombre, unidad, cantidad, costo_unitario, costo_total
                FROM inventario_diario.bajas_directas
                WHERE baja_grupo = %s ORDER BY id
            """, (grp,))
            items = [{'id': r['id'], 'codigo': r['codigo'], 'nombre': r['nombre'],
                      'unidad': r['unidad'], 'cantidad': float(r['cantidad']),
                      'costo_unitario': float(r['costo_unitario'] or 0),
                      'costo_total': float(r['costo_total'] or 0)} for r in cur.fetchall()]
            # Asignaciones del grupo
            cur.execute("""
                SELECT id, persona, monto FROM inventario_diario.bajas_asignaciones
                WHERE baja_grupo = %s ORDER BY id
            """, (grp,))
            asigs = [{'id': r['id'], 'persona': r['persona'], 'monto': float(r['monto'])} for r in cur.fetchall()]
            result.append({
                'baja_grupo': grp,
                'fecha': str(g['fecha']),
                'local': g['local'],
                'motivo': g['motivo'] or '',
                'documento': g['documento'] or '',
                'codigo_baja': g['codigo_baja'] or '',
                'total_costo': float(g['total_costo'] or 0),
                'created_at': str(g['created_at']),
                'items': items,
                'asignaciones': asigs
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/bajas/registrar', methods=['POST'])
def registrar_baja():
    import time as _time_mod
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')
    motivo = data.get('motivo', '').strip()
    documento = data.get('documento', '').strip()
    codigo_baja = data.get('codigo_baja', '').strip()
    items = data.get('items', [])
    asignaciones = data.get('asignaciones', [])
    if not all([fecha, local]):
        return jsonify({'error': 'Faltan campos requeridos: fecha, local'}), 400
    if not items:
        return jsonify({'error': 'Debes incluir al menos un producto'}), 400
    baja_grupo = int(_time_mod.time() * 1000)
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        for item in items:
            codigo = item.get('codigo', '').strip()
            nombre = item.get('nombre', '').strip()
            unidad = item.get('unidad', '').strip()
            cantidad = float(item.get('cantidad') or 0)
            costo_unitario = float(item.get('costo_unitario') or 0)
            costo_total = cantidad * costo_unitario
            cur.execute("""
                INSERT INTO inventario_diario.bajas_directas
                    (baja_grupo, fecha, local, codigo, nombre, unidad, cantidad, persona, motivo, documento, codigo_baja, costo_unitario, costo_total)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (baja_grupo, fecha, local, codigo, nombre, unidad, cantidad, '', motivo, documento or None, codigo_baja or None, costo_unitario, costo_total))
        for asig in asignaciones:
            persona = asig.get('persona', '').strip()
            monto = float(asig.get('monto') or 0)
            if persona and monto > 0:
                cur.execute("""
                    INSERT INTO inventario_diario.bajas_asignaciones
                        (baja_grupo, persona, monto, fecha, local, motivo)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (baja_grupo, persona, monto, fecha, local, motivo))
        conn.commit()
        return jsonify({'success': True, 'baja_grupo': baja_grupo})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/bajas/grupo/<int:baja_grupo>', methods=['DELETE'])
def eliminar_baja_grupo(baja_grupo):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM inventario_diario.bajas_directas WHERE baja_grupo = %s", (baja_grupo,))
        cur.execute("DELETE FROM inventario_diario.bajas_asignaciones WHERE baja_grupo = %s", (baja_grupo,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


import threading
def _precargar_personas():
    for intento in range(6):
        token = _get_airtable_token()
        if not token:
            print(f'Pre-carga intento {intento+1}: AIRTABLE_TOKEN vacio, reintentando en 5s...')
            _time.sleep(5)
            continue
        try:
            _cargar_personas_airtable()
            print(f'Pre-carga personas OK (intento {intento+1}): {len(_personas_cache["datos"])} personas')
            return
        except Exception as e:
            print(f'Pre-carga intento {intento+1} error: {e}')
            _time.sleep(5)
    print('Pre-carga personas FALLO despues de 6 intentos')
threading.Thread(target=_precargar_personas, daemon=True).start()

# Inicializar tablas al arrancar
try:
    init_db()
except Exception as _e:
    print(f'Startup init_db error: {_e}')

# ==================== PANEL DE CONTROL ====================

@app.route('/api/panel/consultar', methods=['GET'])
def panel_consultar():
    """Consulta inventario por fecha y bodega opcional"""
    fecha = request.args.get('fecha')
    bodega = request.args.get('bodega', '')
    if not fecha:
        return jsonify({'error': 'Falta fecha'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT local, codigo, nombre, unidad,
                   cantidad, cantidad_contada, cantidad_contada_2, costo_unitario
            FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha = %s
        """
        params = [fecha]
        if bodega:
            query += ' AND local = %s'
            params.append(bodega)
        query += ' ORDER BY local, nombre'

        cur.execute(query, params)
        rows = cur.fetchall()

        return jsonify({
            'total': len(rows),
            'data': rows
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/panel/borrar-stock', methods=['POST'])
def panel_borrar_stock():
    """Pone cantidad=NULL para fecha/bodega. NO toca conteos."""
    data = request.get_json()
    fecha = data.get('fecha')
    bodega = data.get('bodega', '')
    if not fecha:
        return jsonify({'error': 'Falta fecha'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Contar afectados
        q_count = """
            SELECT COUNT(*) as cnt FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha = %s AND cantidad IS NOT NULL
        """
        params = [fecha]
        if bodega:
            q_count += ' AND local = %s'
            params.append(bodega)

        cur.execute(q_count, params)
        count = cur.fetchone()['cnt']

        if count == 0:
            return jsonify({'affected': 0, 'message': 'No hay registros con stock para esa fecha'})

        # Ejecutar UPDATE
        q_update = """
            UPDATE inventario_diario.inventario_ciego_conteos
            SET cantidad = NULL
            WHERE fecha = %s AND cantidad IS NOT NULL
        """
        params2 = [fecha]
        if bodega:
            q_update += ' AND local = %s'
            params2.append(bodega)

        cur.execute(q_update, params2)
        affected = cur.rowcount
        conn.commit()

        return jsonify({
            'affected': affected,
            'message': f'Stock borrado: {affected} registros actualizados'
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/panel/contar-stock', methods=['GET'])
def panel_contar_stock():
    """Cuenta registros con stock para preview antes de borrar"""
    fecha = request.args.get('fecha')
    bodega = request.args.get('bodega', '')
    if not fecha:
        return jsonify({'error': 'Falta fecha'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT COUNT(*) as cnt FROM inventario_diario.inventario_ciego_conteos
            WHERE fecha = %s AND cantidad IS NOT NULL
        """
        params = [fecha]
        if bodega:
            query += ' AND local = %s'
            params.append(bodega)

        cur.execute(query, params)
        count = cur.fetchone()['cnt']

        return jsonify({'count': count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


# ==================== ASIGNACION SEMANAL ====================

@app.route('/api/semanas', methods=['GET'])
def listar_semanas():
    """Lista semanas de inventario para una bodega"""
    local = request.args.get('local')
    if not local:
        return jsonify({'error': 'Falta parametro local'}), 400

    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT s.*,
                (SELECT COUNT(DISTINCT c.codigo)
                 FROM inventario_diario.inventario_ciego_conteos c
                 WHERE c.local = s.local
                   AND c.fecha BETWEEN s.fecha_inicio AND s.fecha_fin
                   AND (c.cantidad_contada IS NOT NULL OR c.cantidad_contada_2 IS NOT NULL)
                ) as total_productos,
                COALESCE((SELECT SUM(ap.monto)
                 FROM inventario_diario.asignacion_semanal a
                 JOIN inventario_diario.asignacion_semanal_personas ap ON ap.asignacion_semanal_id = a.id
                 WHERE a.semana_id = s.id
                ), 0) as total_asignado
            FROM inventario_diario.semanas_inventario s
            WHERE s.local = %s
        """
        params = [local]

        if fecha_desde:
            query += ' AND s.fecha_inicio >= %s'
            params.append(fecha_desde)
        if fecha_hasta:
            query += ' AND s.fecha_fin <= %s'
            params.append(fecha_hasta)

        query += ' ORDER BY s.fecha_inicio DESC'
        cur.execute(query, params)
        semanas = cur.fetchall()

        # Convert dates to strings
        for s in semanas:
            s['fecha_inicio'] = str(s['fecha_inicio'])
            s['fecha_fin'] = str(s['fecha_fin'])
            if s.get('cerrada_at'):
                s['cerrada_at'] = str(s['cerrada_at'])
            if s.get('created_at'):
                s['created_at'] = str(s['created_at'])

        return jsonify(semanas)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/crear', methods=['POST'])
def crear_semana():
    """Crea o retorna una semana de inventario"""
    data = request.get_json()
    local = data.get('local')
    fecha_inicio = data.get('fecha_inicio')

    if not local or not fecha_inicio:
        return jsonify({'error': 'Faltan parametros local y fecha_inicio'}), 400

    from datetime import datetime, timedelta
    try:
        dt_inicio = datetime.strptime(fecha_inicio, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'fecha_inicio debe ser formato YYYY-MM-DD'}), 400

    # Validar que sea lunes (ISO weekday 1)
    if dt_inicio.isoweekday() != 1:
        return jsonify({'error': 'fecha_inicio debe ser un lunes'}), 400

    dt_fin = dt_inicio + timedelta(days=6)  # domingo

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Verificar si ya existe
        cur.execute("""
            SELECT * FROM inventario_diario.semanas_inventario
            WHERE fecha_inicio = %s AND local = %s
        """, (dt_inicio, local))
        existing = cur.fetchone()

        if existing:
            existing['fecha_inicio'] = str(existing['fecha_inicio'])
            existing['fecha_fin'] = str(existing['fecha_fin'])
            if existing.get('cerrada_at'):
                existing['cerrada_at'] = str(existing['cerrada_at'])
            if existing.get('created_at'):
                existing['created_at'] = str(existing['created_at'])
            return jsonify(existing)

        # Verificar que no haya otra semana abierta para este local
        cur.execute("""
            SELECT id, fecha_inicio, fecha_fin FROM inventario_diario.semanas_inventario
            WHERE local = %s AND estado = 'abierta'
        """, (local,))
        abierta = cur.fetchone()

        if abierta:
            return jsonify({
                'error': f'Ya existe una semana abierta para {local} ({abierta["fecha_inicio"]} - {abierta["fecha_fin"]}). Cierre primero antes de crear otra.'
            }), 409

        cur.execute("""
            INSERT INTO inventario_diario.semanas_inventario (fecha_inicio, fecha_fin, local)
            VALUES (%s, %s, %s)
            RETURNING *
        """, (dt_inicio, dt_fin, local))
        nueva = cur.fetchone()
        conn.commit()

        nueva['fecha_inicio'] = str(nueva['fecha_inicio'])
        nueva['fecha_fin'] = str(nueva['fecha_fin'])
        if nueva.get('created_at'):
            nueva['created_at'] = str(nueva['created_at'])

        return jsonify(nueva), 201
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/<int:semana_id>/diferencias', methods=['GET'])
def diferencias_semana(semana_id):
    """Obtiene diferencias semanales de productos para una semana"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Obtener datos de la semana
        cur.execute("""
            SELECT * FROM inventario_diario.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404

        fecha_inicio = semana['fecha_inicio']
        fecha_fin = semana['fecha_fin']
        local = semana['local']

        # Para cada producto, obtener primer registro (stock) y ultimo registro (contado)
        cur.execute("""
            WITH primer_conteo AS (
                SELECT DISTINCT ON (codigo)
                    codigo, nombre, unidad, cantidad, fecha, costo_unitario
                FROM inventario_diario.inventario_ciego_conteos
                WHERE local = %s AND fecha BETWEEN %s AND %s
                ORDER BY codigo, fecha ASC, id ASC
            ),
            ultimo_conteo AS (
                SELECT DISTINCT ON (codigo)
                    codigo,
                    COALESCE(cantidad_contada_2, cantidad_contada) as contado,
                    fecha as fecha_ultimo,
                    costo_unitario as costo_ultimo
                FROM inventario_diario.inventario_ciego_conteos
                WHERE local = %s AND fecha BETWEEN %s AND %s
                  AND (cantidad_contada IS NOT NULL OR cantidad_contada_2 IS NOT NULL)
                ORDER BY codigo, fecha DESC, id DESC
            )
            SELECT
                p.codigo,
                p.nombre,
                p.unidad,
                p.cantidad as stock_sistema,
                u.contado,
                COALESCE(u.contado, 0) - COALESCE(p.cantidad, 0) as diferencia,
                COALESCE(u.costo_ultimo, p.costo_unitario, 0) as costo_unitario,
                p.fecha as fecha_primer,
                u.fecha_ultimo
            FROM primer_conteo p
            LEFT JOIN ultimo_conteo u ON p.codigo = u.codigo
            WHERE u.contado IS NOT NULL
              AND (COALESCE(u.contado, 0) - COALESCE(p.cantidad, 0)) != 0
            ORDER BY p.nombre
        """, (local, fecha_inicio, fecha_fin, local, fecha_inicio, fecha_fin))
        diferencias = cur.fetchall()

        # Serializar fechas
        for d in diferencias:
            d['fecha_primer'] = str(d['fecha_primer']) if d.get('fecha_primer') else None
            d['fecha_ultimo'] = str(d['fecha_ultimo']) if d.get('fecha_ultimo') else None

        # Obtener asignaciones existentes para esta semana
        cur.execute("""
            SELECT a.id, a.codigo, a.nombre, a.unidad, a.diferencia_semanal, a.costo_unitario,
                   json_agg(json_build_object(
                       'id', ap.id,
                       'persona', ap.persona,
                       'cantidad', ap.cantidad,
                       'monto', ap.monto
                   )) FILTER (WHERE ap.id IS NOT NULL) as personas
            FROM inventario_diario.asignacion_semanal a
            LEFT JOIN inventario_diario.asignacion_semanal_personas ap
                ON ap.asignacion_semanal_id = a.id
            WHERE a.semana_id = %s
            GROUP BY a.id, a.codigo, a.nombre, a.unidad, a.diferencia_semanal, a.costo_unitario
        """, (semana_id,))
        asignaciones = cur.fetchall()

        # Mapear asignaciones por codigo
        asig_map = {}
        for a in asignaciones:
            asig_map[a['codigo']] = {
                'id': a['id'],
                'diferencia_semanal': a['diferencia_semanal'],
                'costo_unitario': a['costo_unitario'],
                'personas': a['personas'] or []
            }

        # Combinar diferencias con asignaciones
        resultado = []
        for d in diferencias:
            item = dict(d)
            if d['codigo'] in asig_map:
                item['asignacion'] = asig_map[d['codigo']]
            else:
                item['asignacion'] = None
            resultado.append(item)

        semana_info = {
            'id': semana['id'],
            'fecha_inicio': str(semana['fecha_inicio']),
            'fecha_fin': str(semana['fecha_fin']),
            'local': semana['local'],
            'estado': semana['estado']
        }

        return jsonify({
            'semana': semana_info,
            'diferencias': resultado
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/<int:semana_id>/asignar', methods=['POST'])
def asignar_semana(semana_id):
    """Guarda asignaciones semanales de diferencias"""
    data = request.get_json()
    asignaciones = data.get('asignaciones', [])

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Verificar que la semana existe y esta abierta
        cur.execute("""
            SELECT * FROM inventario_diario.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404
        if semana['estado'] != 'abierta':
            return jsonify({'error': 'La semana esta cerrada, no se pueden modificar asignaciones'}), 400

        # Borrar asignaciones previas de esta semana
        cur.execute("""
            DELETE FROM inventario_diario.asignacion_semanal_personas
            WHERE asignacion_semanal_id IN (
                SELECT id FROM inventario_diario.asignacion_semanal WHERE semana_id = %s
            )
        """, (semana_id,))
        cur.execute("""
            DELETE FROM inventario_diario.asignacion_semanal WHERE semana_id = %s
        """, (semana_id,))

        # Insertar nuevas asignaciones
        total_insertadas = 0
        for asig in asignaciones:
            cur.execute("""
                INSERT INTO inventario_diario.asignacion_semanal
                    (semana_id, codigo, nombre, unidad, local, diferencia_semanal, costo_unitario)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                semana_id,
                asig.get('codigo'),
                asig.get('nombre'),
                asig.get('unidad'),
                semana['local'],
                asig.get('diferencia_semanal', 0),
                asig.get('costo_unitario', 0)
            ))
            asig_id = cur.fetchone()['id']

            for persona in asig.get('personas', []):
                cantidad = persona.get('cantidad', 0)
                costo = asig.get('costo_unitario', 0)
                monto = float(cantidad) * float(costo) if cantidad and costo else 0
                cur.execute("""
                    INSERT INTO inventario_diario.asignacion_semanal_personas
                        (asignacion_semanal_id, persona, cantidad, monto)
                    VALUES (%s, %s, %s, %s)
                """, (asig_id, persona.get('persona'), cantidad, round(monto, 2)))

            total_insertadas += 1

        conn.commit()
        return jsonify({
            'ok': True,
            'message': f'{total_insertadas} asignaciones guardadas para semana {semana_id}'
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/<int:semana_id>/cerrar', methods=['POST'])
def cerrar_semana(semana_id):
    """Cierra una semana de inventario"""
    data = request.get_json() or {}
    cerrada_por = data.get('cerrada_por', 'sistema')

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT estado FROM inventario_diario.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404
        if semana['estado'] != 'abierta':
            return jsonify({'error': 'La semana ya esta cerrada'}), 400

        cur.execute("""
            UPDATE inventario_diario.semanas_inventario
            SET estado = 'cerrada', cerrada_por = %s, cerrada_at = NOW()
            WHERE id = %s
            RETURNING *
        """, (cerrada_por, semana_id))
        updated = cur.fetchone()
        conn.commit()

        updated['fecha_inicio'] = str(updated['fecha_inicio'])
        updated['fecha_fin'] = str(updated['fecha_fin'])
        if updated.get('cerrada_at'):
            updated['cerrada_at'] = str(updated['cerrada_at'])
        if updated.get('created_at'):
            updated['created_at'] = str(updated['created_at'])

        return jsonify({'ok': True, 'semana': updated})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/<int:semana_id>/reabrir', methods=['POST'])
def reabrir_semana(semana_id):
    """Reabre una semana cerrada (solo admin)"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT estado FROM inventario_diario.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404
        if semana['estado'] != 'cerrada':
            return jsonify({'error': 'La semana ya esta abierta'}), 400

        cur.execute("""
            UPDATE inventario_diario.semanas_inventario
            SET estado = 'abierta', cerrada_por = NULL, cerrada_at = NULL
            WHERE id = %s
            RETURNING *
        """, (semana_id,))
        updated = cur.fetchone()
        conn.commit()

        updated['fecha_inicio'] = str(updated['fecha_inicio'])
        updated['fecha_fin'] = str(updated['fecha_fin'])
        if updated.get('created_at'):
            updated['created_at'] = str(updated['created_at'])

        return jsonify({'ok': True, 'semana': updated})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/pendientes', methods=['GET'])
def semanas_pendientes():
    """Retorna semanas abiertas cuyo periodo ya termino (para recordatorios)"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT s.*
            FROM inventario_diario.semanas_inventario s
            WHERE s.estado = 'abierta'
              AND s.fecha_fin < CURRENT_DATE
            ORDER BY s.fecha_fin ASC
        """)
        semanas = cur.fetchall()

        for s in semanas:
            s['fecha_inicio'] = str(s['fecha_inicio'])
            s['fecha_fin'] = str(s['fecha_fin'])
            if s.get('created_at'):
                s['created_at'] = str(s['created_at'])

        return jsonify(semanas)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/semanas/resumen-persona', methods=['GET'])
def resumen_persona_semanal():
    """Resumen de asignaciones por persona a traves de semanas cerradas"""
    local = request.args.get('local')
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')

    if not local:
        return jsonify({'error': 'Falta parametro local'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT ap.persona,
                   SUM(ap.cantidad) as total_cantidad,
                   SUM(ap.monto) as total_monto,
                   COUNT(DISTINCT a.semana_id) as semanas_count
            FROM inventario_diario.asignacion_semanal_personas ap
            JOIN inventario_diario.asignacion_semanal a ON a.id = ap.asignacion_semanal_id
            JOIN inventario_diario.semanas_inventario s ON s.id = a.semana_id
            WHERE s.local = %s AND s.estado = 'cerrada'
        """
        params = [local]

        if fecha_desde:
            query += ' AND s.fecha_inicio >= %s'
            params.append(fecha_desde)
        if fecha_hasta:
            query += ' AND s.fecha_fin <= %s'
            params.append(fecha_hasta)

        query += ' GROUP BY ap.persona ORDER BY total_monto DESC'
        cur.execute(query, params)
        resumen = cur.fetchall()

        return jsonify(resumen)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


# ============================================================
# MODULO: Cruce Operativo "CUADRAR" - Boton + Worker local
# ============================================================
# Flujo: Panel web -> POST /solicitar -> tarea pendiente
#        Worker PC FINANZAS -> GET /pendientes (cada 15s) -> toma tarea
#        Worker descarga Contifico, calcula cruce -> POST /resultado
#        Panel web -> GET /estado/<id> (polling) -> muestra resultado

# Token simple para autenticar al worker (env var)
WORKER_TOKEN = os.environ.get('CRUCE_WORKER_TOKEN', 'worker-foodix-2026-7K3xR9pL2qN8mZ4w')


@app.route('/api/cruce-op/solicitar', methods=['POST'])
def cruce_op_solicitar():
    """Llamado desde el panel cuando el usuario presiona CUADRAR.
    Crea una tarea pendiente que el worker tomara.
    Si ya existe una en estado terminal (completado/error), la resetea.
    Si ya hay una pendiente o en proceso, devuelve esa misma."""
    data = request.json or {}
    bodega = data.get('bodega')
    fecha_toma = data.get('fecha_toma')
    fecha_corte = data.get('fecha_corte_contifico') or fecha_toma  # por defecto = fecha_toma
    usuario = data.get('usuario', 'panel')

    if bodega not in ('bodega_principal', 'materia_prima', 'planta'):
        return jsonify({'error': 'bodega invalida'}), 400
    if not fecha_toma:
        return jsonify({'error': 'fecha_toma requerida'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        # Ver si ya existe alguna ejecucion para esta bodega+fecha
        cur.execute("""
            SELECT id, estado FROM inventario_diario.cruce_operativo_ejecuciones
            WHERE bodega = %s AND fecha_toma = %s
            ORDER BY COALESCE(solicitado_at, timestamp_deteccion) DESC LIMIT 1
        """, (bodega, fecha_toma))
        existente = cur.fetchone()

        if existente and existente['estado'] in ('pendiente', 'en_proceso'):
            # Ya se esta procesando, devolver la misma
            return jsonify({'id': existente['id'], 'estado': existente['estado'], 'reused': True})

        if existente:
            # Existe pero esta en estado terminal (completado/error): resetear
            cur.execute("DELETE FROM inventario_diario.cruce_operativo_detalle WHERE ejecucion_id = %s", (existente['id'],))
            cur.execute("""
                UPDATE inventario_diario.cruce_operativo_ejecuciones
                SET estado='pendiente', solicitado_por=%s, solicitado_at=NOW(),
                    fecha_corte_contifico=%s,
                    worker_lock=NULL, error_msg=NULL,
                    timestamp_descarga=NULL, timestamp_cruce=NULL,
                    total_productos_toma=NULL, total_productos_contifico=NULL,
                    total_cruzados=NULL, total_con_diferencia=NULL, valor_total_dif=NULL
                WHERE id = %s
            """, (usuario, fecha_corte, existente['id']))
            conn.commit()
            return jsonify({'id': existente['id'], 'estado': 'pendiente', 'reset': True})

        # No existe: crear nueva
        cur.execute("""
            INSERT INTO inventario_diario.cruce_operativo_ejecuciones
            (bodega, fecha_toma, fecha_corte_contifico, estado, solicitado_por, solicitado_at)
            VALUES (%s, %s, %s, 'pendiente', %s, NOW())
            RETURNING id
        """, (bodega, fecha_toma, fecha_corte, usuario))
        new_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'id': new_id, 'estado': 'pendiente'})
    except Exception as e:
        print(f"Error en /api/cruce-op/solicitar: {e}")
        if conn: conn.rollback()
        return jsonify({'error': 'Error interno del servidor', 'detalle': str(e)[:200]}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce-op/eliminar/<int:ejec_id>', methods=['DELETE'])
def cruce_op_eliminar(ejec_id):
    """Elimina una ejecucion y su detalle. Llamado desde el panel."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM inventario_diario.cruce_operativo_detalle WHERE ejecucion_id = %s", (ejec_id,))
        cur.execute("DELETE FROM inventario_diario.cruce_operativo_ejecuciones WHERE id = %s", (ejec_id,))
        conn.commit()
        return jsonify({'ok': True, 'eliminados': cur.rowcount})
    except Exception as e:
        print(f"Error en /api/cruce-op/eliminar: {e}")
        if conn: conn.rollback()
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce-op/pendientes', methods=['GET'])
def cruce_op_pendientes():
    """Llamado por el worker. Devuelve tareas pendientes y las marca como en_proceso."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401

    worker_id = request.args.get('worker_id', 'pc-finanzas')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        # Marca atomicamente las pendientes como en_proceso para este worker
        cur.execute("""
            UPDATE inventario_diario.cruce_operativo_ejecuciones
            SET estado = 'en_proceso',
                worker_lock = %s,
                timestamp_descarga = NOW()
            WHERE id IN (
                SELECT id FROM inventario_diario.cruce_operativo_ejecuciones
                WHERE estado = 'pendiente'
                ORDER BY solicitado_at ASC
                LIMIT 5
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, bodega, fecha_toma, fecha_corte_contifico, solicitado_por, solicitado_at
        """, (worker_id,))
        rows = cur.fetchall()
        conn.commit()
        result = [{
            'id': r['id'],
            'bodega': r['bodega'],
            'fecha_toma': r['fecha_toma'].isoformat() if r['fecha_toma'] else None,
            'fecha_corte_contifico': r['fecha_corte_contifico'].isoformat() if r['fecha_corte_contifico'] else (r['fecha_toma'].isoformat() if r['fecha_toma'] else None),
            'solicitado_por': r['solicitado_por'],
        } for r in rows]
        return jsonify(result)
    except Exception as e:
        print(f"Error en /api/cruce-op/pendientes: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce-op/resultado', methods=['POST'])
def cruce_op_resultado():
    """Llamado por el worker al terminar. Inserta detalle y marca completado/error."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401

    data = request.json or {}
    ejec_id = data.get('id')
    estado = data.get('estado', 'completado')  # 'completado' o 'error'
    error_msg = data.get('error_msg')
    detalle = data.get('detalle', [])
    resumen = data.get('resumen', {})

    if not ejec_id:
        return jsonify({'error': 'id requerido'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        if estado == 'error':
            cur.execute("""
                UPDATE inventario_diario.cruce_operativo_ejecuciones
                SET estado = 'error', error_msg = %s, timestamp_cruce = NOW()
                WHERE id = %s
            """, (error_msg, ejec_id))
            conn.commit()
            return jsonify({'ok': True})

        # Borrar detalle previo si existiera
        cur.execute("DELETE FROM inventario_diario.cruce_operativo_detalle WHERE ejecucion_id = %s", (ejec_id,))

        # Insertar detalle
        if detalle:
            for d in detalle:
                cur.execute("""
                    INSERT INTO inventario_diario.cruce_operativo_detalle
                    (ejecucion_id, codigo, nombre, categoria, unidad, unidad_toma, factor,
                     unidad_destino, cantidad_toma, cantidad_sistema, diferencia,
                     costo_unitario, valor_diferencia, tipo_abc, origen)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    ejec_id, d.get('codigo'), d.get('nombre'), d.get('categoria'),
                    d.get('unidad_destino'), d.get('unidad_toma'), d.get('factor'),
                    d.get('unidad_destino'), d.get('cantidad_toma'), d.get('cantidad_sistema'),
                    d.get('diferencia'), d.get('costo_unitario'), d.get('valor_diferencia'),
                    d.get('tipo_abc'), d.get('origen', 'cruce_operativo')
                ))

        # Update ejecucion
        cur.execute("""
            UPDATE inventario_diario.cruce_operativo_ejecuciones
            SET estado = 'completado',
                total_productos_toma = %s,
                total_productos_contifico = %s,
                total_cruzados = %s,
                total_con_diferencia = %s,
                valor_total_dif = %s,
                timestamp_cruce = NOW()
            WHERE id = %s
        """, (
            resumen.get('total_productos_toma'),
            resumen.get('total_productos_contifico'),
            resumen.get('total_cruzados'),
            resumen.get('total_con_diferencia'),
            resumen.get('valor_total_dif'),
            ejec_id
        ))
        conn.commit()
        return jsonify({'ok': True, 'detalles_insertados': len(detalle)})
    except Exception as e:
        print(f"Error en /api/cruce-op/resultado: {e}")
        if conn:
            conn.rollback()
        return jsonify({'error': 'Error interno del servidor', 'detalle': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce-op/estado/<int:ejec_id>', methods=['GET'])
def cruce_op_estado(ejec_id):
    """Polling desde el panel para saber estado de una ejecucion."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, bodega, fecha_toma, estado, solicitado_por, solicitado_at,
                   timestamp_descarga, timestamp_cruce, error_msg,
                   total_productos_toma, total_productos_contifico, total_cruzados,
                   total_con_diferencia, valor_total_dif
            FROM inventario_diario.cruce_operativo_ejecuciones WHERE id = %s
        """, (ejec_id,))
        r = cur.fetchone()
        if not r:
            return jsonify({'error': 'no encontrado'}), 404
        return jsonify({
            'id': r['id'],
            'bodega': r['bodega'],
            'fecha_toma': r['fecha_toma'].isoformat() if r['fecha_toma'] else None,
            'estado': r['estado'],
            'solicitado_por': r['solicitado_por'],
            'solicitado_at': r['solicitado_at'].isoformat() if r['solicitado_at'] else None,
            'timestamp_descarga': r['timestamp_descarga'].isoformat() if r['timestamp_descarga'] else None,
            'timestamp_cruce': r['timestamp_cruce'].isoformat() if r['timestamp_cruce'] else None,
            'error_msg': r['error_msg'],
            'total_productos_toma': r['total_productos_toma'],
            'total_productos_contifico': r['total_productos_contifico'],
            'total_cruzados': r['total_cruzados'],
            'total_con_diferencia': r['total_con_diferencia'],
            'valor_total_dif': float(r['valor_total_dif']) if r['valor_total_dif'] is not None else None,
        })
    except Exception as e:
        print(f"Error en /api/cruce-op/estado: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/cruce-op/fechas-disponibles', methods=['GET'])
def cruce_op_fechas():
    """Devuelve las fechas con toma fisica disponibles para una bodega."""
    bodega = request.args.get('bodega')
    tablas = {
        'bodega_principal': 'public.toma_bodega',
        'materia_prima':    'public.toma_materiaprima',
        'planta':           'public.toma_planta',
    }
    if bodega not in tablas:
        return jsonify({'error': 'bodega invalida'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(f"""
            SELECT fecha, COUNT(*) AS productos
            FROM {tablas[bodega]}
            WHERE fecha IS NOT NULL
            GROUP BY fecha ORDER BY fecha DESC
        """)
        rows = cur.fetchall()
        return jsonify([{
            'fecha': r['fecha'].isoformat(),
            'productos': r['productos']
        } for r in rows])
    except Exception as e:
        print(f"Error en /api/cruce-op/fechas-disponibles: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


# ==================== ADMIN USUARIOS ====================

def _require_admin(data):
    """Valida que quien llama sea admin (username + password en el body)."""
    if not data:
        return None, jsonify({'error': 'Sin datos'}), 400
    admin_user = data.get('admin_user', '')
    admin_pass = data.get('admin_pass', '')
    if not admin_user or not admin_pass:
        return None, jsonify({'error': 'Credenciales de admin requeridas'}), 401
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""SELECT id FROM inventario_diario.usuarios
                       WHERE username = %s AND password = %s AND rol = 'admin' AND activo = TRUE""",
                    (admin_user, admin_pass))
        row = cur.fetchone()
        if not row:
            return None, jsonify({'error': 'No autorizado'}), 403
        return conn, None, None
    except Exception:
        release_db(conn)
        raise


@app.route('/api/admin/usuarios', methods=['GET'])
def admin_listar_usuarios():
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT u.id, u.username, u.nombre, u.rol, u.activo, u.created_at,
                   COALESCE(array_agg(ub.bodega ORDER BY ub.bodega) FILTER (WHERE ub.bodega IS NOT NULL), '{}') AS bodegas
            FROM inventario_diario.usuarios u
            LEFT JOIN inventario_diario.usuario_bodegas ub ON ub.usuario_id = u.id
            GROUP BY u.id, u.username, u.nombre, u.rol, u.activo, u.created_at
            ORDER BY u.id
        """)
        usuarios = cur.fetchall()
        return jsonify(usuarios)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/admin/usuarios', methods=['POST'])
def admin_crear_usuario():
    data = request.json
    conn, err, code = _require_admin(data)
    if err:
        return err, code
    try:
        cur = conn.cursor()
        username = data.get('username', '').strip().lower()
        nombre = data.get('nombre', '').strip()
        password = data.get('password', '').strip()
        rol = data.get('rol', 'empleado')
        bodegas = data.get('bodegas', [])

        if not username or not nombre or not password:
            return jsonify({'error': 'username, nombre y password son obligatorios'}), 400

        cur.execute("SELECT id FROM inventario_diario.usuarios WHERE username = %s", (username,))
        if cur.fetchone():
            return jsonify({'error': f'El usuario "{username}" ya existe'}), 409

        cur.execute("""
            INSERT INTO inventario_diario.usuarios (username, password, nombre, rol, activo)
            VALUES (%s, %s, %s, %s, TRUE) RETURNING id
        """, (username, password, nombre, rol))
        new_id = cur.fetchone()['id']

        for bod in bodegas:
            cur.execute("""INSERT INTO inventario_diario.usuario_bodegas (usuario_id, bodega)
                           VALUES (%s, %s) ON CONFLICT DO NOTHING""", (new_id, bod))

        conn.commit()
        return jsonify({'success': True, 'id': new_id, 'message': f'Usuario {username} creado'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        release_db(conn)


@app.route('/api/admin/usuarios/<int:uid>', methods=['PUT'])
def admin_editar_usuario(uid):
    data = request.json
    conn, err, code = _require_admin(data)
    if err:
        return err, code
    try:
        cur = conn.cursor()
        nombre = data.get('nombre', '').strip()
        password = data.get('password', '').strip()
        rol = data.get('rol', 'empleado')
        activo = data.get('activo', True)
        bodegas = data.get('bodegas', [])

        if password:
            cur.execute("""UPDATE inventario_diario.usuarios
                           SET nombre = %s, password = %s, rol = %s, activo = %s
                           WHERE id = %s""", (nombre, password, rol, activo, uid))
        else:
            cur.execute("""UPDATE inventario_diario.usuarios
                           SET nombre = %s, rol = %s, activo = %s
                           WHERE id = %s""", (nombre, rol, activo, uid))

        if cur.rowcount == 0:
            return jsonify({'error': 'Usuario no encontrado'}), 404

        cur.execute("DELETE FROM inventario_diario.usuario_bodegas WHERE usuario_id = %s", (uid,))
        for bod in bodegas:
            cur.execute("""INSERT INTO inventario_diario.usuario_bodegas (usuario_id, bodega)
                           VALUES (%s, %s) ON CONFLICT DO NOTHING""", (uid, bod))

        conn.commit()
        return jsonify({'success': True, 'message': 'Usuario actualizado'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        release_db(conn)


@app.route('/api/admin/usuarios/<int:uid>', methods=['DELETE'])
def admin_eliminar_usuario(uid):
    data = request.json
    conn, err, code = _require_admin(data)
    if err:
        return err, code
    try:
        cur = conn.cursor()
        cur.execute("SELECT username FROM inventario_diario.usuarios WHERE id = %s", (uid,))
        row = cur.fetchone()
        if row and row['username'] == 'admin':
            return jsonify({'error': 'No se puede eliminar al administrador principal'}), 403

        cur.execute("DELETE FROM inventario_diario.usuarios WHERE id = %s", (uid,))
        conn.commit()
        return jsonify({'success': True, 'message': 'Usuario eliminado'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        release_db(conn)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port, debug=False)
