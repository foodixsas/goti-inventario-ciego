# -*- coding: utf-8 -*-
"""
Facturas recibidas del SRI: el XML completo, guardado en la base y visible en PDF.

Por que existe este modulo
--------------------------
Hasta ahora, de una factura de compra solo teniamos los 14 campos de cabecera
que trae el TXT del portal del SRI: quien emitio, cuanto, y la clave de acceso.
El detalle de linea -- que producto, cuanto, a que precio -- no estaba en
ninguna parte, y es justo lo que hace falta para cuadrar inventario y costos.

Ese detalle si se puede traer: el SRI publica un web service SIN login
(`AutorizacionComprobantesOffline`) que, dandole la clave de acceso de 49
digitos, devuelve el XML entero del comprobante.

El limite que manda el diseno
-----------------------------
**El XML caduca.** Medido el 11-sep-2026 contra compras reales: de 1 a 3 dias
responde siempre, al cuarto es frontera, de 5 en adelante el SRI contesta
`numeroComprobantes = 0` (junio dio cero de 801 claves). Por eso el XML
completo se guarda en la columna `xml` de la cabecera: una vez capturado es
nuestro, y el PDF se regenera cuando sea sin volver a pedirselo al SRI.

Con que se vincula al resto del sistema
---------------------------------------
La llave es `clave_acceso` (49 digitos), que en Contifico se llama
`autorizacion`. Con eso esta tabla cruza contra `documentos_api` y
`fact_detallada_compras` de la base `movimientos`, y permite ver que factura
llego al SRI pero no se registro en Contifico -- y al reves.

Lo unico que sigue siendo manual es el LISTADO: el portal de comprobantes
recibidos es una app JSF sin API (probado: las rutas REST dan 404 y las de
/movil-servicios las rechaza el F5 que tiene delante). Asi que se sube el TXT
del portal y de ahi en adelante todo es automatico.

Tablas: goti.gfc_sri_comprobantes y goti.gfc_sri_comprobantes_detalle
"""
import json
import os
import re
import tempfile
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime

from flask import Blueprint, request, jsonify, Response

bp_sri_facturas = Blueprint('sri_facturas', __name__)

WS_SRI = ('https://cel.sri.gob.ec/comprobantes-electronicos-ws'
          '/AutorizacionComprobantesOffline')

_SOBRE = ('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
          'xmlns:ec="http://ec.gob.sri.ws.autorizacion">'
          '<soapenv:Header/><soapenv:Body><ec:autorizacionComprobante>'
          '<claveAccesoComprobante>%s</claveAccesoComprobante>'
          '</ec:autorizacionComprobante></soapenv:Body></soapenv:Envelope>')


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


# ---------------------------------------------------------------- esquema

def asegurar_tablas(cur):
    """Idempotente: corre en cada llamada, igual que el resto de la app."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS goti.gfc_sri_comprobantes (
            clave_acceso            text PRIMARY KEY,
            tipo_comprobante        text,
            cod_doc                 text,
            serie                   text,
            ruc_emisor              text,
            razon_social_emisor     text,
            nombre_comercial        text,
            fecha_emision           date,
            fecha_autorizacion      text,
            identificacion_receptor text,
            valor_sin_impuestos     numeric(14,2),
            iva                     numeric(14,2),
            importe_total           numeric(14,2),
            estado_sri              text,
            ambiente                text,
            dir_establecimiento     text,
            info_adicional          jsonb,
            formas_pago             jsonb,
            xml                     text,
            origen                  text,
            descargado_en           timestamptz DEFAULT now(),
            creado_en               timestamptz DEFAULT now()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS goti.gfc_sri_comprobantes_detalle (
            id                        bigserial PRIMARY KEY,
            clave_acceso              text NOT NULL
                REFERENCES goti.gfc_sri_comprobantes(clave_acceso) ON DELETE CASCADE,
            linea                     integer NOT NULL,
            codigo_principal          text,
            codigo_auxiliar           text,
            descripcion               text,
            cantidad                  numeric(18,6),
            precio_unitario           numeric(18,6),
            descuento                 numeric(14,2),
            precio_total_sin_impuesto numeric(14,2),
            iva_tarifa                numeric(6,2),
            iva_valor                 numeric(14,2),
            UNIQUE (clave_acceso, linea)
        )
    """)
    cur.execute("""CREATE INDEX IF NOT EXISTS gfc_sri_comp_fecha_idx
                     ON goti.gfc_sri_comprobantes (fecha_emision)""")
    cur.execute("""CREATE INDEX IF NOT EXISTS gfc_sri_comp_ruc_idx
                     ON goti.gfc_sri_comprobantes (ruc_emisor)""")


