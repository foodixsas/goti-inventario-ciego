# -*- coding: utf-8 -*-
"""
Importacion directa desde el portal del SRI, por HTTP puro y sin navegador.

Que resuelve
------------
El web service publico solo entrega el XML ~3 dias despues de la autorizacion.
Para lo anterior hay que ir al portal autenticado. Bajarlo pulsando enlaces en
Chrome resulto fragil por diseno (modales, permiso de descargas multiples,
paginador que se resetea, navegador que muere): todo el 14-sep se fue en eso.

Aca el flujo del portal se hace a mano por HTTP:
  1. Login Keycloak con la clave transformada (MD5+SHA512 pegados) y luego el
     j_security_check de Java EE que exige la app de comprobantes.
  2. POST de la consulta (anio/mes/tipo) con el juego MINIMO de campos JSF.
     Mandar todos los inputs de la pagina hace que el servidor evalue acciones
     equivocadas y responda 500 ('Method not found: descargarArchivoDocumento').
  3. POST del commandLink de cada fila -> el XML del comprobante.

El endpoint trabaja por LOTES cortos (pocos XML por llamada) para caber en el
timeout del servidor web; la pantalla lo llama en bucle mostrando el avance.
La sesion del portal se cachea unos minutos entre llamadas.

Las credenciales salen de goti.gfc_sri_credenciales (pantalla Credenciales SRI).
"""
import hashlib
import re
import time
import urllib.parse
import uuid

from flask import Blueprint, request, jsonify

bp_sri_portal = Blueprint('sri_portal', __name__)

URL_RECIBIDOS = ('https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa'
                 '?redireccion=57&idGrupo=55')
MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
         'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
TIPOS = ['Factura', 'Notas de Credito',
         'Liquidacion de compra de bienes y prestacion de servicios']

CLAVE49 = re.compile(r'(\d{49})')

# Sesion del portal cacheada por proceso: el login cuesta 10-20 s y la pantalla
# llama al endpoint en bucle. {'s', 'url', 'html', 'cuando'}
_CACHE = {}
_VIDA_SESION = 8 * 60


def _db():
    from app import get_db
    return get_db()


def _soltar(conn):
    if conn is None:
        return
    from app import release_db
    release_db(conn)


# ---------------------------------------------------------------- login

def _entrar(ruc, clave):
    """(sesion_requests, respuesta_formulario) o (None, motivo)."""
    try:
        return _entrar_crudo(ruc, clave)
    except Exception as e:
        return None, '%s: %s' % (type(e).__name__, str(e)[:100])


def _entrar_crudo(ruc, clave):
    import requests
    s = requests.Session()
    s.headers.update({
        'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/152.0.0.0 Safari/537.36'),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
    })
    clave_hash = (hashlib.md5(clave.encode()).hexdigest()
                  + hashlib.sha512(clave.encode()).hexdigest())
    url_auth = ('https://srienlinea.sri.gob.ec/auth/realms/Internet/protocol/'
                'openid-connect/auth?' + urllib.parse.urlencode({
                    'client_id': 'app-sri-claves-angular',
                    'redirect_uri': ('https://srienlinea.sri.gob.ec/sri-en-linea//'
                                     'contribuyente/perfil'),
                    'state': str(uuid.uuid4()), 'nonce': str(uuid.uuid4()),
                    'response_mode': 'fragment', 'response_type': 'code',
                    'scope': 'openid'}))
    r = s.get(url_auth, timeout=45)
    m = re.search(r'action="(https://srienlinea\.sri\.gob\.ec/auth[^"]+)"', r.text)
    if not m:
        return None, 'no vino el formulario de Keycloak'
    campos = {}
    for mm in re.finditer(r'<input[^>]+>', r.text):
        nom = re.search(r'name="([^"]+)"', mm.group(0))
        if nom:
            val = re.search(r'value="([^"]*)"', mm.group(0))
            campos[nom.group(1)] = val.group(1) if val else ''
    campos.update({'username': ruc, 'usuario': ruc, 'ciAdicional': '',
                   'password': clave_hash})
    campos.pop('login', None)
    s.post(m.group(1).replace('&amp;', '&'), data=campos, timeout=45,
           headers={'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://srienlinea.sri.gob.ec', 'Referer': r.url})

    for _ in range(3):
        r3 = s.get(URL_RECIBIDOS, timeout=45)
        if 'frmPrincipal' in r3.text:
            return s, r3
        if 'j_security_check' in r3.text:
            jee = dict(re.findall(r'name="?(j_\w+)"?\s+value="?([^"\s/>]+)"?',
                                  r3.text))
            base = (r3.url.split('/pages/')[0] if '/pages/' in r3.url else
                    'https://srienlinea.sri.gob.ec/comprobantes-electronicos-internet')
            s.post(base + '/j_security_check', data=jee, timeout=45,
                   headers={'Content-Type': 'application/x-www-form-urlencoded'})
            r3 = s.get(URL_RECIBIDOS, timeout=45)
            if 'frmPrincipal' in r3.text:
                return s, r3
        time.sleep(4)
    return None, 'la sesion no llego a comprobantes recibidos'


