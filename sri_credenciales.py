# -*- coding: utf-8 -*-
"""
Credenciales del SRI administradas desde el panel.

Hasta ahora la clave del portal vivia regada en archivos (BOT_SRI/config.py,
N8N/bot_sri_descargas.py, ~/.foodix/sri.env) y cada cambio de clave rompia los
procesos hasta que alguien la actualizaba a mano en cada sitio. Aca queda UNA
sola, en la base, y todos los modulos que hablan con el SRI la leen de aqui.

La clave se guarda CIFRADA (Fernet). No se repite el error de goti.usuarios,
que guarda las claves en texto plano. La llave de cifrado NO vive en la base:
    - en Render: variable de entorno SRI_CRED_KEY
    - en local:  ~/.foodix/sri_cred.key (se genera sola la primera vez)
Si la llave se pierde (p.ej. redeploy sin la variable), la clave guardada no se
puede leer: el panel lo dice y se vuelve a guardar. Nunca se expone la clave
por el API; solo se dice si hay una guardada y de cuando es.

Tabla: goti.gfc_sri_credenciales (una sola fila, id='portal')
"""
import hashlib
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime

from flask import Blueprint, request, jsonify

bp_sri_cred = Blueprint('sri_credenciales', __name__)

TOKEN_URL = ('https://srienlinea.sri.gob.ec/auth/realms/Internet/protocol/'
             'openid-connect/token')
CATASTRO_URL = ('https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet'
                '/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc')

# Respaldo local para desarrollo: si la tabla esta vacia se leen de aqui.
RUTA_ENV_LOCAL = os.path.join(os.path.expanduser('~'), '.foodix', 'sri.env')


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


# ---------------------------------------------------------------- cifrado

def _llave_fernet():
    """La llave de cifrado, por orden: variable de entorno, archivo local.

    El archivo se genera solo la primera vez. En Render hay que definir
    SRI_CRED_KEY (el disco es efimero y un archivo se perderia en cada deploy).
    """
    k = (os.environ.get('SRI_CRED_KEY') or '').strip()
    if k:
        return k.encode()
    ruta = os.path.join(os.path.expanduser('~'), '.foodix', 'sri_cred.key')
    try:
        if os.path.exists(ruta):
            return open(ruta, 'rb').read().strip()
        from cryptography.fernet import Fernet
        nueva = Fernet.generate_key()
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with open(ruta, 'wb') as f:
            f.write(nueva)
        return nueva
    except Exception:
        return None


def _cifrar(texto):
    from cryptography.fernet import Fernet
    llave = _llave_fernet()
    if not llave:
        raise RuntimeError('no hay llave de cifrado (SRI_CRED_KEY)')
    return Fernet(llave).encrypt(texto.encode()).decode()


def _descifrar(cifrado):
    """Devuelve la clave en claro, o None si la llave no coincide."""
    try:
        from cryptography.fernet import Fernet
        llave = _llave_fernet()
        if not llave:
            return None
        return Fernet(llave).decrypt(cifrado.encode()).decode()
    except Exception:
        return None


# ---------------------------------------------------------------- esquema