# ---------------------------------------------------------------- SRI

def envolver_autorizacion(xml, clave, estado='AUTORIZADO', fecha_aut='',
                          ambiente='PRODUCCION'):
    """Devuelve el comprobante dentro del sobre <autorizacion> que espera el
    generador de RIDE.

    Guardamos el comprobante desnudo (es lo util para consultar y cruzar), pero
    `ride/xml_parser.py` fue escrito para la respuesta completa del SRI, donde
    el comprobante viaja dentro del CDATA de <comprobante>. Reconstruir el
    sobre sale mas barato que tocar un generador ya probado.
    """
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<autorizacion>'
            '<estado>%s</estado>'
            '<numeroAutorizacion>%s</numeroAutorizacion>'
            '<fechaAutorizacion>%s</fechaAutorizacion>'
            '<ambiente>%s</ambiente>'
            '<comprobante><![CDATA[%s]]></comprobante>'
            '</autorizacion>') % (estado or '', clave or '', fecha_aut or '',
                                  ambiente or '', normalizar(xml))


def pedir_xml_al_sri(clave, timeout=45):
    """Devuelve (estado, xml, fecha_autorizacion). No necesita login ni token."""
    req = urllib.request.Request(
        WS_SRI, data=(_SOBRE % clave).encode('utf-8'),
        headers={'Content-Type': 'text/xml; charset=utf-8',
                 'SOAPAction': '', 'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return 'HTTP %d' % e.code, None, ''
    except Exception as e:
        return type(e).__name__, None, ''

    if '<numeroComprobantes>0</numeroComprobantes>' in resp.replace(' ', ''):
        # El SRI ya no lo tiene: el XML caduca a los pocos dias de emitido.
        return 'NO_DISPONIBLE', None, ''

    m_est = re.search(r'<estado>(.*?)</estado>', resp, re.S)
    estado = m_est.group(1).strip() if m_est else '?'
    m_fec = re.search(r'<fechaAutorizacion>(.*?)</fechaAutorizacion>', resp, re.S)
    fecha_aut = m_fec.group(1).strip() if m_fec else ''

    m = re.search(r'<comprobante>(.*?)</comprobante>', resp, re.S)
    if not m:
        return estado, None, fecha_aut
    cuerpo = m.group(1)
    cd = re.search(r'<!\[CDATA\[(.*?)\]\]>', cuerpo, re.S)
    xml = cd.group(1) if cd else cuerpo
    if not xml.lstrip().startswith('<'):
        xml = (xml.replace('&lt;', '<').replace('&gt;', '>')
                  .replace('&quot;', '"').replace('&amp;', '&'))
    return estado, xml.strip(), fecha_aut


# ---------------------------------------------------------------- parseo

def _txt(nodo, tag, default=''):
    if nodo is None:
        return default
    hijo = nodo.find(tag)
    return (hijo.text or '').strip() if hijo is not None and hijo.text else default


def _num(v):
    try:
        return float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def _fecha(txt):
    """El SRI manda dd/mm/aaaa."""
    for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime((txt or '').strip()[:10], fmt).date()
        except ValueError:
            continue
    return None


TIPOS = {'01': 'Factura', '03': 'Liquidacion de compra', '04': 'Nota de Credito',
         '05': 'Nota de Debito', '06': 'Guia de Remision',
         '07': 'Comprobante de Retencion'}


def normalizar(xml):
    """Deja el XML en condiciones de ser parseado, sin cambiar su contenido.

    Hay emisores que mandan el retorno de carro escapado (`&#xD;`) al final de
    cada linea, incluida la que sigue a la declaracion `<?xml ?>`. El SRI los
    autoriza igual, pero ahi ningun parser estricto puede seguir: una referencia
    de caracter no puede ir antes del elemento raiz. Caso real: AGRICOLA LOS
    VOLCANES, factura 001-002-000017654 del 10-sep-2026.

    Esto se aplica SOLO en memoria, al leer. En la base se guarda el XML tal
    como vino del SRI: modificarlo invalidaria la firma electronica.
    """
    limpio = (xml or '').lstrip('﻿').strip()
    limpio = limpio.replace('&#xD;', '').replace('&#xd;', '').replace('&#13;', '')
    return limpio


def desmenuzar_xml(xml, clave):
    """Saca del XML la cabecera y las lineas. Sirve para factura, nota de
    credito y retencion: los tres comparten `infoTributaria`."""
    raiz = ET.fromstring(normalizar(xml).encode('utf-8'))
    trib = raiz.find('.//infoTributaria')
    info = raiz.find('.//infoFactura')
    if info is None:
        info = raiz.find('.//infoNotaCredito')
    if info is None:
        info = raiz.find('.//infoCompRetencion')

    cod_doc = _txt(trib, 'codDoc')
    estab, pto, sec = (_txt(trib, 'estab'), _txt(trib, 'ptoEmi'),
                       _txt(trib, 'secuencial'))

    total_sin = _num(_txt(info, 'totalSinImpuestos'))
    importe = _num(_txt(info, 'importeTotal'))

    # El IVA no viene como campo suelto: se suma de totalConImpuestos.
    iva = 0.0
    for ti in raiz.findall('.//totalImpuesto'):
        if _txt(ti, 'codigo') == '2':          # 2 = IVA
            iva += _num(_txt(ti, 'valor')) or 0.0

    adicionales = {}
    for c in raiz.findall('.//campoAdicional'):
        n = (c.get('nombre') or '').strip()
        if n:
            adicionales[n] = (c.text or '').strip()

    pagos = [{'formaPago': _txt(p, 'formaPago'), 'total': _txt(p, 'total'),
              'plazo': _txt(p, 'plazo')} for p in raiz.findall('.//pago')]

    cabecera = {
        'clave_acceso': _txt(trib, 'claveAcceso') or clave,
        'tipo_comprobante': TIPOS.get(cod_doc, cod_doc or '?'),
        'cod_doc': cod_doc,
        'serie': '%s-%s-%s' % (estab, pto, sec) if sec else '',
        'ruc_emisor': _txt(trib, 'ruc'),
        'razon_social_emisor': _txt(trib, 'razonSocial'),
        'nombre_comercial': _txt(trib, 'nombreComercial'),
        'fecha_emision': _fecha(_txt(info, 'fechaEmision')),
        'identificacion_receptor': _txt(info, 'identificacionComprador'),
        'valor_sin_impuestos': total_sin,
        'iva': iva,
        'importe_total': importe,
        'ambiente': 'PRODUCCION' if _txt(trib, 'ambiente') == '2' else 'PRUEBAS',
        'dir_establecimiento': _txt(info, 'dirEstablecimiento'),
        'info_adicional': adicionales,
        'formas_pago': pagos,
    }

    lineas = []
    for i, d in enumerate(raiz.findall('.//detalle'), 1):
        iva_tarifa = iva_valor = None
        for imp in d.findall('.//impuesto'):
            if _txt(imp, 'codigo') == '2':
                iva_tarifa = _num(_txt(imp, 'tarifa'))
                iva_valor = _num(_txt(imp, 'valor'))
                break
        lineas.append({
            'linea': i,
            'codigo_principal': _txt(d, 'codigoPrincipal') or _txt(d, 'codigoInterno'),
            'codigo_auxiliar': _txt(d, 'codigoAuxiliar') or _txt(d, 'codigoAdicional'),
            'descripcion': _txt(d, 'descripcion'),
            'cantidad': _num(_txt(d, 'cantidad')),
            'precio_unitario': _num(_txt(d, 'precioUnitario')),
            'descuento': _num(_txt(d, 'descuento')),
            'precio_total_sin_impuesto': _num(_txt(d, 'precioTotalSinImpuesto')),
            'iva_tarifa': iva_tarifa,
            'iva_valor': iva_valor,
        })
    return cabecera, lineas


def guardar(cur, xml, clave, estado, origen='txt_sri', fecha_aut=''):
    """Upsert por clave de acceso. Re-guardar el mismo comprobante no duplica
    nada: la cabecera se reemplaza y las lineas se rehacen."""
    cab, lineas = desmenuzar_xml(xml, clave)
    cur.execute("""
        INSERT INTO goti.gfc_sri_comprobantes
            (clave_acceso, tipo_comprobante, cod_doc, serie, ruc_emisor,
             razon_social_emisor, nombre_comercial, fecha_emision,
             identificacion_receptor, valor_sin_impuestos, iva, importe_total,
             estado_sri, ambiente, dir_establecimiento, info_adicional,
             formas_pago, xml, origen, fecha_autorizacion, descargado_en)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
        ON CONFLICT (clave_acceso) DO UPDATE SET
            tipo_comprobante    = EXCLUDED.tipo_comprobante,
            serie               = EXCLUDED.serie,
            fecha_emision       = EXCLUDED.fecha_emision,
            fecha_autorizacion  = COALESCE(NULLIF(EXCLUDED.fecha_autorizacion, ''),
                                           goti.gfc_sri_comprobantes.fecha_autorizacion),
            valor_sin_impuestos = EXCLUDED.valor_sin_impuestos,
            iva                 = EXCLUDED.iva,
            importe_total       = EXCLUDED.importe_total,
            estado_sri          = EXCLUDED.estado_sri,
            info_adicional      = EXCLUDED.info_adicional,
            formas_pago         = EXCLUDED.formas_pago,
            xml                 = EXCLUDED.xml,
            descargado_en       = now()
    """, (cab['clave_acceso'], cab['tipo_comprobante'], cab['cod_doc'],
          cab['serie'], cab['ruc_emisor'], cab['razon_social_emisor'],
          cab['nombre_comercial'], cab['fecha_emision'],
          cab['identificacion_receptor'], cab['valor_sin_impuestos'],
          cab['iva'], cab['importe_total'], estado, cab['ambiente'],
          cab['dir_establecimiento'],
          json.dumps(cab['info_adicional'], ensure_ascii=False),
          json.dumps(cab['formas_pago'], ensure_ascii=False), xml, origen,
          fecha_aut or ''))

    cur.execute('DELETE FROM goti.gfc_sri_comprobantes_detalle WHERE clave_acceso = %s',
                (cab['clave_acceso'],))
    for l in lineas:
        cur.execute("""INSERT INTO goti.gfc_sri_comprobantes_detalle
                           (clave_acceso, linea, codigo_principal, codigo_auxiliar,
                            descripcion, cantidad, precio_unitario, descuento,
                            precio_total_sin_impuesto, iva_tarifa, iva_valor)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (cab['clave_acceso'], l['linea'], l['codigo_principal'],
                     l['codigo_auxiliar'], l['descripcion'], l['cantidad'],
                     l['precio_unitario'], l['descuento'],
                     l['precio_total_sin_impuesto'], l['iva_tarifa'], l['iva_valor']))
    return cab, len(lineas)


# ---------------------------------------------------------------- TXT

def leer_txt_recibidos(contenido):
    """El TXT del portal viene separado por tabulaciones, con encabezado."""
    lineas = contenido.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    if not lineas:
        return []
    cab = [c.strip() for c in lineas[0].split('\t')]
    if 'CLAVE_ACCESO' not in cab:
        raise ValueError('El archivo no parece el TXT de comprobantes recibidos: '
                         'no tiene la columna CLAVE_ACCESO')
    idx = {n: i for i, n in enumerate(cab)}
    filas = []
    for ln in lineas[1:]:
        if not ln.strip():
            continue
        p = ln.split('\t')
        try:
            filas.append({
                'clave': p[idx['CLAVE_ACCESO']].strip(),
                'emisor': p[idx['RAZON_SOCIAL_EMISOR']].strip(),
                'serie': p[idx['SERIE_COMPROBANTE']].strip(),
            })
        except IndexError:
            continue
    return filas


# ---------------------------------------------------------------- endpoints

@bp_sri_facturas.route('/api/sri/facturas', methods=['GET'])
def facturas_listar():
    desde = (request.args.get('desde') or '').strip()
    hasta = (request.args.get('hasta') or '').strip()
    buscar = (request.args.get('buscar') or '').strip()

    where, params = [], []
    if desde:
        where.append('c.fecha_emision >= %s')
        params.append(desde)
    if hasta:
        where.append('c.fecha_emision <= %s')
        params.append(hasta)
    if buscar:
        where.append('(c.razon_social_emisor ILIKE %s OR c.ruc_emisor ILIKE %s '
                     'OR c.serie ILIKE %s)')
        params += ['%' + buscar + '%'] * 3
    filtro = ('WHERE ' + ' AND '.join(where)) if where else ''

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()
        cur.execute("""
            SELECT c.clave_acceso, c.tipo_comprobante, c.serie, c.ruc_emisor,
                   c.razon_social_emisor, c.fecha_emision, c.valor_sin_impuestos,
                   c.iva, c.importe_total, c.estado_sri, c.descargado_en,
                   (SELECT count(*) FROM goti.gfc_sri_comprobantes_detalle d
                     WHERE d.clave_acceso = c.clave_acceso) AS lineas
              FROM goti.gfc_sri_comprobantes c
              %s
             ORDER BY c.fecha_emision DESC, c.razon_social_emisor
             LIMIT 2000
        """ % filtro, params)
        filas = [dict(r) for r in cur.fetchall()]
        total = sum(float(f['importe_total'] or 0) for f in filas)
        return jsonify({'success': True, 'facturas': filas,
                        'total_comprobantes': len(filas),
                        'total_importe': round(total, 2),
                        'total_lineas': sum(f['lineas'] or 0 for f in filas)})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'listar facturas del SRI')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/<clave>', methods=['GET'])
def facturas_detalle(clave):
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()
        cur.execute("""SELECT clave_acceso, tipo_comprobante, cod_doc, serie,
                              ruc_emisor, razon_social_emisor, nombre_comercial,
                              fecha_emision, fecha_autorizacion,
                              identificacion_receptor, valor_sin_impuestos, iva,
                              importe_total, estado_sri, ambiente,
                              dir_establecimiento, info_adicional, formas_pago,
                              descargado_en
                         FROM goti.gfc_sri_comprobantes WHERE clave_acceso = %s""",
                    (clave,))
        cab = cur.fetchone()
        if not cab:
            return jsonify({'success': False,
                            'error': 'No esta guardado ese comprobante'}), 404
        cur.execute("""SELECT * FROM goti.gfc_sri_comprobantes_detalle
                        WHERE clave_acceso = %s ORDER BY linea""", (clave,))
        return jsonify({'success': True, 'comprobante': dict(cab),
                        'detalle': [dict(r) for r in cur.fetchall()]})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'detalle del comprobante')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/<clave>/pdf', methods=['GET'])
def facturas_pdf(clave):
    """El RIDE en PDF, generado desde el XML guardado.

    Se arma al vuelo y no se cachea: el XML ya esta en la base, asi que el PDF
    es reproducible y no hay que almacenarlo.
    """
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute("""SELECT xml, serie, tipo_comprobante, estado_sri,
                              fecha_autorizacion, ambiente
                         FROM goti.gfc_sri_comprobantes WHERE clave_acceso = %s""",
                    (clave,))
        fila = cur.fetchone()
        if not fila or not fila['xml']:
            return jsonify({'success': False,
                            'error': 'No hay XML guardado para esa clave'}), 404

        from ride import generar_pdf_desde_xml
        carpeta = tempfile.mkdtemp(prefix='ride_')
        ruta_xml = os.path.join(carpeta, clave + '.xml')
        ruta_pdf = os.path.join(carpeta, clave + '.pdf')
        try:
            with open(ruta_xml, 'w', encoding='utf-8') as fh:
                # el generador lee la respuesta completa del SRI, no el
                # comprobante solo; y normalizado, por los `&#xD;`
                fh.write(envolver_autorizacion(
                    fila['xml'], clave, fila['estado_sri'] or 'AUTORIZADO',
                    fila['fecha_autorizacion'] or '',
                    fila['ambiente'] or 'PRODUCCION'))
            generar_pdf_desde_xml(ruta_xml, ruta_pdf)
            with open(ruta_pdf, 'rb') as fh:
                pdf = fh.read()
        finally:
            for r in (ruta_xml, ruta_pdf):
                try:
                    os.remove(r)
                except OSError:
                    pass
            try:
                os.rmdir(carpeta)
            except OSError:
                pass

        nombre = '%s_%s.pdf' % (
            (fila['tipo_comprobante'] or 'comprobante').replace(' ', '_'),
            (fila['serie'] or clave).replace('-', ''))
        return Response(pdf, mimetype='application/pdf', headers={
            'Content-Disposition': 'inline; filename="%s"' % nombre})
    except Exception as e:
        return _error(e, 'generar el PDF')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/<clave>/xml', methods=['GET'])
def facturas_xml(clave):
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute('SELECT xml FROM goti.gfc_sri_comprobantes WHERE clave_acceso = %s',
                    (clave,))
        fila = cur.fetchone()
        if not fila or not fila['xml']:
            return jsonify({'success': False, 'error': 'No hay XML guardado'}), 404
        return Response(fila['xml'], mimetype='application/xml', headers={
            'Content-Disposition': 'attachment; filename="%s.xml"' % clave})
    except Exception as e:
        return _error(e, 'entregar el XML')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/importar', methods=['POST'])
def facturas_importar():
    """Recibe el TXT del portal (o una lista de claves) y trae cada XML del SRI.

    Acepta tres formas:
      - multipart con el archivo en el campo `archivo`
      - JSON {"txt": "<contenido del archivo>"}
      - JSON {"claves": [...]}
    """
    filas = []
    try:
        if 'archivo' in request.files:
            crudo = request.files['archivo'].read()
            for enc in ('utf-8-sig', 'utf-8', 'latin-1'):
                try:
                    filas = leer_txt_recibidos(crudo.decode(enc))
                    break
                except UnicodeDecodeError:
                    continue
        else:
            d = request.get_json(silent=True) or {}
            if d.get('txt'):
                filas = leer_txt_recibidos(d['txt'])
            elif d.get('claves'):
                filas = [{'clave': str(c).strip(), 'emisor': '', 'serie': ''}
                         for c in d['claves']]
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    filas = [f for f in filas if len(f['clave']) == 49 and f['clave'].isdigit()]
    if not filas:
        return jsonify({'success': False,
                        'error': 'No se encontro ninguna clave de acceso valida '
                                 '(49 digitos) en lo que se envio'}), 400

    conn = None
    guardados, ya_estaban, lineas_tot = 0, 0, 0
    sin_xml = []
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()

        cur.execute("""SELECT clave_acceso FROM goti.gfc_sri_comprobantes
                        WHERE clave_acceso = ANY(%s) AND xml IS NOT NULL""",
                    ([f['clave'] for f in filas],))
        existentes = {r['clave_acceso'] for r in cur.fetchall()}

        for f in filas:
            if f['clave'] in existentes:
                ya_estaban += 1
                continue
            estado, xml, fecha_aut = pedir_xml_al_sri(f['clave'])
            if not xml:
                sin_xml.append({'clave': f['clave'], 'emisor': f['emisor'],
                                'serie': f['serie'], 'motivo': estado})
                continue
            try:
                _, n = guardar(cur, xml, f['clave'], estado, fecha_aut=fecha_aut)
                conn.commit()
                guardados += 1
                lineas_tot += n
            except Exception as e:
                conn.rollback()
                sin_xml.append({'clave': f['clave'], 'emisor': f['emisor'],
                                'serie': f['serie'],
                                'motivo': 'no se pudo guardar: %s' % str(e)[:120]})
            time.sleep(0.3)      # no atropellar al web service del SRI

        return jsonify({'success': True, 'recibidos': len(filas),
                        'guardados': guardados, 'ya_estaban': ya_estaban,
                        'lineas': lineas_tot, 'sin_xml': sin_xml,
                        'nota': ('El SRI solo entrega el XML los primeros dias '
                                 'despues de la emision; lo que ya caduco no se '
                                 'puede recuperar.') if sin_xml else ''})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'importar comprobantes')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/faltantes', methods=['POST'])
def facturas_faltantes():
    """Dice cuales de las claves enviadas hay que pedirle al SRI y cuales no.

    Se usa ANTES de importar, para dos cosas: no volver a pedir lo que ya esta
    guardado, y avisar cuantas son tan viejas que el SRI ya no las tiene. Pedir
    750 claves de un mes pasado son 16 minutos de espera para traer cero, y eso
    es exactamente lo que hay que evitar.

    Recibe: {"comprobantes": [{"clave": ..., "fecha": "dd/mm/aaaa", ...}, ...]}
    """
    d = request.get_json(silent=True) or {}
    comprobantes = d.get('comprobantes') or []
    if not comprobantes:
        return jsonify({'success': False, 'error': 'No se envio ningun comprobante'}), 400

    # DIAS_VIVOS: hasta aqui el SRI entrega el XML con seguridad. Medido el
    # 11-sep-2026: 1-3 dias siempre, 4 dias es frontera, 5+ nunca.
    DIAS_VIVOS = 4
    hoy = datetime.now().date()

    validos = []
    for c in comprobantes:
        clave = str(c.get('clave') or '').strip()
        if len(clave) != 49 or not clave.isdigit():
            continue
        f = _fecha(c.get('fecha') or '')
        validos.append({'clave': clave, 'fecha': f,
                        'emisor': (c.get('emisor') or '')[:120],
                        'serie': (c.get('serie') or '')[:40],
                        'dias': (hoy - f).days if f else None})

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()
        cur.execute("""SELECT clave_acceso FROM goti.gfc_sri_comprobantes
                        WHERE clave_acceso = ANY(%s) AND xml IS NOT NULL""",
                    ([v['clave'] for v in validos],))
        ya = {r['clave_acceso'] for r in cur.fetchall()}

        pendientes = [v for v in validos if v['clave'] not in ya]
        frescas = [v for v in pendientes
                   if v['dias'] is None or v['dias'] <= DIAS_VIVOS]
        caducadas = [v for v in pendientes
                     if v['dias'] is not None and v['dias'] > DIAS_VIVOS]

        return jsonify({
            'success': True,
            'total': len(validos),
            'ya_guardados': len(ya),
            'por_pedir': [v['clave'] for v in frescas],
            'caducadas': [{'clave': v['clave'], 'emisor': v['emisor'],
                           'serie': v['serie'], 'dias': v['dias']}
                          for v in caducadas],
            'dias_vivos': DIAS_VIVOS,
            'segundos_estimados': round(len(frescas) * 1.3),
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'revisar que falta')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/dias', methods=['GET'])
def facturas_dias():
    """Resumen por dia, para que la pantalla sepa que fechas tienen algo."""
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()
        cur.execute("""SELECT fecha_emision, count(*) AS comprobantes,
                              sum(importe_total) AS importe
                         FROM goti.gfc_sri_comprobantes
                        WHERE fecha_emision IS NOT NULL
                        GROUP BY 1 ORDER BY 1 DESC LIMIT 60""")
        return jsonify({'success': True, 'dias': [dict(r) for r in cur.fetchall()]})
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'resumen por dia')
    finally:
        _soltar(conn)


@bp_sri_facturas.route('/api/sri/facturas/cruce-contifico', methods=['GET'])
def facturas_cruce_contifico():
    """Que llego al SRI y no esta en Contifico, y al reves.

    El cruce es `clave_acceso` (SRI) contra `autorizacion` (Contifico): las dos
    son la misma cadena de 49 digitos. Contifico vive en la base `movimientos`,
    por eso la conexion aparte.
    """
    desde = (request.args.get('desde') or '').strip()
    hasta = (request.args.get('hasta') or '').strip()
    if not desde or not hasta:
        return jsonify({'success': False,
                        'error': 'Hacen falta las fechas desde y hasta'}), 400

    conn = conn_mov = None
    try:
        conn = _db()
        cur = conn.cursor()
        asegurar_tablas(cur)
        conn.commit()
        cur.execute("""SELECT clave_acceso, serie, razon_social_emisor,
                              ruc_emisor, fecha_emision, importe_total
                         FROM goti.gfc_sri_comprobantes
                        WHERE fecha_emision BETWEEN %s AND %s""", (desde, hasta))
        sri = {r['clave_acceso']: dict(r) for r in cur.fetchall()}

        from app import fc_get_movimientos_db, fc_release_movimientos_db
        conn_mov = fc_get_movimientos_db()
        # Ojo: esta conexion NO usa RealDictCursor, devuelve tuplas.
        cm = conn_mov.cursor()
        cm.execute("""SELECT DISTINCT autorizacion
                        FROM public.documentos_api
                       WHERE tipo_registro = 'PRO'
                         AND fecha_emision::date BETWEEN %s AND %s
                         AND autorizacion IS NOT NULL""", (desde, hasta))
        en_contifico = {r[0].strip() for r in cm.fetchall() if r[0]}
        fc_release_movimientos_db(conn_mov)
        conn_mov = None

        solo_sri = [v for k, v in sri.items() if k not in en_contifico]
        faltan_en_sri = sorted(a for a in en_contifico if a not in sri and len(a) == 49)

        return jsonify({
            'success': True,
            'en_sri': len(sri), 'en_contifico': len(en_contifico),
            'solo_en_sri': solo_sri,
            'solo_en_contifico': faltan_en_sri,
            'monto_solo_en_sri': round(
                sum(float(f['importe_total'] or 0) for f in solo_sri), 2),
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return _error(e, 'cruce con Contifico')
    finally:
        if conn_mov is not None:
            from app import fc_release_movimientos_db
            fc_release_movimientos_db(conn_mov)
        _soltar(conn)