def _sesion(ruc, clave, forzar=False):
    """La sesion cacheada si sigue fresca; si no, entra de nuevo (2 intentos)."""
    if (not forzar and _CACHE.get('s') is not None
            and time.time() - _CACHE.get('cuando', 0) < _VIDA_SESION):
        return _CACHE['s'], _CACHE['url'], _CACHE['html'], None
    ultimo = 'sin intento'
    for i in range(2):
        s, r = _entrar(ruc, clave)
        if s is not None:
            _CACHE.update({'s': s, 'url': r.url, 'html': r.text,
                           'cuando': time.time()})
            return s, r.url, r.text, None
        ultimo = r
        time.sleep(6)
    _CACHE.clear()
    return None, None, None, ultimo


# ---------------------------------------------------------------- JSF

def _campos_del_form(html):
    datos = {}
    for mm in re.finditer(r'<input[^>]+>', html):
        tag = mm.group(0)
        nom = re.search(r'name="([^"]+)"', tag)
        if not nom:
            continue
        mt = re.search(r'type="([^"]+)"', tag)
        tipo = mt.group(1) if mt else 'text'
        if tipo in ('radio', 'checkbox') and 'checked' not in tag:
            continue
        val = re.search(r'value="([^"]*)"', tag)
        datos[nom.group(1)] = val.group(1) if val else ''
    for mm in re.finditer(r'<select[^>]+name="([^"]+)"[^>]*>(.*?)</select>',
                          html, re.S):
        sel = re.search(r'<option[^>]+value="([^"]*)"[^>]*selected', mm.group(2))
        if sel:
            datos[mm.group(1)] = sel.group(1)
        else:
            pri = re.search(r'<option[^>]+value="([^"]*)"', mm.group(2))
            datos[mm.group(1)] = pri.group(1) if pri else ''
    return datos


def _sin_tildes(t):
    tabla = {u'á': 'a', u'é': 'e', u'í': 'i', u'ó': 'o', u'ú': 'u', u'ñ': 'n',
             u'Á': 'a', u'É': 'e', u'Í': 'i', u'Ó': 'o', u'Ú': 'u', u'Ñ': 'n'}
    return ''.join(tabla.get(c, c) for c in (t or '').strip().lower())


def _valor_de_opcion(html, nombre_select, texto):
    m = re.search(r'<select[^>]+name="%s"[^>]*>(.*?)</select>'
                  % re.escape(nombre_select), html, re.S)
    if not m:
        return None
    for om in re.finditer(r'<option[^>]+value="([^"]*)"[^>]*>([^<]*)</option>',
                          m.group(1)):
        if _sin_tildes(om.group(2)).startswith(_sin_tildes(texto)[:12]):
            return om.group(1)
    return None


def _boton_consulta(html):
    """Id del boton que dispara la consulta, leido del formulario.

    El portal ya lo renombro una vez. Se buscan los nombres conocidos y, si no
    aparece ninguno, cualquier submit del formulario que no sea "Anterior".
    """
    for conocido in ('frmPrincipal:btnBuscar', 'frmPrincipal:btnConsultarSinRe',
                     'frmPrincipal:btnConsultar'):
        if 'id="%s"' % conocido in html:
            return conocido
    for m in re.finditer(r'<input[^>]*id="(frmPrincipal:[^"]+)"[^>]*>', html):
        etiqueta = m.group(0)
        if 'submit' in etiqueta and 'Anterior' not in etiqueta:
            return m.group(1)
    return 'frmPrincipal:btnBuscar'


