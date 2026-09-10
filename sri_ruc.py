"""
Validacion de RUC contra el SRI, en vivo.

Sin base de datos, sin scraping y sin depender del servicio de Render (que esta
suspendido). Se consulta el catastro publico del SRI en cada llamada: responde
en menos de un segundo y no pide login ni token.

Especificacion completa en Obsidian:
    CONTROL_CONTABLE/INTEGRACION_SRI_TIEMPO_REAL.md

Dos cosas que conviene tener presentes:

- **El parametro es `?ruc=`.** Con `?numeroRuc=` el SRI devuelve HTTP 400. Y se
  consulta un RUC por llamada: las comas no funcionan.

- **La API NO expone Gran Contribuyente ni Exportador Habitual de bienes.**
  PRONACA, Favorita y Conecel devuelven `categoria: null`, sin marca. Por
  decision de Jonathan (10-sep-2026) ambas se asumen 'NO' y NO se arma una tabla
  para taparlo. Consecuencia: a un Gran Contribuyente se le retiene IR de mas
  (el IVA sale bien igual, porque casi todos son Especial y eso si lo trae la
  API) y a un exportador se le retiene IVA de mas. En los dos casos el proveedor
  lo recupera como credito tributario.
"""
import json
import urllib.error
import urllib.request

from flask import Blueprint, request, jsonify

bp_sri = Blueprint('sri', __name__)

SRI_API_URL = ('https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet'
               '/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc')


# ---------------------------------------------------------------- consulta

