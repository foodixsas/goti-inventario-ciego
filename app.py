"""
Backend Flask para Inventario Ciego - Render Deploy
Conecta a Azure PostgreSQL
"""
from flask import Flask, request, jsonify, send_from_directory, send_file, render_template_string
from flask_cors import CORS
import psycopg2
from psycopg2.pool import SimpleConnectionPool
from psycopg2.extras import RealDictCursor
import os, secrets, smtplib, json
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from io import BytesIO

# Zona horaria Ecuador (UTC-5)
TZ_ECUADOR = timezone(timedelta(hours=-5))
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
_movimientos_pool = None

def _get_pool():
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = SimpleConnectionPool(
            minconn=1, maxconn=5,
            **DB_CONFIG, cursor_factory=RealDictCursor
        )
    return _connection_pool

def _get_movimientos_pool():
    """Pool separado para BD movimientos"""
    global _movimientos_pool
    if _movimientos_pool is None:
        _movimientos_pool = SimpleConnectionPool(
            minconn=1, maxconn=3,
            host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
            database='movimientos',
            user=os.environ.get('DB_USER', 'adminChios'),
            password=os.environ.get('DB_PASSWORD', 'Burger2023'),
            port=os.environ.get('DB_PORT', '5432'),
            sslmode='require',
            connect_timeout=10
        )
    return _movimientos_pool

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
            CREATE TABLE IF NOT EXISTS goti.merma_operativa (
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
            ALTER TABLE goti.asignacion_diferencias
                ADD COLUMN IF NOT EXISTS codigo VARCHAR(50),
                ADD COLUMN IF NOT EXISTS nombre VARCHAR(150),
                ADD COLUMN IF NOT EXISTS unidad VARCHAR(20),
                ADD COLUMN IF NOT EXISTS local VARCHAR(50),
                ADD COLUMN IF NOT EXISTS fecha DATE
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.bajas_directas (
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
            ALTER TABLE goti.bajas_directas
                ADD COLUMN IF NOT EXISTS baja_grupo BIGINT
        """)
        cur.execute("""
            ALTER TABLE goti.bajas_directas
                ADD COLUMN IF NOT EXISTS documento VARCHAR(100)
        """)
        cur.execute("""
            ALTER TABLE goti.bajas_directas
                ADD COLUMN IF NOT EXISTS codigo_baja VARCHAR(50)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.bajas_asignaciones (
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
            CREATE TABLE IF NOT EXISTS goti.asignacion_seccion (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                nombre VARCHAR(100),
                total_valor NUMERIC(12,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.asig_seccion_productos (
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
            ALTER TABLE goti.asig_seccion_productos
                ADD COLUMN IF NOT EXISTS cantidad_asignada NUMERIC(12,4)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.asig_seccion_personas (
                id SERIAL PRIMARY KEY,
                seccion_id INT NOT NULL,
                persona VARCHAR(100),
                monto NUMERIC(12,2)
            )
        """)
        # ---- Tablas para Asignacion Semanal ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.semanas_inventario (
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
            CREATE TABLE IF NOT EXISTS goti.asignacion_semanal (
                id SERIAL PRIMARY KEY,
                semana_id INT NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                nombre VARCHAR(150),
                unidad VARCHAR(20),
                local VARCHAR(50),
                diferencia_semanal NUMERIC(12,4) DEFAULT 0,
                costo_unitario NUMERIC(12,4) DEFAULT 0,
                grupo_idx INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.asignacion_semanal_personas (
                id SERIAL PRIMARY KEY,
                asignacion_semanal_id INT NOT NULL,
                persona VARCHAR(100) NOT NULL,
                cantidad NUMERIC(12,4) DEFAULT 0,
                monto NUMERIC(12,2) DEFAULT 0
            )
        """)
        # ---- Columna grupo_idx para preservar estructura de grupos ----
        cur.execute("""
            ALTER TABLE goti.asignacion_semanal
                ADD COLUMN IF NOT EXISTS grupo_idx INT DEFAULT 0
        """)
        # ---- Columnas de auditoria: quien contó y quien modificó ----
        cur.execute("""
            ALTER TABLE goti.inventario_ciego_conteos
                ADD COLUMN IF NOT EXISTS contado_por VARCHAR(50),
                ADD COLUMN IF NOT EXISTS contado_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS contado2_por VARCHAR(50),
                ADD COLUMN IF NOT EXISTS contado2_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(50),
                ADD COLUMN IF NOT EXISTS modificado_at TIMESTAMP
        """)
        # ---- Tabla de permisos por ROL (ver + editar) ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.rol_modulos (
                id SERIAL PRIMARY KEY,
                rol VARCHAR(20) NOT NULL,
                modulo VARCHAR(30) NOT NULL,
                puede_ver BOOLEAN DEFAULT TRUE,
                puede_editar BOOLEAN DEFAULT FALSE,
                UNIQUE(rol, modulo)
            )
        """)
        # Migrar: agregar columnas si tabla ya existia sin ellas
        cur.execute("""
            ALTER TABLE goti.rol_modulos
                ADD COLUMN IF NOT EXISTS puede_ver BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS puede_editar BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS puede_eliminar BOOLEAN DEFAULT FALSE
        """)
        # Seed defaults si la tabla esta vacia
        cur.execute("SELECT COUNT(*) as cnt FROM goti.rol_modulos")
        if cur.fetchone()['cnt'] == 0:
            # Subgerente: conteo, observaciones, historico, dashboard
            for mod in ['conteo','observaciones','historico','dashboard']:
                cur.execute("INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar) VALUES ('subgerente', %s, TRUE, TRUE, FALSE) ON CONFLICT DO NOTHING", (mod,))
            # Supervisor: ve todos los locales, ve todo pero no edita usuarios
            for mod in ['conteo','observaciones','historico','dashboard','cruce','bajas','semanal','correccion']:
                cur.execute("INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar) VALUES ('supervisor', %s, TRUE, TRUE, FALSE) ON CONFLICT DO NOTHING", (mod,))
            # Gerente: todo lo del subgerente + semanal, cruce, bajas
            for mod in ['conteo','observaciones','historico','dashboard']:
                cur.execute("INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar) VALUES ('gerente', %s, TRUE, TRUE, FALSE) ON CONFLICT DO NOTHING", (mod,))
            for mod in ['cruce','bajas','semanal','correccion']:
                cur.execute("INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar) VALUES ('gerente', %s, TRUE, TRUE, FALSE) ON CONFLICT DO NOTHING", (mod,))
            # Admin: ve, edita y elimina todo
            for mod in ['conteo','observaciones','historico','dashboard','cruce','bajas','semanal','correccion','usuarios']:
                cur.execute("INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar) VALUES ('admin', %s, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING", (mod,))
        # Actualizar registros existentes que no tengan puede_ver seteado (migracion)
        cur.execute("UPDATE goti.rol_modulos SET puede_ver = TRUE WHERE puede_ver IS NULL")
        cur.execute("UPDATE goti.rol_modulos SET puede_editar = TRUE WHERE puede_editar IS NULL")

        # Migrar roles: empleado → subgerente, supervisor → gerente
        try:
            cur.execute("SAVEPOINT migrate_roles")
            cur.execute("UPDATE goti.usuarios SET rol = 'subgerente' WHERE rol = 'empleado'")
            cur.execute("UPDATE goti.usuarios SET rol = 'gerente' WHERE rol = 'supervisor'")
            cur.execute("UPDATE goti.rol_modulos SET rol = 'subgerente' WHERE rol = 'empleado'")
            cur.execute("UPDATE goti.rol_modulos SET rol = 'gerente' WHERE rol = 'supervisor'")
            cur.execute("RELEASE SAVEPOINT migrate_roles")
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT migrate_roles")

        # Garantizar que gerente siempre tenga acceso a semanal con edicion
        for mod in ['semanal', 'cruce', 'bajas', 'correccion']:
            cur.execute("""
                INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar)
                VALUES ('gerente', %s, TRUE, TRUE, FALSE)
                ON CONFLICT (rol, modulo) DO UPDATE SET puede_ver = TRUE, puede_editar = TRUE
            """, (mod,))

        # ---- Tabla Cuadres de Caja ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.cuadres_caja (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                venta_sistema NUMERIC(12,2) DEFAULT 0,
                efectivo_contado NUMERIC(12,2) DEFAULT 0,
                venta_tarjeta NUMERIC(12,2) DEFAULT 0,
                venta_transferencia NUMERIC(12,2) DEFAULT 0,
                venta_plataformas NUMERIC(12,2) DEFAULT 0,
                otros_ingresos NUMERIC(12,2) DEFAULT 0,
                gastos_retiros NUMERIC(12,2) DEFAULT 0,
                efectivo_esperado NUMERIC(12,2) DEFAULT 0,
                diferencia NUMERIC(12,2) DEFAULT 0,
                observacion TEXT,
                registrado_por VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(fecha, local)
            )
        """)

        # ---- Tabla Delivery Liquidaciones ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.delivery_liquidaciones (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                plataforma VARCHAR(30) NOT NULL,
                total_pedidos INT DEFAULT 0,
                venta_bruta NUMERIC(12,2) DEFAULT 0,
                comision_pct NUMERIC(5,2) DEFAULT 0,
                comision_monto NUMERIC(12,2) DEFAULT 0,
                iva_comision NUMERIC(12,2) DEFAULT 0,
                propinas NUMERIC(12,2) DEFAULT 0,
                ajustes NUMERIC(12,2) DEFAULT 0,
                neto_recibir NUMERIC(12,2) DEFAULT 0,
                depositado_real NUMERIC(12,2) DEFAULT 0,
                diferencia NUMERIC(12,2) DEFAULT 0,
                referencia VARCHAR(100),
                observacion TEXT,
                registrado_por VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ---- Tabla Registro de Facturas ----
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.facturas_registro (
                id SERIAL PRIMARY KEY,
                fecha_emision DATE NOT NULL,
                local VARCHAR(50) NOT NULL,
                proveedor VARCHAR(200) NOT NULL,
                ruc VARCHAR(20),
                numero_factura VARCHAR(50),
                autorizacion VARCHAR(60),
                subtotal_0 NUMERIC(12,2) DEFAULT 0,
                subtotal_iva NUMERIC(12,2) DEFAULT 0,
                iva NUMERIC(12,2) DEFAULT 0,
                total NUMERIC(12,2) DEFAULT 0,
                categoria VARCHAR(50) DEFAULT 'Otros',
                forma_pago VARCHAR(30) DEFAULT 'Transferencia',
                estado_pago VARCHAR(20) DEFAULT 'Pendiente',
                observacion TEXT,
                registrado_por VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

# (USUARIO_BODEGA eliminado — permisos de bodega ahora se manejan desde BD tabla usuario_bodegas)

# ==================== RUTAS ESTATICAS ====================

@app.route('/')
def index():
    import json as json_lib, base64
    # Inyectar personas directamente en el HTML como JSON en data attribute (evita problemas de encoding en script)
    try:
        personas = _obtener_personas()
    except Exception:
        personas = _personas_cache['datos'] if _personas_cache['datos'] else []
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

@app.route('/establecer-clave')
def pagina_establecer_clave():
    """Pagina publica donde el usuario establece su contrasena."""
    token = request.args.get('token', '')
    if not token:
        return PAGINA_TOKEN_INVALIDO, 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""SELECT username, nombre, invite_token_expires FROM goti.usuarios
                       WHERE invite_token = %s AND activo = TRUE""", (token,))
        user = cur.fetchone()
        if not user:
            return PAGINA_TOKEN_INVALIDO, 404
        if user['invite_token_expires'] and user['invite_token_expires'] < datetime.utcnow():
            return PAGINA_TOKEN_INVALIDO, 410
        html = PAGINA_ESTABLECER_CLAVE.replace('{{ nombre }}', user['nombre']).replace('{{ username }}', user['username']).replace('{{ token }}', token)
        return html
    except Exception as e:
        print(f"Error en /establecer-clave: {e}")
        return PAGINA_TOKEN_INVALIDO, 500
    finally:
        if conn:
            release_db(conn)


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
            SELECT username, nombre, rol FROM goti.usuarios
            WHERE username = %s AND password = %s AND activo = TRUE
        """, (username, password))
        user = cur.fetchone()

        if user:
            # Cargar bodegas desde BD
            cur.execute("""
                SELECT ub.bodega FROM goti.usuario_bodegas ub
                JOIN goti.usuarios u ON u.id = ub.usuario_id
                WHERE u.username = %s
                ORDER BY ub.bodega
            """, (user['username'],))
            bodegas_user = [r['bodega'] for r in cur.fetchall()]
            # Compatibilidad: si tiene 1 sola bodega de ventas, enviar como string
            bodegas_ventas = [b for b in bodegas_user if b not in ('bodega_principal', 'materia_prima', 'planta')]
            bodega_asignada = bodegas_ventas[0] if len(bodegas_ventas) == 1 else None
            # Cargar modulos permitidos segun el ROL (con nivel ver/editar)
            cur.execute("""
                SELECT modulo, puede_ver, puede_editar FROM goti.rol_modulos
                WHERE rol = %s ORDER BY modulo
            """, (user['rol'],))
            modulos_user = [r['modulo'] for r in cur.fetchall() if r['puede_ver']]
            permisos_user = {}
            cur.execute("""
                SELECT modulo, puede_ver, puede_editar, COALESCE(puede_eliminar, FALSE) as puede_eliminar
                FROM goti.rol_modulos WHERE rol = %s
            """, (user['rol'],))
            for r in cur.fetchall():
                permisos_user[r['modulo']] = {'ver': r['puede_ver'], 'editar': r['puede_editar'], 'eliminar': r['puede_eliminar']}
            return jsonify({
                'success': True,
                'user': {
                    'username': user['username'],
                    'nombre': user['nombre'],
                    'rol': user['rol'],
                    'bodega': bodega_asignada,
                    'bodegas': bodegas_user,
                    'modulos': modulos_user,
                    'permisos': permisos_user
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

@app.route('/api/personas', methods=['GET'])
def api_personas():
    """Personas que han realizado conteos (para filtro de contador en dashboard)"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT c.contado_por as username,
                   COALESCE(u.nombre, c.contado_por) as nombre
            FROM goti.inventario_ciego_conteos c
            LEFT JOIN goti.usuarios u ON u.username = c.contado_por
            WHERE c.contado_por IS NOT NULL AND c.contado_por != ''
            ORDER BY 2
        """)
        rows = cur.fetchall()
        return jsonify([{'username': r['username'], 'nombre': r['nombre']} for r in rows])
    except Exception as e:
        print(f"Error en /api/personas: {e}")
        return jsonify([]), 500
    finally:
        if conn: release_db(conn)

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

        # Asegurar columnas: observaciones, motivo, corregido (auditoría) y justificado (no descontar)
        cur.execute("""
            ALTER TABLE goti.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS observaciones TEXT;
            ALTER TABLE goti.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS motivo TEXT;
            ALTER TABLE goti.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS corregido BOOLEAN DEFAULT FALSE;
            ALTER TABLE goti.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS justificado BOOLEAN DEFAULT FALSE;
            ALTER TABLE goti.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS cantidad_justificada NUMERIC(12,4) DEFAULT 0;
        """)
        conn.commit()

        cur.execute("""
            SELECT c.id, c.codigo, c.nombre, c.unidad, c.cantidad, c.cantidad_contada, c.cantidad_contada_2,
                   c.observaciones,
                   COALESCE(c.motivo, '') as motivo,
                   COALESCE(c.corregido, FALSE) as corregido,
                   COALESCE(c.justificado, FALSE) as justificado,
                   COALESCE(c.cantidad_justificada, 0) as cantidad_justificada,
                   COALESCE(c.costo_unitario, 0) as costo_unitario,
                   c.contado_por,
                   c.contado2_por,
                   u1.nombre as contado_por_nombre,
                   u2.nombre as contado2_por_nombre,
                   c.contado_at,
                   c.contado2_at
            FROM goti.inventario_ciego_conteos c
            LEFT JOIN goti.usuarios u1 ON u1.username = c.contado_por
            LEFT JOIN goti.usuarios u2 ON u2.username = c.contado2_por
            WHERE c.fecha = %s AND c.local = %s
            ORDER BY c.codigo
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
            UPDATE goti.inventario_ciego_conteos
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
    usuario = data.get('usuario', '')

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        if conteo == 2:
            cur.execute("""
                UPDATE goti.inventario_ciego_conteos
                SET cantidad_contada_2 = %s, contado2_por = %s, contado2_at = NOW()
                WHERE id = %s
            """, (cantidad, usuario or None, id_producto))
        else:
            cur.execute("""
                UPDATE goti.inventario_ciego_conteos
                SET cantidad_contada = %s, contado_por = %s, contado_at = NOW()
                WHERE id = %s
            """, (cantidad, usuario or None, id_producto))

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
    observaciones = data.get('observaciones', None)
    motivo = data.get('motivo', None)
    corregido = data.get('corregido', None)
    justificado = data.get('justificado', None)

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Construir SET dinámico según los campos enviados
        sets = []
        params = []
        if observaciones is not None:
            sets.append("observaciones = %s")
            params.append(observaciones)
        if motivo is not None:
            sets.append("motivo = %s")
            params.append(motivo)
        if corregido is not None:
            sets.append("corregido = %s")
            params.append(bool(corregido))
        if justificado is not None:
            sets.append("justificado = %s")
            params.append(bool(justificado))
        cantidad_justificada = data.get('cantidad_justificada', None)
        if cantidad_justificada is not None:
            sets.append("cantidad_justificada = %s")
            params.append(float(cantidad_justificada))
            # Si pone cantidad > 0, marcar justificado=TRUE automaticamente
            if float(cantidad_justificada) > 0:
                sets.append("justificado = TRUE")
            else:
                sets.append("justificado = FALSE")

        if sets:
            params.append(id_producto)
            cur.execute(f"""
                UPDATE goti.inventario_ciego_conteos
                SET {', '.join(sets)}
                WHERE id = %s
            """, params)
        conn.commit()

        return jsonify({'success': True})
    except Exception as e:
        print(f"Error en /api/inventario/guardar-observacion: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)

# ==================== REPORTE MOTIVOS ====================

@app.route('/api/reportes/motivos-lista', methods=['GET'])
def reporte_motivos_lista():
    """Devuelve lista de motivos unicos disponibles."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT motivo FROM goti.inventario_ciego_conteos
            WHERE motivo IS NOT NULL AND motivo != ''
            ORDER BY motivo
        """)
        motivos = [r['motivo'] for r in cur.fetchall()]
        return jsonify(motivos)
    except Exception as e:
        return jsonify([])
    finally:
        if conn: release_db(conn)


@app.route('/api/reportes/motivos', methods=['GET'])
def reporte_motivos():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodegas = request.args.getlist('bodega')
    bodegas = [b for b in bodegas if b]
    producto = request.args.get('producto', '')
    contador = request.args.get('contador', '').strip()

    if not fecha_desde or not fecha_hasta:
        return jsonify({'error': 'fecha_desde y fecha_hasta requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Asegurar columna motivo existe en conteos
        cur.execute("""
            ALTER TABLE goti.inventario_ciego_conteos
            ADD COLUMN IF NOT EXISTS motivo TEXT
        """)
        conn.commit()

        # Asegurar tabla manuales existe
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.observaciones_manuales (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(100) NOT NULL,
                codigo VARCHAR(50),
                nombre VARCHAR(255) NOT NULL,
                diferencia NUMERIC(12,3) DEFAULT 0,
                motivo TEXT,
                observaciones TEXT,
                corregido BOOLEAN DEFAULT FALSE,
                creado_por VARCHAR(100),
                creado_at TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit()

        # Motivos de conteos
        query1 = """
            SELECT motivo, COUNT(*) as cantidad
            FROM goti.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
              AND motivo IS NOT NULL AND motivo != ''
        """
        params1 = [fecha_desde, fecha_hasta]
        if producto:
            query1 += " AND codigo = %s"
            params1.append(producto)
        if len(bodegas) == 1:
            query1 += " AND local = %s"
            params1.append(bodegas[0])
        elif len(bodegas) > 1:
            query1 += " AND local IN (" + ",".join(["%s"] * len(bodegas)) + ")"
            params1.extend(bodegas)
        if contador:
            query1 += " AND contado_por = %s"
            params1.append(contador)
        query1 += " GROUP BY motivo"

        cur.execute(query1, params1)
        motivos_conteo = cur.fetchall()

        # Motivos de observaciones manuales
        query2 = """
            SELECT motivo, COUNT(*) as cantidad
            FROM goti.observaciones_manuales
            WHERE fecha >= %s AND fecha <= %s
              AND motivo IS NOT NULL AND motivo != ''
        """
        params2 = [fecha_desde, fecha_hasta]
        if producto:
            query2 += " AND codigo = %s"
            params2.append(producto)
        if len(bodegas) == 1:
            query2 += " AND local = %s"
            params2.append(bodegas[0])
        elif len(bodegas) > 1:
            query2 += " AND local IN (" + ",".join(["%s"] * len(bodegas)) + ")"
            params2.extend(bodegas)
        query2 += " GROUP BY motivo"

        cur.execute(query2, params2)
        motivos_manual = cur.fetchall()

        # Combinar ambos
        totales = {}
        for m in motivos_conteo:
            totales[m['motivo']] = totales.get(m['motivo'], 0) + m['cantidad']
        for m in motivos_manual:
            totales[m['motivo']] = totales.get(m['motivo'], 0) + m['cantidad']

        resultado = [{'motivo': k, 'cantidad': v} for k, v in totales.items()]
        resultado.sort(key=lambda x: x['cantidad'], reverse=True)

        return jsonify(resultado)
    except Exception as e:
        print(f"Error en /api/reportes/motivos: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/reportes/personas-errores', methods=['GET'])
def reporte_personas_errores():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodegas = request.args.getlist('bodega')
    bodegas = [b for b in bodegas if b]

    if not fecha_desde or not fecha_hasta:
        return jsonify({'error': 'fecha_desde y fecha_hasta requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT
                contado_por,
                COUNT(*) as total_conteos,
                SUM(CASE
                    WHEN cantidad_contada IS NOT NULL
                     AND cantidad_contada != cantidad
                     AND COALESCE(justificado, FALSE) = FALSE
                    THEN 1 ELSE 0
                END) as total_errores
            FROM goti.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
              AND contado_por IS NOT NULL AND contado_por != ''
              AND cantidad_contada IS NOT NULL
        """
        params = [fecha_desde, fecha_hasta]

        if len(bodegas) == 1:
            query += " AND local = %s"
            params.append(bodegas[0])
        elif len(bodegas) > 1:
            query += " AND local IN (" + ",".join(["%s"] * len(bodegas)) + ")"
            params.extend(bodegas)

        query += """
            GROUP BY contado_por
            HAVING COUNT(*) >= 5
            ORDER BY (SUM(CASE
                WHEN cantidad_contada IS NOT NULL
                 AND cantidad_contada != cantidad
                 AND COALESCE(justificado, FALSE) = FALSE
                THEN 1 ELSE 0
            END) * 100.0 / COUNT(*)) DESC
            LIMIT 10
        """

        cur.execute(query, params)
        rows = cur.fetchall()

        # Obtener nombres reales si existen
        nombres_query = "SELECT username, nombre FROM goti.usuarios WHERE username = ANY(%s)"
        usernames = [r['contado_por'] for r in rows]
        nombres_map = {}
        if usernames:
            cur.execute(nombres_query, (usernames,))
            for u in cur.fetchall():
                nombres_map[u['username']] = u['nombre']

        resultado = []
        for r in rows:
            total = r['total_conteos']
            errores = r['total_errores']
            pct = round(errores * 100.0 / total, 1) if total > 0 else 0
            resultado.append({
                'persona': nombres_map.get(r['contado_por'], r['contado_por']),
                'username': r['contado_por'],
                'total_conteos': total,
                'total_errores': errores,
                'porcentaje_error': pct
            })

        return jsonify(resultado)
    except Exception as e:
        print(f"Error en /api/reportes/personas-errores: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/reportes/diferencias-fecha', methods=['GET'])
def reporte_diferencias_fecha():
    """Productos con diferencia para una fecha y bodega específica"""
    fecha = request.args.get('fecha')
    bodega = request.args.get('bodega', '')
    excluir_justificados = request.args.get('excluir_justificados', '0') == '1'

    if not fecha:
        return jsonify({'error': 'fecha requerida'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        query = """
            SELECT c.nombre, c.unidad,
                   c.cantidad as sistema,
                   COALESCE(c.cantidad_contada_2, c.cantidad_contada) as conteo,
                   COALESCE(c.cantidad_contada_2, c.cantidad_contada) - c.cantidad as diferencia,
                   COALESCE(c.motivo, '') as motivo,
                   COALESCE(u1.nombre, c.contado_por, '') as responsable
            FROM goti.inventario_ciego_conteos c
            LEFT JOIN goti.usuarios u1 ON u1.username = c.contado_por
            WHERE c.fecha = %s
              AND COALESCE(c.cantidad_contada_2, c.cantidad_contada) IS NOT NULL
              AND COALESCE(c.cantidad_contada_2, c.cantidad_contada) - c.cantidad != 0
        """
        params = [fecha]
        if bodega:
            query += " AND c.local = %s"
            params.append(bodega)
        if excluir_justificados:
            query += " AND (c.justificado IS NULL OR c.justificado = FALSE)"
        query += " ORDER BY ABS(COALESCE(c.cantidad_contada_2, c.cantidad_contada) - c.cantidad) DESC LIMIT 50"

        cur.execute(query, params)
        productos = [{
            'nombre': r['nombre'],
            'unidad': r['unidad'],
            'sistema': float(r['sistema']),
            'conteo': float(r['conteo']),
            'diferencia': float(r['diferencia']),
            'motivo': r['motivo'],
            'responsable': r['responsable']
        } for r in cur.fetchall()]

        return jsonify(productos)
    except Exception as e:
        print(f"Error en /api/reportes/diferencias-fecha: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/reportes/motivos/detalle', methods=['GET'])
def reporte_motivo_detalle():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    motivo = request.args.get('motivo', '')
    bodegas_f = request.args.getlist('bodega')
    bodegas_f = [b for b in bodegas_f if b]
    contador = request.args.get('contador', '').strip()
    excluir_justificados = request.args.get('excluir_justificados', '0') == '1'

    if not fecha_desde or not fecha_hasta or not motivo:
        return jsonify({'error': 'fecha_desde, fecha_hasta y motivo requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Ocurrencias individuales de conteos con ese motivo
        query1 = """
            SELECT c.fecha, c.nombre, c.local,
                   COALESCE(c.cantidad_contada_2, c.cantidad_contada) - c.cantidad as diferencia,
                   COALESCE(u.nombre, c.contado_por, '') as responsable,
                   COALESCE(c.observaciones, '') as observacion
            FROM goti.inventario_ciego_conteos c
            LEFT JOIN goti.usuarios u ON u.username = c.contado_por
            WHERE c.fecha >= %s AND c.fecha <= %s AND c.motivo = %s
        """
        params1 = [fecha_desde, fecha_hasta, motivo]
        if len(bodegas_f) == 1:
            query1 += " AND c.local = %s"
            params1.append(bodegas_f[0])
        elif len(bodegas_f) > 1:
            query1 += " AND c.local IN (" + ",".join(["%s"] * len(bodegas_f)) + ")"
            params1.extend(bodegas_f)
        if contador:
            query1 += " AND c.contado_por = %s"
            params1.append(contador)
        if excluir_justificados:
            query1 += " AND (c.justificado IS NULL OR c.justificado = FALSE)"
        query1 += " ORDER BY c.fecha DESC, c.local"
        cur.execute(query1, params1)
        rows_conteo = cur.fetchall()

        # Ocurrencias individuales de observaciones manuales con ese motivo
        query2 = """
            SELECT fecha, nombre, local, diferencia, '' as responsable
            FROM goti.observaciones_manuales
            WHERE fecha >= %s AND fecha <= %s AND motivo = %s
        """
        params2 = [fecha_desde, fecha_hasta, motivo]
        if len(bodegas_f) == 1:
            query2 += " AND local = %s"
            params2.append(bodegas_f[0])
        elif len(bodegas_f) > 1:
            query2 += " AND local IN (" + ",".join(["%s"] * len(bodegas_f)) + ")"
            params2.extend(bodegas_f)
        query2 += " ORDER BY fecha DESC, local"
        cur.execute(query2, params2)
        rows_manual = cur.fetchall()

        resultado = []
        for r in rows_conteo:
            resultado.append({
                'fecha': r['fecha'].strftime('%d/%m/%Y'),
                'nombre': r['nombre'],
                'local': BODEGAS_NOMBRES.get(r['local'], r['local']),
                'diferencia': round(float(r['diferencia'] or 0), 3),
                'responsable': r['responsable'],
                'observacion': r['observacion']
            })
        for r in rows_manual:
            resultado.append({
                'fecha': r['fecha'].strftime('%d/%m/%Y'),
                'nombre': r['nombre'],
                'local': BODEGAS_NOMBRES.get(r['local'], r['local']),
                'diferencia': round(float(r['diferencia'] or 0), 3),
                'responsable': '',
                'observacion': ''
            })
        resultado.sort(key=lambda x: x['fecha'], reverse=True)

        return jsonify(resultado)
    except Exception as e:
        print(f"Error en /api/reportes/motivos/detalle: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

# ==================== OBSERVACIONES MANUALES ====================

@app.route('/api/observaciones-manuales', methods=['GET'])
def listar_obs_manuales():
    fecha = request.args.get('fecha')
    local = request.args.get('local')
    if not fecha or not local:
        return jsonify({'error': 'fecha y local requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.observaciones_manuales (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                local VARCHAR(100) NOT NULL,
                codigo VARCHAR(50),
                nombre VARCHAR(255) NOT NULL,
                diferencia NUMERIC(12,3) DEFAULT 0,
                motivo TEXT,
                observaciones TEXT,
                corregido BOOLEAN DEFAULT FALSE,
                justificado BOOLEAN DEFAULT FALSE,
                creado_por VARCHAR(100),
                creado_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # Asegurar columna justificado (migracion)
        cur.execute("ALTER TABLE goti.observaciones_manuales ADD COLUMN IF NOT EXISTS justificado BOOLEAN DEFAULT FALSE")
        conn.commit()

        cur.execute("""
            SELECT id, codigo, nombre, diferencia, motivo, observaciones, corregido, COALESCE(justificado, FALSE) as justificado, creado_por
            FROM goti.observaciones_manuales
            WHERE fecha = %s AND local = %s
            ORDER BY creado_at
        """, (fecha, local))
        return jsonify(cur.fetchall())
    except Exception as e:
        print(f"Error en /api/observaciones-manuales GET: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/observaciones-manuales', methods=['POST'])
def crear_obs_manual():
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')
    codigo = data.get('codigo', '')
    nombre = data.get('nombre', '')
    diferencia = data.get('diferencia', 0)
    motivo = data.get('motivo', '')
    observaciones = data.get('observaciones', '')
    creado_por = data.get('creado_por', '')

    if not fecha or not local or not nombre:
        return jsonify({'error': 'fecha, local y nombre son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.observaciones_manuales
            (fecha, local, codigo, nombre, diferencia, motivo, observaciones, creado_por)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (fecha, local, codigo, nombre, float(diferencia), motivo, observaciones, creado_por))
        new_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'success': True, 'id': new_id})
    except Exception as e:
        print(f"Error en /api/observaciones-manuales POST: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/observaciones-manuales/<int:obs_id>', methods=['PUT'])
def actualizar_obs_manual(obs_id):
    data = request.json
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sets = []
        params = []
        for campo in ['motivo', 'observaciones', 'diferencia']:
            if campo in data:
                sets.append(f"{campo} = %s")
                params.append(data[campo])
        if 'corregido' in data:
            sets.append("corregido = %s")
            params.append(bool(data['corregido']))
        if 'justificado' in data:
            sets.append("justificado = %s")
            params.append(bool(data['justificado']))
        if sets:
            params.append(obs_id)
            cur.execute(f"""
                UPDATE goti.observaciones_manuales
                SET {', '.join(sets)}
                WHERE id = %s
            """, params)
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error en /api/observaciones-manuales PUT: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)

@app.route('/api/observaciones-manuales/<int:obs_id>', methods=['DELETE'])
def eliminar_obs_manual(obs_id):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM goti.observaciones_manuales WHERE id = %s", (obs_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error en /api/observaciones-manuales DELETE: {e}")
        return jsonify({'error': str(e)}), 500
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
    usuario = data.get('usuario', '')

    if id_producto is None:
        return jsonify({'error': 'id es requerido'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.inventario_ciego_conteos
            SET cantidad = COALESCE(%s, cantidad),
                cantidad_contada = %s,
                cantidad_contada_2 = %s,
                modificado_por = %s,
                modificado_at = CURRENT_TIMESTAMP,
                corregido = TRUE
            WHERE id = %s
        """, (cantidad_sistema, cantidad_contada, cantidad_contada_2, usuario or None, id_producto))
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
                INSERT INTO goti.inventario_ciego_conteos
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

MARCA_BODEGA = {
    'bodega_principal': 'BODEGA_PRINCIPAL',
    'materia_prima': 'MATERIA_PRIMA',
    'planta': 'PLANTA',
}

def _get_lunes(fecha):
    """Retorna el lunes de la semana de la fecha dada"""
    from datetime import date
    if isinstance(fecha, str):
        fecha = date.fromisoformat(fecha)
    return fecha - timedelta(days=fecha.weekday())

def _seleccionar_productos_semana(cur, bodega, fecha_lunes):
    """Selecciona productos para conteo semanal.
    BP: 14 fijos (tipo_conteo='fijo')
    MP/Planta: 10 aleatorios que no se hayan usado recientemente"""
    marca = MARCA_BODEGA.get(bodega)
    if not marca:
        return []

    if bodega == 'bodega_principal':
        # Fijos: siempre los mismos
        cur.execute("""
            SELECT codigo, nombre, unidad FROM goti.productos_por_marca
            WHERE marca = %s AND tipo_conteo = 'fijo' AND activo = TRUE
            ORDER BY nombre
        """, (marca,))
        return cur.fetchall()

    # MP / Planta: 10 aleatorios sin repetir hasta agotar todos
    cur.execute("""
        SELECT codigo FROM goti.productos_por_marca
        WHERE marca = %s AND activo = TRUE
    """, (marca,))
    todos = [r['codigo'] for r in cur.fetchall()]

    # Obtener codigos usados en rotaciones recientes
    cur.execute("""
        SELECT codigos FROM goti.rotacion_semanal_bodegas
        WHERE bodega = %s ORDER BY semana_inicio DESC
    """, (bodega,))
    usados = set()
    for r in cur.fetchall():
        if r['codigos']:
            usados.update(r['codigos'])
        if len(usados) >= len(todos) - 10:
            break  # Ya agotamos casi todos, reset

    # Si ya se usaron casi todos, resetear
    disponibles = [c for c in todos if c not in usados]
    if len(disponibles) < 10:
        disponibles = todos  # Reset: todos disponibles de nuevo

    # Seleccionar 10 aleatorios
    import random
    seleccion = random.sample(disponibles, min(10, len(disponibles)))

    # Guardar rotacion
    domingo = fecha_lunes + timedelta(days=6)
    cur.execute("""
        INSERT INTO goti.rotacion_semanal_bodegas (bodega, semana_inicio, semana_fin, codigos)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (bodega, semana_inicio) DO UPDATE SET codigos = EXCLUDED.codigos
    """, (bodega, fecha_lunes, domingo, seleccion))

    # Retornar datos completos
    cur.execute("""
        SELECT codigo, nombre, unidad FROM goti.productos_por_marca
        WHERE marca = %s AND codigo = ANY(%s) AND activo = TRUE
        ORDER BY nombre
    """, (marca, seleccion))
    return cur.fetchall()


@app.route('/api/inventario/generar-conteo-operativo', methods=['POST'])
def generar_conteo_operativo():
    """Genera conteo DIARIO para bodegas operativas.
    Los productos se seleccionan UNA vez por semana (lunes) y se usan todos los dias.
    BP: 14 fijos | MP/Planta: 10 aleatorios semanales.
    Crea una tarea POR DIA para que el worker descargue stock de Contifico.
    Body: {bodega, fecha}"""
    data = request.json or {}
    bodega = data.get('bodega')
    fecha = data.get('fecha')

    BODEGAS_VALIDAS = ('bodega_principal', 'materia_prima', 'planta')
    if bodega not in BODEGAS_VALIDAS:
        return jsonify({'error': f'bodega invalida. Validas: {BODEGAS_VALIDAS}'}), 400
    if not fecha:
        return jsonify({'error': 'fecha requerida'}), 400

    from datetime import date
    if isinstance(fecha, str):
        fecha_date = date.fromisoformat(fecha)
    else:
        fecha_date = fecha
    fecha_lunes = _get_lunes(fecha_date)

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Seleccionar productos para la semana (solo genera rotacion nueva si es la primera vez)
        productos = _seleccionar_productos_semana(cur, bodega, fecha_lunes)
        if not productos:
            return jsonify({'error': 'No hay productos configurados para esta bodega'}), 400

        n_fijos = len(productos) if bodega == 'bodega_principal' else 0
        n_aleatorios = 0 if bodega == 'bodega_principal' else len(productos)

        # Crear tabla si no existe
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.conteo_operativo_tareas (
                id SERIAL PRIMARY KEY,
                bodega VARCHAR(50) NOT NULL,
                fecha DATE NOT NULL,
                estado VARCHAR(20) DEFAULT 'pendiente',
                solicitado_at TIMESTAMP DEFAULT NOW(),
                worker_lock VARCHAR(50),
                timestamp_inicio TIMESTAMP,
                timestamp_fin TIMESTAMP,
                total_productos INT,
                fijos INT,
                aleatorios INT,
                error_msg TEXT,
                codigos_seleccionados TEXT[],
                semana_inicio DATE,
                semana_fin DATE,
                UNIQUE(bodega, fecha)
            )
        """)
        for col in ['codigos_seleccionados TEXT[]', 'semana_inicio DATE', 'semana_fin DATE']:
            try:
                cur.execute(f"ALTER TABLE goti.conteo_operativo_tareas ADD COLUMN IF NOT EXISTS {col}")
            except Exception:
                conn.rollback()
        conn.commit()

        codigos = [p['codigo'] for p in productos]
        domingo = fecha_lunes + timedelta(days=6)

        # Verificar si ya hay tarea para este DIA+bodega
        cur.execute("""
            SELECT id, estado FROM goti.conteo_operativo_tareas
            WHERE bodega = %s AND fecha = %s
        """, (bodega, str(fecha_date)))
        existente = cur.fetchone()
        if existente:
            if existente['estado'] == 'completado':
                return jsonify({'error': f'Ya se genero el conteo para {fecha} en {bodega}', 'ya_existe': True}), 409
            # Resetear si pendiente/error
            cur.execute("""
                UPDATE goti.conteo_operativo_tareas
                SET estado='pendiente', solicitado_at=NOW(), worker_lock=NULL, error_msg=NULL,
                    timestamp_inicio=NULL, timestamp_fin=NULL,
                    total_productos=%s, fijos=%s, aleatorios=%s,
                    codigos_seleccionados=%s, semana_inicio=%s, semana_fin=%s
                WHERE id = %s
            """, (len(codigos), n_fijos, n_aleatorios, codigos, str(fecha_lunes), str(domingo), existente['id']))
            conn.commit()
            return jsonify({
                'id': existente['id'], 'estado': 'pendiente', 'reset': True,
                'fecha': str(fecha_date),
                'productos': len(codigos), 'fijos': n_fijos, 'aleatorios': n_aleatorios,
                'semana': f'{fecha_lunes} - {domingo}',
                'codigos': codigos
            })

        cur.execute("""
            INSERT INTO goti.conteo_operativo_tareas
                (bodega, fecha, total_productos, fijos, aleatorios, codigos_seleccionados, semana_inicio, semana_fin)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (bodega, str(fecha_date), len(codigos), n_fijos, n_aleatorios, codigos, str(fecha_lunes), str(domingo)))
        new_id = cur.fetchone()['id']
        conn.commit()

        return jsonify({
            'id': new_id, 'estado': 'pendiente',
            'fecha': str(fecha_date),
            'productos': len(codigos), 'fijos': n_fijos, 'aleatorios': n_aleatorios,
            'semana': f'{fecha_lunes} - {domingo}',
            'codigos': codigos,
            'detalle': [{'codigo': p['codigo'], 'nombre': p['nombre'], 'unidad': p['unidad']} for p in productos]
        })
    except Exception as e:
        print(f"Error en generar-conteo-operativo: {e}")
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/conteo-op/productos-semana', methods=['GET'])
def conteo_op_productos_semana():
    """Retorna los productos seleccionados para conteo en una semana+bodega.
    Usado por el worker para saber que descargar de Contifico."""
    bodega = request.args.get('bodega')
    fecha = request.args.get('fecha')
    if not bodega or not fecha:
        return jsonify({'error': 'bodega y fecha requeridos'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        # Buscar productos: primero por fecha exacta, luego por cualquier dia de la semana
        lunes = _get_lunes(fecha)
        cur.execute("""
            SELECT codigos_seleccionados, semana_inicio, semana_fin
            FROM goti.conteo_operativo_tareas
            WHERE bodega = %s AND (fecha = %s OR semana_inicio = %s)
            ORDER BY fecha DESC LIMIT 1
        """, (bodega, str(fecha), str(lunes)))
        r = cur.fetchone()
        if not r or not r['codigos_seleccionados']:
            return jsonify({'error': 'No hay productos seleccionados para esta semana'}), 404
        marca = MARCA_BODEGA.get(bodega, '')
        cur.execute("""
            SELECT codigo, nombre, unidad, equivalencia FROM goti.productos_por_marca
            WHERE marca = %s AND codigo = ANY(%s) AND activo = TRUE
            ORDER BY nombre
        """, (marca, r['codigos_seleccionados']))
        productos = cur.fetchall()
        return jsonify({
            'bodega': bodega, 'semana_inicio': str(r['semana_inicio']), 'semana_fin': str(r['semana_fin']),
            'productos': [dict(p) for p in productos]
        })
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/conteo-op/pendientes', methods=['GET'])
def conteo_op_pendientes():
    """Worker toma tareas de conteo operativo."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401
    worker_id = request.args.get('worker_id', 'pc-finanzas')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.conteo_operativo_tareas
            SET estado = 'en_proceso', worker_lock = %s, timestamp_inicio = NOW()
            WHERE id IN (
                SELECT id FROM goti.conteo_operativo_tareas
                WHERE estado = 'pendiente' ORDER BY solicitado_at ASC LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, bodega, fecha
        """, (worker_id,))
        rows = cur.fetchall()
        conn.commit()
        return jsonify([{
            'id': r['id'], 'bodega': r['bodega'],
            'fecha': r['fecha'].isoformat() if r['fecha'] else None,
            'tipo': 'conteo_operativo',
        } for r in rows])
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/conteo-op/resultado', methods=['POST'])
def conteo_op_resultado():
    """Worker reporta resultado del conteo operativo."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401
    data = request.json or {}
    ejec_id = data.get('id')
    estado = data.get('estado', 'completado')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.conteo_operativo_tareas
            SET estado = %s, timestamp_fin = NOW(),
                total_productos = %s, fijos = %s, aleatorios = %s, error_msg = %s
            WHERE id = %s
        """, (estado, data.get('total_productos'), data.get('fijos'), data.get('aleatorios'),
              data.get('error_msg'), ejec_id))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/conteo-op/estado/<int:ejec_id>', methods=['GET'])
def conteo_op_estado(ejec_id):
    """Polling del panel."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM goti.conteo_operativo_tareas WHERE id = %s", (ejec_id,))
        r = cur.fetchone()
        if not r: return jsonify({'error': 'no encontrado'}), 404
        return jsonify({
            'id': r['id'], 'bodega': r['bodega'], 'estado': r['estado'],
            'total_productos': r['total_productos'], 'fijos': r['fijos'],
            'aleatorios': r['aleatorios'], 'error_msg': r['error_msg'],
        })
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


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
            FROM goti.inventario_ciego_conteos
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
            FROM goti.inventario_ciego_conteos c
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
            FROM goti.asignacion_diferencias a
            JOIN goti.inventario_ciego_conteos c ON a.conteo_id = c.id
            WHERE c.fecha >= %s AND c.fecha <= %s AND c.local = %s
              AND a.persona IS NOT NULL AND a.persona <> ''
            GROUP BY c.codigo, a.persona
        """, (fecha_desde, fecha_hasta, local))
        asig_rows = cur.fetchall()

        # Obtener contadores (quién contó) por fecha
        cur.execute("""
            SELECT c.fecha,
                   u.nombre as contador_nombre,
                   MIN(c.contado_at) as hora_inicio,
                   MAX(c.contado_at) as hora_fin,
                   'conteo1' as tipo
            FROM goti.inventario_ciego_conteos c
            LEFT JOIN goti.usuarios u ON u.username = c.contado_por
            WHERE c.fecha >= %s AND c.fecha <= %s AND c.local = %s
              AND c.contado_por IS NOT NULL
            GROUP BY c.fecha, u.nombre

            UNION ALL

            SELECT c.fecha,
                   u.nombre as contador_nombre,
                   MIN(c.contado2_at) as hora_inicio,
                   MAX(c.contado2_at) as hora_fin,
                   'conteo2' as tipo
            FROM goti.inventario_ciego_conteos c
            LEFT JOIN goti.usuarios u ON u.username = c.contado2_por
            WHERE c.fecha >= %s AND c.fecha <= %s AND c.local = %s
              AND c.contado2_por IS NOT NULL
            GROUP BY c.fecha, u.nombre

            ORDER BY fecha, tipo
        """, (fecha_desde, fecha_hasta, local, fecha_desde, fecha_hasta, local))
        cont_rows = cur.fetchall()

        release_db(conn)
        conn = None

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

        contadores_por_fecha = {}
        for cr in cont_rows:
            f = str(cr['fecha'])
            if f not in contadores_por_fecha:
                contadores_por_fecha[f] = []
            hi = cr['hora_inicio'].strftime('%H:%M') if cr['hora_inicio'] else ''
            hf = cr['hora_fin'].strftime('%H:%M') if cr['hora_fin'] else ''
            contadores_por_fecha[f].append({
                'nombre': cr['contador_nombre'] or '',
                'hora_inicio': hi,
                'hora_fin': hf,
                'tipo': 'Conteo 1' if cr['tipo'] == 'conteo1' else 'Conteo 2'
            })

        return jsonify({
            'fechas': sorted(fechas),
            'productos': list(productos.values()),
            'personas': todas_personas,
            'contadores': contadores_por_fecha
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
                   COALESCE(motivo, '') as motivo,
                   observaciones,
                   COALESCE(corregido, FALSE) as corregido,
                   local
            FROM goti.inventario_ciego_conteos
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
                'motivo': p['motivo'] or '',
                'observaciones': p['observaciones'] or '',
                'corregido': bool(p['corregido'])
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
                   COALESCE(motivo, '') as motivo,
                   observaciones,
                   COALESCE(corregido, FALSE) as corregido
            FROM goti.inventario_ciego_conteos
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

        headers = ['Codigo', 'Producto', 'Unidad', 'Sistema', 'Conteo 1', 'Conteo 2', 'Diferencia', 'Motivo', 'Observaciones', 'Corregido']

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
                    item.get('motivo') or '',
                    item['observaciones'] or '',
                    'Sí' if item.get('corregido') else 'No'
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
            FROM goti.inventario_ciego_conteos
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


@app.route('/api/reportes/productos-disponibles', methods=['GET'])
def productos_disponibles():
    """Devuelve productos distintos para un rango de fechas y bodega."""
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodega = request.args.get('bodega')
    if not fecha_desde or not fecha_hasta:
        return jsonify([])
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        query = "SELECT DISTINCT codigo, nombre FROM goti.inventario_ciego_conteos WHERE fecha >= %s AND fecha <= %s"
        params = [fecha_desde, fecha_hasta]
        if bodega:
            query += " AND local = %s"
            params.append(bodega)
        query += " ORDER BY nombre"
        cur.execute(query, params)
        return jsonify([{'codigo': r['codigo'], 'nombre': r['nombre']} for r in cur.fetchall()])
    except Exception as e:
        return jsonify([])
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/dashboard', methods=['GET'])
def reporte_dashboard():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    bodegas = request.args.getlist('bodega')
    bodegas = [b for b in bodegas if b]  # filtrar vacíos
    producto = request.args.get('producto', '').strip()
    contador = request.args.get('contador', '').strip()
    excluir_justificados = request.args.get('excluir_justificados', '0') == '1'

    if not fecha_desde or not fecha_hasta:
        return jsonify({'error': 'fecha_desde y fecha_hasta son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Filtros comunes
        filtro_extra = ""
        params = [fecha_desde, fecha_hasta]
        if len(bodegas) == 1:
            filtro_extra += " AND local = %s"
            params.append(bodegas[0])
        elif len(bodegas) > 1:
            filtro_extra += " AND local IN (" + ",".join(["%s"] * len(bodegas)) + ")"
            params.extend(bodegas)
        if producto:
            filtro_extra += " AND codigo = %s"
            params.append(producto)
        if contador:
            filtro_extra += " AND (contado_por = %s OR contado2_por = %s)"
            params.extend([contador, contador])
        if excluir_justificados:
            filtro_extra += " AND (justificado IS NULL OR justificado = FALSE)"

        # Resumen por bodega
        query = """
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
                    THEN 1 END) as total_sobrantes,
                COALESCE(SUM(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad < 0
                    THEN ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad) * COALESCE(costo_unitario, 0) END), 0) as valor_faltantes,
                COALESCE(SUM(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad > 0
                    THEN ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad) * COALESCE(costo_unitario, 0) END), 0) as valor_sobrantes
            FROM goti.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
        """ + filtro_extra + " GROUP BY local ORDER BY local"
        cur.execute(query, params)

        resultados = cur.fetchall()

        bodegas_data = []
        for r in resultados:
            bodegas_data.append({
                'local': r['local'],
                'local_nombre': BODEGAS_NOMBRES.get(r['local'], r['local']),
                'total_productos': r['total_productos'],
                'total_contados': r['total_contados'],
                'total_con_diferencia': r['total_con_diferencia'],
                'promedio_diferencia_abs': float(r['promedio_diferencia_abs']),
                'total_faltantes': r['total_faltantes'],
                'total_sobrantes': r['total_sobrantes'],
                'valor_faltantes': float(r['valor_faltantes']),
                'valor_sobrantes': float(r['valor_sobrantes'])
            })

        # Top 10 productos con mayor descuadre en valor (agrupados por producto)
        query_top = """
            SELECT codigo, nombre, unidad,
                   SUM(ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad)) as diferencia_total,
                   AVG(COALESCE(costo_unitario, 0)) as costo_unitario,
                   SUM(ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad) * COALESCE(costo_unitario, 0)) as valor_descuadre
            FROM goti.inventario_ciego_conteos
            WHERE fecha >= %s AND fecha <= %s
              AND COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
              AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
        """ + filtro_extra
        params_top = list(params)
        query_top += " GROUP BY codigo, nombre, unidad ORDER BY valor_descuadre DESC LIMIT 10"
        cur.execute(query_top, params_top)
        top_descuadre = []
        for r in cur.fetchall():
            top_descuadre.append({
                'codigo': r['codigo'],
                'nombre': r['nombre'],
                'unidad': r['unidad'],
                'diferencia': float(r['diferencia_total']),
                'costo_unitario': float(r['costo_unitario']),
                'valor_descuadre': float(r['valor_descuadre'])
            })

        # % cumplimiento por bodega (contados / total)
        cumplimiento = []
        for b in bodegas_data:
            pct = round(b['total_contados'] / b['total_productos'] * 100, 1) if b['total_productos'] > 0 else 0
            cumplimiento.append({
                'local': b['local'],
                'local_nombre': b['local_nombre'],
                'porcentaje': pct,
                'exactos': b['total_contados'] - b['total_con_diferencia'],
                'con_diferencia': b['total_con_diferencia']
            })

        # Promedio diario de exactitud (items contados sin error / items contados)
        query_prom = """
            SELECT AVG(exactitud_dia) as promedio_exactitud,
                   AVG(cumplimiento_dia) as promedio_cumplimiento,
                   COUNT(*) as total_dias
            FROM (
                SELECT fecha,
                       CASE WHEN COUNT(cantidad_contada) > 0
                            THEN (COUNT(cantidad_contada) - COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                                AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0 THEN 1 END))::float
                                / COUNT(cantidad_contada) * 100
                            ELSE 0 END as exactitud_dia,
                       CASE WHEN COUNT(*) > 0
                            THEN COUNT(cantidad_contada)::float / COUNT(*) * 100
                            ELSE 0 END as cumplimiento_dia
                FROM goti.inventario_ciego_conteos
                WHERE fecha >= %s AND fecha <= %s
        """ + filtro_extra + """
                GROUP BY fecha
            ) dias
        """
        cur.execute(query_prom, params)
        prom = cur.fetchone()
        promedios = {
            'exactitud_promedio': round(float(prom['promedio_exactitud'] or 0), 1),
            'cumplimiento_promedio': round(float(prom['promedio_cumplimiento'] or 0), 1),
            'total_dias': prom['total_dias'] or 0
        }

        # Actividad de contadores en el periodo
        query_cont = """
            SELECT
                u.nombre as contador,
                c.contado_por as username,
                COUNT(DISTINCT c.fecha) as dias_contados,
                COUNT(*) as total_items,
                COUNT(DISTINCT c.local) as bodegas_cubiertas,
                MAX(c.contado_at) as ultima_actividad
            FROM goti.inventario_ciego_conteos c
            JOIN goti.usuarios u ON u.username = c.contado_por
            WHERE c.fecha >= %s AND c.fecha <= %s
              AND c.contado_por IS NOT NULL
        """ + filtro_extra + """
            GROUP BY u.nombre, c.contado_por
            ORDER BY total_items DESC
        """
        cur.execute(query_cont, params)
        contadores_data = []
        for r in cur.fetchall():
            ua = r['ultima_actividad']
            contadores_data.append({
                'nombre': r['contador'],
                'username': r['username'],
                'dias_contados': r['dias_contados'],
                'total_items': r['total_items'],
                'bodegas_cubiertas': r['bodegas_cubiertas'],
                'ultima_actividad': ua.strftime('%d/%m %H:%M') if ua else ''
            })

        return jsonify({
            'bodegas': bodegas_data,
            'top_descuadre': top_descuadre,
            'cumplimiento': cumplimiento,
            'promedios': promedios,
            'contadores': contadores_data
        })
    except Exception as e:
        print(f"Error en /api/reportes/dashboard: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/reportes/tendencias-temporal', methods=['GET'])
def reporte_tendencias_temporal():
    bodegas = request.args.getlist('bodega')
    bodegas = [b for b in bodegas if b]
    dias = request.args.get('dias', 30, type=int)
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    motivo = request.args.get('motivo', '')
    producto = request.args.get('producto', '')
    contador = request.args.get('contador', '').strip()
    excluir_justificados = request.args.get('excluir_justificados', '0') == '1'

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        if fecha_desde and fecha_hasta:
            where_fecha = "fecha >= %s AND fecha <= %s"
            params = [fecha_desde, fecha_hasta]
        else:
            where_fecha = "fecha >= CURRENT_DATE - %s"
            params = [dias]

        motivo_filter = ""
        if motivo:
            motivo_filter = " AND motivo = %s"
            params.append(motivo)

        if producto:
            motivo_filter += " AND codigo = %s"
            params.append(producto)

        if contador:
            motivo_filter += " AND (contado_por = %s OR contado2_por = %s)"
            params.extend([contador, contador])

        if excluir_justificados:
            motivo_filter += " AND (justificado IS NULL OR justificado = FALSE)"

        query = f"""
            SELECT
                fecha,
                local,
                COUNT(CASE WHEN COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
                    AND COALESCE(cantidad_contada_2, cantidad_contada) - cantidad != 0
                    THEN 1 END) as total_con_diferencia
            FROM goti.inventario_ciego_conteos
            WHERE {where_fecha}{motivo_filter}
        """

        if len(bodegas) == 1:
            query += " AND local = %s"
            params.append(bodegas[0])
        elif len(bodegas) > 1:
            query += " AND local IN (" + ",".join(["%s"] * len(bodegas)) + ")"
            params.extend(bodegas)

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
PERSONAS_CACHE_TTL = 300  # 5 minutos

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
    'planta': 'Planta de Produccion',
    'real_audiencia': 'Real Audiencia (Chios)',
    'floreana': 'Floreana (Chios)',
    'portugal': 'Portugal (Chios)',
    'santo_cachon_real': 'Santo Cachon Real',
    'santo_cachon_portugal': 'Santo Cachon Portugal',
    'simon_bolon': 'Simon Bolon',
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
        sql = """SELECT * FROM goti.cruce_operativo_ejecuciones WHERE 1=1"""
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
        sql = """SELECT * FROM goti.cruce_operativo_detalle
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
                FROM goti.cruce_operativo_ejecuciones
                WHERE estado = 'completado'
                ORDER BY bodega, fecha_toma DESC
            )
            SELECT u.id, u.bodega, u.fecha_toma, u.total_productos_toma, u.total_con_diferencia,
                   COALESCE(SUM(d.valor_diferencia) FILTER (WHERE d.diferencia != 0), 0) as valor_total,
                   COUNT(*) FILTER (WHERE d.diferencia < 0) as faltantes,
                   COUNT(*) FILTER (WHERE d.diferencia > 0) as sobrantes
            FROM ultimas u
            LEFT JOIN goti.cruce_operativo_detalle d ON d.ejecucion_id = u.id
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
        cur.execute("SELECT * FROM goti.cruce_operativo_ejecuciones WHERE id = %s", (ejec_id,))
        ejec = cur.fetchone()
        if not ejec:
            return jsonify({'error': 'Ejecucion no encontrada'}), 404

        # Detalle
        cur.execute("""SELECT * FROM goti.cruce_operativo_detalle
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
            FROM goti.cruce_operativo_detalle d
            JOIN goti.cruce_operativo_ejecuciones e ON d.ejecucion_id = e.id
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
            DELETE FROM goti.asignacion_diferencias
            WHERE conteo_id IN (
                SELECT id FROM goti.inventario_ciego_conteos
                WHERE fecha = %s AND local = %s
            )
        """, (fecha, local))
        asig_borradas = cur.rowcount

        cur.execute("""
            DELETE FROM goti.inventario_ciego_conteos
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
                    UPDATE goti.inventario_ciego_conteos
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
            SELECT DISTINCT nombre FROM goti.inventario_ciego_conteos
            WHERE costo_unitario IS NULL OR costo_unitario = 0
        """)
        nombres = [r['nombre'] for r in cur_inv.fetchall()]
        release_db(conn_inv)
        return jsonify({'pendientes': nombres, 'total': len(nombres)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


_cedulas_cache = {'datos': {}, 'timestamp': 0}

@app.route('/api/personas-cedulas-debug', methods=['GET'])
def debug_personas_airtable():
    """Debug: trae TODOS los campos de los primeros 3 registros"""
    import urllib.request, json as json_lib
    try:
        url = f'https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}?pageSize=3'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {_get_airtable_token()}'})
        data = json_lib.loads(urllib.request.urlopen(req, timeout=10).read())
        return jsonify({'records': [r.get('fields', {}) for r in data.get('records', [])]})
    except Exception as e:
        return jsonify({'error': str(e)})

@app.route('/api/personas-cedulas', methods=['GET'])
def obtener_personas_cedulas():
    """Retorna mapa {nombre: cedula} desde AirTable"""
    global _cedulas_cache
    ahora = _time.time()
    if _cedulas_cache['datos'] and (ahora - _cedulas_cache['timestamp']) < 600:
        return jsonify(_cedulas_cache['datos'])

    import urllib.request, json as json_lib
    cedulas = {}
    offset = None
    try:
        # Traer TODOS los campos (sin filtrar) para buscar cualquier variante de cédula
        while True:
            url = f'https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}?pageSize=100'
            if offset:
                url += f'&offset={offset}'
            req = urllib.request.Request(url, headers={'Authorization': f'Bearer {_get_airtable_token()}'})
            data = json_lib.loads(urllib.request.urlopen(req, timeout=10).read())
            for r in data.get('records', []):
                f = r.get('fields', {})
                nombre = f.get('nombre') or f.get('Nombre') or ''
                # Buscar cédula en cualquier campo cuyo nombre contenga "ced" o "identif"
                ced = ''
                for k, v in f.items():
                    kl = k.lower().replace('é', 'e').replace('á', 'a').replace('í', 'i').replace('ó', 'o').replace('ú', 'u')
                    if 'cedula' in kl or 'identif' in kl or kl == 'ci' or kl == 'dni':
                        ced = str(v).strip()
                        break
                if nombre and ced:
                    cedulas[nombre] = ced
            offset = data.get('offset')
            if not offset:
                break
        _cedulas_cache = {'datos': cedulas, 'timestamp': ahora}
        return jsonify(cedulas)
    except Exception as e:
        print(f"Error cargando cedulas: {e}")
        return jsonify({})

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
        return _personas_cache['datos'] if _personas_cache['datos'] else []


_personas_correo_cache = {'datos': [], 'timestamp': 0}

def _obtener_personas_con_correo():
    """Obtiene personas activas con nombre y correo desde AirTable."""
    import urllib.request, json as json_lib
    ahora = _time.time()
    if _personas_correo_cache['datos'] and (ahora - _personas_correo_cache['timestamp']) < PERSONAS_CACHE_TTL:
        return _personas_correo_cache['datos']
    todos = []
    offset = None
    while True:
        url = f'https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}?pageSize=100'
        url += '&fields%5B%5D=nombre&fields%5B%5D=estado&fields%5B%5D=correo'
        if offset:
            url += f'&offset={offset}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {_get_airtable_token()}'})
        data = json_lib.loads(urllib.request.urlopen(req, timeout=10).read())
        for r in data.get('records', []):
            f = r.get('fields', {})
            if f.get('estado') == 'Activo':
                nombre = f.get('nombre', '')
                correo = f.get('correo', '')
                if nombre:
                    todos.append({'nombre': nombre, 'correo': correo or ''})
        offset = data.get('offset')
        if not offset:
            break
    todos.sort(key=lambda x: x['nombre'])
    _personas_correo_cache['datos'] = todos
    _personas_correo_cache['timestamp'] = _time.time()
    return todos


@app.route('/api/personas', methods=['GET'])
def get_personas():
    try:
        if request.args.get('refresh') == '1':
            _personas_cache['timestamp'] = 0
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
            FROM goti.asignacion_diferencias a
            JOIN goti.inventario_ciego_conteos c ON a.conteo_id = c.id
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
            DELETE FROM goti.asignacion_diferencias
            WHERE conteo_id = %s
        """, (conteo_id,))
        # Obtener info del producto para guardar datos auto-contenidos
        cur.execute("""
            SELECT codigo, nombre, unidad, local, fecha
            FROM goti.inventario_ciego_conteos
            WHERE id = %s
        """, (conteo_id,))
        conteo_info = cur.fetchone()
        for a in asignaciones:
            if a.get('persona') and a.get('cantidad') and float(a['cantidad']) > 0:
                if conteo_info:
                    cur.execute("""
                        INSERT INTO goti.asignacion_diferencias
                            (conteo_id, persona, cantidad, codigo, nombre, unidad, local, fecha)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (conteo_id, a['persona'].strip(), float(a['cantidad']),
                          conteo_info['codigo'], conteo_info['nombre'], conteo_info['unidad'],
                          conteo_info['local'], conteo_info['fecha']))
                else:
                    cur.execute("""
                        INSERT INTO goti.asignacion_diferencias (conteo_id, persona, cantidad)
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
            FROM goti.asignacion_seccion
            WHERE fecha = %s AND local = %s
            ORDER BY created_at
        """, (fecha, local))
        secciones = cur.fetchall()
        result = []
        for s in secciones:
            cur.execute("""
                SELECT conteo_id, codigo, nombre, diferencia, costo_unitario, cantidad_asignada, valor
                FROM goti.asig_seccion_productos
                WHERE seccion_id = %s ORDER BY id
            """, (s['id'],))
            productos = [{'conteo_id': r['conteo_id'], 'codigo': r['codigo'],
                          'nombre': r['nombre'], 'diferencia': float(r['diferencia'] or 0),
                          'costo_unitario': float(r['costo_unitario'] or 0),
                          'cantidad_asignada': float(r['cantidad_asignada'] or 0),
                          'valor': float(r['valor'] or 0)} for r in cur.fetchall()]
            cur.execute("""
                SELECT persona, monto
                FROM goti.asig_seccion_personas
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
                DELETE FROM goti.asignacion_diferencias
                WHERE conteo_id = %s
            """, (conteo_id,))
            # Obtener info del producto para guardar datos auto-contenidos
            cur.execute("""
                SELECT codigo, nombre, unidad, local, fecha
                FROM goti.inventario_ciego_conteos WHERE id = %s
            """, (conteo_id,))
            info = cur.fetchone()
            for nombre_persona in personas:
                if info:
                    cur.execute("""
                        INSERT INTO goti.asignacion_diferencias
                            (conteo_id, persona, cantidad, codigo, nombre, unidad, local, fecha)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (conteo_id, nombre_persona.strip(), cantidad_por_persona,
                          info['codigo'], info['nombre'], info['unidad'],
                          info['local'], info['fecha']))
                else:
                    cur.execute("""
                        INSERT INTO goti.asignacion_diferencias (conteo_id, persona, cantidad)
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
        cur.execute("DELETE FROM goti.asig_seccion_productos WHERE seccion_id=%s", (seccion_id,))
        cur.execute("DELETE FROM goti.asig_seccion_personas WHERE seccion_id=%s", (seccion_id,))
        cur.execute("DELETE FROM goti.asignacion_seccion WHERE id=%s", (seccion_id,))
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
        cur2.execute("SELECT COUNT(*) as cnt FROM goti.usuarios")
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
            FROM goti.merma_operativa
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
            INSERT INTO goti.merma_operativa
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
        cur.execute("DELETE FROM goti.merma_operativa WHERE id = %s", (merma_id,))
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
            FROM goti.bajas_directas b
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
                FROM goti.bajas_directas
                WHERE baja_grupo = %s ORDER BY id
            """, (grp,))
            items = [{'id': r['id'], 'codigo': r['codigo'], 'nombre': r['nombre'],
                      'unidad': r['unidad'], 'cantidad': float(r['cantidad']),
                      'costo_unitario': float(r['costo_unitario'] or 0),
                      'costo_total': float(r['costo_total'] or 0)} for r in cur.fetchall()]
            # Asignaciones del grupo
            cur.execute("""
                SELECT id, persona, monto FROM goti.bajas_asignaciones
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
                INSERT INTO goti.bajas_directas
                    (baja_grupo, fecha, local, codigo, nombre, unidad, cantidad, persona, motivo, documento, codigo_baja, costo_unitario, costo_total)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (baja_grupo, fecha, local, codigo, nombre, unidad, cantidad, '', motivo, documento or None, codigo_baja or None, costo_unitario, costo_total))
        for asig in asignaciones:
            persona = asig.get('persona', '').strip()
            monto = float(asig.get('monto') or 0)
            if persona and monto > 0:
                cur.execute("""
                    INSERT INTO goti.bajas_asignaciones
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
        cur.execute("DELETE FROM goti.bajas_directas WHERE baja_grupo = %s", (baja_grupo,))
        cur.execute("DELETE FROM goti.bajas_asignaciones WHERE baja_grupo = %s", (baja_grupo,))
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
            FROM goti.inventario_ciego_conteos
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
            SELECT COUNT(*) as cnt FROM goti.inventario_ciego_conteos
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
            UPDATE goti.inventario_ciego_conteos
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
            SELECT COUNT(*) as cnt FROM goti.inventario_ciego_conteos
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
                 FROM goti.inventario_ciego_conteos c
                 WHERE c.local = s.local
                   AND c.fecha BETWEEN s.fecha_inicio AND s.fecha_fin
                   AND (c.cantidad_contada IS NOT NULL OR c.cantidad_contada_2 IS NOT NULL)
                ) as total_productos,
                COALESCE((SELECT SUM(ap.monto)
                 FROM goti.asignacion_semanal a
                 JOIN goti.asignacion_semanal_personas ap ON ap.asignacion_semanal_id = a.id
                 WHERE a.semana_id = s.id
                ), 0) as total_asignado
            FROM goti.semanas_inventario s
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
            SELECT * FROM goti.semanas_inventario
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
            SELECT id, fecha_inicio, fecha_fin FROM goti.semanas_inventario
            WHERE local = %s AND estado = 'abierta'
        """, (local,))
        abierta = cur.fetchone()

        if abierta:
            return jsonify({
                'error': f'Ya existe una semana abierta para {local} ({abierta["fecha_inicio"]} - {abierta["fecha_fin"]}). Cierre primero antes de crear otra.'
            }), 409

        cur.execute("""
            INSERT INTO goti.semanas_inventario (fecha_inicio, fecha_fin, local)
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
            SELECT * FROM goti.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404

        fecha_inicio = semana['fecha_inicio']
        fecha_fin = semana['fecha_fin']
        local = semana['local']

        # Netear diferencias diarias por producto en la semana
        # Resta cantidad_justificada de cada dia (justificacion parcial)
        # dif_neta = dif_dia + cantidad_justificada (dif es negativa, justif reduce el faltante)
        cur.execute("""
            WITH diferencias_diarias AS (
                SELECT
                    codigo, nombre, COALESCE(unidad, '') as unidad, fecha,
                    cantidad as stock_sistema,
                    COALESCE(cantidad_contada_2, cantidad_contada) as contado,
                    COALESCE(cantidad_contada_2, cantidad_contada) - cantidad as dif_dia,
                    COALESCE(costo_unitario, 0) as costo_unitario,
                    COALESCE(corregido, FALSE) as corregido,
                    COALESCE(justificado, FALSE) as justificado,
                    COALESCE(cantidad_justificada, 0) as cant_justif
                FROM goti.inventario_ciego_conteos
                WHERE local = %s AND fecha BETWEEN %s AND %s
                  AND COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
            )
            SELECT
                codigo,
                nombre,
                unidad,
                SUM(
                    CASE
                        WHEN dif_dia < 0 THEN LEAST(dif_dia + cant_justif, 0)
                        WHEN dif_dia > 0 THEN GREATEST(dif_dia - cant_justif, 0)
                        ELSE 0
                    END
                ) as diferencia,
                AVG(costo_unitario) as costo_unitario,
                COUNT(*) as dias_contados,
                BOOL_AND(justificado) as justificado,
                SUM(cant_justif) as total_justificado,
                BOOL_OR(corregido) as tiene_correccion,
                json_agg(json_build_object(
                    'fecha', fecha,
                    'stock', stock_sistema,
                    'contado', contado,
                    'dif', dif_dia,
                    'corregido', corregido,
                    'justificado', justificado,
                    'cant_justif', cant_justif
                ) ORDER BY fecha) as detalle_diario
            FROM diferencias_diarias
            GROUP BY codigo, nombre, unidad
            HAVING SUM(CASE WHEN dif_dia < 0 THEN LEAST(dif_dia + cant_justif, 0) WHEN dif_dia > 0 THEN GREATEST(dif_dia - cant_justif, 0) ELSE 0 END) != 0
            ORDER BY nombre
        """, (local, fecha_inicio, fecha_fin))
        diferencias = cur.fetchall()

        # Serializar datos — costo incluye 20% por costos indirectos (no visible al usuario)
        FACTOR_COSTO_INDIRECTO = 1.20
        for d in diferencias:
            d['diferencia'] = float(d['diferencia']) if d['diferencia'] else 0
            costo_base = float(d['costo_unitario']) if d['costo_unitario'] else 0
            d['costo_unitario'] = round(costo_base * FACTOR_COSTO_INDIRECTO, 4)
            if d.get('detalle_diario'):
                for dd in d['detalle_diario']:
                    dd['fecha'] = str(dd['fecha'])
                    dd['stock'] = float(dd['stock']) if dd['stock'] else 0
                    dd['contado'] = float(dd['contado']) if dd['contado'] else 0
                    dd['dif'] = float(dd['dif']) if dd['dif'] else 0

        # Obtener asignaciones existentes para esta semana (con grupo_idx)
        cur.execute("""
            SELECT a.id, a.codigo, a.nombre, a.unidad, a.diferencia_semanal, a.costo_unitario,
                   COALESCE(a.grupo_idx, 0) as grupo_idx,
                   json_agg(json_build_object(
                       'id', ap.id,
                       'persona', ap.persona,
                       'cantidad', ap.cantidad,
                       'monto', ap.monto
                   )) FILTER (WHERE ap.id IS NOT NULL) as personas
            FROM goti.asignacion_semanal a
            LEFT JOIN goti.asignacion_semanal_personas ap
                ON ap.asignacion_semanal_id = a.id
            WHERE a.semana_id = %s
            GROUP BY a.id, a.codigo, a.nombre, a.unidad, a.diferencia_semanal, a.costo_unitario, a.grupo_idx
        """, (semana_id,))
        asignaciones = cur.fetchall()

        # Mapear asignaciones por codigo (lista, puede haber multiples por grupo)
        asig_map = {}
        for a in asignaciones:
            entry = {
                'id': a['id'],
                'nombre': a['nombre'],
                'unidad': a['unidad'],
                'diferencia_semanal': float(a['diferencia_semanal']) if a['diferencia_semanal'] else 0,
                'costo_unitario': float(a['costo_unitario']) if a['costo_unitario'] else 0,
                'grupo_idx': a['grupo_idx'],
                'personas': a['personas'] or []
            }
            if a['codigo'] not in asig_map:
                asig_map[a['codigo']] = []
            asig_map[a['codigo']].append(entry)

        # Combinar diferencias con asignaciones
        codigos_en_resultado = set()
        resultado = []
        for d in diferencias:
            item = dict(d)
            if d['codigo'] in asig_map:
                item['asignaciones'] = asig_map[d['codigo']]
            else:
                item['asignaciones'] = []
            resultado.append(item)
            codigos_en_resultado.add(d['codigo'])

        # Para semanas cerradas: incluir tambien productos asignados que ya no tienen diferencia neta
        if semana['estado'] == 'cerrada':
            for codigo, asig_list in asig_map.items():
                if codigo not in codigos_en_resultado and any(a['personas'] for a in asig_list):
                    first = asig_list[0]
                    resultado.append({
                        'codigo': codigo,
                        'nombre': first['nombre'],
                        'unidad': first['unidad'],
                        'diferencia': first['diferencia_semanal'],
                        'costo_unitario': first['costo_unitario'],
                        'dias_contados': 0,
                        'justificado': False,
                        'total_justificado': 0,
                        'tiene_correccion': False,
                        'detalle_diario': [],
                        'asignaciones': asig_list,
                    })

        semana_info = {
            'id': semana['id'],
            'fecha_inicio': str(semana['fecha_inicio']),
            'fecha_fin': str(semana['fecha_fin']),
            'local': semana['local'],
            'estado': semana['estado'],
            'cerrada_por': semana.get('cerrada_por'),
            'cerrada_at': str(semana['cerrada_at']) if semana.get('cerrada_at') else None,
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
    """Guarda asignaciones semanales de diferencias preservando estructura de grupos"""
    data = request.get_json()
    grupos = data.get('grupos', [])

    # Compatibilidad: si el frontend envia formato viejo {asignaciones:[...]},
    # convertir a formato nuevo {grupos:[...]} para no perder datos
    if not grupos and 'asignaciones' in data:
        asignaciones_viejas = data.get('asignaciones', [])
        if asignaciones_viejas:
            # Agrupar por set de personas (mismo comportamiento que tenia el frontend viejo)
            from collections import defaultdict
            grupos_temp = defaultdict(lambda: {'productos': [], 'personas_set': set()})
            for asig in asignaciones_viejas:
                personas = sorted([p.get('persona', '') for p in asig.get('personas', [])])
                key = '|'.join(personas)
                grupos_temp[key]['productos'].append({
                    'codigo': asig.get('codigo'),
                    'nombre': asig.get('nombre'),
                    'unidad': asig.get('unidad'),
                    'diferencia_semanal': asig.get('diferencia_semanal', 0),
                    'costo_unitario': asig.get('costo_unitario', 0),
                    'cantidad': sum(float(p.get('cantidad', 0)) for p in asig.get('personas', []))
                })
                for p in personas:
                    grupos_temp[key]['personas_set'].add(p)
            grupos = []
            for key, g in grupos_temp.items():
                grupos.append({
                    'productos': g['productos'],
                    'personas': sorted(g['personas_set'])
                })

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Verificar que la semana existe y esta abierta
        cur.execute("""
            SELECT * FROM goti.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404
        if semana['estado'] != 'abierta':
            return jsonify({'error': 'La semana esta cerrada, no se pueden modificar asignaciones'}), 400

        # Borrar asignaciones previas de esta semana
        cur.execute("""
            DELETE FROM goti.asignacion_semanal_personas
            WHERE asignacion_semanal_id IN (
                SELECT id FROM goti.asignacion_semanal WHERE semana_id = %s
            )
        """, (semana_id,))
        cur.execute("""
            DELETE FROM goti.asignacion_semanal WHERE semana_id = %s
        """, (semana_id,))

        # Insertar por grupo preservando la estructura original
        total_insertadas = 0
        for grupo_idx, grupo in enumerate(grupos):
            personas = grupo.get('personas', [])
            num_personas = len(personas)
            if num_personas == 0:
                continue

            for prod in grupo.get('productos', []):
                cantidad_total = float(prod.get('cantidad', 0))
                if cantidad_total <= 0:
                    continue
                costo = float(prod.get('costo_unitario', 0))

                cur.execute("""
                    INSERT INTO goti.asignacion_semanal
                        (semana_id, codigo, nombre, unidad, local, diferencia_semanal, costo_unitario, grupo_idx)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    semana_id,
                    prod.get('codigo'),
                    prod.get('nombre'),
                    prod.get('unidad'),
                    semana['local'],
                    prod.get('diferencia_semanal', 0),
                    costo,
                    grupo_idx
                ))
                asig_id = cur.fetchone()['id']

                # Dividir cantidad equitativamente entre personas del grupo
                cant_por_persona = cantidad_total / num_personas
                for persona_nombre in personas:
                    monto = cant_por_persona * costo
                    cur.execute("""
                        INSERT INTO goti.asignacion_semanal_personas
                            (asignacion_semanal_id, persona, cantidad, monto)
                        VALUES (%s, %s, %s, %s)
                    """, (asig_id, persona_nombre, round(cant_por_persona, 4), round(monto, 2)))

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


@app.route('/api/semanas/<int:semana_id>/justificar-producto', methods=['POST'])
def justificar_producto_semanal(semana_id):
    """Justifica TODOS los dias de un producto en una semana (marca justificado=TRUE y cantidad_justificada=abs(dif))"""
    data = request.get_json()
    codigo = data.get('codigo')
    justificar = data.get('justificar', True)  # True=justificar, False=quitar justificacion

    if not codigo:
        return jsonify({'error': 'Falta codigo de producto'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("SELECT * FROM goti.semanas_inventario WHERE id = %s", (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404

        if justificar:
            # Justificar: marcar justificado=TRUE y cantidad_justificada=abs(diferencia) en todos los dias
            cur.execute("""
                UPDATE goti.inventario_ciego_conteos
                SET justificado = TRUE,
                    cantidad_justificada = ABS(COALESCE(cantidad_contada_2, cantidad_contada) - cantidad)
                WHERE local = %s AND codigo = %s
                  AND fecha BETWEEN %s AND %s
                  AND COALESCE(cantidad_contada_2, cantidad_contada) IS NOT NULL
            """, (semana['local'], codigo, semana['fecha_inicio'], semana['fecha_fin']))
        else:
            # Quitar justificacion
            cur.execute("""
                UPDATE goti.inventario_ciego_conteos
                SET justificado = FALSE, cantidad_justificada = 0
                WHERE local = %s AND codigo = %s
                  AND fecha BETWEEN %s AND %s
            """, (semana['local'], codigo, semana['fecha_inicio'], semana['fecha_fin']))

        rows = cur.rowcount
        conn.commit()
        return jsonify({'ok': True, 'dias_actualizados': rows})
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
            SELECT estado FROM goti.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404
        if semana['estado'] != 'abierta':
            return jsonify({'error': 'La semana ya esta cerrada'}), 400

        cur.execute("""
            UPDATE goti.semanas_inventario
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


@app.route('/api/semanas/<int:semana_id>', methods=['DELETE'])
def eliminar_semana(semana_id):
    """Elimina una semana (abierta o cerrada) y todas sus asignaciones (solo admin)"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("SELECT estado FROM goti.semanas_inventario WHERE id = %s", (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404

        # Admin puede eliminar tanto abiertas como cerradas
        # Al eliminar, los productos asignados quedan sin responsable y deben ser reasignados

        # Eliminar asignaciones de personas
        cur.execute("""
            DELETE FROM goti.asignacion_semanal_personas
            WHERE asignacion_semanal_id IN (
                SELECT id FROM goti.asignacion_semanal WHERE semana_id = %s
            )
        """, (semana_id,))
        # Eliminar asignaciones
        cur.execute("DELETE FROM goti.asignacion_semanal WHERE semana_id = %s", (semana_id,))
        # Eliminar semana
        cur.execute("DELETE FROM goti.semanas_inventario WHERE id = %s", (semana_id,))
        conn.commit()

        return jsonify({'success': True, 'estado_previo': semana['estado']})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/semanas/<int:semana_id>/reabrir', methods=['POST'])
def reabrir_semana(semana_id):
    """Reabre una semana cerrada (solo admin)"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT estado FROM goti.semanas_inventario WHERE id = %s
        """, (semana_id,))
        semana = cur.fetchone()
        if not semana:
            return jsonify({'error': 'Semana no encontrada'}), 404
        if semana['estado'] != 'cerrada':
            return jsonify({'error': 'La semana ya esta abierta'}), 400

        cur.execute("""
            UPDATE goti.semanas_inventario
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
            FROM goti.semanas_inventario s
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
            FROM goti.asignacion_semanal_personas ap
            JOIN goti.asignacion_semanal a ON a.id = ap.asignacion_semanal_id
            JOIN goti.semanas_inventario s ON s.id = a.semana_id
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
    Si ya existe completado, solo admin puede re-ejecutar.
    Si ya hay una pendiente o en proceso, devuelve esa misma."""
    data = request.json or {}
    bodega = data.get('bodega')
    fecha_toma = data.get('fecha_toma')
    fecha_corte = data.get('fecha_corte_contifico') or fecha_toma  # por defecto = fecha_toma
    usuario = data.get('usuario', 'panel')
    rol = data.get('rol', '')

    if bodega not in BODEGAS_OPERATIVAS:
        return jsonify({'error': 'bodega invalida'}), 400
    if not fecha_toma:
        return jsonify({'error': 'fecha_toma requerida'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        # Ver si ya existe alguna ejecucion para esta bodega+fecha
        cur.execute("""
            SELECT id, estado FROM goti.cruce_operativo_ejecuciones
            WHERE bodega = %s AND fecha_toma = %s
            ORDER BY COALESCE(solicitado_at, timestamp_deteccion) DESC LIMIT 1
        """, (bodega, fecha_toma))
        existente = cur.fetchone()

        if existente and existente['estado'] in ('pendiente', 'en_proceso'):
            # Ya se esta procesando, devolver la misma
            return jsonify({'id': existente['id'], 'estado': existente['estado'], 'reused': True})

        if existente and existente['estado'] == 'completado':
            # Cualquier usuario puede re-ejecutar un cruce completado
            cur.execute("DELETE FROM goti.cruce_operativo_detalle WHERE ejecucion_id = %s", (existente['id'],))
            cur.execute("""
                UPDATE goti.cruce_operativo_ejecuciones
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

        if existente:
            # Estado error: cualquiera puede reintentar
            cur.execute("DELETE FROM goti.cruce_operativo_detalle WHERE ejecucion_id = %s", (existente['id'],))
            cur.execute("""
                UPDATE goti.cruce_operativo_ejecuciones
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
            INSERT INTO goti.cruce_operativo_ejecuciones
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
        cur.execute("DELETE FROM goti.cruce_operativo_detalle WHERE ejecucion_id = %s", (ejec_id,))
        cur.execute("DELETE FROM goti.cruce_operativo_ejecuciones WHERE id = %s", (ejec_id,))
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
            UPDATE goti.cruce_operativo_ejecuciones
            SET estado = 'en_proceso',
                worker_lock = %s,
                timestamp_descarga = NOW()
            WHERE id IN (
                SELECT id FROM goti.cruce_operativo_ejecuciones
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
                UPDATE goti.cruce_operativo_ejecuciones
                SET estado = 'error', error_msg = %s, timestamp_cruce = NOW()
                WHERE id = %s
            """, (error_msg, ejec_id))
            conn.commit()
            return jsonify({'ok': True})

        # Borrar detalle previo si existiera
        cur.execute("DELETE FROM goti.cruce_operativo_detalle WHERE ejecucion_id = %s", (ejec_id,))

        # Insertar detalle (batch insert para evitar timeout)
        if detalle:
            valores = []
            for d in detalle:
                valores.append((
                    ejec_id, d.get('codigo'), d.get('nombre'), d.get('categoria'),
                    d.get('unidad_destino'), d.get('unidad_toma'), d.get('factor'),
                    d.get('unidad_destino'), d.get('cantidad_toma'), d.get('cantidad_sistema'),
                    d.get('diferencia'), d.get('costo_unitario'), d.get('valor_diferencia'),
                    d.get('tipo_abc'), d.get('origen', 'cruce_operativo')
                ))
            cur.executemany("""
                INSERT INTO goti.cruce_operativo_detalle
                (ejecucion_id, codigo, nombre, categoria, unidad, unidad_toma, factor,
                 unidad_destino, cantidad_toma, cantidad_sistema, diferencia,
                 costo_unitario, valor_diferencia, tipo_abc, origen)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, valores)

        # Update ejecucion
        cur.execute("""
            UPDATE goti.cruce_operativo_ejecuciones
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
            FROM goti.cruce_operativo_ejecuciones WHERE id = %s
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
    tablas_centrales = {
        'bodega_principal': 'public.toma_bodega',
        'materia_prima':    'public.toma_materiaprima',
        'planta':           'public.toma_planta',
    }
    if bodega not in BODEGAS_OPERATIVAS:
        return jsonify({'error': 'bodega invalida'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        if bodega in tablas_centrales:
            cur.execute(f"""
                SELECT fecha, COUNT(*) AS productos
                FROM {tablas_centrales[bodega]}
                WHERE fecha IS NOT NULL
                GROUP BY fecha ORDER BY fecha DESC
            """)
        else:
            cur.execute("""
                SELECT fecha, COUNT(*) AS productos
                FROM goti.inventario_ciego_conteos
                WHERE local = %s AND fecha IS NOT NULL
                GROUP BY fecha ORDER BY fecha DESC
            """, (bodega,))
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


# ============================================================
# MODULO: Carga Toma Fisica a Contifico
# ============================================================
# Flujo: Panel web -> POST /solicitar -> tarea pendiente
#        Worker PC FINANZAS -> GET /pendientes-carga (cada 15s) -> toma tarea
#        Worker abre Contifico, llena formulario toma fisica -> POST /resultado-carga
#        Panel web -> GET /estado-carga/<id> (polling) -> muestra resultado
#        UNIQUE(bodega, fecha_toma) -> no permite cargar dos veces

@app.route('/api/carga-contifico/fechas-con-cruce', methods=['GET'])
def carga_contifico_fechas_con_cruce():
    """Devuelve las fechas que tienen cruce operativo completado para una bodega."""
    bodega = request.args.get('bodega')
    if bodega not in BODEGAS_OPERATIVAS:
        return jsonify({'error': 'bodega invalida'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT fecha_toma, total_cruzados, total_con_diferencia, valor_total_dif
            FROM goti.cruce_operativo_ejecuciones
            WHERE bodega = %s AND estado = 'completado'
            ORDER BY fecha_toma DESC
        """, (bodega,))
        rows = cur.fetchall()
        return jsonify([{
            'fecha': r['fecha_toma'].isoformat(),
            'cruzados': r['total_cruzados'],
            'con_dif': r['total_con_diferencia'],
            'valor_dif': float(r['valor_total_dif']) if r['valor_total_dif'] else 0,
        } for r in rows])
    except Exception as e:
        print(f"Error en /api/carga-contifico/fechas-con-cruce: {e}")
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/carga-contifico/verificar', methods=['GET'])
def carga_contifico_verificar():
    """Verifica si ya existe una carga completada para bodega+fecha."""
    bodega = request.args.get('bodega')
    fecha = request.args.get('fecha')
    if not bodega or not fecha:
        return jsonify({'error': 'bodega y fecha requeridos'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, estado, solicitado_at, timestamp_fin, total_productos, productos_ok, productos_error
            FROM goti.carga_contifico_ejecuciones
            WHERE bodega = %s AND fecha_toma = %s
        """, (bodega, fecha))
        row = cur.fetchone()
        if not row:
            return jsonify({'existe': False, 'cargado': False})
        return jsonify({
            'existe': True,
            'cargado': row['estado'] == 'completado',
            'estado': row['estado'],
            'id': row['id'],
            'solicitado_at': row['solicitado_at'].isoformat() if row['solicitado_at'] else None,
            'timestamp_fin': row['timestamp_fin'].isoformat() if row['timestamp_fin'] else None,
            'total_productos': row['total_productos'],
            'productos_ok': row['productos_ok'],
            'productos_error': row['productos_error'],
        })
    except Exception as e:
        print(f"Error en /api/carga-contifico/verificar: {e}")
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/carga-contifico/solicitar', methods=['POST'])
def carga_contifico_solicitar():
    """Crea tarea de carga. Si ya esta completada, solo admin puede re-ejecutar."""
    data = request.json or {}
    bodega = data.get('bodega')
    fecha_toma = data.get('fecha_toma')
    usuario = data.get('usuario', 'panel')
    rol = data.get('rol', '')

    if bodega not in BODEGAS_OPERATIVAS:
        return jsonify({'error': 'bodega invalida'}), 400
    if not fecha_toma:
        return jsonify({'error': 'fecha_toma requerida'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, estado FROM goti.carga_contifico_ejecuciones
            WHERE bodega = %s AND fecha_toma = %s
        """, (bodega, fecha_toma))
        existente = cur.fetchone()

        if existente:
            if existente['estado'] == 'completado':
                if rol != 'admin':
                    return jsonify({'error': 'Ya fue cargado a Contifico. Solo el administrador puede re-ejecutar.', 'ya_cargado': True}), 409
                # Admin: resetear para re-ejecutar
                cur.execute("""
                    UPDATE goti.carga_contifico_ejecuciones
                    SET estado='pendiente', solicitado_por=%s, solicitado_at=NOW(),
                        worker_lock=NULL, error_msg=NULL, timestamp_inicio=NULL, timestamp_fin=NULL,
                        total_productos=NULL, productos_ok=NULL, productos_error=NULL, productos_error_lista=NULL
                    WHERE id = %s
                """, (usuario, existente['id']))
                conn.commit()
                return jsonify({'id': existente['id'], 'estado': 'pendiente', 'reset': True})
            if existente['estado'] in ('pendiente', 'en_proceso'):
                return jsonify({'id': existente['id'], 'estado': existente['estado'], 'reused': True})
            # Estado error: resetear para reintentar
            cur.execute("""
                UPDATE goti.carga_contifico_ejecuciones
                SET estado='pendiente', solicitado_por=%s, solicitado_at=NOW(),
                    worker_lock=NULL, error_msg=NULL, timestamp_inicio=NULL, timestamp_fin=NULL,
                    total_productos=NULL, productos_ok=NULL, productos_error=NULL, productos_error_lista=NULL
                WHERE id = %s
            """, (usuario, existente['id']))
            conn.commit()
            return jsonify({'id': existente['id'], 'estado': 'pendiente', 'reset': True})

        # No existe: crear nueva
        cur.execute("""
            INSERT INTO goti.carga_contifico_ejecuciones
            (bodega, fecha_toma, estado, solicitado_por, solicitado_at)
            VALUES (%s, %s, 'pendiente', %s, NOW())
            RETURNING id
        """, (bodega, fecha_toma, usuario))
        new_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'id': new_id, 'estado': 'pendiente'})
    except Exception as e:
        print(f"Error en /api/carga-contifico/solicitar: {e}")
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/carga-contifico/pendientes', methods=['GET'])
def carga_contifico_pendientes():
    """Llamado por el worker. Devuelve tareas pendientes de carga y las marca en_proceso."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401

    worker_id = request.args.get('worker_id', 'pc-finanzas')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.carga_contifico_ejecuciones
            SET estado = 'en_proceso', worker_lock = %s, timestamp_inicio = NOW()
            WHERE id IN (
                SELECT id FROM goti.carga_contifico_ejecuciones
                WHERE estado = 'pendiente'
                ORDER BY solicitado_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, bodega, fecha_toma, solicitado_por
        """, (worker_id,))
        rows = cur.fetchall()
        conn.commit()
        return jsonify([{
            'id': r['id'],
            'bodega': r['bodega'],
            'fecha_toma': r['fecha_toma'].isoformat() if r['fecha_toma'] else None,
            'tipo': 'carga_contifico',
        } for r in rows])
    except Exception as e:
        print(f"Error en /api/carga-contifico/pendientes: {e}")
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/carga-contifico/resultado', methods=['POST'])
def carga_contifico_resultado():
    """Llamado por el worker al terminar la carga."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401

    data = request.json or {}
    ejec_id = data.get('id')
    estado = data.get('estado', 'completado')
    error_msg = data.get('error_msg')

    if not ejec_id:
        return jsonify({'error': 'id requerido'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.carga_contifico_ejecuciones
            SET estado = %s, timestamp_fin = NOW(),
                total_productos = %s, productos_ok = %s,
                productos_error = %s, productos_error_lista = %s,
                error_msg = %s
            WHERE id = %s
        """, (
            estado,
            data.get('total_productos'),
            data.get('productos_ok'),
            data.get('productos_error'),
            data.get('productos_error_lista'),
            error_msg,
            ejec_id
        ))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        print(f"Error en /api/carga-contifico/resultado: {e}")
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/carga-contifico/estado/<int:ejec_id>', methods=['GET'])
def carga_contifico_estado(ejec_id):
    """Polling desde el panel."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, bodega, fecha_toma, estado, solicitado_at,
                   timestamp_inicio, timestamp_fin, error_msg,
                   total_productos, productos_ok, productos_error, productos_error_lista
            FROM goti.carga_contifico_ejecuciones WHERE id = %s
        """, (ejec_id,))
        r = cur.fetchone()
        if not r:
            return jsonify({'error': 'no encontrado'}), 404
        return jsonify({
            'id': r['id'],
            'bodega': r['bodega'],
            'fecha_toma': r['fecha_toma'].isoformat() if r['fecha_toma'] else None,
            'estado': r['estado'],
            'solicitado_at': r['solicitado_at'].isoformat() if r['solicitado_at'] else None,
            'timestamp_inicio': r['timestamp_inicio'].isoformat() if r['timestamp_inicio'] else None,
            'timestamp_fin': r['timestamp_fin'].isoformat() if r['timestamp_fin'] else None,
            'error_msg': r['error_msg'],
            'total_productos': r['total_productos'],
            'productos_ok': r['productos_ok'],
            'productos_error': r['productos_error'],
            'productos_error_lista': r['productos_error_lista'],
        })
    except Exception as e:
        print(f"Error en /api/carga-contifico/estado: {e}")
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


# ============================================================
# MODULO: Evaluacion Semanal por Local
# ============================================================

EVAL_LOCALES = [
    {'id': 'real_audiencia', 'nombre': 'Chios Real Audiencia'},
    {'id': 'floreana', 'nombre': 'Chios Floreana'},
    {'id': 'portugal', 'nombre': 'Chios Portugal'},
    {'id': 'santo_cachon_real', 'nombre': 'Santo Cachon Real'},
    {'id': 'santo_cachon_portugal', 'nombre': 'Santo Cachon Portugal'},
    {'id': 'simon_bolon', 'nombre': 'Simon Bolon'},
]

@app.route('/api/eval/categorias', methods=['GET'])
def eval_categorias():
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT id, nombre, descripcion, orden, criterios FROM goti.eval_categorias WHERE activa = TRUE ORDER BY orden")
        return jsonify(cur.fetchall())
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/eval/locales', methods=['GET'])
def eval_locales():
    return jsonify(EVAL_LOCALES)


@app.route('/api/eval/guardar', methods=['POST'])
def eval_guardar():
    """Guarda evaluacion semanal. Body: {local, semana_inicio, semana_fin, evaluaciones: [{categoria_id, puntaje, comentario}], evaluado_por}"""
    data = request.json or {}
    local = data.get('local')
    semana_inicio = data.get('semana_inicio')
    semana_fin = data.get('semana_fin')
    evaluaciones = data.get('evaluaciones', [])
    evaluado_por = data.get('evaluado_por', 'admin')

    if not local or not semana_inicio or not evaluaciones:
        return jsonify({'error': 'local, semana_inicio y evaluaciones requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        guardados = 0
        for ev in evaluaciones:
            cur.execute("""
                INSERT INTO goti.eval_semanal
                (local, semana_inicio, semana_fin, categoria_id, puntaje, comentario, evaluado_por, evaluado_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (local, semana_inicio, categoria_id)
                DO UPDATE SET puntaje = EXCLUDED.puntaje, comentario = EXCLUDED.comentario,
                              evaluado_por = EXCLUDED.evaluado_por, evaluado_at = NOW()
            """, (local, semana_inicio, semana_fin, ev['categoria_id'], ev['puntaje'], ev.get('comentario', ''), evaluado_por))
            guardados += 1
        conn.commit()
        return jsonify({'ok': True, 'guardados': guardados})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/eval/semana', methods=['GET'])
def eval_semana():
    """Obtiene evaluaciones de una semana. Params: semana_inicio, local (opcional)"""
    semana = request.args.get('semana_inicio')
    local = request.args.get('local')
    if not semana:
        return jsonify({'error': 'semana_inicio requerido'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        if local:
            cur.execute("""
                SELECT e.id, e.local, e.categoria_id, c.nombre as categoria, e.puntaje, e.comentario, e.evaluado_por, e.evaluado_at
                FROM goti.eval_semanal e
                JOIN goti.eval_categorias c ON c.id = e.categoria_id
                WHERE e.semana_inicio = %s AND e.local = %s
                ORDER BY c.orden
            """, (semana, local))
        else:
            cur.execute("""
                SELECT e.id, e.local, e.categoria_id, c.nombre as categoria, e.puntaje, e.comentario, e.evaluado_por, e.evaluado_at
                FROM goti.eval_semanal e
                JOIN goti.eval_categorias c ON c.id = e.categoria_id
                WHERE e.semana_inicio = %s
                ORDER BY e.local, c.orden
            """, (semana,))
        return jsonify(cur.fetchall())
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/eval/ranking', methods=['GET'])
def eval_ranking():
    """Ranking de locales por promedio. Params: semana_inicio (opcional, default ultima disponible), ultimas_n (semanas a promediar, default 1)"""
    semana = request.args.get('semana_inicio')
    ultimas_n = int(request.args.get('ultimas_n', '1'))
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        if semana:
            cur.execute("""
                SELECT local, ROUND(AVG(puntaje)::numeric, 2) as promedio, COUNT(DISTINCT categoria_id) as categorias_evaluadas
                FROM goti.eval_semanal
                WHERE semana_inicio = %s
                GROUP BY local ORDER BY promedio DESC
            """, (semana,))
        else:
            cur.execute("""
                SELECT local, ROUND(AVG(puntaje)::numeric, 2) as promedio, COUNT(DISTINCT semana_inicio) as semanas
                FROM goti.eval_semanal
                WHERE semana_inicio >= (
                    SELECT MAX(semana_inicio) - interval '%s weeks' FROM goti.eval_semanal
                )
                GROUP BY local ORDER BY promedio DESC
            """ % max(1, ultimas_n))
        return jsonify(cur.fetchall())
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/eval/tendencia', methods=['GET'])
def eval_tendencia():
    """Tendencia historica por local. Params: local (opcional), limite (semanas, default 12)"""
    local = request.args.get('local')
    limite = int(request.args.get('limite', '12'))
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        if local:
            cur.execute("""
                SELECT semana_inicio, ROUND(AVG(puntaje)::numeric, 2) as promedio
                FROM goti.eval_semanal
                WHERE local = %s
                GROUP BY semana_inicio ORDER BY semana_inicio DESC LIMIT %s
            """, (local, limite))
        else:
            cur.execute("""
                SELECT local, semana_inicio, ROUND(AVG(puntaje)::numeric, 2) as promedio
                FROM goti.eval_semanal
                GROUP BY local, semana_inicio ORDER BY semana_inicio DESC, promedio DESC
                LIMIT %s
            """, (limite * 6,))
        return jsonify(cur.fetchall())
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/eval/semanas-disponibles', methods=['GET'])
def eval_semanas_disponibles():
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT semana_inicio, semana_fin
            FROM goti.eval_semanal
            ORDER BY semana_inicio DESC LIMIT 52
        """)
        return jsonify(cur.fetchall())
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/evaluacion')
def evaluacion_page():
    return render_template('evaluacion.html')


# ============================================================
# MODULO: DEPOSITOS (lee desde AirTable)
# ============================================================
_AT_DEP_FB = _b64.b64decode('cGF0d1owSHBiRlQ5RkNoNWQuZDQwY2ExZTZlNGViYWRlZWE5ZjJmZGYyZTAwM2FhOGMxMGIyMjAzYzkxZjg2OTk1YmRiOTgyMjYwOTkzMzM3YQ==').decode()
AIRTABLE_DEPOSITOS_TOKEN = os.environ.get('AIRTABLE_DEPOSITOS_TOKEN', '') or _AT_DEP_FB
AIRTABLE_DEPOSITOS_BASE = 'apppZXgUChlBLbVpR'
AIRTABLE_DEPOSITOS_TABLE = 'tbldo5QTH6bBpgYbx'
AIRTABLE_TIENDAS_TABLE = 'tblxloBdnbdsGcuKR'

_tiendas_cache = {}
_tiendas_cache_ts = 0

def _at_headers():
    return {'Authorization': f'Bearer {AIRTABLE_DEPOSITOS_TOKEN}'}

def _cargar_tiendas():
    global _tiendas_cache, _tiendas_cache_ts
    import time as _t
    if _tiendas_cache and (_t.time() - _tiendas_cache_ts) < 600:
        return _tiendas_cache
    try:
        import requests as req
        r = req.get(f'https://api.airtable.com/v0/{AIRTABLE_DEPOSITOS_BASE}/{AIRTABLE_TIENDAS_TABLE}',
            headers=_at_headers(), params={'fields[]': ['Código', 'Marca']}, timeout=15)
        if r.status_code == 200:
            for rec in r.json().get('records', []):
                _tiendas_cache[rec['id']] = rec['fields'].get('Código', rec['id'])
            _tiendas_cache_ts = _t.time()
    except Exception as e:
        print(f'Error cargando tiendas: {e}')
    return _tiendas_cache

def _resolver_local(local_ids):
    if not local_ids:
        return 'Sin local'
    tiendas = _cargar_tiendas()
    nombres = [tiendas.get(lid, lid) for lid in local_ids]
    return ', '.join(nombres)


@app.route('/api/depositos/listar', methods=['GET'])
def depositos_listar():
    """Lista depositos desde AirTable con filtros."""
    import requests as req
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    estado = request.args.get('estado', '')
    cuadre = request.args.get('cuadre', '')

    try:
        # Construir formula de filtro
        filtros = []
        if fecha_desde:
            filtros.append(f"IS_AFTER({{Fecha}}, '{fecha_desde}')")
        if fecha_hasta:
            filtros.append(f"IS_BEFORE({{Fecha}}, DATEADD('{fecha_hasta}', 1, 'day'))")
        if estado:
            filtros.append(f"{{Estado}} = '{estado}'")
        if cuadre:
            filtros.append(f"{{Estado De Cuadre}} = '{cuadre}'")

        params = {
            'pageSize': 100,
            'sort[0][field]': 'Fecha',
            'sort[0][direction]': 'desc',
            'fields[]': ['Fecha', 'Local', 'Responsable De Caja', 'Monto Contado',
                         'Monto A Recibir', 'Diferencia Contado Vs. Recibido',
                         'Secuencia De Caja', 'Número De Depósitos', 'Estado',
                         'Estado De Cuadre', 'Observación', 'Evidencia', 'Evidencia Del Déposito',
                         'Fecha Creación', 'Correo (from Responsable De Caja)'],
        }
        if filtros:
            params['filterByFormula'] = 'AND(' + ','.join(filtros) + ')'

        all_records = []
        offset = None
        while True:
            if offset:
                params['offset'] = offset
            r = req.get(f'https://api.airtable.com/v0/{AIRTABLE_DEPOSITOS_BASE}/{AIRTABLE_DEPOSITOS_TABLE}',
                headers=_at_headers(), params=params, timeout=20)
            if r.status_code != 200:
                return jsonify({'error': f'AirTable error: {r.status_code}'}), 500
            data = r.json()
            all_records.extend(data.get('records', []))
            offset = data.get('offset')
            if not offset or len(all_records) >= 500:
                break

        # Resolver locales
        resultado = []
        for rec in all_records:
            f = rec['fields']
            evidencias = []
            for att in (f.get('Evidencia', []) + f.get('Evidencia Del Déposito', [])):
                if isinstance(att, dict):
                    thumb = att.get('thumbnails', {}).get('large', {}).get('url', '')
                    evidencias.append({'url': att.get('url', ''), 'thumb': thumb, 'filename': att.get('filename', '')})

            resultado.append({
                'id': rec['id'],
                'fecha': f.get('Fecha'),
                'local': _resolver_local(f.get('Local', [])),
                'monto_contado': f.get('Monto Contado', 0),
                'monto_recibir': f.get('Monto A Recibir', 0),
                'diferencia': f.get('Diferencia Contado Vs. Recibido', 0),
                'secuencia': f.get('Secuencia De Caja'),
                'num_depositos': f.get('Número De Depósitos'),
                'estado': f.get('Estado', ''),
                'cuadre': f.get('Estado De Cuadre', ''),
                'observacion': f.get('Observación', ''),
                'evidencias': evidencias,
                'fecha_creacion': f.get('Fecha Creación'),
                'responsable_email': (f.get('Correo (from Responsable De Caja)', [None]) or [None])[0],
            })

        return jsonify({'depositos': resultado, 'total': len(resultado)})
    except Exception as e:
        print(f'Error en depositos_listar: {e}')
        return jsonify({'error': str(e)[:200]}), 500


@app.route('/api/depositos/resumen', methods=['GET'])
def depositos_resumen():
    """Resumen/KPIs de depositos."""
    import requests as req
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')

    try:
        filtros = []
        if fecha_desde:
            filtros.append(f"IS_AFTER({{Fecha}}, '{fecha_desde}')")
        if fecha_hasta:
            filtros.append(f"IS_BEFORE({{Fecha}}, DATEADD('{fecha_hasta}', 1, 'day'))")

        params = {
            'pageSize': 100,
            'fields[]': ['Fecha', 'Local', 'Monto Contado', 'Monto A Recibir',
                         'Diferencia Contado Vs. Recibido', 'Estado', 'Estado De Cuadre'],
        }
        if filtros:
            params['filterByFormula'] = 'AND(' + ','.join(filtros) + ')'

        all_records = []
        offset = None
        while True:
            if offset:
                params['offset'] = offset
            r = req.get(f'https://api.airtable.com/v0/{AIRTABLE_DEPOSITOS_BASE}/{AIRTABLE_DEPOSITOS_TABLE}',
                headers=_at_headers(), params=params, timeout=20)
            if r.status_code != 200:
                break
            data = r.json()
            all_records.extend(data.get('records', []))
            offset = data.get('offset')
            if not offset:
                break

        total_depositado = 0
        total_recibido = 0
        total_diferencia = 0
        descuadres = 0
        cuadran = 0
        por_local = {}
        pendientes = 0

        for rec in all_records:
            f = rec['fields']
            monto = f.get('Monto Contado', 0) or 0
            recibido = f.get('Monto A Recibir', 0) or 0
            dif = f.get('Diferencia Contado Vs. Recibido', 0) or 0
            total_depositado += monto
            total_recibido += recibido
            total_diferencia += abs(dif)

            if f.get('Estado De Cuadre') == 'Descuadra':
                descuadres += 1
            elif f.get('Estado De Cuadre') == 'Cuadra':
                cuadran += 1

            if f.get('Estado') not in ('Aprobado por Contabilidad',):
                pendientes += 1

            local = _resolver_local(f.get('Local', []))
            if local not in por_local:
                por_local[local] = {'monto': 0, 'depositos': 0, 'descuadres': 0}
            por_local[local]['monto'] += monto
            por_local[local]['depositos'] += 1
            if f.get('Estado De Cuadre') == 'Descuadra':
                por_local[local]['descuadres'] += 1

        return jsonify({
            'total_depositos': len(all_records),
            'total_depositado': round(total_depositado, 2),
            'total_recibido': round(total_recibido, 2),
            'total_diferencia': round(total_diferencia, 2),
            'cuadran': cuadran,
            'descuadres': descuadres,
            'pendientes': pendientes,
            'por_local': por_local,
        })
    except Exception as e:
        print(f'Error en depositos_resumen: {e}')
        return jsonify({'error': str(e)[:200]}), 500


@app.route('/api/depositos/aprobar', methods=['POST'])
def depositos_aprobar():
    """Aprueba un deposito en AirTable."""
    import requests as req
    data = request.json or {}
    record_id = data.get('id')
    if not record_id:
        return jsonify({'error': 'id requerido'}), 400

    try:
        r = req.patch(
            f'https://api.airtable.com/v0/{AIRTABLE_DEPOSITOS_BASE}/{AIRTABLE_DEPOSITOS_TABLE}/{record_id}',
            headers={**_at_headers(), 'Content-Type': 'application/json'},
            json={'fields': {
                'Estado': 'Aprobado por Contabilidad',
                'Fecha Aprobado Por Contabilidad': datetime.now().isoformat(),
            }},
            timeout=15,
        )
        if r.status_code == 200:
            return jsonify({'ok': True})
        return jsonify({'error': f'AirTable: {r.status_code}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500


# ==================== ADMIN USUARIOS ====================

SMTP_CONFIG = {
    'server': os.environ.get('SMTP_SERVER', 'smtp.gmail.com'),
    'port': int(os.environ.get('SMTP_PORT', '587')),
    'user': os.environ.get('SMTP_USER', 'ortiz.medranda@gmail.com'),
    'password': os.environ.get('SMTP_PASSWORD', 'cikp vxlq zlim dzzc'),
}
APP_URL = os.environ.get('APP_URL', 'https://inventario-ciego-5bdr.onrender.com')


def _enviar_email_invitacion(email_destino, nombre, username, token):
    """Envia email con link para establecer contrasena."""
    link = f"{APP_URL}/establecer-clave?token={token}"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:30px;background:#f8fafc;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
            <h1 style="color:#123450;font-size:22px;margin:0;">FOODIX - Inventario</h1>
        </div>
        <div style="background:#fff;padding:28px;border-radius:10px;border:1px solid #e2e8f0;">
            <h2 style="color:#123450;font-size:18px;margin:0 0 12px;">Hola {nombre},</h2>
            <p style="color:#475569;font-size:14px;line-height:1.6;">
                Se ha creado tu cuenta en el sistema de inventario.
                Tu usuario es: <strong style="color:#123450;">{username}</strong>
            </p>
            <p style="color:#475569;font-size:14px;line-height:1.6;">
                Haz clic en el boton para establecer tu contrasena:
            </p>
            <div style="text-align:center;margin:24px 0;">
                <a href="{link}" style="background:#123450;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
                    Crear mi contrasena
                </a>
            </div>
            <p style="color:#94a3b8;font-size:12px;line-height:1.5;">
                Este enlace es valido por 48 horas. Si no puedes hacer clic, copia y pega esta URL en tu navegador:<br>
                <span style="color:#64748b;word-break:break-all;">{link}</span>
            </p>
        </div>
        <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:16px;">
            FOODIX S.A.S. — Sistema de Inventario Ciego
        </p>
    </div>
    """
    msg = MIMEMultipart('alternative')
    msg['Subject'] = f'FOODIX Inventario — Configura tu acceso'
    msg['From'] = f'FOODIX Inventario <{SMTP_CONFIG["user"]}>'
    msg['To'] = email_destino
    msg.attach(MIMEText(html, 'html'))

    server = smtplib.SMTP(SMTP_CONFIG['server'], SMTP_CONFIG['port'], timeout=15)
    server.starttls()
    server.login(SMTP_CONFIG['user'], SMTP_CONFIG['password'])
    server.sendmail(SMTP_CONFIG['user'], email_destino, msg.as_string())
    server.quit()


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
        cur.execute("""SELECT id FROM goti.usuarios
                       WHERE username = %s AND password = %s AND rol = 'admin' AND activo = TRUE""",
                    (admin_user, admin_pass))
        row = cur.fetchone()
        if not row:
            return None, jsonify({'error': 'No autorizado'}), 403
        return conn, None, None
    except Exception:
        release_db(conn)
        raise


@app.route('/api/admin/personas', methods=['GET'])
def admin_listar_personas():
    """Devuelve lista de personas activas desde AirTable con nombre y correo."""
    try:
        personas = _obtener_personas_con_correo()
        return jsonify(personas)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/usuarios', methods=['GET'])
def admin_listar_usuarios():
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT u.id, u.username, u.nombre, u.rol, u.activo, u.created_at, u.email,
                   COALESCE(array_agg(ub.bodega ORDER BY ub.bodega) FILTER (WHERE ub.bodega IS NOT NULL), '{}') AS bodegas
            FROM goti.usuarios u
            LEFT JOIN goti.usuario_bodegas ub ON ub.usuario_id = u.id
            GROUP BY u.id, u.username, u.nombre, u.rol, u.activo, u.created_at, u.email
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
        email = data.get('email', '').strip().lower()
        rol = data.get('rol', 'subgerente')
        bodegas = data.get('bodegas', [])
        enviar_invitacion = data.get('enviar_invitacion', False)

        if not username or not nombre:
            return jsonify({'error': 'username y nombre son obligatorios'}), 400
        if enviar_invitacion and not email:
            return jsonify({'error': 'Email es obligatorio para enviar invitacion'}), 400
        if not enviar_invitacion and not password:
            return jsonify({'error': 'Debes asignar contrasena o enviar invitacion por email'}), 400

        cur.execute("SELECT id FROM goti.usuarios WHERE username = %s", (username,))
        if cur.fetchone():
            return jsonify({'error': f'El usuario "{username}" ya existe'}), 409

        # Generar token si enviar invitacion
        token = secrets.token_urlsafe(32) if enviar_invitacion else None
        token_expires = (datetime.utcnow() + timedelta(hours=48)).isoformat() if token else None
        pwd = password if password else '__pendiente__'

        cur.execute("""
            INSERT INTO goti.usuarios (username, password, nombre, rol, activo, email, invite_token, invite_token_expires)
            VALUES (%s, %s, %s, %s, TRUE, %s, %s, %s) RETURNING id
        """, (username, pwd, nombre, rol, email or None, token, token_expires))
        new_id = cur.fetchone()['id']

        for bod in bodegas:
            cur.execute("""INSERT INTO goti.usuario_bodegas (usuario_id, bodega)
                           VALUES (%s, %s) ON CONFLICT DO NOTHING""", (new_id, bod))

        conn.commit()

        # Enviar email
        msg_extra = ''
        if enviar_invitacion and token:
            try:
                _enviar_email_invitacion(email, nombre, username, token)
                msg_extra = f' — Invitacion enviada a {email}'
            except Exception as mail_err:
                msg_extra = f' — ERROR enviando email: {str(mail_err)[:100]}'

        return jsonify({'success': True, 'id': new_id, 'message': f'Usuario {username} creado{msg_extra}'})
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
        username = data.get('username', '').strip().lower()
        nombre = data.get('nombre', '').strip()
        password = data.get('password', '').strip()
        rol = data.get('rol', 'subgerente')
        activo = data.get('activo', True)
        bodegas = data.get('bodegas', [])

        email = data.get('email', '').strip().lower() or None

        # Verificar que el nuevo username no exista en otro usuario
        if username:
            cur.execute("SELECT id FROM goti.usuarios WHERE username = %s AND id != %s", (username, uid))
            if cur.fetchone():
                return jsonify({'error': f'El usuario "{username}" ya existe'}), 409

        if password:
            cur.execute("""UPDATE goti.usuarios
                           SET username = %s, nombre = %s, password = %s, rol = %s, activo = %s, email = %s
                           WHERE id = %s""", (username, nombre, password, rol, activo, email, uid))
        else:
            cur.execute("""UPDATE goti.usuarios
                           SET username = %s, nombre = %s, rol = %s, activo = %s, email = %s
                           WHERE id = %s""", (username, nombre, rol, activo, email, uid))

        if cur.rowcount == 0:
            return jsonify({'error': 'Usuario no encontrado'}), 404

        cur.execute("DELETE FROM goti.usuario_bodegas WHERE usuario_id = %s", (uid,))
        for bod in bodegas:
            cur.execute("""INSERT INTO goti.usuario_bodegas (usuario_id, bodega)
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
        cur.execute("SELECT username FROM goti.usuarios WHERE id = %s", (uid,))
        row = cur.fetchone()
        if row and row['username'] == 'admin':
            return jsonify({'error': 'No se puede eliminar al administrador principal'}), 403

        cur.execute("DELETE FROM goti.usuarios WHERE id = %s", (uid,))
        conn.commit()
        return jsonify({'success': True, 'message': 'Usuario eliminado'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        release_db(conn)


@app.route('/api/admin/roles', methods=['GET'])
def admin_listar_roles():
    """Devuelve los modulos y permisos de cada rol."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""SELECT rol, modulo, puede_ver, puede_editar,
                       COALESCE(puede_eliminar, FALSE) as puede_eliminar
                       FROM goti.rol_modulos ORDER BY rol, modulo""")
        rows = cur.fetchall()
        result = {}
        for r in rows:
            result.setdefault(r['rol'], {})[r['modulo']] = {
                'ver': r['puede_ver'], 'editar': r['puede_editar'], 'eliminar': r['puede_eliminar']
            }
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


@app.route('/api/admin/roles', methods=['PUT'])
def admin_guardar_roles():
    """Guarda permisos de un rol. Body: { admin_user, admin_pass, rol, modulos: { modulo: {ver,editar,eliminar} } }"""
    data = request.json
    conn, err, code = _require_admin(data)
    if err:
        return err, code
    try:
        cur = conn.cursor()
        rol = data.get('rol', '').strip().lower()
        modulos = data.get('modulos', {})
        if rol not in ('subgerente', 'supervisor', 'gerente', 'admin'):
            return jsonify({'error': 'Rol invalido'}), 400
        cur.execute("DELETE FROM goti.rol_modulos WHERE rol = %s", (rol,))
        for mod, perms in modulos.items():
            ver = perms.get('ver', False)
            editar = perms.get('editar', False)
            eliminar = perms.get('eliminar', False)
            if ver or editar or eliminar:
                cur.execute("""INSERT INTO goti.rol_modulos (rol, modulo, puede_ver, puede_editar, puede_eliminar)
                               VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                            (rol, mod, ver, editar, eliminar))
        conn.commit()
        return jsonify({'success': True, 'message': f'Permisos de {rol} actualizados'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        release_db(conn)


@app.route('/api/admin/usuarios/<int:uid>/reenviar', methods=['POST'])
def admin_reenviar_invitacion(uid):
    """Genera nuevo token y reenvia email de invitacion."""
    data = request.json
    conn, err, code = _require_admin(data)
    if err:
        return err, code
    try:
        cur = conn.cursor()
        cur.execute("SELECT username, nombre, email FROM goti.usuarios WHERE id = %s", (uid,))
        user = cur.fetchone()
        if not user:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        if not user['email']:
            return jsonify({'error': 'El usuario no tiene email configurado'}), 400

        token = secrets.token_urlsafe(32)
        token_expires = (datetime.utcnow() + timedelta(hours=48)).isoformat()
        cur.execute("""UPDATE goti.usuarios
                       SET invite_token = %s, invite_token_expires = %s
                       WHERE id = %s""", (token, token_expires, uid))
        conn.commit()

        _enviar_email_invitacion(user['email'], user['nombre'], user['username'], token)
        return jsonify({'success': True, 'message': f'Invitacion reenviada a {user["email"]}'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        release_db(conn)


PAGINA_ESTABLECER_CLAVE = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Establecer Contrasena - FOODIX</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #F8FAFC; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(15,23,42,0.08); max-width: 420px; width: 100%; padding: 40px 32px; }
        .logo { text-align: center; margin-bottom: 28px; }
        .logo h1 { color: #123450; font-size: 24px; }
        .logo p { color: #64748B; font-size: 13px; margin-top: 4px; }
        .info { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
        .info p { color: #1E40AF; font-size: 13px; line-height: 1.5; }
        .info strong { color: #123450; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-size: 12px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
        .form-group input { width: 100%; padding: 12px 14px; border: 1px solid #CBD5E1; border-radius: 10px; font-size: 14px; font-family: inherit; transition: border 0.2s; }
        .form-group input:focus { outline: none; border-color: #123450; box-shadow: 0 0 0 3px rgba(18,52,80,0.1); }
        .btn { width: 100%; padding: 14px; background: #123450; color: #fff; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn:hover { background: #1a4a6e; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .msg { text-align: center; padding: 12px; border-radius: 8px; margin-top: 16px; font-size: 13px; display: none; }
        .msg.ok { display: block; background: #D1FAE5; color: #065F46; }
        .msg.err { display: block; background: #FEE2E2; color: #991B1B; }
        .success-card { text-align: center; }
        .success-card .icon { font-size: 48px; margin-bottom: 16px; }
        .success-card a { display: inline-block; margin-top: 20px; padding: 12px 28px; background: #123450; color: #fff; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; }
        .success-card a:hover { background: #1a4a6e; }
    </style>
</head>
<body>
    <div class="card" id="form-card">
        <div class="logo">
            <h1>FOODIX</h1>
            <p>Sistema de Inventario</p>
        </div>
        <div class="info">
            <p>Hola <strong>{{ nombre }}</strong>, establece la contrasena para tu usuario <strong>{{ username }}</strong></p>
        </div>
        <form id="set-pass-form" onsubmit="return guardar(event)">
            <div class="form-group">
                <label>Nueva contrasena</label>
                <input type="password" id="pass1" placeholder="Minimo 4 caracteres" required minlength="4">
            </div>
            <div class="form-group">
                <label>Confirmar contrasena</label>
                <input type="password" id="pass2" placeholder="Repite la contrasena" required minlength="4">
            </div>
            <button type="submit" class="btn" id="btn-guardar">Establecer contrasena</button>
        </form>
        <div id="msg" class="msg"></div>
    </div>
    <div class="card success-card" id="success-card" style="display:none;">
        <div class="icon">&#10004;</div>
        <h2 style="color:#065F46;font-size:20px;">Contrasena establecida</h2>
        <p style="color:#64748B;margin-top:8px;font-size:14px;">Ya puedes iniciar sesion con tu usuario y contrasena.</p>
        <a href="/">Ir al sistema</a>
    </div>
    <script>
    async function guardar(e) {
        e.preventDefault();
        const p1 = document.getElementById('pass1').value;
        const p2 = document.getElementById('pass2').value;
        const msg = document.getElementById('msg');
        if (p1 !== p2) { msg.className = 'msg err'; msg.textContent = 'Las contrasenas no coinciden'; return false; }
        document.getElementById('btn-guardar').disabled = true;
        try {
            const r = await fetch('/api/establecer-clave', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({token: '{{ token }}', password: p1})
            });
            const d = await r.json();
            if (r.ok && d.success) {
                document.getElementById('form-card').style.display = 'none';
                document.getElementById('success-card').style.display = 'block';
            } else {
                msg.className = 'msg err'; msg.textContent = d.error || 'Error al guardar';
                document.getElementById('btn-guardar').disabled = false;
            }
        } catch(err) {
            msg.className = 'msg err'; msg.textContent = 'Error de conexion';
            document.getElementById('btn-guardar').disabled = false;
        }
        return false;
    }
    </script>
</body>
</html>
"""

PAGINA_TOKEN_INVALIDO = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enlace invalido - FOODIX</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #F8FAFC; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(15,23,42,0.08); max-width: 420px; width: 100%; padding: 40px 32px; text-align: center; }
        .icon { font-size: 48px; margin-bottom: 16px; }
        h2 { color: #991B1B; font-size: 20px; }
        p { color: #64748B; margin-top: 8px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">&#10060;</div>
        <h2>Enlace invalido o expirado</h2>
        <p>Pide al administrador que te reenvie la invitacion.</p>
    </div>
</body>
</html>
"""


@app.route('/api/establecer-clave', methods=['POST'])
def api_establecer_clave():
    """Endpoint para guardar la contrasena desde el formulario publico."""
    data = request.json or {}
    token = data.get('token', '')
    password = data.get('password', '')

    if not token or not password:
        return jsonify({'error': 'Token y contrasena requeridos'}), 400
    if len(password) < 4:
        return jsonify({'error': 'La contrasena debe tener al menos 4 caracteres'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""SELECT id, invite_token_expires FROM goti.usuarios
                       WHERE invite_token = %s AND activo = TRUE""", (token,))
        user = cur.fetchone()
        if not user:
            return jsonify({'error': 'Enlace invalido'}), 404
        if user['invite_token_expires'] and user['invite_token_expires'] < datetime.utcnow():
            return jsonify({'error': 'Enlace expirado. Pide al administrador que lo reenvie.'}), 410

        cur.execute("""UPDATE goti.usuarios
                       SET password = %s, invite_token = NULL, invite_token_expires = NULL
                       WHERE id = %s""", (password, user['id']))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            release_db(conn)


# ==================== DESCUENTOS NOMINA ====================

@app.route('/api/descuentos/reporte', methods=['GET'])
def descuentos_reporte():
    """Reporte de descuentos por persona en un rango de fechas (semanas cerradas)"""
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local', '')
    solo_cerradas = request.args.get('solo_cerradas', '1')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        params = []
        where = ""
        if fecha_desde:
            where += " AND s.fecha_inicio >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            where += " AND s.fecha_fin <= %s"; params.append(fecha_hasta)
        if local:
            where += " AND s.local = %s"; params.append(local)
        if solo_cerradas == '1':
            where += " AND s.estado = 'cerrada'"

        # Detalle por persona, semana, local y producto
        cur.execute(f"""
            SELECT ap.persona,
                   s.fecha_inicio, s.fecha_fin, s.local,
                   a.codigo, a.nombre, a.unidad,
                   ap.cantidad, ap.monto,
                   a.costo_unitario, a.diferencia_semanal
            FROM goti.asignacion_semanal_personas ap
            JOIN goti.asignacion_semanal a ON a.id = ap.asignacion_semanal_id
            JOIN goti.semanas_inventario s ON s.id = a.semana_id
            WHERE 1=1 {where}
            ORDER BY ap.persona, s.fecha_inicio, s.local, a.nombre
        """, params)
        detalle = [dict(r) for r in cur.fetchall()]

        # Resumen por persona
        cur.execute(f"""
            SELECT ap.persona,
                   COUNT(DISTINCT s.id) as semanas,
                   COUNT(DISTINCT s.local) as locales,
                   COALESCE(SUM(ap.monto), 0) as total_monto
            FROM goti.asignacion_semanal_personas ap
            JOIN goti.asignacion_semanal a ON a.id = ap.asignacion_semanal_id
            JOIN goti.semanas_inventario s ON s.id = a.semana_id
            WHERE 1=1 {where}
            GROUP BY ap.persona
            ORDER BY total_monto DESC
        """, params)
        resumen = [dict(r) for r in cur.fetchall()]

        # Semanas incluidas
        cur.execute(f"""
            SELECT DISTINCT s.fecha_inicio, s.fecha_fin, s.local, s.estado
            FROM goti.semanas_inventario s
            JOIN goti.asignacion_semanal a ON a.semana_id = s.id
            JOIN goti.asignacion_semanal_personas ap ON ap.asignacion_semanal_id = a.id
            WHERE 1=1 {where}
            ORDER BY s.fecha_inicio, s.local
        """, params)
        semanas = [dict(r) for r in cur.fetchall()]

        return jsonify({
            'resumen': resumen,
            'detalle': detalle,
            'semanas': semanas,
            'total_personas': len(resumen),
            'total_descuento': sum(float(r['total_monto']) for r in resumen)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/descuentos/exportar-excel', methods=['GET'])
def descuentos_exportar_excel():
    """Exporta el reporte de descuentos a Excel"""
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local', '')
    solo_cerradas = request.args.get('solo_cerradas', '1')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        params = []
        where = ""
        if fecha_desde:
            where += " AND s.fecha_inicio >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            where += " AND s.fecha_fin <= %s"; params.append(fecha_hasta)
        if local:
            where += " AND s.local = %s"; params.append(local)
        if solo_cerradas == '1':
            where += " AND s.estado = 'cerrada'"

        # Resumen por persona
        cur.execute(f"""
            SELECT ap.persona,
                   COUNT(DISTINCT s.id) as semanas,
                   COALESCE(SUM(ap.monto), 0) as total_monto
            FROM goti.asignacion_semanal_personas ap
            JOIN goti.asignacion_semanal a ON a.id = ap.asignacion_semanal_id
            JOIN goti.semanas_inventario s ON s.id = a.semana_id
            WHERE 1=1 {where}
            GROUP BY ap.persona
            ORDER BY ap.persona
        """, params)
        resumen = cur.fetchall()

        # Detalle
        cur.execute(f"""
            SELECT ap.persona, s.fecha_inicio, s.fecha_fin, s.local,
                   a.codigo, a.nombre, ap.cantidad, ap.monto, a.costo_unitario
            FROM goti.asignacion_semanal_personas ap
            JOIN goti.asignacion_semanal a ON a.id = ap.asignacion_semanal_id
            JOIN goti.semanas_inventario s ON s.id = a.semana_id
            WHERE 1=1 {where}
            ORDER BY ap.persona, s.fecha_inicio, s.local
        """, params)
        detalle = cur.fetchall()

        wb = Workbook()
        # Hoja 1: Resumen por persona
        ws1 = wb.active
        ws1.title = "Resumen Descuentos"
        headers1 = ['Persona', 'Semanas', 'Total Descuento']
        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="123450", end_color="123450", fill_type="solid")
        for col, h in enumerate(headers1, 1):
            c = ws1.cell(row=1, column=col, value=h)
            c.font = header_font; c.fill = header_fill
            c.alignment = Alignment(horizontal='center')
        total_gen = 0
        for i, r in enumerate(resumen, 2):
            ws1.cell(row=i, column=1, value=r['persona'])
            ws1.cell(row=i, column=2, value=int(r['semanas']))
            monto = float(r['total_monto'])
            ws1.cell(row=i, column=3, value=round(monto, 2)).number_format = '$#,##0.00'
            total_gen += monto
        # Fila total
        row_total = len(resumen) + 2
        ws1.cell(row=row_total, column=1, value='TOTAL').font = Font(bold=True, size=12)
        ws1.cell(row=row_total, column=3, value=round(total_gen, 2)).font = Font(bold=True, size=12)
        ws1.cell(row=row_total, column=3).number_format = '$#,##0.00'
        ws1.column_dimensions['A'].width = 35
        ws1.column_dimensions['B'].width = 12
        ws1.column_dimensions['C'].width = 18

        # Hoja 2: Detalle
        ws2 = wb.create_sheet("Detalle")
        headers2 = ['Persona', 'Semana Inicio', 'Semana Fin', 'Local', 'Codigo', 'Producto', 'Cantidad', 'Monto', 'Costo Unit.']
        for col, h in enumerate(headers2, 1):
            c = ws2.cell(row=1, column=col, value=h)
            c.font = header_font; c.fill = header_fill
            c.alignment = Alignment(horizontal='center')
        for i, r in enumerate(detalle, 2):
            ws2.cell(row=i, column=1, value=r['persona'])
            ws2.cell(row=i, column=2, value=str(r['fecha_inicio']))
            ws2.cell(row=i, column=3, value=str(r['fecha_fin']))
            ws2.cell(row=i, column=4, value=BODEGAS_NOMBRES.get(r['local'], r['local']))
            ws2.cell(row=i, column=5, value=r['codigo'])
            ws2.cell(row=i, column=6, value=r['nombre'])
            ws2.cell(row=i, column=7, value=float(r['cantidad'] or 0))
            ws2.cell(row=i, column=8, value=round(float(r['monto'] or 0), 2)).number_format = '$#,##0.00'
            ws2.cell(row=i, column=9, value=round(float(r['costo_unitario'] or 0), 4)).number_format = '$#,##0.0000'
        for col_letter in ['A','B','C','D','E','F','G','H','I']:
            ws2.column_dimensions[col_letter].width = 18 if col_letter in ['A','F'] else 14

        rango = f"{fecha_desde or 'inicio'}_a_{fecha_hasta or 'fin'}"
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                         as_attachment=True, download_name=f'Descuentos_Nomina_{rango}.xlsx')
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


# ==================== CUADRES DE CAJA ====================

@app.route('/api/cuadres/listar', methods=['GET'])
def cuadres_listar():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local', '')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = "SELECT * FROM goti.cuadres_caja WHERE 1=1"
        params = []
        if fecha_desde:
            sql += " AND fecha >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            sql += " AND fecha <= %s"; params.append(fecha_hasta)
        if local:
            sql += " AND local = %s"; params.append(local)
        sql += " ORDER BY fecha DESC, local"
        cur.execute(sql, params)
        rows = cur.fetchall()
        return jsonify({'cuadres': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/cuadres/guardar', methods=['POST'])
def cuadres_guardar():
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')
    if not fecha or not local:
        return jsonify({'error': 'Fecha y local requeridos'}), 400
    venta_sistema = float(data.get('venta_sistema', 0))
    efectivo_contado = float(data.get('efectivo_contado', 0))
    venta_tarjeta = float(data.get('venta_tarjeta', 0))
    venta_transferencia = float(data.get('venta_transferencia', 0))
    venta_plataformas = float(data.get('venta_plataformas', 0))
    otros_ingresos = float(data.get('otros_ingresos', 0))
    gastos_retiros = float(data.get('gastos_retiros', 0))
    efectivo_esperado = venta_sistema - venta_tarjeta - venta_transferencia - venta_plataformas + otros_ingresos - gastos_retiros
    diferencia = efectivo_contado - efectivo_esperado
    observacion = data.get('observacion', '')
    registrado_por = data.get('registrado_por', '')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.cuadres_caja (fecha, local, venta_sistema, efectivo_contado, venta_tarjeta,
                venta_transferencia, venta_plataformas, otros_ingresos, gastos_retiros,
                efectivo_esperado, diferencia, observacion, registrado_por)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (fecha, local) DO UPDATE SET
                venta_sistema=EXCLUDED.venta_sistema, efectivo_contado=EXCLUDED.efectivo_contado,
                venta_tarjeta=EXCLUDED.venta_tarjeta, venta_transferencia=EXCLUDED.venta_transferencia,
                venta_plataformas=EXCLUDED.venta_plataformas, otros_ingresos=EXCLUDED.otros_ingresos,
                gastos_retiros=EXCLUDED.gastos_retiros, efectivo_esperado=EXCLUDED.efectivo_esperado,
                diferencia=EXCLUDED.diferencia, observacion=EXCLUDED.observacion,
                registrado_por=EXCLUDED.registrado_por
            RETURNING id
        """, (fecha, local, venta_sistema, efectivo_contado, venta_tarjeta,
              venta_transferencia, venta_plataformas, otros_ingresos, gastos_retiros,
              efectivo_esperado, diferencia, observacion, registrado_por))
        row = cur.fetchone()
        conn.commit()
        return jsonify({'success': True, 'id': row['id']})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/cuadres/<int:cuadre_id>', methods=['DELETE'])
def cuadres_eliminar(cuadre_id):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM goti.cuadres_caja WHERE id = %s", (cuadre_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/cuadres/resumen', methods=['GET'])
def cuadres_resumen():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        params = []
        where = ""
        if fecha_desde:
            where += " AND fecha >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            where += " AND fecha <= %s"; params.append(fecha_hasta)
        cur.execute(f"""
            SELECT COUNT(*) as total,
                   COALESCE(SUM(ABS(diferencia)),0) as total_diferencia,
                   COALESCE(AVG(diferencia),0) as avg_diferencia,
                   COALESCE(SUM(venta_sistema),0) as total_ventas,
                   COUNT(CASE WHEN ABS(diferencia) > 1 THEN 1 END) as con_descuadre
            FROM goti.cuadres_caja WHERE 1=1 {where}
        """, params)
        resumen = dict(cur.fetchone())
        cur.execute(f"""
            SELECT local, COUNT(*) as cuadres, COALESCE(SUM(diferencia),0) as diferencia_total,
                   COALESCE(SUM(ABS(diferencia)),0) as diferencia_abs,
                   COALESCE(AVG(diferencia),0) as diferencia_avg
            FROM goti.cuadres_caja WHERE 1=1 {where}
            GROUP BY local ORDER BY diferencia_abs DESC
        """, params)
        resumen['por_local'] = [dict(r) for r in cur.fetchall()]
        return jsonify(resumen)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


# ==================== DELIVERY / PLATAFORMAS ====================

@app.route('/api/delivery/listar', methods=['GET'])
def delivery_listar():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local', '')
    plataforma = request.args.get('plataforma', '')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = "SELECT * FROM goti.delivery_liquidaciones WHERE 1=1"
        params = []
        if fecha_desde:
            sql += " AND fecha >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            sql += " AND fecha <= %s"; params.append(fecha_hasta)
        if local:
            sql += " AND local = %s"; params.append(local)
        if plataforma:
            sql += " AND plataforma = %s"; params.append(plataforma)
        sql += " ORDER BY fecha DESC, local, plataforma"
        cur.execute(sql, params)
        rows = cur.fetchall()
        return jsonify({'liquidaciones': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/delivery/guardar', methods=['POST'])
def delivery_guardar():
    data = request.json
    fecha = data.get('fecha')
    local = data.get('local')
    plataforma = data.get('plataforma')
    if not fecha or not local or not plataforma:
        return jsonify({'error': 'Fecha, local y plataforma requeridos'}), 400
    venta_bruta = float(data.get('venta_bruta', 0))
    comision_pct = float(data.get('comision_pct', 0))
    comision_monto = float(data.get('comision_monto', 0))
    iva_comision = float(data.get('iva_comision', 0))
    propinas = float(data.get('propinas', 0))
    ajustes = float(data.get('ajustes', 0))
    neto_recibir = venta_bruta - comision_monto - iva_comision + propinas + ajustes
    depositado_real = float(data.get('depositado_real', 0))
    diferencia = depositado_real - neto_recibir
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.delivery_liquidaciones (fecha, local, plataforma, total_pedidos,
                venta_bruta, comision_pct, comision_monto, iva_comision, propinas, ajustes,
                neto_recibir, depositado_real, diferencia, referencia, observacion, registrado_por)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (fecha, local, plataforma, int(data.get('total_pedidos', 0)),
              venta_bruta, comision_pct, comision_monto, iva_comision, propinas, ajustes,
              neto_recibir, depositado_real, diferencia,
              data.get('referencia', ''), data.get('observacion', ''), data.get('registrado_por', '')))
        row = cur.fetchone()
        conn.commit()
        return jsonify({'success': True, 'id': row['id']})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/delivery/<int:liq_id>', methods=['DELETE'])
def delivery_eliminar(liq_id):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM goti.delivery_liquidaciones WHERE id = %s", (liq_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/delivery/resumen', methods=['GET'])
def delivery_resumen():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        params = []
        where = ""
        if fecha_desde:
            where += " AND fecha >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            where += " AND fecha <= %s"; params.append(fecha_hasta)
        cur.execute(f"""
            SELECT COUNT(*) as total, COALESCE(SUM(venta_bruta),0) as total_ventas,
                   COALESCE(SUM(comision_monto),0) as total_comisiones,
                   COALESCE(SUM(neto_recibir),0) as total_neto,
                   COALESCE(SUM(depositado_real),0) as total_depositado,
                   COALESCE(SUM(ABS(diferencia)),0) as total_diferencia,
                   COALESCE(SUM(total_pedidos),0) as total_pedidos
            FROM goti.delivery_liquidaciones WHERE 1=1 {where}
        """, params)
        resumen = dict(cur.fetchone())
        cur.execute(f"""
            SELECT plataforma, COUNT(*) as liquidaciones, COALESCE(SUM(venta_bruta),0) as ventas,
                   COALESCE(SUM(comision_monto),0) as comisiones,
                   COALESCE(AVG(comision_pct),0) as comision_pct_avg,
                   COALESCE(SUM(ABS(diferencia)),0) as diferencia_abs,
                   COALESCE(SUM(total_pedidos),0) as pedidos
            FROM goti.delivery_liquidaciones WHERE 1=1 {where}
            GROUP BY plataforma ORDER BY ventas DESC
        """, params)
        resumen['por_plataforma'] = [dict(r) for r in cur.fetchall()]
        cur.execute(f"""
            SELECT local, COUNT(*) as liquidaciones, COALESCE(SUM(venta_bruta),0) as ventas,
                   COALESCE(SUM(ABS(diferencia)),0) as diferencia_abs
            FROM goti.delivery_liquidaciones WHERE 1=1 {where}
            GROUP BY local ORDER BY ventas DESC
        """, params)
        resumen['por_local'] = [dict(r) for r in cur.fetchall()]
        return jsonify(resumen)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


# ==================== REGISTRO DE FACTURAS ====================

@app.route('/api/facturas/listar', methods=['GET'])
def facturas_listar():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    local = request.args.get('local', '')
    categoria = request.args.get('categoria', '')
    estado_pago = request.args.get('estado_pago', '')
    proveedor = request.args.get('proveedor', '')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = "SELECT * FROM goti.facturas_registro WHERE 1=1"
        params = []
        if fecha_desde:
            sql += " AND fecha_emision >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            sql += " AND fecha_emision <= %s"; params.append(fecha_hasta)
        if local:
            sql += " AND local = %s"; params.append(local)
        if categoria:
            sql += " AND categoria = %s"; params.append(categoria)
        if estado_pago:
            sql += " AND estado_pago = %s"; params.append(estado_pago)
        if proveedor:
            sql += " AND proveedor ILIKE %s"; params.append(f'%{proveedor}%')
        sql += " ORDER BY fecha_emision DESC, local"
        cur.execute(sql, params)
        rows = cur.fetchall()
        return jsonify({'facturas': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/facturas/guardar', methods=['POST'])
def facturas_guardar():
    data = request.json
    fecha = data.get('fecha_emision')
    local = data.get('local')
    proveedor = data.get('proveedor')
    if not fecha or not local or not proveedor:
        return jsonify({'error': 'Fecha, local y proveedor requeridos'}), 400
    subtotal_0 = float(data.get('subtotal_0', 0))
    subtotal_iva = float(data.get('subtotal_iva', 0))
    iva = float(data.get('iva', 0))
    total = subtotal_0 + subtotal_iva + iva
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.facturas_registro (fecha_emision, local, proveedor, ruc, numero_factura,
                autorizacion, subtotal_0, subtotal_iva, iva, total, categoria, forma_pago,
                estado_pago, observacion, registrado_por)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (fecha, local, proveedor, data.get('ruc',''), data.get('numero_factura',''),
              data.get('autorizacion',''), subtotal_0, subtotal_iva, iva, total,
              data.get('categoria','Otros'), data.get('forma_pago','Transferencia'),
              data.get('estado_pago','Pendiente'), data.get('observacion',''),
              data.get('registrado_por','')))
        row = cur.fetchone()
        conn.commit()
        return jsonify({'success': True, 'id': row['id']})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/facturas/<int:factura_id>', methods=['PUT'])
def facturas_actualizar(factura_id):
    data = request.json
    estado_pago = data.get('estado_pago')
    if not estado_pago:
        return jsonify({'error': 'estado_pago requerido'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("UPDATE goti.facturas_registro SET estado_pago = %s WHERE id = %s", (estado_pago, factura_id))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/facturas/<int:factura_id>', methods=['DELETE'])
def facturas_eliminar(factura_id):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM goti.facturas_registro WHERE id = %s", (factura_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)

@app.route('/api/facturas/resumen', methods=['GET'])
def facturas_resumen():
    fecha_desde = request.args.get('fecha_desde')
    fecha_hasta = request.args.get('fecha_hasta')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        params = []
        where = ""
        if fecha_desde:
            where += " AND fecha_emision >= %s"; params.append(fecha_desde)
        if fecha_hasta:
            where += " AND fecha_emision <= %s"; params.append(fecha_hasta)
        cur.execute(f"""
            SELECT COUNT(*) as total, COALESCE(SUM(total),0) as total_facturado,
                   COALESCE(SUM(iva),0) as total_iva,
                   COUNT(CASE WHEN estado_pago = 'Pendiente' THEN 1 END) as pendientes,
                   COALESCE(SUM(CASE WHEN estado_pago = 'Pendiente' THEN total ELSE 0 END),0) as monto_pendiente
            FROM goti.facturas_registro WHERE 1=1 {where}
        """, params)
        resumen = dict(cur.fetchone())
        cur.execute(f"""
            SELECT categoria, COUNT(*) as facturas, COALESCE(SUM(total),0) as monto
            FROM goti.facturas_registro WHERE 1=1 {where}
            GROUP BY categoria ORDER BY monto DESC
        """, params)
        resumen['por_categoria'] = [dict(r) for r in cur.fetchall()]
        cur.execute(f"""
            SELECT local, COUNT(*) as facturas, COALESCE(SUM(total),0) as monto,
                   COUNT(CASE WHEN estado_pago = 'Pendiente' THEN 1 END) as pendientes
            FROM goti.facturas_registro WHERE 1=1 {where}
            GROUP BY local ORDER BY monto DESC
        """, params)
        resumen['por_local'] = [dict(r) for r in cur.fetchall()]
        return jsonify(resumen)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


# ==================== CONFIG PRODUCTOS POR MARCA ====================

@app.route('/api/admin/productos-marca', methods=['GET'])
def listar_productos_marca():
    """Lista productos configurados para una marca"""
    marca = request.args.get('marca', '')
    if not marca:
        return jsonify({'error': 'Marca requerida'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goti.productos_por_marca (
                id SERIAL PRIMARY KEY,
                marca VARCHAR(50) NOT NULL,
                codigo VARCHAR(20) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                activo BOOLEAN DEFAULT TRUE,
                unidad VARCHAR(30) DEFAULT 'Unidad',
                equivalencia NUMERIC(12,4) DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(marca, codigo)
            )
        """)
        conn.commit()
        # Asegurar columnas nuevas existan
        cur.execute("ALTER TABLE goti.productos_por_marca ADD COLUMN IF NOT EXISTS unidad VARCHAR(30) DEFAULT 'Unidad'")
        cur.execute("ALTER TABLE goti.productos_por_marca ADD COLUMN IF NOT EXISTS equivalencia NUMERIC(12,4) DEFAULT 1")
        cur.execute("ALTER TABLE goti.productos_por_marca ADD COLUMN IF NOT EXISTS tipo_conteo VARCHAR(20) DEFAULT 'diario'")
        conn.commit()
        cur.execute("""
            SELECT id, marca, codigo, nombre, activo, unidad, equivalencia, tipo_conteo, created_at
            FROM goti.productos_por_marca
            WHERE marca = %s
            ORDER BY codigo
        """, (marca,))
        productos = [dict(r) for r in cur.fetchall()]
        return jsonify(productos)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/admin/productos-marca', methods=['POST'])
def agregar_producto_marca():
    """Agrega un producto a una marca"""
    data = request.json
    marca = data.get('marca', '').strip()
    codigo = data.get('codigo', '').strip().upper()
    nombre = data.get('nombre', '').strip().upper()
    unidad = data.get('unidad', 'Unidad').strip()
    equivalencia = data.get('equivalencia', 1)
    tipo_conteo = data.get('tipo_conteo', 'diario').strip()
    if tipo_conteo not in ('diario', 'cruce', 'ambos'):
        tipo_conteo = 'diario'
    if not marca or not codigo or not nombre:
        return jsonify({'error': 'marca, codigo y nombre son requeridos'}), 400
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.productos_por_marca (marca, codigo, nombre, activo, unidad, equivalencia, tipo_conteo)
            VALUES (%s, %s, %s, TRUE, %s, %s, %s)
            ON CONFLICT (marca, codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE, unidad = EXCLUDED.unidad, equivalencia = EXCLUDED.equivalencia, tipo_conteo = EXCLUDED.tipo_conteo
            RETURNING id, marca, codigo, nombre, activo, unidad, equivalencia, tipo_conteo
        """, (marca, codigo, nombre, unidad, equivalencia, tipo_conteo))
        conn.commit()
        prod = dict(cur.fetchone())
        return jsonify(prod)
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/admin/productos-marca/<int:prod_id>', methods=['DELETE'])
def eliminar_producto_marca(prod_id):
    """Elimina un producto de la configuracion"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM goti.productos_por_marca WHERE id = %s", (prod_id,))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/admin/productos-marca/<int:prod_id>', methods=['PUT'])
def editar_producto_marca(prod_id):
    """Edita unidad y/o equivalencia de un producto"""
    data = request.json
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        sets = []
        vals = []
        if 'unidad' in data:
            sets.append("unidad = %s")
            vals.append(data['unidad'])
        if 'equivalencia' in data:
            sets.append("equivalencia = %s")
            vals.append(data['equivalencia'])
        if 'nombre' in data:
            sets.append("nombre = %s")
            vals.append(data['nombre'].strip().upper())
        if 'tipo_conteo' in data:
            tc = data['tipo_conteo'].strip()
            if tc not in ('diario', 'cruce', 'ambos'):
                tc = 'diario'
            sets.append("tipo_conteo = %s")
            vals.append(tc)
        if not sets:
            return jsonify({'error': 'Nada que actualizar'}), 400
        vals.append(prod_id)
        cur.execute(f"UPDATE goti.productos_por_marca SET {', '.join(sets)} WHERE id = %s RETURNING id, marca, codigo, nombre, activo, unidad, equivalencia, tipo_conteo", vals)
        conn.commit()
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Producto no encontrado'}), 404
        return jsonify(dict(row))
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/admin/productos-marca/toggle/<int:prod_id>', methods=['PUT'])
def toggle_producto_marca(prod_id):
    """Activa o desactiva un producto"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.productos_por_marca SET activo = NOT activo WHERE id = %s
            RETURNING id, marca, codigo, nombre, activo, unidad, equivalencia, tipo_conteo
        """, (prod_id,))
        conn.commit()
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Producto no encontrado'}), 404
        return jsonify(dict(row))
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/admin/productos-marca/carga-inicial', methods=['POST'])
def carga_inicial_productos():
    """Carga los productos hardcodeados o desde equivalencias_conteo para bodegas operativas"""
    PRODUCTOS_LOCALES = {
        'CHIOS': {
            'ALCH002': 'CLUB PEQ', 'ALMP001': 'PILSENER 600 ML', 'BEB019': 'AGUA DASANI',
            'BEB020': 'GUITIG', 'BEB021': 'COCA PEQ', 'BEB023': 'SPRITE PEQ',
            'BEB025': 'ZERO PEQ', 'BEB029': 'HATSU FRAMBUESA', 'BEB030': 'HATSU UVILLA',
            'CONG003': 'HELADO VAINILLA', 'CONGP001': 'PORTOBELLO PROCESADO',
            'CONGP006': 'PAN DE PORTOBELLO', 'CONGP007': 'PORTOBELLO CHEESE',
            'CONGP020': 'BOLITAS DE PAPA', 'CP001': 'ALAS CRUDAS PAQ',
            'CP002': 'POLLO ESTANDAR PAQ', 'CP003': 'HAMBURGUESA',
            'CP005': 'POLLO BOLDER PAQ', 'CP007': 'HAMBURGUESA SMASH',
            'DOG001': 'HELADO DE PERRO', 'DOG004': 'PUDIN POLLO PEQUENO',
            'DOMP003': 'GALLETA DE PERRO PAQ', 'DUL002': 'OREO', 'DUL013': 'KIT KAT CHOCOLATE',
            'EMB002': 'TOCINO', 'FRU012': 'FRUTILLA PORCIONADA PAQ', 'LAC004': 'HUEVOS',
            'LAC005': 'QUESO AMERICANO', 'LACP002': 'QUESO MOZZARELLA UNIDAD',
            'PASN008': 'PAN PRETZEL', 'PASN012': 'PAN DE PAPA',
        },
        'CACHON': {
            'ALCH001': 'PILSENER PEQ', 'ALCH002': 'CLUB PEQ', 'ALCH004': 'CORONA',
            'ALMP001': 'PILSENER 600 ML', 'BEB019': 'AGUA DASANI', 'BEB020': 'GUITIG',
            'BEB031': 'COCA VIDRIO', 'BEB032': 'SPRITE VIDRIO',
            'BEB035': 'FANTA VIDRIO', 'BEB040': 'FUZE TE VIDRIO', 'BEB048': 'ZERO VIDRIO',
            'BEB049': 'FRESA VIDRIO', 'CP012': 'CHULETA PAQ', 'CP013': 'FILETE DE PECHUGA',
            'CP014': 'PICAÑA A PAQ', 'CP015': 'PICAÑA C PAQ', 'CP016': 'LOMO FINO PAQ',
            'CP017': 'FILETE DE CARNE', 'CP018': 'COSTILLA PAQ', 'EMB013': 'CHISTORRA',
            'EMB012': 'MORCILLA', 'EMB010': 'CHORIZO CON ROMERO', 'EMB011': 'CHORIZO CON ALBAHACA',
            'EMB009': 'CHORIZO CHISTORRA', 'LAC004': 'HUEVOS', 'CP021': 'NEW YORK B PAQ',
            'CP022': 'RIBEYE B PAQ', 'CP023': 'NEW YORK C PAQ', 'CP024': 'RIBEYE C PAQ',
            'ZUM007': 'PULPA DE MARACUYA', 'ZUM008': 'PULPA DE MORA',
            'ZUM009': 'PULPA DE TOMATE DE ARBOL', 'ZUM010': 'PULPA DE NARANJILLA',
            'POST017': 'CHEESE CAKE', 'POST018': 'TRES LECHES',
        },
        'SIMON_BOLON': {
            'ACOM001': 'EMPANADA DE QUESO', 'ACOM002': 'EMPANADA DE CAMARON',
            'ACOM003': 'EMPANADA DE POLLO', 'ACOM005': 'CORVICHE DE ALBACORA',
            'ACOM006': 'MUCHIN', 'ALCH001': 'PILSENER PEQ', 'ALCH002': 'CLUB PEQ',
            'ALCH004': 'CORONA', 'BEB019': 'AGUA DASANI', 'BEB020': 'GUITIG',
            'BEB021': 'COCA PEQ', 'BEB023': 'SPRITE PEQ', 'BEB025': 'ZERO PEQ',
            'BEB031': 'COCA VIDRIO', 'BEB032': 'SPRITE VIDRIO', 'BEB035': 'FANTA VIDRIO',
            'BEB040': 'FUZE TE VIDRIO', 'BEB047': 'FANTA PEQ',
            'CP019': 'ESTOFADO DE CARNE PAQ', 'CP020': 'FRITADA PAQ',
            'DOG001': 'HELADO DE PERRO', 'DOG004': 'PUDIN POLLO PEQUENO',
            'FRU010': 'MORA', 'LAC004': 'HUEVOS',
            'MAR002': 'CAMARON', 'MAR003': 'ALBACORA', 'MAR005': 'CAMARON PAQ 110 GR',
            'MAR006': 'CAMARON PAQ 76 GR', 'PASN010': 'CHIFLES', 'ZUM003': 'ZUMO DE FRESA',
        },
    }
    # Mapeo de marca a bodega en equivalencias_conteo
    BODEGAS_OPERATIVAS_MAP = {
        'BODEGA_PRINCIPAL': 'bodega_principal',
        'MATERIA_PRIMA': 'materia_prima',
        'PLANTA': 'planta',
    }

    marca = request.json.get('marca', '') if request.json else ''
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        total = 0

        # Si es bodega operativa, cargar desde tablas de toma fisica usando INSERT directo
        if marca in BODEGAS_OPERATIVAS_MAP:
            TABLAS_TOMA = {
                'BODEGA_PRINCIPAL': 'public.toma_bodega',
                'MATERIA_PRIMA': 'public.toma_materiaprima',
                'PLANTA': 'public.toma_planta',
            }
            tabla = TABLAS_TOMA.get(marca)
            if tabla:
                # Primero borrar datos incorrectos si existen
                cur.execute("DELETE FROM goti.productos_por_marca WHERE marca = %s", (marca,))

                # INSERT directo desde la tabla de toma (evita problemas de fetch)
                # Usamos subquery con ROW_NUMBER para deduplicar por codigo
                cur.execute(f"""
                    INSERT INTO goti.productos_por_marca (marca, codigo, nombre, activo, unidad, equivalencia)
                    SELECT
                        %s as marca,
                        sub.codigo,
                        sub.producto,
                        TRUE as activo,
                        COALESCE(sub.unidad, 'Unidad') as unidad,
                        CASE WHEN LOWER(COALESCE(sub.unidad,'')) LIKE '%%kg%%' THEN 1000 ELSE 1 END as equivalencia
                    FROM (
                        SELECT codigo, producto, unidad,
                               ROW_NUMBER() OVER (PARTITION BY codigo ORDER BY fecha DESC) as rn
                        FROM {tabla}
                        WHERE fecha >= CURRENT_DATE - INTERVAL '90 days'
                          AND codigo IS NOT NULL AND codigo != ''
                    ) sub
                    WHERE sub.rn = 1
                    ON CONFLICT (marca, codigo) DO UPDATE
                    SET nombre = EXCLUDED.nombre, unidad = EXCLUDED.unidad
                """, (marca,))
                total = cur.rowcount
        else:
            # Cargar desde lista hardcodeada para locales
            marcas_cargar = [marca] if marca else list(PRODUCTOS_LOCALES.keys())
            for m in marcas_cargar:
                if m not in PRODUCTOS_LOCALES:
                    continue
                for codigo, nombre in PRODUCTOS_LOCALES[m].items():
                    cur.execute("""
                        INSERT INTO goti.productos_por_marca (marca, codigo, nombre, activo)
                        VALUES (%s, %s, %s, TRUE)
                        ON CONFLICT (marca, codigo) DO NOTHING
                    """, (m, codigo, nombre))
                    total += 1

        conn.commit()
        return jsonify({'ok': True, 'insertados': total})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/admin/productos-marca/fix-equivalencias-kg', methods=['POST'])
def fix_equivalencias_kg():
    """Pone equivalencia=1000 a todos los productos con unidad Kg, excepto DETERGENTE y JACK DANIELS"""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        # Actualizar equivalencia a 1000 para productos en Kg/Kilogramos SOLO en bodegas operativas
        cur.execute("""
            UPDATE goti.productos_por_marca
            SET equivalencia = 1000
            WHERE marca IN ('BODEGA_PRINCIPAL', 'MATERIA_PRIMA', 'PLANTA')
              AND (LOWER(unidad) LIKE '%kg%' OR LOWER(unidad) LIKE '%kilogramo%')
              AND UPPER(nombre) NOT LIKE '%DETERGENTE%'
              AND UPPER(nombre) NOT LIKE '%JACK DANIEL%'
        """)
        actualizados = cur.rowcount
        conn.commit()
        return jsonify({'ok': True, 'actualizados': actualizados})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: release_db(conn)


# ============================================================
# MODULO FLUJO DE CAJA
# ============================================================

def fc_get_movimientos_db():
    """Conexion a BD movimientos con reintentos"""
    import time
    max_retries = 3
    for attempt in range(max_retries):
        try:
            # Intentar pool primero
            try:
                conn = _get_movimientos_pool().getconn()
                conn.cursor().execute("SELECT 1")
                conn.rollback()
                return conn
            except Exception:
                pass

            # Fallback a conexion directa
            conn = psycopg2.connect(
                host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
                database='movimientos',
                user=os.environ.get('DB_USER', 'adminChios'),
                password=os.environ.get('DB_PASSWORD', 'Burger2023'),
                port=os.environ.get('DB_PORT', '5432'),
                sslmode='require',
                connect_timeout=15
            )
            return conn
        except Exception as e:
            print(f"fc_get_movimientos_db intento {attempt+1}/{max_retries}: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)

    # Ultimo intento
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
        database='movimientos',
        user=os.environ.get('DB_USER', 'adminChios'),
        password=os.environ.get('DB_PASSWORD', 'Burger2023'),
        port=os.environ.get('DB_PORT', '5432'),
        sslmode='require',
        connect_timeout=20
    )

def fc_release_movimientos_db(conn):
    """Libera conexion de movimientos al pool"""
    try:
        if conn and not conn.closed:
            _get_movimientos_pool().putconn(conn)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass

def fc_dia_deposito_tc(fecha_venta):
    """Calcula dia de deposito TC (2 dias habiles)"""
    dia = fecha_venta.weekday()
    if dia == 0: return fecha_venta + timedelta(days=2)  # Lun->Mie
    elif dia == 1: return fecha_venta + timedelta(days=2)  # Mar->Jue
    elif dia == 2: return fecha_venta + timedelta(days=2)  # Mie->Vie
    elif dia == 3: return fecha_venta + timedelta(days=4)  # Jue->Lun
    elif dia == 4: return fecha_venta + timedelta(days=3)  # Vie->Lun
    elif dia == 5: return fecha_venta + timedelta(days=3)  # Sab->Mar
    else: return fecha_venta + timedelta(days=2)  # Dom->Mar

def fc_dia_deposito_efectivo_g1(fecha_cobro):
    """Grupo 1 efectivo: libran Dom/Lun"""
    dia = fecha_cobro.weekday()
    if dia == 0: return fecha_cobro + timedelta(days=1)  # Lun->Mar
    elif dia == 1: return fecha_cobro + timedelta(days=1)  # Mar->Mie
    elif dia == 2: return fecha_cobro + timedelta(days=1)
    elif dia == 3: return fecha_cobro + timedelta(days=1)
    elif dia == 4: return fecha_cobro + timedelta(days=1)
    elif dia == 5: return fecha_cobro + timedelta(days=3)  # Sab->Mar
    else: return fecha_cobro + timedelta(days=2)  # Dom->Mar

def fc_dia_deposito_efectivo_g2(fecha_cobro):
    """Grupo 2 efectivo: libran Lun/Mar"""
    dia = fecha_cobro.weekday()
    if dia == 0: return fecha_cobro + timedelta(days=2)  # Lun->Mie
    elif dia == 1: return fecha_cobro + timedelta(days=1)  # Mar->Mie
    elif dia == 2: return fecha_cobro + timedelta(days=1)
    elif dia == 3: return fecha_cobro + timedelta(days=1)
    elif dia == 4: return fecha_cobro + timedelta(days=1)
    elif dia == 5: return fecha_cobro + timedelta(days=4)  # Sab->Mie
    else: return fecha_cobro + timedelta(days=3)  # Dom->Mie

def fc_dia_deposito_deuna(fecha_cobro):
    """DEUNA deposita en Pichincha dia siguiente (o martes si fin de semana)"""
    dia = fecha_cobro.weekday()
    if dia <= 3: return fecha_cobro + timedelta(days=1)  # Lun-Jue -> dia siguiente
    elif dia == 4: return fecha_cobro + timedelta(days=3)  # Vie->Lun
    elif dia == 5: return fecha_cobro + timedelta(days=3)  # Sab->Mar
    else: return fecha_cobro + timedelta(days=2)  # Dom->Mar

GRUPO1_EFECTIVO = ['REAL', 'FLOREANA', 'PORTUGAL', 'SANTO CACHON PORTUGAL']
GRUPO2_EFECTIVO = ['SIMON BOLON', 'SANTO CACHON REAL']

@app.route('/api/flujo-caja/datos', methods=['GET'])
def flujo_caja_datos():
    """Endpoint para obtener datos de flujo de caja"""
    conn = None
    try:
        # Leer parametros de query
        fecha_param = request.args.get('fecha', '')
        num_semanas = int(request.args.get('semanas', '5'))

        conn = fc_get_movimientos_db()
        cur = conn.cursor()

        # Determinar fecha de inicio (lunes)
        if fecha_param:
            try:
                lunes = datetime.strptime(fecha_param, '%Y-%m-%d').date()
                # Asegurar que sea lunes
                if lunes.weekday() != 0:
                    lunes = lunes - timedelta(days=lunes.weekday())
            except:
                hoy = datetime.now(TZ_ECUADOR).date()
                lunes = hoy - timedelta(days=hoy.weekday())
        else:
            hoy = datetime.now(TZ_ECUADOR).date()
            lunes = hoy - timedelta(days=hoy.weekday())

        fecha_inicio_datos = lunes - timedelta(days=7)

        # Generar semanas
        semanas = []
        fecha_fin_proyeccion = lunes + timedelta(weeks=num_semanas)
        for i in range(num_semanas):
            inicio = lunes + timedelta(weeks=i)
            fin = inicio + timedelta(days=6)
            num = inicio.isocalendar()[1]
            dias = [str(inicio + timedelta(days=j)) for j in range(7)]
            semanas.append({'num': num, 'inicio': str(inicio), 'fin': str(fin), 'dias': dias})

        hoy = datetime.now(TZ_ECUADOR).date()

        # ============ PROMEDIOS HISTORICOS (ultimas 8 semanas) ============
        fecha_hist_inicio = hoy - timedelta(weeks=8)

        # Promedio TC por dia de semana
        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI' AND forma_cobro_pago ILIKE '%%tarjeta%%'
                AND fecha >= %s AND fecha < %s
            )
            SELECT EXTRACT(DOW FROM fecha) as dia_semana, AVG(total) as promedio
            FROM (SELECT fecha, SUM(valor) as total FROM unicos GROUP BY fecha) sub
            GROUP BY dia_semana
        ''', (fecha_hist_inicio, hoy))
        promedios_tc = {int(r[0]): float(r[1]) for r in cur.fetchall()}

        # Promedio Efectivo por dia de semana
        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI' AND forma_cobro_pago = 'Efectivo'
                AND fecha >= %s AND fecha < %s
            )
            SELECT EXTRACT(DOW FROM fecha) as dia_semana, AVG(total) as promedio
            FROM (SELECT fecha, SUM(valor) as total FROM unicos GROUP BY fecha) sub
            GROUP BY dia_semana
        ''', (fecha_hist_inicio, hoy))
        promedios_efectivo = {int(r[0]): float(r[1]) for r in cur.fetchall()}

        # Promedio DEUNA por dia de semana
        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI' AND forma_cobro_pago = 'Transferencia'
                AND cta_afectada = 'BANCO DEUNA' AND fecha >= %s AND fecha < %s
            )
            SELECT EXTRACT(DOW FROM fecha) as dia_semana, AVG(total) as promedio
            FROM (SELECT fecha, SUM(valor) as total FROM unicos GROUP BY fecha) sub
            GROUP BY dia_semana
        ''', (fecha_hist_inicio, hoy))
        promedios_deuna = {int(r[0]): float(r[1]) for r in cur.fetchall()}

        # ============ GENERAR VENTAS PROYECTADAS PARA DIAS SIN DATOS ============
        ventas_tc_proyectadas = {}
        ventas_efectivo_proyectadas = {}
        ventas_deuna_proyectadas = {}

        # Para cada dia desde inicio de datos hasta fin de proyeccion
        # Incluimos dias pasados recientes para que tengan proyecciones si no hay datos
        dia_actual = fecha_inicio_datos
        while dia_actual < fecha_fin_proyeccion:
            dia_str = str(dia_actual)
            dow = dia_actual.weekday()
            # PostgreSQL DOW: 0=domingo, 1=lunes... Python weekday: 0=lunes, 1=martes...
            dow_pg = (dow + 1) % 7  # Convertir a formato PostgreSQL

            # Proyectar todos los dias (pasados y futuros) - luego se filtran los que tienen datos reales
            if dow_pg in promedios_tc:
                ventas_tc_proyectadas[dia_str] = promedios_tc[dow_pg]
            if dow_pg in promedios_efectivo:
                ventas_efectivo_proyectadas[dia_str] = promedios_efectivo[dow_pg]
            if dow_pg in promedios_deuna:
                ventas_deuna_proyectadas[dia_str] = promedios_deuna[dow_pg]

            dia_actual += timedelta(days=1)

        # Obtener ventas TC
        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI' AND forma_cobro_pago ILIKE '%%tarjeta%%' AND fecha >= %s
            )
            SELECT fecha, SUM(valor) as total FROM unicos GROUP BY fecha ORDER BY fecha
        ''', (fecha_inicio_datos,))
        ventas_tc = {str(r[0]): float(r[1]) for r in cur.fetchall()}

        # Agregar ventas proyectadas para dias sin datos
        for fecha_str, total in ventas_tc_proyectadas.items():
            if fecha_str not in ventas_tc:
                ventas_tc[fecha_str] = total

        # Calcular depositos TC (86% neto)
        depositos_tc = {}
        for fecha_str, total in ventas_tc.items():
            fecha = datetime.strptime(fecha_str, '%Y-%m-%d').date()
            fecha_dep = fc_dia_deposito_tc(fecha)
            dep_str = str(fecha_dep)
            if dep_str not in depositos_tc:
                depositos_tc[dep_str] = {'bruto': 0, 'neto': 0}
            depositos_tc[dep_str]['bruto'] += total
            depositos_tc[dep_str]['neto'] += total * 0.86

        # Obtener cobros efectivo
        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, centro_costo, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI' AND forma_cobro_pago = 'Efectivo' AND fecha >= %s
            )
            SELECT fecha, centro_costo, SUM(valor) as total FROM unicos GROUP BY fecha, centro_costo ORDER BY fecha
        ''', (fecha_inicio_datos,))
        cobros_efectivo = {}
        for r in cur.fetchall():
            fecha = str(r[0])
            local = r[1]
            total = float(r[2])
            if fecha not in cobros_efectivo:
                cobros_efectivo[fecha] = {'G1': 0, 'G2': 0}
            if local in GRUPO1_EFECTIVO:
                cobros_efectivo[fecha]['G1'] += total
            elif local in GRUPO2_EFECTIVO:
                cobros_efectivo[fecha]['G2'] += total

        # Agregar efectivo proyectado (dividir 50/50 entre G1 y G2)
        for fecha_str, total in ventas_efectivo_proyectadas.items():
            if fecha_str not in cobros_efectivo:
                cobros_efectivo[fecha_str] = {'G1': total * 0.5, 'G2': total * 0.5}

        # Calcular depositos efectivo
        depositos_efectivo = {}
        for fecha_str, grupos in cobros_efectivo.items():
            fecha = datetime.strptime(fecha_str, '%Y-%m-%d').date()
            if grupos['G1'] > 0:
                dep = str(fc_dia_deposito_efectivo_g1(fecha))
                if dep not in depositos_efectivo:
                    depositos_efectivo[dep] = {'total': 0}
                depositos_efectivo[dep]['total'] += grupos['G1']
            if grupos['G2'] > 0:
                dep = str(fc_dia_deposito_efectivo_g2(fecha))
                if dep not in depositos_efectivo:
                    depositos_efectivo[dep] = {'total': 0}
                depositos_efectivo[dep]['total'] += grupos['G2']

        # Obtener cobros DEUNA
        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI' AND forma_cobro_pago = 'Transferencia'
                AND cta_afectada = 'BANCO DEUNA' AND fecha >= %s
            )
            SELECT fecha, SUM(valor) as total FROM unicos GROUP BY fecha ORDER BY fecha
        ''', (fecha_inicio_datos,))
        cobros_deuna = {str(r[0]): float(r[1]) for r in cur.fetchall()}

        # Agregar DEUNA proyectado
        for fecha_str, total in ventas_deuna_proyectadas.items():
            if fecha_str not in cobros_deuna:
                cobros_deuna[fecha_str] = total

        # Calcular depositos DEUNA
        depositos_deuna = {}
        for fecha_str, total in cobros_deuna.items():
            fecha = datetime.strptime(fecha_str, '%Y-%m-%d').date()
            dep = str(fc_dia_deposito_deuna(fecha))
            if dep not in depositos_deuna:
                depositos_deuna[dep] = {'total': 0}
            depositos_deuna[dep]['total'] += total

        # Calcular totales por semana
        totales_produbanco = {}
        totales_pichincha = {}
        for sem in semanas:
            total_prod = 0
            total_pich = 0
            for dia in sem['dias']:
                total_prod += depositos_tc.get(dia, {}).get('neto', 0)
                total_prod += depositos_efectivo.get(dia, {}).get('total', 0)
                total_pich += depositos_deuna.get(dia, {}).get('total', 0)
            totales_produbanco[sem['num']] = total_prod
            totales_pichincha[sem['num']] = total_pich

        return jsonify({
            'ok': True,
            'semanas': semanas,
            'depositos_tc': depositos_tc,
            'depositos_efectivo': depositos_efectivo,
            'depositos_deuna': depositos_deuna,
            'totales_produbanco': totales_produbanco,
            'totales_pichincha': totales_pichincha
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/guardar', methods=['POST'])
def flujo_caja_guardar():
    """Guardar datos de flujo de caja trabajados"""
    conn = None
    try:
        # Asegurar que las nuevas columnas existan
        conn_temp = fc_get_movimientos_db()
        cur_temp = conn_temp.cursor()
        cur_temp.execute('''
            ALTER TABLE flujo_caja_guardado
            ADD COLUMN IF NOT EXISTS saldo_produbanco NUMERIC(14,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS saldo_pichincha NUMERIC(14,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS plataformas JSONB DEFAULT '{}'::jsonb
        ''')
        conn_temp.commit()
        fc_release_movimientos_db(conn_temp)

        data = request.get_json()
        fecha_semana = data.get('fecha_semana')
        semana_num = data.get('semana_num')
        # Soportar tanto formato viejo (saldo_inicial) como nuevo (saldo_produbanco/pichincha)
        saldo_produbanco = data.get('saldo_produbanco', data.get('saldo_inicial', 0))
        saldo_pichincha = data.get('saldo_pichincha', 0)
        ajustes_tc = json.dumps(data.get('ajustes_tc', {}))
        ajustes_efectivo = json.dumps(data.get('ajustes_efectivo', {}))
        ajustes_deuna = json.dumps(data.get('ajustes_deuna', {}))
        traspasos = json.dumps(data.get('traspasos', {}))
        plataformas = json.dumps(data.get('plataformas', {}))
        egresos_dict = data.get('egresos', {})
        egresos = json.dumps(egresos_dict)
        usuario = data.get('usuario', 'admin')

        # PROTECCION contra perdida de datos: si los egresos entrantes no traen
        # ningun valor/saldo/dias/deuda, NO sobrescribir egresos ya guardados.
        egresos_entrantes_vacios = not any(
            (it.get('valores') or it.get('saldo') or it.get('dias') or it.get('deuda'))
            for items in egresos_dict.values() for it in items
        )

        conn = fc_get_movimientos_db()
        cur = conn.cursor()

        # Upsert: insertar o actualizar si ya existe.
        # Si los egresos entrantes estan vacios y la fila existente tiene datos,
        # se conservan los egresos existentes.
        cur.execute('''
            INSERT INTO flujo_caja_guardado
                (fecha_semana, semana_num, saldo_produbanco, saldo_pichincha, ajustes_tc, ajustes_efectivo,
                 ajustes_deuna, traspasos, plataformas, egresos, created_by, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (fecha_semana) DO UPDATE SET
                semana_num = EXCLUDED.semana_num,
                saldo_produbanco = EXCLUDED.saldo_produbanco,
                saldo_pichincha = EXCLUDED.saldo_pichincha,
                ajustes_tc = EXCLUDED.ajustes_tc,
                ajustes_efectivo = EXCLUDED.ajustes_efectivo,
                ajustes_deuna = EXCLUDED.ajustes_deuna,
                traspasos = EXCLUDED.traspasos,
                plataformas = EXCLUDED.plataformas,
                egresos = CASE
                    WHEN %s AND COALESCE(flujo_caja_guardado.egresos::text, '{}') NOT IN ('{}', 'null')
                    THEN flujo_caja_guardado.egresos
                    ELSE EXCLUDED.egresos
                END,
                updated_at = NOW()
            RETURNING id
        ''', (fecha_semana, semana_num, saldo_produbanco, saldo_pichincha, ajustes_tc, ajustes_efectivo,
              ajustes_deuna, traspasos, plataformas, egresos, usuario, egresos_entrantes_vacios))

        row_id = cur.fetchone()[0]
        conn.commit()

        return jsonify({'ok': True, 'id': row_id, 'mensaje': f'Semana {semana_num} guardada'})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/cargar-guardado', methods=['GET'])
def flujo_caja_cargar_guardado():
    """Cargar datos guardados de flujo de caja para las semanas solicitadas"""
    conn = None
    try:
        fechas = request.args.get('fechas', '')  # Comma-separated list of dates
        if not fechas:
            return jsonify({'ok': True, 'guardados': {}})

        lista_fechas = [f.strip() for f in fechas.split(',')]

        conn = fc_get_movimientos_db()
        cur = conn.cursor()

        # Asegurar que las nuevas columnas existan
        cur.execute('''
            ALTER TABLE flujo_caja_guardado
            ADD COLUMN IF NOT EXISTS saldo_produbanco NUMERIC(14,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS saldo_pichincha NUMERIC(14,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS plataformas JSONB DEFAULT '{}'::jsonb
        ''')
        conn.commit()

        cur.execute('''
            SELECT fecha_semana, semana_num,
                   COALESCE(saldo_produbanco, saldo_inicial, 0) as saldo_produbanco,
                   COALESCE(saldo_pichincha, 0) as saldo_pichincha,
                   ajustes_tc, ajustes_efectivo, ajustes_deuna, traspasos,
                   COALESCE(plataformas, '{}'::jsonb) as plataformas,
                   egresos, updated_at
            FROM flujo_caja_guardado
            WHERE fecha_semana = ANY(%s::date[])
            ORDER BY updated_at ASC NULLS FIRST
        ''', (lista_fechas,))

        guardados = {}
        for row in cur.fetchall():
            fecha_str = str(row[0])
            guardados[fecha_str] = {
                'semana_num': row[1],
                'saldo_produbanco': float(row[2]) if row[2] else 0,
                'saldo_pichincha': float(row[3]) if row[3] else 0,
                'ajustes_tc': row[4] or {},
                'ajustes_efectivo': row[5] or {},
                'ajustes_deuna': row[6] or {},
                'traspasos': row[7] or {},
                'plataformas': row[8] or {},
                'egresos': row[9] or {},
                'updated_at': row[10].isoformat() if row[10] else None
            }

        return jsonify({'ok': True, 'guardados': guardados})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/proveedores', methods=['GET'])
def flujo_caja_proveedores_listar():
    """Listar proveedores del catalogo"""
    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS fc_proveedores (
                id SERIAL PRIMARY KEY,
                nombre TEXT UNIQUE NOT NULL,
                nombre_comercial TEXT DEFAULT '',
                criticidad TEXT DEFAULT 'BAJO',
                dias_credito INTEGER DEFAULT 0,
                dia_despacho TEXT DEFAULT '',
                productos_servicios TEXT DEFAULT '',
                observaciones TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        conn.commit()
        cur.execute('SELECT id, nombre, nombre_comercial, criticidad, dias_credito, dia_despacho, productos_servicios, observaciones FROM fc_proveedores ORDER BY nombre')
        proveedores = []
        for r in cur.fetchall():
            proveedores.append({
                'id': r[0], 'nombre': r[1], 'nombre_comercial': r[2] or '',
                'criticidad': r[3] or 'BAJO', 'dias_credito': r[4] or 0,
                'dia_despacho': r[5] or '', 'productos_servicios': r[6] or '',
                'observaciones': r[7] or ''
            })
        return jsonify({'ok': True, 'proveedores': proveedores})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/proveedores', methods=['POST'])
def flujo_caja_proveedores_guardar():
    """Crear o actualizar proveedor"""
    conn = None
    try:
        data = request.get_json()
        nombre = data.get('nombre', '').strip()
        if not nombre:
            return jsonify({'error': 'Nombre requerido'}), 400
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO fc_proveedores (nombre, nombre_comercial, criticidad, dias_credito, dia_despacho, productos_servicios, observaciones)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (nombre) DO UPDATE SET
                nombre_comercial = EXCLUDED.nombre_comercial,
                criticidad = EXCLUDED.criticidad,
                dias_credito = EXCLUDED.dias_credito,
                dia_despacho = EXCLUDED.dia_despacho,
                productos_servicios = EXCLUDED.productos_servicios,
                observaciones = EXCLUDED.observaciones,
                updated_at = NOW()
            RETURNING id
        ''', (nombre, (data.get('nombre_comercial') or '').strip() or nombre, data.get('criticidad', 'BAJO'),
              data.get('dias_credito', 0), data.get('dia_despacho', ''),
              data.get('productos_servicios', ''), data.get('observaciones', '')))
        prov_id = cur.fetchone()[0]
        conn.commit()
        return jsonify({'ok': True, 'id': prov_id})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/proveedores/bulk', methods=['POST'])
def flujo_caja_proveedores_bulk():
    """Guardar multiples proveedores de una vez"""
    conn = None
    try:
        data = request.get_json()
        proveedores = data.get('proveedores', [])
        if not proveedores:
            return jsonify({'error': 'Sin proveedores'}), 400
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        cur.execute('''CREATE TABLE IF NOT EXISTS fc_proveedores (
            id SERIAL PRIMARY KEY, nombre TEXT UNIQUE NOT NULL,
            nombre_comercial TEXT DEFAULT '', criticidad TEXT DEFAULT 'BAJO',
            dias_credito INTEGER DEFAULT 0, dia_despacho TEXT DEFAULT '',
            productos_servicios TEXT DEFAULT '', observaciones TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())''')
        guardados = 0
        for p in proveedores:
            nombre = p.get('nombre', '').strip()
            if not nombre: continue
            cur.execute('''
                INSERT INTO fc_proveedores (nombre, nombre_comercial, criticidad, dias_credito, dia_despacho, productos_servicios, observaciones)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (nombre) DO UPDATE SET
                    nombre_comercial = COALESCE(NULLIF(EXCLUDED.nombre_comercial, ''), fc_proveedores.nombre_comercial),
                    criticidad = CASE WHEN EXCLUDED.criticidad != 'BAJO' THEN EXCLUDED.criticidad ELSE fc_proveedores.criticidad END,
                    dias_credito = CASE WHEN EXCLUDED.dias_credito > 0 THEN EXCLUDED.dias_credito ELSE fc_proveedores.dias_credito END,
                    dia_despacho = COALESCE(NULLIF(EXCLUDED.dia_despacho, ''), fc_proveedores.dia_despacho),
                    productos_servicios = COALESCE(NULLIF(EXCLUDED.productos_servicios, ''), fc_proveedores.productos_servicios),
                    observaciones = COALESCE(NULLIF(EXCLUDED.observaciones, ''), fc_proveedores.observaciones),
                    updated_at = NOW()
            ''', (nombre, (p.get('nombre_comercial') or '').strip() or nombre, p.get('criticidad', 'BAJO'),
                  p.get('dias_credito', 0), p.get('dia_despacho', ''),
                  p.get('productos_servicios', ''), p.get('observaciones', '')))
            guardados += 1
        conn.commit()
        return jsonify({'ok': True, 'guardados': guardados})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/proveedores/<int:prov_id>', methods=['DELETE'])
def flujo_caja_proveedores_eliminar(prov_id):
    """Eliminar proveedor del catalogo"""
    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        cur.execute('DELETE FROM fc_proveedores WHERE id = %s RETURNING nombre', (prov_id,))
        row = cur.fetchone()
        conn.commit()
        if row: return jsonify({'ok': True, 'eliminado': row[0]})
        return jsonify({'error': 'No encontrado'}), 404
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/recurrentes', methods=['GET'])
def flujo_caja_recurrentes_listar():
    """Listar pagos recurrentes"""
    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS fc_pagos_recurrentes (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                grupo TEXT DEFAULT 'pagos-fijos',
                monto NUMERIC(14,2) DEFAULT 0,
                frecuencia TEXT DEFAULT 'mensual',
                dia_mes INTEGER DEFAULT 1,
                dia_semana INTEGER DEFAULT 0,
                banco TEXT DEFAULT 'produbanco',
                activo BOOLEAN DEFAULT TRUE,
                observaciones TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        ''')
        conn.commit()
        cur.execute('SELECT id, nombre, grupo, monto, frecuencia, dia_mes, dia_semana, banco, activo, observaciones FROM fc_pagos_recurrentes ORDER BY grupo, nombre')
        pagos = []
        for r in cur.fetchall():
            pagos.append({
                'id': r[0], 'nombre': r[1], 'grupo': r[2], 'monto': float(r[3] or 0),
                'frecuencia': r[4] or 'mensual', 'dia_mes': r[5] or 1,
                'dia_semana': r[6] or 0, 'banco': r[7] or 'produbanco',
                'activo': r[8], 'observaciones': r[9] or ''
            })
        return jsonify({'ok': True, 'pagos': pagos})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/recurrentes', methods=['POST'])
def flujo_caja_recurrentes_guardar():
    """Crear o actualizar pago recurrente"""
    conn = None
    try:
        data = request.get_json()
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        pago_id = data.get('id', 0)
        if pago_id and pago_id > 0:
            cur.execute('''
                UPDATE fc_pagos_recurrentes SET nombre=%s, grupo=%s, monto=%s, frecuencia=%s,
                    dia_mes=%s, dia_semana=%s, banco=%s, activo=%s, observaciones=%s, updated_at=NOW()
                WHERE id=%s RETURNING id
            ''', (data.get('nombre',''), data.get('grupo','pagos-fijos'), data.get('monto',0),
                  data.get('frecuencia','mensual'), data.get('dia_mes',1), data.get('dia_semana',0),
                  data.get('banco','produbanco'), data.get('activo',True), data.get('observaciones',''), pago_id))
        else:
            cur.execute('''
                INSERT INTO fc_pagos_recurrentes (nombre, grupo, monto, frecuencia, dia_mes, dia_semana, banco, activo, observaciones)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            ''', (data.get('nombre',''), data.get('grupo','pagos-fijos'), data.get('monto',0),
                  data.get('frecuencia','mensual'), data.get('dia_mes',1), data.get('dia_semana',0),
                  data.get('banco','produbanco'), data.get('activo',True), data.get('observaciones','')))
        pago_id = cur.fetchone()[0]
        conn.commit()
        return jsonify({'ok': True, 'id': pago_id})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/recurrentes/<int:pago_id>', methods=['DELETE'])
def flujo_caja_recurrentes_eliminar(pago_id):
    """Eliminar pago recurrente"""
    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        cur.execute('DELETE FROM fc_pagos_recurrentes WHERE id = %s RETURNING nombre', (pago_id,))
        row = cur.fetchone()
        conn.commit()
        if row: return jsonify({'ok': True, 'eliminado': row[0]})
        return jsonify({'error': 'No encontrado'}), 404
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


def _fc_crear_tabla_eliminados(cur):
    cur.execute('''CREATE TABLE IF NOT EXISTS fc_egresos_eliminados (
        grupo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        eliminado_desde DATE NOT NULL,
        eliminado_por TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (grupo, nombre))''')


@app.route('/api/flujo-caja/egresos-eliminados', methods=['GET'])
def flujo_caja_eliminados_get():
    """Items de egreso dados de baja con su fecha de vigencia"""
    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        _fc_crear_tabla_eliminados(cur)
        conn.commit()
        cur.execute('SELECT grupo, nombre, eliminado_desde FROM fc_egresos_eliminados')
        eliminados = [{'grupo': r[0], 'nombre': r[1], 'eliminado_desde': r[2].isoformat()} for r in cur.fetchall()]
        return jsonify({'ok': True, 'eliminados': eliminados})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/egresos-eliminados', methods=['POST'])
def flujo_caja_eliminados_marcar():
    """Marcar item como eliminado desde una semana (conserva el historico anterior)"""
    conn = None
    try:
        data = request.get_json()
        grupo = (data.get('grupo') or '').strip()
        nombre = (data.get('nombre') or '').strip()
        desde = (data.get('eliminado_desde') or '').strip()
        if not grupo or not nombre or not desde:
            return jsonify({'error': 'grupo, nombre y eliminado_desde son requeridos'}), 400
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        _fc_crear_tabla_eliminados(cur)
        cur.execute('''INSERT INTO fc_egresos_eliminados (grupo, nombre, eliminado_desde, eliminado_por)
            VALUES (%s, %s, %s, %s) ON CONFLICT (grupo, nombre) DO UPDATE SET
            eliminado_desde = EXCLUDED.eliminado_desde, created_at = NOW()''',
            (grupo, nombre, desde, data.get('usuario', '')))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/egresos-eliminados/reactivar', methods=['POST'])
def flujo_caja_eliminados_reactivar():
    """Quitar la baja de un item (vuelve a aparecer en todas las semanas)"""
    conn = None
    try:
        data = request.get_json()
        grupo = (data.get('grupo') or '').strip()
        nombre = (data.get('nombre') or '').strip()
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        _fc_crear_tabla_eliminados(cur)
        cur.execute('DELETE FROM fc_egresos_eliminados WHERE grupo = %s AND nombre = %s', (grupo, nombre))
        conn.commit()
        return jsonify({'ok': True, 'reactivados': cur.rowcount})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


def _fc_crear_tabla_ahorro(cur):
    cur.execute('''CREATE TABLE IF NOT EXISTS fc_ahorro_deuda (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        ahorro_semanal NUMERIC(14,2) DEFAULT 0,
        aportes_extra JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW())''')


@app.route('/api/flujo-caja/ahorro-deuda', methods=['GET'])
def flujo_caja_ahorro_deuda_get():
    """Config de ahorro semanal destinado a pago de deuda vencida"""
    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        _fc_crear_tabla_ahorro(cur)
        conn.commit()
        cur.execute('SELECT ahorro_semanal, aportes_extra FROM fc_ahorro_deuda WHERE id = 1')
        row = cur.fetchone()
        if row:
            return jsonify({'ok': True, 'ahorro_semanal': float(row[0] or 0), 'aportes_extra': row[1] or {}})
        return jsonify({'ok': True, 'ahorro_semanal': 0, 'aportes_extra': {}})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/ahorro-deuda', methods=['POST'])
def flujo_caja_ahorro_deuda_guardar():
    """Guardar config de ahorro semanal para deuda"""
    conn = None
    try:
        data = request.get_json()
        ahorro = float(data.get('ahorro_semanal', 0) or 0)
        aportes = data.get('aportes_extra', {}) or {}
        conn = fc_get_movimientos_db()
        cur = conn.cursor()
        _fc_crear_tabla_ahorro(cur)
        cur.execute('''INSERT INTO fc_ahorro_deuda (id, ahorro_semanal, aportes_extra)
            VALUES (1, %s, %s::jsonb) ON CONFLICT (id) DO UPDATE SET
            ahorro_semanal = EXCLUDED.ahorro_semanal,
            aportes_extra = EXCLUDED.aportes_extra,
            updated_at = NOW()''', (ahorro, json.dumps(aportes)))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn: fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/ventas-por-local', methods=['GET'])
def flujo_caja_ventas_por_local():
    """Ventas mensuales por centro de costo para grafico"""
    conn = None
    try:
        meses = int(request.args.get('meses', '12'))
        conn = fc_get_movimientos_db()
        cur = conn.cursor()

        cur.execute('''
            WITH unicos AS (
                SELECT DISTINCT ON (documento_id, fecha, valor) fecha, centro_costo, valor
                FROM contifico_cobrospagos
                WHERE tipo_registro = 'CLI'
                AND fecha >= CURRENT_DATE - (%s || ' months')::interval
                AND centro_costo IS NOT NULL AND centro_costo != ''
            )
            SELECT TO_CHAR(fecha, 'YYYY-MM') as mes,
                   centro_costo,
                   SUM(valor) as total
            FROM unicos
            GROUP BY mes, centro_costo
            ORDER BY mes, centro_costo
        ''', (meses,))

        datos = {}
        locales_set = set()
        for r in cur.fetchall():
            mes = r[0]
            local = r[1]
            total = float(r[2])
            if mes not in datos:
                datos[mes] = {}
            datos[mes][local] = total
            locales_set.add(local)

        return jsonify({
            'ok': True,
            'datos': datos,
            'locales': sorted(list(locales_set)),
            'meses': sorted(datos.keys())
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


@app.route('/api/flujo-caja/facturas-proveedor', methods=['GET'])
def flujo_caja_facturas_proveedor():
    """Buscar facturas de compras pendientes de un proveedor"""
    conn = None
    try:
        nombre = request.args.get('nombre', '')
        if not nombre or len(nombre) < 3:
            return jsonify({'ok': False, 'error': 'Nombre muy corto (min 3 caracteres)'})

        conn = fc_get_movimientos_db()
        cur = conn.cursor()

        # Buscar en fact_detallada_compras (facturas de compra de proveedores)
        cur.execute('''
            SELECT DISTINCT numero_documento, fecha_emision::date, total,
                   razon_social, autorizacion
            FROM fact_detallada_compras
            WHERE razon_social ILIKE %s
            AND fecha_emision >= CURRENT_DATE - INTERVAL '6 months'
            ORDER BY fecha_emision DESC
            LIMIT 100
        ''', (f'%{nombre}%',))

        facturas = []
        for r in cur.fetchall():
            facturas.append({
                'num': r[0] or '',
                'fecha': str(r[1]) if r[1] else '',
                'monto': float(r[2]) if r[2] else 0,
                'proveedor': r[3] or '',
                'autorizacion': r[4] or '',
                'vencimiento': ''
            })

        return jsonify({'ok': True, 'facturas': facturas, 'total': len(facturas)})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


# =====================================================
# VOUCHER SCANNER - Endpoint comparacion Azure
# =====================================================
@app.route('/api/vouchers/cobros-tarjeta', methods=['GET'])
def vs_cobros_tarjeta():
    """Obtiene cobros con tarjeta de Azure para comparar con vouchers Supabase"""
    fecha = request.args.get('fecha')
    local = request.args.get('local')  # Filtro opcional por local
    if not fecha:
        return jsonify({'error': 'Fecha requerida'}), 400

    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Mapeo de IDs Supabase a nombres de local en Azure
        mapeo_locales = {
            'vj6e98Ao7UrAEdWB': 'PORTUGAL',
            'gDGe76ymMCn21dn2': 'REAL',
            'pXKdwmJWZcgk3agW': 'SANTO CACHON PORTUGAL',
            '4pzb864o4uBWpeEw': 'SANTO CACHON REAL',
            'rQzaOyDP4cElmdp4': 'SIMON BOLON'
        }
        local_azure = mapeo_locales.get(local) if local else None

        # Cobros con tarjeta - detalle individual
        if local_azure:
            cur.execute('''
                SELECT
                    codigo_comprobante as factura,
                    centro_costo as local,
                    valor,
                    persona,
                    lote
                FROM contifico_cobrospagos
                WHERE fecha = %s AND forma_cobro_pago = 'Tarjeta Credito' AND centro_costo = %s
                ORDER BY lote, codigo_comprobante
            ''', (fecha, local_azure))
        else:
            cur.execute('''
                SELECT
                    codigo_comprobante as factura,
                    centro_costo as local,
                    valor,
                    persona,
                    lote
                FROM contifico_cobrospagos
                WHERE fecha = %s AND forma_cobro_pago = 'Tarjeta Credito'
                ORDER BY centro_costo, lote, codigo_comprobante
            ''', (fecha,))

        registros = []
        total_monto = 0
        for row in cur.fetchall():
            factura = row['factura'] or ''
            local = row['local'] or '(sin local)'
            valor = float(row['valor'] or 0)
            registros.append({
                'factura': factura,
                'local': local,
                'valor': valor,
                'persona': row['persona'] or '',
                'lote': row['lote'] or ''
            })
            total_monto += valor

        # Obtener lotes únicos con totales
        lotes_unicos = {}
        for r in registros:
            lote = r['lote'] or ''
            if lote:
                if lote not in lotes_unicos:
                    lotes_unicos[lote] = {'lote': lote, 'local': r['local'], 'txn': 0, 'total': 0}
                lotes_unicos[lote]['txn'] += 1
                lotes_unicos[lote]['total'] += r['valor']

        return jsonify({
            'ok': True,
            'fecha': fecha,
            'registros': registros,
            'lotes': list(lotes_unicos.values()),
            'total_transacciones': len(registros),
            'total_monto': total_monto
        })

    except Exception as e:
        print(f"Error en /api/vouchers/cobros-tarjeta: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


@app.route('/api/vouchers/cobros-deuna', methods=['GET'])
def vs_cobros_deuna():
    """Obtiene cobros DEUNA de Azure (contifico_cobrospagos) para comparar con vouchers Supabase"""
    fecha = request.args.get('fecha')
    local = request.args.get('local')
    if not fecha:
        return jsonify({'error': 'Fecha requerida'}), 400

    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Mapeo de IDs Supabase a nombres de local en Azure
        mapeo_locales = {
            'vj6e98Ao7UrAEdWB': 'PORTUGAL',
            'gDGe76ymMCn21dn2': 'REAL',
            'pXKdwmJWZcgk3agW': 'SANTO CACHON PORTUGAL',
            '4pzb864o4uBWpeEw': 'SANTO CACHON REAL',
            'rQzaOyDP4cElmdp4': 'SIMON BOLON'
        }
        local_azure = mapeo_locales.get(local) if local else None

        # Consultar contifico_cobrospagos (DEUNA = Transferencia + BANCO DEUNA)
        if local_azure:
            cur.execute('''
                SELECT
                    codigo_comprobante as factura,
                    centro_costo as local,
                    valor,
                    persona
                FROM contifico_cobrospagos
                WHERE fecha = %s
                  AND forma_cobro_pago = 'Transferencia'
                  AND cta_afectada = 'BANCO DEUNA'
                  AND centro_costo = %s
                ORDER BY codigo_comprobante
            ''', (fecha, local_azure))
        else:
            cur.execute('''
                SELECT
                    codigo_comprobante as factura,
                    centro_costo as local,
                    valor,
                    persona
                FROM contifico_cobrospagos
                WHERE fecha = %s
                  AND forma_cobro_pago = 'Transferencia'
                  AND cta_afectada = 'BANCO DEUNA'
                ORDER BY centro_costo, codigo_comprobante
            ''', (fecha,))

        registros = []
        total_monto = 0
        for row in cur.fetchall():
            factura = row['factura'] or ''
            local_name = row['local'] or '(sin local)'
            valor = float(row['valor'] or 0)
            registros.append({
                'factura': factura,
                'local': local_name,
                'valor': valor,
                'persona': row['persona'] or ''
            })
            total_monto += valor

        return jsonify({
            'ok': True,
            'fecha': fecha,
            'registros': registros,
            'total_transacciones': len(registros),
            'total_monto': total_monto
        })

    except Exception as e:
        print(f"Error en /api/vouchers/cobros-deuna: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


@app.route('/api/vouchers/cortesias', methods=['GET'])
def vs_cortesias():
    """Obtiene cortesias (DNAs) de una fecha para control"""
    fecha = request.args.get('fecha')
    local = request.args.get('local')
    if not fecha:
        return jsonify({'error': 'Fecha requerida'}), 400

    conn = None
    try:
        conn = fc_get_movimientos_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        mapeo_locales = {
            'vj6e98Ao7UrAEdWB': 'PORTUGAL',
            'gDGe76ymMCn21dn2': 'REAL',
            'pXKdwmJWZcgk3agW': 'SANTO CACHON PORTUGAL',
            '4pzb864o4uBWpeEw': 'SANTO CACHON REAL',
            'rQzaOyDP4cElmdp4': 'SIMON BOLON',
            'isla_floreana': 'FLOREANA'
        }
        local_azure = mapeo_locales.get(local) if local else None

        if local_azure:
            cur.execute('''
                SELECT num_documento, persona, vendedor, centro_costo, nota, total
                FROM fact_detallada
                WHERE fecha = %s
                  AND tipo_documento = 'DNA'
                  AND centro_costo = %s
                ORDER BY num_documento
            ''', (fecha, local_azure))
        else:
            cur.execute('''
                SELECT num_documento, persona, vendedor, centro_costo, nota, total
                FROM fact_detallada
                WHERE fecha = %s
                  AND tipo_documento = 'DNA'
                ORDER BY centro_costo, num_documento
            ''', (fecha,))

        registros = []
        total_monto = 0
        for row in cur.fetchall():
            monto = float(row['total'] or 0)
            registros.append({
                'dna': row['num_documento'] or '',
                'cliente': row['persona'] or '',
                'vendedor': row['vendedor'] or '',
                'local': row['centro_costo'] or '',
                'nota': row['nota'] or '',
                'monto': monto
            })
            total_monto += monto

        return jsonify({
            'ok': True,
            'fecha': fecha,
            'registros': registros,
            'total_cortesias': len(registros),
            'total_monto': total_monto
        })

    except Exception as e:
        print(f"Error en /api/vouchers/cortesias: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            fc_release_movimientos_db(conn)


# ============================================================
# INVENTARIO LOCALES (actualizar cantidad / toma fisica)
# ============================================================
# NOTA: WORKER_TOKEN ya definido arriba (linea ~4159)

@app.route('/api/inventario-locales/solicitar', methods=['POST'])
def inventario_locales_solicitar():
    """Admin solicita tarea de actualizar cantidad o toma fisica."""
    data = request.json or {}
    bodega = data.get('bodega')
    fecha = data.get('fecha')
    accion = data.get('accion')
    usuario = data.get('usuario', 'admin')

    if not bodega or not fecha or not accion:
        return jsonify({'error': 'bodega, fecha y accion son requeridos'}), 400

    if accion not in ('actualizar_cantidad', 'toma_fisica'):
        return jsonify({'error': 'accion debe ser actualizar_cantidad o toma_fisica'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO goti.tareas_inventario_locales (bodega, fecha, accion, solicitado_por)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (bodega, fecha, accion, usuario))
        tarea_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'ok': True, 'id': tarea_id})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/inventario-locales/pendientes', methods=['GET'])
def inventario_locales_pendientes():
    """Worker toma tareas pendientes."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401
    worker_id = request.args.get('worker_id', 'pc-finanzas')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.tareas_inventario_locales
            SET estado = 'en_proceso', worker_lock = %s, timestamp_inicio = NOW()
            WHERE id IN (
                SELECT id FROM goti.tareas_inventario_locales
                WHERE estado = 'pendiente' ORDER BY solicitado_at ASC LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, bodega, fecha, accion
        """, (worker_id,))
        rows = cur.fetchall()
        conn.commit()
        return jsonify([{
            'id': r['id'],
            'bodega': r['bodega'],
            'fecha': r['fecha'].isoformat() if r['fecha'] else None,
            'accion': r['accion'],
        } for r in rows])
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/inventario-locales/resultado', methods=['POST'])
def inventario_locales_resultado():
    """Worker reporta resultado."""
    token = request.headers.get('X-Worker-Token')
    if token != WORKER_TOKEN:
        return jsonify({'error': 'unauthorized'}), 401
    data = request.json or {}
    ejec_id = data.get('id')
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            UPDATE goti.tareas_inventario_locales
            SET estado = %s, timestamp_fin = NOW(), total_productos = %s,
                url_contifico = %s, error_msg = %s
            WHERE id = %s
        """, (
            data.get('estado', 'completado'),
            data.get('total_productos'),
            data.get('url_contifico'),
            data.get('error_msg'),
            ejec_id
        ))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/inventario-locales/historial', methods=['GET'])
def inventario_locales_historial():
    """Lista historial de tareas."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, bodega, fecha, accion, estado, solicitado_por, solicitado_at,
                   timestamp_inicio, timestamp_fin, total_productos, url_contifico, error_msg
            FROM goti.tareas_inventario_locales
            ORDER BY solicitado_at DESC
            LIMIT 100
        """)
        return jsonify(cur.fetchall())
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/inventario-locales/estado/<int:tarea_id>', methods=['GET'])
def inventario_locales_estado(tarea_id):
    """Estado de una tarea especifica."""
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM goti.tareas_inventario_locales WHERE id = %s", (tarea_id,))
        r = cur.fetchone()
        if not r:
            return jsonify({'error': 'no encontrado'}), 404
        return jsonify(dict(r))
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


@app.route('/api/inventario-locales/borrar', methods=['POST'])
def inventario_locales_borrar():
    """Borra datos de inventario (cantidad + conteos) para un local y fecha."""
    data = request.json or {}
    bodega = data.get('bodega')
    fecha = data.get('fecha')
    usuario = data.get('usuario', 'admin')

    if not bodega or not fecha:
        return jsonify({'error': 'bodega y fecha son requeridos'}), 400

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Borrar registros
        cur.execute("""
            DELETE FROM goti.inventario_ciego_conteos
            WHERE local = %s AND fecha = %s::date
        """, (bodega, fecha))
        borrados = cur.rowcount
        conn.commit()

        return jsonify({
            'ok': True,
            'borrados': borrados,
            'mensaje': f'Borrados {borrados} registros de {bodega} fecha {fecha}'
        })
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: release_db(conn)


# ================================================================
# MODULO NOMINA Y TTHH - Endpoints API
# BD: movimientos (Azure PostgreSQL) - Schema: nomina_*
# ================================================================

_nomina_pool = None

def _get_nomina_pool():
    """Pool dedicado para nomina con RealDictCursor"""
    global _nomina_pool
    if _nomina_pool is None:
        _nomina_pool = SimpleConnectionPool(
            minconn=1, maxconn=3,
            host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
            database='movimientos',
            user=os.environ.get('DB_USER', 'adminChios'),
            password=os.environ.get('DB_PASSWORD', 'Burger2023'),
            port=os.environ.get('DB_PORT', '5432'),
            sslmode='require',
            connect_timeout=10,
            cursor_factory=RealDictCursor
        )
    return _nomina_pool

def _get_mov_conn():
    """Conexion a BD movimientos para modulo nomina (con RealDictCursor)"""
    conn = _get_nomina_pool().getconn()
    try:
        conn.cursor().execute("SELECT 1")
        conn.rollback()
    except Exception:
        try:
            _get_nomina_pool().putconn(conn, close=True)
        except Exception:
            try: conn.close()
            except Exception: pass
        conn = psycopg2.connect(
            host=os.environ.get('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
            database='movimientos',
            user=os.environ.get('DB_USER', 'adminChios'),
            password=os.environ.get('DB_PASSWORD', 'Burger2023'),
            port=os.environ.get('DB_PORT', '5432'),
            sslmode='require',
            cursor_factory=RealDictCursor
        )
    return conn

def _release_mov(conn):
    try:
        if conn and not conn.closed:
            _get_nomina_pool().putconn(conn)
    except Exception:
        try: conn.close()
        except Exception: pass

def _init_nomina_schema():
    """Crea tablas nomina_* en BD movimientos si no existen"""
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS nomina_empleados (
                id SERIAL PRIMARY KEY,
                tipo_documento TEXT DEFAULT 'cedula',
                cedula TEXT NOT NULL UNIQUE,
                nombre_completo TEXT,
                primer_nombre TEXT DEFAULT '',
                segundo_nombre TEXT,
                apellido_paterno TEXT DEFAULT '',
                apellido_materno TEXT,
                email TEXT,
                fecha_nacimiento DATE,
                genero TEXT,
                nacionalidad TEXT DEFAULT 'Ecuatoriano',
                estado_civil TEXT,
                direccion TEXT,
                celular TEXT,
                empresa TEXT DEFAULT 'FOODIX SAS',
                marca TEXT,
                tienda TEXT,
                area TEXT,
                cargo_texto TEXT,
                cargo_jerarquico_texto TEXT,
                estado TEXT DEFAULT 'Activo',
                fecha_ingreso DATE,
                fecha_salida DATE,
                tipo_contrato TEXT,
                etapa TEXT,
                jornada TEXT DEFAULT 'Completa',
                horas_mes NUMERIC(6,2) DEFAULT 240,
                salario NUMERIC(10,2) NOT NULL DEFAULT 0,
                descuento_por_cargo NUMERIC(10,2) DEFAULT 0,
                bono_cumpleanos NUMERIC(10,2) DEFAULT 0,
                decimos TEXT DEFAULT 'Mensualizado',
                forma_pago TEXT DEFAULT 'Transferencia',
                banco TEXT,
                tipo_cuenta TEXT,
                numero_cuenta TEXT,
                motivo_salida TEXT,
                emergencia1_nombre TEXT,
                emergencia1_telefono TEXT,
                emergencia1_relacion TEXT,
                emergencia2_nombre TEXT,
                emergencia2_telefono TEXT,
                emergencia2_relacion TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS nomina_rubros (
                id SERIAL PRIMARY KEY,
                codigo TEXT NOT NULL UNIQUE,
                nombre TEXT NOT NULL,
                tipo TEXT NOT NULL,
                es_predeterminado BOOLEAN DEFAULT FALSE,
                porcentaje NUMERIC(8,4),
                valor_fijo NUMERIC(10,2),
                aplica_iess BOOLEAN DEFAULT FALSE,
                aplica_ir BOOLEAN DEFAULT FALSE,
                activo BOOLEAN DEFAULT TRUE,
                orden INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nomina_liquidacion_grupo (
                id SERIAL PRIMARY KEY,
                tipo TEXT NOT NULL,
                periodo TEXT NOT NULL,
                fecha_liquidacion DATE NOT NULL,
                estado TEXT DEFAULT 'Borrador',
                total_ingresos NUMERIC(12,2) DEFAULT 0,
                total_descuentos NUMERIC(12,2) DEFAULT 0,
                total_pagar NUMERIC(12,2) DEFAULT 0,
                total_prestaciones NUMERIC(12,2) DEFAULT 0,
                total_costo_empleado NUMERIC(12,2) DEFAULT 0,
                num_empleados INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS nomina_liquidacion_detalle (
                id SERIAL PRIMARY KEY,
                liquidacion_grupo_id INTEGER NOT NULL REFERENCES nomina_liquidacion_grupo(id) ON DELETE CASCADE,
                empleado_id INTEGER NOT NULL REFERENCES nomina_empleados(id),
                nombre_completo TEXT,
                sueldo_base NUMERIC(10,2) NOT NULL,
                dias_trabajados NUMERIC(5,1) DEFAULT 30,
                total_ingresos NUMERIC(10,2) DEFAULT 0,
                total_descuentos NUMERIC(10,2) DEFAULT 0,
                liquido_pagar NUMERIC(10,2) DEFAULT 0,
                total_prestaciones NUMERIC(10,2) DEFAULT 0,
                costo_empleado NUMERIC(10,2) DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nomina_liquidacion_rubro (
                id SERIAL PRIMARY KEY,
                liquidacion_detalle_id INTEGER NOT NULL REFERENCES nomina_liquidacion_detalle(id) ON DELETE CASCADE,
                concepto TEXT NOT NULL,
                tipo TEXT NOT NULL,
                cantidad NUMERIC(8,2) DEFAULT 1,
                valor NUMERIC(10,2) DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nomina_centros_costo (
                id SERIAL PRIMARY KEY,
                codigo TEXT NOT NULL UNIQUE,
                nombre TEXT NOT NULL,
                activo BOOLEAN DEFAULT TRUE
            );

            CREATE TABLE IF NOT EXISTS nomina_tipos_contrato (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                dias_duracion INTEGER,
                activo BOOLEAN DEFAULT TRUE
            );

            CREATE TABLE IF NOT EXISTS nomina_config_cargo (
                id SERIAL PRIMARY KEY,
                cargo_jerarquico TEXT NOT NULL UNIQUE,
                descuento_por_cargo NUMERIC(10,2) DEFAULT 0,
                bono_cumpleanos NUMERIC(10,2) DEFAULT 0,
                activo BOOLEAN DEFAULT TRUE
            );
        """)

        # Insertar rubros predeterminados si no existen
        cur.execute("SELECT COUNT(*) as c FROM nomina_rubros")
        if cur.fetchone()['c'] == 0:
            rubros = [
                ('ING001', 'Sueldo Base', 'ingreso', None, True, True, 1),
                ('ING004', 'Comisiones', 'ingreso', None, True, True, 4),
                ('ING009', 'Vacaciones Pagadas', 'ingreso', None, True, True, 9),
                ('DES001', 'IESS Personal', 'descuento', 9.45, False, False, 1),
                ('DES003', 'Prestamo IESS Quirografario', 'descuento', None, False, False, 3),
                ('DES007', 'Multas', 'descuento', None, False, False, 7),
                ('PRE001', 'IESS Patronal', 'prestacion', 12.15, False, False, 1),
                ('PRE002', 'IECE+SECAP', 'prestacion', 1.0, False, False, 2),
                ('PRE004', 'Provision Vacaciones', 'prestacion', None, False, False, 4),
                ('PRE005', 'Provision Decimotercero', 'prestacion', None, False, False, 5),
                ('PRE006', 'Provision Decimocuarto', 'prestacion', None, False, False, 6),
            ]
            for r in rubros:
                cur.execute("""
                    INSERT INTO nomina_rubros (codigo, nombre, tipo, porcentaje, aplica_iess, aplica_ir, orden)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, r)

        # Insertar config cargos jerarquicos si no existen
        cur.execute("SELECT COUNT(*) as c FROM nomina_config_cargo")
        if cur.fetchone()['c'] == 0:
            cargos = [
                ('Director General', 100, 30), ('Jefe de Area', 35, 30),
                ('Gerente de Tienda', 25, 30), ('Subgerente de Tienda', 20, 20),
                ('Analista', 20, 20), ('Supervisor', 20, 20),
                ('Operario de Produccion', 15, 15), ('Polifuncional', 15, 15),
                ('Auxiliar', 15, 15), ('Asistente', 15, 15),
                ('Pasante / Practicante', 10, 10),
            ]
            for c in cargos:
                cur.execute("""
                    INSERT INTO nomina_config_cargo (cargo_jerarquico, descuento_por_cargo, bono_cumpleanos)
                    VALUES (%s, %s, %s)
                """, c)

        # Insertar tipos contrato si no existen
        cur.execute("SELECT COUNT(*) as c FROM nomina_tipos_contrato")
        if cur.fetchone()['c'] == 0:
            tipos = [
                'Contrato Indefinido con Periodo de Prueba', 'Contrato Sector Turistico',
                'Contrato Pasantias', 'Contrato Practicas', 'Contrato por Servicios Profesionales',
                'Contrato Emergente', 'Contrato Funciones de Confianza',
                'Contrato Jornada Parcial Permanente', 'Contrato Artesanal',
            ]
            for t in tipos:
                cur.execute("INSERT INTO nomina_tipos_contrato (nombre) VALUES (%s)", (t,))

        conn.commit()
        print('[NOMINA] Schema inicializado correctamente')
    except Exception as e:
        if conn: conn.rollback()
        print(f'[NOMINA] Error inicializando schema: {e}')
    finally:
        if conn: _release_mov(conn)

# Inicializar schema al arrancar
_init_nomina_schema()

# ---------- CONSTANTES NOMINA ECUADOR 2026 ----------
NOM_SBU = 482.0
NOM_IESS_PERSONAL = 0.0945
NOM_IESS_PATRONAL = 0.1215
NOM_IECE_SECAP = 0.01
NOM_FR_RATE = 1/12  # 8.33%
NOM_ANTICIPO_PCT = 0.40

def _nom_round(n):
    """Redondeo bancario a 2 decimales"""
    return round(float(n or 0) + 1e-9, 2)

# ---------- CATALOGOS ----------
@app.route('/api/nomina/catalogos', methods=['GET'])
def nomina_catalogos():
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("SELECT nombre FROM nomina_tipos_contrato WHERE activo = TRUE ORDER BY nombre")
        tipos = [r['nombre'] for r in cur.fetchall()]
        cur.execute("SELECT cargo_jerarquico, descuento_por_cargo, bono_cumpleanos FROM nomina_config_cargo WHERE activo = TRUE ORDER BY cargo_jerarquico")
        cargos = cur.fetchall()
        return jsonify({
            'tipos_contrato': tipos,
            'cargos_jerarquicos': [c['cargo_jerarquico'] for c in cargos],
            'config_cargos': {c['cargo_jerarquico']: {'descuento': float(c['descuento_por_cargo']), 'bono': float(c['bono_cumpleanos'])} for c in cargos},
            'tiendas': ['Chios Real Audiencia','Chios Portugal','Chios Floreana','Santo Cachon Real Audiencia','Santo Cachon Portugal','Simon Bolon','Planta','Oficinas'],
            'areas': ['Operaciones','Produccion','Administracion','Contabilidad','Marketing','Talento Humano'],
            'marcas': ['Chios','Santo Cachon','Simon Bolon','FOODIX'],
        })
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

# ---------- DASHBOARD ----------
@app.route('/api/nomina/dashboard', methods=['GET'])
def nomina_dashboard():
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as c FROM nomina_empleados WHERE estado = 'Activo'")
        activos = cur.fetchone()['c']
        cur.execute("SELECT COUNT(*) as c FROM nomina_empleados WHERE estado != 'Activo'")
        inactivos = cur.fetchone()['c']
        cur.execute("SELECT COALESCE(SUM(salario),0) as s, COALESCE(AVG(salario),0) as a FROM nomina_empleados WHERE estado = 'Activo'")
        sal = cur.fetchone()
        # Costo mensual estimado: salario + IESS patronal + IECE/SECAP + provisiones
        costo_base = float(sal['s'])
        costo_mensual = _nom_round(costo_base * (1 + NOM_IESS_PATRONAL + NOM_IECE_SECAP + NOM_FR_RATE + 1/12 + NOM_SBU/(12*costo_base) if costo_base > 0 else 0))
        if costo_base == 0:
            costo_mensual = 0

        cur.execute("SELECT COALESCE(area, 'Sin area') as area, COUNT(*) as cantidad FROM nomina_empleados WHERE estado = 'Activo' GROUP BY area ORDER BY cantidad DESC")
        por_area = cur.fetchall()
        cur.execute("SELECT COALESCE(tienda, 'Sin tienda') as tienda, COUNT(*) as cantidad FROM nomina_empleados WHERE estado = 'Activo' GROUP BY tienda ORDER BY cantidad DESC")
        por_tienda = cur.fetchall()
        cur.execute("SELECT COALESCE(tipo_contrato, 'Sin tipo') as tipo_contrato, COUNT(*) as cantidad FROM nomina_empleados WHERE estado = 'Activo' GROUP BY tipo_contrato ORDER BY cantidad DESC")
        por_contrato = cur.fetchall()

        return jsonify({
            'activos': activos, 'inactivos': inactivos,
            'costo_mensual': costo_mensual,
            'promedio_salario': float(sal['a']),
            'por_area': [dict(r) for r in por_area],
            'por_tienda': [dict(r) for r in por_tienda],
            'por_contrato': [dict(r) for r in por_contrato],
        })
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

# ---------- EMPLEADOS CRUD ----------
@app.route('/api/nomina/empleados', methods=['GET'])
def nomina_empleados_lista():
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        filtro = request.args.get('filtro', 'Activo')
        buscar = request.args.get('buscar', '').strip()
        where = []
        params = []
        if filtro:
            where.append("estado = %s")
            params.append(filtro)
        if buscar:
            where.append("(nombre_completo ILIKE %s OR cedula ILIKE %s OR cargo_texto ILIKE %s)")
            like = f'%{buscar}%'
            params.extend([like, like, like])
        w = ('WHERE ' + ' AND '.join(where)) if where else ''
        cur.execute(f"""
            SELECT id, cedula, nombre_completo, cargo_texto, tienda, salario, fecha_ingreso, estado, area, marca
            FROM nomina_empleados {w}
            ORDER BY nombre_completo
        """, params)
        return jsonify({'empleados': [dict(r) for r in cur.fetchall()]})
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/empleados/<int:emp_id>', methods=['GET'])
def nomina_empleado_detalle(emp_id):
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM nomina_empleados WHERE id = %s", (emp_id,))
        emp = cur.fetchone()
        if not emp:
            return jsonify({'error': 'Empleado no encontrado'}), 404
        return jsonify(dict(emp))
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/empleados', methods=['POST'])
def nomina_empleado_crear():
    conn = None
    try:
        data = request.get_json()
        conn = _get_mov_conn()
        cur = conn.cursor()
        campos = ['cedula','nombre_completo','email','celular','fecha_nacimiento','genero','estado_civil',
            'nacionalidad','direccion','empresa','marca','tienda','area','cargo_texto','cargo_jerarquico_texto',
            'fecha_ingreso','tipo_contrato','estado','salario','descuento_por_cargo','bono_cumpleanos',
            'jornada','horas_mes','decimos','forma_pago','banco','tipo_cuenta','numero_cuenta',
            'emergencia1_nombre','emergencia1_telefono','emergencia1_relacion',
            'emergencia2_nombre','emergencia2_telefono','emergencia2_relacion']
        vals = []
        placeholders = []
        cols = []
        for c in campos:
            v = data.get(c)
            if v is not None and v != '':
                cols.append(c)
                placeholders.append('%s')
                if c in ('salario','descuento_por_cargo','bono_cumpleanos','horas_mes'):
                    vals.append(float(v) if v else 0)
                else:
                    vals.append(v)
        cur.execute(f"""
            INSERT INTO nomina_empleados ({','.join(cols)})
            VALUES ({','.join(placeholders)})
            RETURNING id
        """, vals)
        new_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'ok': True, 'id': new_id})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/empleados/<int:emp_id>', methods=['PUT'])
def nomina_empleado_editar(emp_id):
    conn = None
    try:
        data = request.get_json()
        conn = _get_mov_conn()
        cur = conn.cursor()
        campos = ['cedula','nombre_completo','email','celular','fecha_nacimiento','genero','estado_civil',
            'nacionalidad','direccion','empresa','marca','tienda','area','cargo_texto','cargo_jerarquico_texto',
            'fecha_ingreso','tipo_contrato','estado','salario','descuento_por_cargo','bono_cumpleanos',
            'jornada','horas_mes','decimos','forma_pago','banco','tipo_cuenta','numero_cuenta',
            'emergencia1_nombre','emergencia1_telefono','emergencia1_relacion',
            'emergencia2_nombre','emergencia2_telefono','emergencia2_relacion']
        sets = []
        vals = []
        for c in campos:
            if c in data:
                v = data[c]
                if c in ('salario','descuento_por_cargo','bono_cumpleanos','horas_mes'):
                    v = float(v) if v else 0
                elif v == '':
                    v = None
                sets.append(f"{c} = %s")
                vals.append(v)
        if not sets:
            return jsonify({'error': 'No hay campos para actualizar'}), 400
        sets.append("updated_at = NOW()")
        vals.append(emp_id)
        cur.execute(f"UPDATE nomina_empleados SET {','.join(sets)} WHERE id = %s", vals)
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/empleados/<int:emp_id>', methods=['DELETE'])
def nomina_empleado_eliminar(emp_id):
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM nomina_empleados WHERE id = %s", (emp_id,))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

# ---------- NOMINAS - PROCESAMIENTO ----------
@app.route('/api/nomina/nominas', methods=['GET'])
def nomina_listar():
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, tipo, periodo, fecha_liquidacion, estado,
                   total_ingresos, total_descuentos, total_pagar, num_empleados, created_at
            FROM nomina_liquidacion_grupo
            ORDER BY periodo DESC, created_at DESC
        """)
        return jsonify({'nominas': [dict(r) for r in cur.fetchall()]})
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/nominas/procesar', methods=['POST'])
def nomina_procesar():
    """Calcula nomina para todos los empleados activos del periodo"""
    conn = None
    try:
        data = request.get_json()
        periodo = data.get('periodo')
        tipo = data.get('tipo', 'Mensual')
        if not periodo:
            return jsonify({'error': 'Periodo requerido'}), 400

        conn = _get_mov_conn()
        cur = conn.cursor()

        # Obtener empleados activos
        cur.execute("""
            SELECT id, nombre_completo, salario, descuento_por_cargo, bono_cumpleanos,
                   fecha_ingreso, cargo_jerarquico_texto, jornada, horas_mes, decimos
            FROM nomina_empleados WHERE estado = 'Activo' AND salario > 0
            ORDER BY nombre_completo
        """)
        empleados = cur.fetchall()
        if not empleados:
            return jsonify({'error': 'No hay empleados activos con salario'}), 400

        # Crear grupo de liquidacion
        cur.execute("""
            INSERT INTO nomina_liquidacion_grupo (tipo, periodo, fecha_liquidacion)
            VALUES (%s, %s, NOW()::date) RETURNING id
        """, (tipo, periodo))
        grupo_id = cur.fetchone()['id']

        total_ing = 0
        total_des = 0
        total_pagar = 0
        total_prest = 0
        total_costo = 0

        for emp in empleados:
            salario = float(emp['salario'])
            dias = 30
            sueldo_devengado = _nom_round(salario * dias / 30)

            if tipo == 'Anticipo':
                # Anticipo: 40% del devengado
                liquido = _nom_round(sueldo_devengado * NOM_ANTICIPO_PCT)
                ing = liquido
                des = 0
                prest = 0
                costo = ing
                rubros_data = [('Anticipo Quincena', 'ingreso', 1, liquido)]
            else:
                # Calculo mensual completo
                desc_cargo = float(emp['descuento_por_cargo'] or 0)
                bono_cumple = float(emp['bono_cumpleanos'] or 0)

                # Ingresos
                ing_sueldo = sueldo_devengado
                ing_total = ing_sueldo + bono_cumple

                # Descuentos
                base_iess = ing_sueldo  # Solo sueldo para IESS
                iess_personal = _nom_round(base_iess * NOM_IESS_PERSONAL)
                des_total = iess_personal + desc_cargo

                # Liquido
                liquido = _nom_round(ing_total - des_total)

                # Prestaciones (costo empleador)
                iess_patronal = _nom_round(base_iess * NOM_IESS_PATRONAL)
                iece_secap = _nom_round(base_iess * NOM_IECE_SECAP)
                prov_vacaciones = _nom_round(base_iess / 24)
                prov_decimo3 = _nom_round(base_iess / 12)
                prov_decimo4 = _nom_round(NOM_SBU / 12)
                fondos_reserva = _nom_round(base_iess * NOM_FR_RATE)

                prest = _nom_round(iess_patronal + iece_secap + prov_vacaciones + prov_decimo3 + prov_decimo4 + fondos_reserva)
                ing = ing_total
                des = des_total
                costo = _nom_round(ing + prest)

                rubros_data = [
                    ('Sueldo Base', 'ingreso', dias, ing_sueldo),
                    ('Bono Cumpleanos', 'ingreso', 1, bono_cumple),
                    ('IESS Personal 9.45%', 'descuento', 1, iess_personal),
                    ('Descuento por Cargo', 'descuento', 1, desc_cargo),
                    ('IESS Patronal 12.15%', 'prestacion', 1, iess_patronal),
                    ('IECE+SECAP 1%', 'prestacion', 1, iece_secap),
                    ('Prov. Vacaciones', 'prestacion', 1, prov_vacaciones),
                    ('Prov. Decimotercero', 'prestacion', 1, prov_decimo3),
                    ('Prov. Decimocuarto', 'prestacion', 1, prov_decimo4),
                    ('Fondos de Reserva', 'prestacion', 1, fondos_reserva),
                ]

            # Insertar detalle
            cur.execute("""
                INSERT INTO nomina_liquidacion_detalle
                    (liquidacion_grupo_id, empleado_id, nombre_completo, sueldo_base, dias_trabajados,
                     total_ingresos, total_descuentos, liquido_pagar, total_prestaciones, costo_empleado)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """, (grupo_id, emp['id'], emp['nombre_completo'], salario, dias, ing, des, liquido, prest, costo))
            det_id = cur.fetchone()['id']

            # Insertar rubros
            for concepto, rtipo, cant, val in rubros_data:
                if val != 0:
                    cur.execute("""
                        INSERT INTO nomina_liquidacion_rubro (liquidacion_detalle_id, concepto, tipo, cantidad, valor)
                        VALUES (%s,%s,%s,%s,%s)
                    """, (det_id, concepto, rtipo, cant, val))

            total_ing += ing
            total_des += des
            total_pagar += liquido
            total_prest += prest
            total_costo += costo

        # Actualizar totales del grupo
        cur.execute("""
            UPDATE nomina_liquidacion_grupo
            SET total_ingresos=%s, total_descuentos=%s, total_pagar=%s,
                total_prestaciones=%s, total_costo_empleado=%s, num_empleados=%s
            WHERE id=%s
        """, (_nom_round(total_ing), _nom_round(total_des), _nom_round(total_pagar),
              _nom_round(total_prest), _nom_round(total_costo), len(empleados), grupo_id))

        conn.commit()
        return jsonify({'ok': True, 'grupo_id': grupo_id, 'num_empleados': len(empleados),
                        'total_pagar': _nom_round(total_pagar)})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/nominas/<int:grupo_id>', methods=['GET'])
def nomina_detalle(grupo_id):
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM nomina_liquidacion_grupo WHERE id = %s", (grupo_id,))
        grupo = cur.fetchone()
        if not grupo:
            return jsonify({'error': 'Nomina no encontrada'}), 404
        cur.execute("""
            SELECT d.*, e.cedula, e.cargo_texto, e.tienda
            FROM nomina_liquidacion_detalle d
            JOIN nomina_empleados e ON e.id = d.empleado_id
            WHERE d.liquidacion_grupo_id = %s
            ORDER BY d.nombre_completo
        """, (grupo_id,))
        detalles = []
        for row in cur.fetchall():
            d = dict(row)
            cur.execute("""
                SELECT concepto, tipo, cantidad, valor
                FROM nomina_liquidacion_rubro WHERE liquidacion_detalle_id = %s ORDER BY id
            """, (d['id'],))
            d['rubros'] = [dict(r) for r in cur.fetchall()]
            detalles.append(d)
        return jsonify({'grupo': dict(grupo), 'detalles': detalles})
    except Exception as e:
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)

@app.route('/api/nomina/nominas/<int:grupo_id>/aprobar', methods=['POST'])
def nomina_aprobar(grupo_id):
    conn = None
    try:
        conn = _get_mov_conn()
        cur = conn.cursor()
        cur.execute("UPDATE nomina_liquidacion_grupo SET estado = 'Aprobado' WHERE id = %s AND estado = 'Borrador'", (grupo_id,))
        if cur.rowcount == 0:
            return jsonify({'error': 'Solo se pueden aprobar nominas en estado Borrador'}), 400
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': str(e)[:200]}), 500
    finally:
        if conn: _release_mov(conn)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port, debug=False)