def _consultar(s, url_form, html, anio, mes, tipo):
    """POST minimo de la consulta. (respuesta, error, filtros_usados)."""
    todos = _campos_del_form(html)
    datos = {}
    if 'javax.faces.ViewState' in todos:
        datos['javax.faces.ViewState'] = todos['javax.faces.ViewState']
    for k, v in todos.items():
        if 'ruc' in k.lower() or 'cedula' in k.lower() or 'radio' in k.lower():
            datos[k] = v
    v_tipo = _valor_de_opcion(html, 'frmPrincipal:cmbTipoComprobante', tipo)
    if v_tipo is None:
        return None, 'el portal no ofrece el tipo %s' % tipo, {}
    v_mes = _valor_de_opcion(html, 'frmPrincipal:mes', MESES[mes - 1])
    if v_mes is None:
        return None, 'no aparece el mes en el desplegable', {}
    datos['frmPrincipal:ano'] = (_valor_de_opcion(html, 'frmPrincipal:ano',
                                                  str(anio)) or str(anio))
    datos['frmPrincipal:mes'] = v_mes
    datos['frmPrincipal:dia'] = (_valor_de_opcion(html, 'frmPrincipal:dia',
                                                  'Todos') or '')
    datos['frmPrincipal:cmbTipoComprobante'] = v_tipo
    # El boton de consulta se LEE de la pagina, no se escribe a mano. El portal
    # lo renombro (`btnConsultarSinRe` -> `btnBuscar`) y con el nombre viejo el
    # POST no dispara la busqueda: vuelve el formulario en blanco, que este
    # codigo leia como "mes sin datos" y marcaba el periodo completo. Asi se
    # perdieron 197 de 285 periodos sin que nada avisara.
    datos[_boton_consulta(html)] = 'Consultar'
    datos['frmPrincipal'] = 'frmPrincipal'
    r = s.post(url_form, data=datos, timeout=120,
               headers={'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': url_form,
                        'Origin': 'https://srienlinea.sri.gob.ec'})
    # El boton no forma parte de los filtros: reenviarlo en la descarga
    # volveria a lanzar la consulta en vez de entregar el XML.
    filtros = {k: v for k, v in datos.items()
               if k != 'javax.faces.ViewState'
               and not k.startswith('frmPrincipal:btn')}
    return r, None, filtros


def _filas(html):
    """[(id_del_enlace, clave_acceso)] de la tabla de resultados.

    La clave se lee de la CELDA que tiene exactamente 49 digitos. Buscarla con
    un regex sobre la fila entera daba claves CORRIDAS: el RUC del emisor
    (13 digitos, celda anterior) pegado a la clave forma una cadena mas larga y
    el regex arrancaba en el RUC, devolviendo 49 digitos que no son la clave.
    Con eso el dedupe no reconocia lo ya descargado y se repetia todo.
    """
    salida = []
    for fila in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S):
        mid = re.search(r'id="(frmPrincipal:tablaCompRecibidos:\d+:lnkXml)"', fila)
        if not mid:
            continue
        clave = None
        for celda in re.findall(r'<td[^>]*>(.*?)</td>', fila, re.S):
            texto = re.sub(r'\s+', '', re.sub(r'<[^>]+>', ' ', celda))
            if len(texto) == 49 and texto.isdigit():
                clave = texto
                break
        salida.append((mid.group(1), clave))
    return salida


def _bajar_xml(s, url_form, html, id_enlace, filtros):
    """POST del commandLink: la respuesta deberia ser el XML del comprobante."""
    todos = _campos_del_form(html)
    datos = {'frmPrincipal': 'frmPrincipal'}
    if 'javax.faces.ViewState' in todos:
        datos['javax.faces.ViewState'] = todos['javax.faces.ViewState']
    datos.update(filtros or {})
    datos[id_enlace] = id_enlace
    return s.post(url_form, data=datos, timeout=120,
                  headers={'Content-Type': 'application/x-www-form-urlencoded',
                           'Referer': url_form,
                           'Origin': 'https://srienlinea.sri.gob.ec'})


# ---------------------------------------------------------------- endpoint