def asegurar_tabla(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS goti.gfc_sri_credenciales (
            id              text PRIMARY KEY DEFAULT 'portal',
            ruc             text NOT NULL,
            clave_cifrada   text NOT NULL,
            actualizado_en  timestamptz DEFAULT now(),
            actualizado_por text,
            ultimo_test     timestamptz,
            ultimo_test_ok  boolean,
            ultimo_test_msg text
        )
    """)


def obtener_credenciales(cur=None):
    """(ruc, clave) para los modulos que hablan con el SRI, o (None, None).

    Primero la base; si no hay o no se puede descifrar, el archivo local.
    """
    conn = None
    try:
        if cur is None:
            conn = _db()
            cur = conn.cursor()
        asegurar_tabla(cur)
        if conn:
            conn.commit()
        cur.execute("SELECT ruc, clave_cifrada FROM goti.gfc_sri_credenciales "
                    "WHERE id = 'portal'")
        fila = cur.fetchone()
        if fila:
            clave = _descifrar(fila['clave_cifrada'])
            if clave:
                return fila['ruc'], clave
    except Exception:
        pass
    finally:
        _soltar(conn)

    # respaldo local (desarrollo)
    try:
        cfg = {}
        for linea in open(RUTA_ENV_LOCAL, encoding='utf-8'):
            if '=' in linea and not linea.strip().startswith('#'):
                k, v = linea.strip().split('=', 1)
                cfg[k.strip()] = v.strip()
        if cfg.get('SRI_RUC') and cfg.get('SRI_CLAVE'):
            return cfg['SRI_RUC'], cfg['SRI_CLAVE']
    except Exception:
        pass
    return None, None


# ---------------------------------------------------------------- endpoints

@bp_sri_cred.route('/api/sri/credenciales', methods=['GET'])
def cred_estado():
    """Estado de la credencial guardada. NUNCA devuelve la clave."""
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)
        conn.commit()
        cur.execute("""SELECT ruc, clave_cifrada, actualizado_en, actualizado_por,
                              ultimo_test, ultimo_test_ok, ultimo_test_msg
                         FROM goti.gfc_sri_credenciales WHERE id = 'portal'""")
        fila = cur.fetchone()
        if not fila:
            return jsonify({'success': True, 'guardada': False,
                            'nota': 'No hay credenciales guardadas todavia.'})
        legible = _descifrar(fila['clave_cifrada']) is not None
        return jsonify({
            'success': True, 'guardada': True,
            'ruc': fila['ruc'],
            'clave_legible': legible,
            'actualizado_en': fila['actualizado_en'].isoformat()
                if fila['actualizado_en'] else None,
            'actualizado_por': fila['actualizado_por'],
            'ultimo_test': fila['ultimo_test'].isoformat()
                if fila['ultimo_test'] else None,
            'ultimo_test_ok': fila['ultimo_test_ok'],
            'ultimo_test_msg': fila['ultimo_test_msg'],
            'nota': (None if legible else
                     'La clave guardada no se puede descifrar (cambio la llave '
                     'SRI_CRED_KEY). Hay que volver a guardarla.'),
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'estado de credenciales')
    finally:
        _soltar(conn)


@bp_sri_cred.route('/api/sri/credenciales', methods=['POST'])
def cred_guardar():
    d = request.get_json(silent=True) or {}
    ruc = (d.get('ruc') or '').strip()
    clave = d.get('clave') or ''
    if len(ruc) != 13 or not ruc.isdigit():
        return jsonify({'success': False,
                        'error': 'El RUC debe tener 13 digitos'}), 400
    if len(clave) < 4:
        return jsonify({'success': False,
                        'error': 'La clave esta vacia o es demasiado corta'}), 400

    conn = None
    try:
        cifrada = _cifrar(clave)
        conn = _db()
        cur = conn.cursor()
        asegurar_tabla(cur)
        cur.execute("""INSERT INTO goti.gfc_sri_credenciales
                           (id, ruc, clave_cifrada, actualizado_en, actualizado_por,
                            ultimo_test, ultimo_test_ok, ultimo_test_msg)
                       VALUES ('portal', %s, %s, now(), %s, NULL, NULL, NULL)
                       ON CONFLICT (id) DO UPDATE SET
                           ruc = EXCLUDED.ruc,
                           clave_cifrada = EXCLUDED.clave_cifrada,
                           actualizado_en = now(),
                           actualizado_por = EXCLUDED.actualizado_por,
                           ultimo_test = NULL, ultimo_test_ok = NULL,
                           ultimo_test_msg = NULL""",
                    (ruc, cifrada, (d.get('usuario') or '').strip() or None))
        conn.commit()
        return jsonify({'success': True,
                        'nota': 'Credenciales guardadas (clave cifrada). '
                                'Usa Probar conexion para verificarlas.'})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'guardar credenciales')
    finally:
        _soltar(conn)


@bp_sri_cred.route('/api/sri/credenciales/probar', methods=['POST'])
def cred_probar():
    """Verifica la credencial contra el SRI. UN solo intento de login: el SRI
    bloquea la cuenta tras varios fallos, asi que aqui no se insiste."""
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        ruc, clave = obtener_credenciales(cur)
        if not ruc:
            return jsonify({'success': False,
                            'error': 'No hay credenciales guardadas'}), 400

        resultados = {}

        # 1. Login por API (Keycloak direct grant, clave como MD5+SHA512)
        pwd = (hashlib.md5(clave.encode()).hexdigest()
               + hashlib.sha512(clave.encode()).hexdigest())
        cuerpo = urllib.parse.urlencode({
            'client_id': 'app-sri-claves-angular', 'grant_type': 'password',
            'username': ruc, 'password': pwd, 'scope': 'openid'}).encode()
        try:
            req = urllib.request.Request(TOKEN_URL, data=cuerpo, headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                tok = json.loads(r.read().decode())
            resultados['login'] = {
                'ok': True,
                'detalle': 'Login correcto (token de %s s)' % tok.get('expires_in')}
        except urllib.error.HTTPError as e:
            det = e.read().decode('utf-8', 'replace')[:200]
            resultados['login'] = {
                'ok': False,
                'detalle': ('Clave rechazada por el SRI' if 'invalid_grant' in det
                            else 'HTTP %d: %s' % (e.code, det))}
        except Exception as e:
            resultados['login'] = {'ok': False,
                                   'detalle': '%s: %s' % (type(e).__name__,
                                                          str(e)[:120])}

        # 2. Catastro publico (sin clave): confirma que el RUC existe y su estado
        try:
            req = urllib.request.Request('%s?ruc=%s' % (CATASTRO_URL, ruc),
                                         headers={'User-Agent': 'Mozilla/5.0',
                                                  'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=20) as r:
                datos = json.loads(r.read().decode())
            if datos:
                resultados['catastro'] = {
                    'ok': True,
                    'detalle': '%s — %s' % (datos[0].get('razonSocial', '?'),
                                            datos[0].get('estadoContribuyenteRuc', '?'))}
            else:
                resultados['catastro'] = {'ok': False,
                                          'detalle': 'El RUC no existe en el SRI'}
        except Exception as e:
            resultados['catastro'] = {'ok': False,
                                      'detalle': '%s: %s' % (type(e).__name__,
                                                             str(e)[:120])}

        ok = resultados['login']['ok']
        msg = '; '.join('%s: %s' % (k, v['detalle']) for k, v in resultados.items())
        asegurar_tabla(cur)
        cur.execute("""UPDATE goti.gfc_sri_credenciales
                          SET ultimo_test = now(), ultimo_test_ok = %s,
                              ultimo_test_msg = %s
                        WHERE id = 'portal'""", (ok, msg[:400]))
        conn.commit()

        return jsonify({'success': True, 'ok': ok, 'resultados': resultados})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'probar credenciales')
    finally:
        _soltar(conn)