def _pedir_al_sri(ruc, timeout):
    """Una sola llamada. Devuelve la lista del SRI, [] si el RUC no existe, o
    lanza la excepcion si el SRI no contesta.

    Ojo con el RUC inexistente: el SRI NO devuelve un array vacio ni un 404,
    devuelve **HTTP 204 sin cuerpo**. Si eso se pasa a json.loads('') revienta,
    y el error terminaba disfrazado de "el SRI no responde" -- o sea que un RUC
    mal tecleado parecia una caida del servicio.
    """
    req = urllib.request.Request(
        '%s?ruc=%s' % (SRI_API_URL, ruc),
        headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status == 204:
            return []
        cuerpo = resp.read().decode('utf-8').strip()
        if not cuerpo:
            return []
        return json.loads(cuerpo)


def _armar(d, ruc):
    fechas = d.get('informacionFechasContribuyente') or {}
    reps = d.get('representantesLegales') or []
    return {
        'ruc': d.get('numeroRuc', ruc),
        'razon_social': d.get('razonSocial', ''),
        'estado': d.get('estadoContribuyenteRuc', ''),
        'tipo_persona': d.get('tipoContribuyente', ''),
        'regimen': d.get('regimen', ''),
        'obligado_contabilidad': d.get('obligadoLlevarContabilidad', 'NO'),
        'agente_retencion': d.get('agenteRetencion', 'NO'),
        'contribuyente_especial': d.get('contribuyenteEspecial', 'NO'),
        'actividad_economica': d.get('actividadEconomicaPrincipal', ''),
        'representante_legal': (reps[0].get('nombre') if reps else ''),
        'fecha_inicio_actividades': fechas.get('fechaInicioActividades', ''),
        'fecha_cese': fechas.get('fechaCese', ''),
        'fecha_sri_actualizacion': fechas.get('fechaActualizacion', ''),
        'contribuyente_fantasma': d.get('contribuyenteFantasma', 'NO'),
        'transacciones_inexistente': d.get('transaccionesInexistente', 'NO'),
        'gran_contribuyente': 'NO',   # no disponible en la API
        'exportador_bienes': 'NO',    # no disponible en la API
        'fuente': 'sri_en_linea',
    }


def consultar_ruc(ruc, timeout=10):
    """Datos fiscales del RUC, o None si no existe o si algo fallo.

    Es la firma simple, para usar desde otro codigo. Cuando hace falta saber
    POR QUE fallo -- no existe contra el SRI no responde -- usar
    consultar_ruc_detallado().
    """
    datos, _ = consultar_ruc_detallado(ruc, timeout=timeout)
    return datos


def consultar_ruc_detallado(ruc, timeout=10):
    """Devuelve (datos, motivo).

    motivo es None si salio bien, o uno de: 'invalido', 'no_existe',
    'sri_no_disponible'. El endpoint necesita distinguirlos para contestar 400,
    404 o 503; devolver None para los tres tapaba una caida del SRI haciendola
    pasar por "el RUC no existe", que es una mentira cara.
    """
    ruc = (ruc or '').strip()
    if len(ruc) != 13 or not ruc.isdigit():
        return None, 'invalido'

    # El SRI se pone lento de a ratos: un reintento y listo.
    ultimo = None
    for intento in (1, 2):
        try:
            data = _pedir_al_sri(ruc, timeout)
            if not data or not isinstance(data, list):
                return None, 'no_existe'
            return _armar(data[0], ruc), None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, 'no_existe'
            ultimo = e
        except Exception as e:
            ultimo = e
    return None, 'sri_no_disponible'


def esta_activo(datos):
    return bool(datos) and (datos.get('estado') or '').upper() == 'ACTIVO'


def alertas(datos):
    """Lo que hay que mostrarle a quien esta cargando la factura."""
    if not datos:
        return []
    avisos = []
    if (datos.get('contribuyente_fantasma') or '').upper() == 'SI':
        avisos.append({
            'nivel': 'critico',
            'texto': 'El SRI lo tiene marcado como CONTRIBUYENTE FANTASMA. '
                     'No deberia comprarsele: sus facturas no dan credito tributario.',
        })
    if (datos.get('transacciones_inexistente') or '').upper() == 'SI':
        avisos.append({
            'nivel': 'critico',
            'texto': 'El SRI lo tiene marcado por TRANSACCIONES INEXISTENTES. '
                     'Proveedor de riesgo: revisar antes de pagar.',
        })
    if not esta_activo(datos):
        avisos.append({
            'nivel': 'alerta',
            'texto': 'El RUC no esta ACTIVO en el SRI (estado: %s). Se puede calcular '
                     'igual, pero conviene confirmar antes de recibir la factura.'
                     % (datos.get('estado') or 'desconocido'),
        })
    return avisos


# ---------------------------------------------------------------- retencion
# Resolucion NAC-DGERCGC26-00000009. FOODIX es SOCIEDAD.
#
#   cod -> (descripcion, % IR, tipo de compra, grupo)
#   tipo: 'bien' | 'servicio' | 'ambos'

CONCEPTOS = {
    '332':         ('RIMPE Negocios Populares (preimpreso)',        0.0,  'ambos',    'RIMPE'),
    '343':         ('RIMPE Emprendedores',                          1.0,  'ambos',    'RIMPE'),
    '312A':        ('Bienes agricolas - PRODUCTOR DIRECTO',         1.0,  'bien',     'Bienes y transporte'),
    '310':         ('Transporte de carga o pasajeros',              1.0,  'servicio', 'Bienes y transporte'),
    '312C':        ('Bienes agricolas - COMERCIALIZADOR',           1.75, 'bien',     'Bienes y transporte'),
    '312':         ('Bienes muebles - insumos, bebidas',            2.0,  'bien',     'Bienes y transporte'),
    '343A':        ('Energia electrica (CNEL, EEQ)',                2.0,  'servicio', 'Servicios generales'),
    '322':         ('Seguros y reaseguros',                         2.0,  'servicio', 'Servicios generales'),
    '307':         ('Servicios PN - mano de obra',                  3.0,  'servicio', 'Servicios generales'),
    '309':         ('Publicidad y medios',                          3.0,  'servicio', 'Servicios generales'),
    '346':         ('Otros pagos sin porcentaje especifico',        3.0,  'ambos',    'Servicios generales'),
    '311':         ('Liquidacion de compra - productor rural sin RUC', 3.0, 'bien',   'Especiales'),
    'COMBUSTIBLE': ('Combustible - NO retiene IR ni IVA',           0.0,  'bien',     'Especiales'),
    '3030':        ('Servicios profesionales por SOCIEDADES',       5.0,  'servicio', 'Honorarios'),
    '3482':        ('Comisiones a SOCIEDADES',                      5.0,  'servicio', 'Honorarios'),
    '303':         ('Honorarios PN con titulo profesional',        10.0,  'servicio', 'Honorarios'),
    '304':         ('Servicios PN de intelecto sin titulo',        10.0,  'servicio', 'Honorarios'),
    '304E':        ('Honorarios de docencia PN',                   10.0,  'servicio', 'Honorarios'),
    '320':         ('Arrendamiento de bienes inmuebles',           10.0,  'servicio', 'Arrendamiento'),
}


def calcular_pct_ir(pct_ir_base, gran_contribuyente='NO'):
    if gran_contribuyente == 'SI':
        return 0.0
    return pct_ir_base


def calcular_pct_iva(tipo_persona, contrib_especial, obligado, regimen,
                     concepto_cod, tipo_compra,
                     gran_contribuyente='NO', exportador_bienes='NO'):
    if gran_contribuyente == 'SI':               return 0
    if exportador_bienes == 'SI':                return 0
    if concepto_cod == '311':                    return 100  # Liquidacion de compra
    if concepto_cod in ('303', '304', '304E'):   return 100  # Honorarios PN
    if concepto_cod == '320':                    return 100  # Arrendamiento
    if concepto_cod in ('COMBUSTIBLE', '332'):   return 0    # Combustible / RIMPE NP
    if contrib_especial == 'SI':                 return 0    # Contribuyente Especial
    return 30 if tipo_compra == 'bien' else 70                # Bienes 30% / Servicios 70%


def calcular_retencion(datos, concepto_cod, subtotal, iva_valor, tipo_compra=None):
    """Arma el calculo completo a partir de los datos del SRI."""
    concepto = CONCEPTOS.get(concepto_cod)
    if not concepto:
        return None

    descripcion, pct_ir_base, tipo_concepto, grupo = concepto
    # Los conceptos 'ambos' no dicen si es bien o servicio: lo elige quien carga
    if tipo_concepto == 'ambos':
        tipo_compra = tipo_compra if tipo_compra in ('bien', 'servicio') else 'bien'
    else:
        tipo_compra = tipo_concepto

    d = datos or {}
    pct_ir = calcular_pct_ir(pct_ir_base, d.get('gran_contribuyente', 'NO'))
    pct_iva = calcular_pct_iva(
        d.get('tipo_persona', ''), d.get('contribuyente_especial', 'NO'),
        d.get('obligado_contabilidad', 'NO'), d.get('regimen', ''),
        concepto_cod, tipo_compra,
        d.get('gran_contribuyente', 'NO'), d.get('exportador_bienes', 'NO'))

    ret_ir = round(subtotal * pct_ir / 100.0, 2)
    ret_iva = round(iva_valor * pct_iva / 100.0, 2)

    return {
        'concepto_cod': concepto_cod,
        'concepto': descripcion,
        'grupo': grupo,
        'tipo_compra': tipo_compra,
        'subtotal': round(subtotal, 2),
        'iva_valor': round(iva_valor, 2),
        'total_factura': round(subtotal + iva_valor, 2),
        'pct_ir': pct_ir,
        'pct_iva': pct_iva,
        'retencion_ir': ret_ir,
        'retencion_iva': ret_iva,
        'total_retenido': round(ret_ir + ret_iva, 2),
        'total_pagar': round(subtotal + iva_valor - ret_ir - ret_iva, 2),
        # Alias con los nombres que ya usaba la calculadora de RETENCIONES, para
        # poder traer su pantalla sin reescribirle 500 lineas de JS.
        'concepto_desc': descripcion,
        'ret_ir': ret_ir,
        'ret_iva': ret_iva,
    }


# ---------------------------------------------------------------- endpoints

def _numero(v, campo):
    try:
        return float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        raise ValueError('%s tiene que ser un numero' % campo)


@bp_sri.route('/api/sri/conceptos', methods=['GET'])
def sri_conceptos():
    """El catalogo de conceptos, para el desplegable."""
    return jsonify({
        'success': True,
        'conceptos': [
            {'codigo': cod, 'descripcion': c[0], 'pct_ir': c[1],
             'tipo': c[2], 'grupo': c[3]}
            for cod, c in sorted(CONCEPTOS.items(), key=lambda x: (x[1][3], x[1][1]))
        ],
    })


@bp_sri.route('/api/sri/validar-ruc/<ruc>', methods=['GET'])
def sri_validar_ruc(ruc):
    datos, motivo = consultar_ruc_detallado(ruc)

    if motivo == 'invalido':
        return jsonify({'success': False,
                        'error': 'RUC invalido: tiene que ser 13 digitos numericos'}), 400
    if motivo == 'no_existe':
        return jsonify({'success': False,
                        'error': 'RUC no encontrado: no existe en el SRI'}), 404
    if motivo == 'sri_no_disponible':
        return jsonify({'success': False,
                        'error': 'El SRI no responde. Se intento dos veces; '
                                 'probar de nuevo en un momento.'}), 503

    return jsonify({'success': True, 'datos': datos,
                    'activo': esta_activo(datos), 'alertas': alertas(datos)})


@bp_sri.route('/api/sri/calcular', methods=['POST'])
def sri_calcular():
    """Consulta el RUC y calcula la retencion en una sola llamada.

    Body: { ruc, concepto_cod, subtotal, iva_valor, tipo_compra? }
    """
    d = request.get_json(silent=True) or {}
    concepto_cod = (d.get('concepto_cod') or '').strip()

    if concepto_cod not in CONCEPTOS:
        return jsonify({'success': False,
                        'error': 'Concepto desconocido: ' + (concepto_cod or '(vacio)')}), 400
    try:
        subtotal = _numero(d.get('subtotal', 0), 'El subtotal')
        iva_valor = _numero(d.get('iva_valor', 0), 'El IVA')
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    if subtotal < 0 or iva_valor < 0:
        return jsonify({'success': False, 'error': 'Los importes no pueden ser negativos'}), 400

    datos, motivo = consultar_ruc_detallado(d.get('ruc'))
    if motivo == 'invalido':
        return jsonify({'success': False,
                        'error': 'RUC invalido: tiene que ser 13 digitos numericos'}), 400
    if motivo == 'no_existe':
        return jsonify({'success': False,
                        'error': 'RUC no encontrado: no existe en el SRI'}), 404
    if motivo == 'sri_no_disponible':
        return jsonify({'success': False,
                        'error': 'El SRI no responde. Se intento dos veces; '
                                 'probar de nuevo en un momento.'}), 503

    calculo = calcular_retencion(datos, concepto_cod, subtotal, iva_valor,
                                 d.get('tipo_compra'))
    return jsonify({'success': True, 'datos': datos, 'calculo': calculo,
                    'activo': esta_activo(datos), 'alertas': alertas(datos)})