@bp_sri_portal.route('/api/sri/portal/importar', methods=['POST'])
def portal_importar():
    """Importa comprobantes de UN mes y UN tipo, en lotes cortos.

    Entrada: {"anio": 2022, "mes": 1, "tipo_idx": 0, "lote": 10}
    La pantalla lo llama en bucle: mientras `pendientes` > 0 con el mismo
    mes/tipo, y luego pasa al siguiente tipo_idx (0..2).
    """
    d = request.get_json(silent=True) or {}
    try:
        anio, mes = int(d.get('anio')), int(d.get('mes'))
        tipo_idx = int(d.get('tipo_idx', 0))
        lote = max(1, min(int(d.get('lote', 10)), 20))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'anio/mes invalidos'}), 400
    if not (2020 <= anio <= 2035 and 1 <= mes <= 12 and 0 <= tipo_idx < len(TIPOS)):
        return jsonify({'success': False, 'error': 'parametros fuera de rango'}), 400
    tipo = TIPOS[tipo_idx]

    from sri_credenciales import obtener_credenciales
    from sri_facturas import asegurar_tablas, guardar, normalizar

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()

        ruc, clave = obtener_credenciales(cur)
        if not ruc:
            return jsonify({'success': False,
                            'error': 'No hay credenciales del SRI guardadas. '
                                     'Configuralas en Credenciales SRI.'}), 400

        s, url_form, html_form, err = _sesion(ruc, clave)
        if s is None:
            return jsonify({'success': False,
                            'error': 'No se pudo entrar al portal del SRI: %s. '
                                     'El portal suele saturarse en horario de '
                                     'oficina; vale reintentar mas tarde.' % err}), 502

        r_tabla, err, filtros = _consultar(s, url_form, html_form, anio, mes, tipo)
        if err:
            # tipo inexistente en el desplegable = nada que hacer con el
            return jsonify({'success': True, 'tipo': tipo, 'guardados': 0,
                            'ya_estaban': 0, 'sin_xml': 0, 'pendientes': 0,
                            'nota': err})
        if r_tabla.status_code != 200 or 'frmPrincipal' not in r_tabla.text:
            _CACHE.clear()       # la vista quedo en mal estado: sesion nueva
            return jsonify({'success': False,
                            'error': 'La consulta devolvio HTTP %d; se reintentara '
                                     'con sesion nueva.' % r_tabla.status_code}), 502

        filas = _filas(r_tabla.text)
        if not filas:
            hay_aviso = 'no existen datos' in r_tabla.text.lower()
            return jsonify({'success': True, 'tipo': tipo, 'guardados': 0,
                            'ya_estaban': 0, 'sin_xml': 0, 'pendientes': 0,
                            'nota': ('El mes no tiene comprobantes de este tipo'
                                     if hay_aviso else
                                     'La consulta no trajo filas (sin aviso del '
                                     'portal); conviene reintentar.')})

        claves = [c for _, c in filas if c]
        cur.execute("""SELECT clave_acceso FROM goti.gfc_sri_comprobantes
                        WHERE clave_acceso = ANY(%s) AND xml IS NOT NULL""",
                    (claves,))
        ya = {r['clave_acceso'] for r in cur.fetchall()}
        por_bajar = [(eid, c) for eid, c in filas if not (c and c in ya)]

        guardados = sin_xml = 0
        detalles = []
        for eid, clave_acc in por_bajar[:lote]:
            try:
                r = _bajar_xml(s, r_tabla.url, r_tabla.text, eid, filtros)
            except Exception as e:
                sin_xml += 1
                detalles.append('%s: %s' % (eid.split(':')[-2],
                                            type(e).__name__))
                continue
            texto = r.text if hasattr(r, 'text') else ''
            es_xml = (texto.lstrip().startswith('<?xml')
                      or 'xml' in (r.headers.get('Content-Type') or '').lower())
            if r.status_code != 200 or not es_xml:
                sin_xml += 1
                detalles.append('%s: HTTP %d, no era XML'
                                % (eid.split(':')[-2], r.status_code))
                continue
            try:
                t = normalizar(texto)
                m = re.search(r'<comprobante>(.*?)</comprobante>', t, re.S)
                cuerpo = m.group(1) if m else t
                cd = re.search(r'<!\[CDATA\[(.*?)\]\]>', cuerpo, re.S)
                xml = (cd.group(1) if cd else cuerpo).strip()
                if not xml.startswith('<'):
                    xml = (xml.replace('&lt;', '<').replace('&gt;', '>')
                              .replace('&amp;', '&'))
                fa = ''
                mf = re.search(r'<fechaAutorizacion>(.*?)</fechaAutorizacion>', t)
                if mf:
                    fa = mf.group(1).strip()
                mc = CLAVE49.search(xml)
                clave_final = clave_acc or (mc.group(1) if mc else '')
                guardar(cur, xml, clave_final, 'AUTORIZADO',
                        origen='portal_http', fecha_aut=fa)
                conn.commit()
                guardados += 1
            except Exception as e:
                conn.rollback()
                sin_xml += 1
                detalles.append('%s: %s' % (eid.split(':')[-2], str(e)[:60]))
            time.sleep(0.4)

        pendientes = max(0, len(por_bajar) - lote) + sin_xml
        return jsonify({'success': True, 'tipo': tipo,
                        'en_pagina': len(filas), 'ya_estaban': len(ya),
                        'guardados': guardados, 'sin_xml': sin_xml,
                        'pendientes': pendientes,
                        'detalles': detalles[:6]})
    except Exception as e:
        if conn:
            conn.rollback()
        _CACHE.clear()
        return jsonify({'success': False,
                        'error': 'importar del portal: %s' % str(e)[:200]}), 500
    finally:
        _soltar(conn)
