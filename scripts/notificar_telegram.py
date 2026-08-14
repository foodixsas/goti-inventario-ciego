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

    enviados = set()

    # Enviar a contabilidad siempre
    for chat_id in CHAT_CONTABILIDAD:
        if chat_id not in enviados:
            enviar_mensaje(chat_id, mensaje)
            enviados.add(chat_id)

    # Enviar al local correspondiente
    chats_local = CHATS_POR_LOCAL.get(local_nombre, [])
    for chat_id in chats_local:
        if chat_id not in enviados:
            enviar_mensaje(chat_id, mensaje)
            enviados.add(chat_id)

    print(f'   [TELEGRAM] Notificacion enviada a {len(enviados)} chats')


def notificar_exito(bot_nombre, local_nombre, detalle, num_documento):
    """Notifica un registro procesado exitosamente (contabilidad + local)"""
    mensaje = (
        f"✅ <b>{bot_nombre.upper()}</b>\n"
        f"📍 {local_nombre}\n"
        f"{detalle}\n"
        f"📄 {num_documento}\n"
    )

    enviados = set()

    # Enviar a contabilidad (consolidado JN + Shavii)
    for chat_id in CHAT_CONTABILIDAD:
        if chat_id not in enviados:
            enviar_mensaje(chat_id, mensaje)
            enviados.add(chat_id)

    # Enviar al local
    chats_local = CHATS_POR_LOCAL.get(local_nombre, [])
    for chat_id in chats_local:
        if chat_id not in enviados:
            enviar_mensaje(chat_id, mensaje)
            enviados.add(chat_id)

    print(f'   [TELEGRAM] Notificacion enviada a {len(enviados)} chats')
