"""
Notificaciones por Telegram - Bot Maestro Airtable/Contifico
Envia alertas de exito y error al procesar registros
"""
import os
import requests

# Cache de nombres de productos (se carga desde Matriz Contifico en AirTable)
_NOMBRES_PRODUCTOS = {}
_NOMBRES_CARGADOS = False


def _cargar_nombres():
    """Carga nombres de productos desde Matriz Contifico (AirTable) una sola vez"""
    global _NOMBRES_PRODUCTOS, _NOMBRES_CARGADOS
    if _NOMBRES_CARGADOS:
        return
    try:
        from pyairtable import Api
        import os
        api = Api(os.getenv('AIRTABLE_TOKEN_A', ''))
        table = api.table('apppZXgUChlBLbVpR', 'tblTUHpdmQgULTY1y')
        records = table.all()
        for r in records:
            f = r['fields']
            codigo = f.get('Código', f.get('Codigo', ''))
            nombre = f.get('Nombre Producto', f.get('Nombre', ''))
            if codigo and nombre:
                _NOMBRES_PRODUCTOS[codigo] = nombre
        print(f'   [TELEGRAM] {len(_NOMBRES_PRODUCTOS)} productos cargados de Matriz Contifico')
    except Exception as e:
        print(f'   [TELEGRAM] Error cargando nombres: {e}')
    _NOMBRES_CARGADOS = True


def nombre_producto(codigo):
    """Retorna el nombre del producto desde Matriz Contifico"""
    _cargar_nombres()
    return _NOMBRES_PRODUCTOS.get(codigo, codigo)

TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN', '')
TELEGRAM_API = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage'

# Chat IDs por local/bodega (mismos que enviar_inventarios_telegram.py)
CHATS_POR_LOCAL = {
    'REAL':               [5805480374, 7623631626],
    'FLOREANA':           [8435511983, 8593540108],
    'PORTUGAL':           [8542982034, 1942907858],
    'SANTO CACHON REAL':  [8593787238, 8511588805],
    'SANTO CACHON PORTUGAL': [8542982034, 7076180011],
    'SIMON BOLON':        [8508487253, 8443325235],
    'PLANTA DE PRODUCCION': [5220304609, 7148059883],
    'BODEGA PRINCIPAL':   [5220304609, 7148059883],
    'BODEGA MATERIA PRIMA': [5220304609, 7148059883],
    'BODEGA PULMON':      [5220304609, 7148059883],
}

# Chat contabilidad (siempre recibe todos los errores y exitos)
CHAT_CONTABILIDAD = [5220304609, 1416079799, 7148059883]  # JN, Shavii, Diana Coque

# ============================================================
# DESTINATARIOS: se leen de la BD, no del codigo
# ============================================================
# Antes los chat_id estaban escritos aqui: para dar de alta o de baja a alguien
# habia que editar el archivo y desplegar. Ahora viven en
# goti.telegram_destinatarios y se administran desde el panel.
#
# Si la BD no responde se usa el diccionario de abajo como respaldo, para que un
# problema de base no deje a nadie sin aviso.
_DESTINATARIOS = None


def _conectar_bd():
    import psycopg2
    from psycopg2.extras import RealDictCursor
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'chiosburguer.postgres.database.azure.com'),
        dbname=os.getenv('DB_NAME', 'InventariosLocales'),
        user=os.getenv('DB_USER', ''), password=os.getenv('DB_PASSWORD', ''),
        port=5432, sslmode='require', connect_timeout=15,
        cursor_factory=RealDictCursor)


def cargar_destinatarios():
    """Lee la tabla una vez por ejecucion. Devuelve [] si la BD falla."""
    global _DESTINATARIOS
    if _DESTINATARIOS is not None:
        return _DESTINATARIOS
    _DESTINATARIOS = []
    try:
        con = _conectar_bd()
        cur = con.cursor()
        cur.execute("""SELECT chat_id, nombre, bodegas, operaciones, avisos
                       FROM goti.telegram_destinatarios
                       WHERE activo = TRUE AND estado = 'asignado'""")
        _DESTINATARIOS = [dict(r) for r in cur.fetchall()]
        con.close()
        print(f'   [TELEGRAM] {len(_DESTINATARIOS)} destinatarios cargados de la BD')
    except Exception as e:
        print(f'   [TELEGRAM] BD no disponible ({str(e)[:60]}), uso la lista del codigo')
    return _DESTINATARIOS


def _norma(t):
    return (t or '').strip().upper()


def destinatarios_para(local_nombre, operacion=None, tipo_aviso='exito'):
    """Chat ids que deben recibir este aviso.

    - bodegas: coincide con el local, o el comodin 'TODAS'
    - operaciones: coincide con la operacion, o 'TODAS'
    - avisos: 'ambos', o justo el tipo ('exito' / 'error')

    Sin datos en la BD, cae a CHATS_POR_LOCAL + CHAT_CONTABILIDAD del codigo.
    """
    filas = cargar_destinatarios()
    if not filas:
        ids = list(CHAT_CONTABILIDAD) + list(CHATS_POR_LOCAL.get(local_nombre, []))
        return list(dict.fromkeys(ids))

    local = _norma(local_nombre)
    oper = _norma(operacion)
    elegidos = []
    for f in filas:
        bods = [_norma(b) for b in (f.get('bodegas') or [])]
        if 'TODAS' not in bods and local not in bods:
            continue
        opers = [_norma(o) for o in (f.get('operaciones') or [])]
        if oper and 'TODAS' not in opers and oper not in opers:
            continue
        av = (f.get('avisos') or 'ambos').lower()
        if av != 'ambos' and av != tipo_aviso:
            continue
        elegidos.append(f['chat_id'])
    return list(dict.fromkeys(elegidos))


def enviar_mensaje(chat_id, mensaje):
    """Envia un mensaje de texto por Telegram"""
    try:
        resp = requests.post(TELEGRAM_API, json={
            'chat_id': chat_id,
            'text': mensaje,
            'parse_mode': 'HTML',
        }, timeout=10)
        return resp.ok
    except:
        return False


def notificar_error(bot_nombre, local_nombre, detalle, error_msg):
    """
    Notifica un error a Telegram.
    - bot_nombre: 'Bajas', 'Ingresos', 'Traslados', 'Conteo', 'Produccion'
    - local_nombre: nombre corto del local (REAL, FLOREANA, etc.)
    - detalle: string con datos del registro ya formateado
    - error_msg: mensaje de error
    """
    mensaje = (
        f"❌ <b>ERROR - {bot_nombre.upper()}</b>\n"
        f"📍 {local_nombre}\n"
        f"{detalle}\n"
        f"⚠️ {error_msg}\n"
    )

    enviados = destinatarios_para(local_nombre, bot_nombre, 'error')
    for chat_id in enviados:
        enviar_mensaje(chat_id, mensaje)
    print(f'   [TELEGRAM] Error enviado a {len(enviados)} chats')


def notificar_exito(bot_nombre, local_nombre, detalle, num_documento):
    """Notifica un registro procesado exitosamente (contabilidad + local)"""
    mensaje = (
        f"✅ <b>{bot_nombre.upper()}</b>\n"
        f"📍 {local_nombre}\n"
        f"{detalle}\n"
        f"📄 {num_documento}\n"
    )

    enviados = destinatarios_para(local_nombre, bot_nombre, 'exito')
    for chat_id in enviados:
        enviar_mensaje(chat_id, mensaje)
    print(f'   [TELEGRAM] Aviso enviado a {len(enviados)} chats')
