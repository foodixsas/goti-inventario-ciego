"""
Generador de PDF (RIDE - Representacion Impresa del Documento Electronico)
desde el XML autorizado del SRI Ecuador.

Reproduce el layout estandar del SRI para los 3 tipos soportados:
- Factura
- Comprobante de Retencion
- Nota de Credito
"""
from __future__ import annotations
import io
import os
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    KeepTogether, Image, PageBreak,
)
from reportlab.pdfgen import canvas as canvas_mod

import barcode
from barcode.writer import ImageWriter

from .xml_parser import parsear_xml_comprobante


# -------------------- Estilos --------------------

_STYLES = getSampleStyleSheet()

LABEL = ParagraphStyle(
    "label", parent=_STYLES["Normal"],
    fontName="Helvetica-Bold", fontSize=7, leading=9,
)
VALUE = ParagraphStyle(
    "value", parent=_STYLES["Normal"],
    fontName="Helvetica", fontSize=7, leading=9,
)
TITLE = ParagraphStyle(
    "title", parent=_STYLES["Normal"],
    fontName="Helvetica-Bold", fontSize=10, leading=12,
    alignment=0,
)
SMALL = ParagraphStyle(
    "small", parent=_STYLES["Normal"],
    fontName="Helvetica", fontSize=6, leading=8,
)
CELL = ParagraphStyle(
    "cell", parent=_STYLES["Normal"],
    fontName="Helvetica", fontSize=7, leading=9,
)
CELL_BOLD = ParagraphStyle(
    "cell_bold", parent=_STYLES["Normal"],
    fontName="Helvetica-Bold", fontSize=7, leading=9,
)
TINY_MONO = ParagraphStyle(
    "tiny_mono", parent=_STYLES["Normal"],
    fontName="Courier", fontSize=6.5, leading=8,
    alignment=0,
)


# -------------------- Helpers --------------------

def _p(text: str, style: ParagraphStyle = VALUE) -> Paragraph:
    """Crea un Paragraph con escape basico (datos del XML, no confiables)."""
    if text is None:
        text = ""
    text = (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))
    return Paragraph(text, style)


def _ph(text: str, style: ParagraphStyle = CELL_BOLD) -> Paragraph:
    """Paragraph para encabezados estaticos (permite <br/> sin escape)."""
    return Paragraph(text or "", style)


def _fmt_num(valor: str, decimales: int = 2) -> str:
    """Formatea un numero string a N decimales. Si falla devuelve el original."""
    try:
        return f"{float(valor):.{decimales}f}"
    except (TypeError, ValueError):
        return valor or "0.00"


def _generar_barcode_png(clave_acceso: str) -> Optional[bytes]:
    """Genera un PNG con el codigo de barras Code128 de la clave de acceso."""
    if not clave_acceso:
        return None
    try:
        Code128 = barcode.get_barcode_class("code128")
        buffer = io.BytesIO()
        writer = ImageWriter()
        Code128(clave_acceso, writer=writer).write(
            buffer,
            options={
                "module_height": 10.0,
                "module_width": 0.18,
                "quiet_zone": 2.0,
                # No escribir texto bajo el barcode: lo escalamos al PDF y se
                # corta en los extremos. La clave ya se muestra como texto
                # legible encima del barcode en _cabecera().
                "write_text": False,
            },
        )
        return buffer.getvalue()
    except Exception:
        return None


# -------------------- Bloques comunes --------------------

def _cabecera(data: dict) -> Table:
    """
    Tabla 2 columnas:
      Izquierda: datos del emisor
      Derecha: RUC + tipo + nº + autorizacion + clave + barcode
    """
    razon_social = data.get("razonSocial", "")
    nombre_com = data.get("nombreComercial", "")
    dir_matriz = data.get("dirMatriz", "")
    dir_estab = data.get("dirEstablecimiento", "") or dir_matriz
    contrib_esp = data.get("contribuyenteEspecial", "")
    obligado = data.get("obligadoContabilidad", "")

    izq_rows = [
        [_p(razon_social, CELL_BOLD)],
        [_p(nombre_com, CELL)] if nombre_com else [_p("")],
        [_p(f"Direccion Matriz: {dir_matriz}", SMALL)] if dir_matriz else [_p("")],
        [_p(f"Direccion Sucursal: {dir_estab}", SMALL)] if dir_estab else [_p("")],
    ]
    if contrib_esp:
        izq_rows.append([_p(f"Contribuyente Especial: {contrib_esp}", SMALL)])
    if obligado:
        izq_rows.append([_p(f"OBLIGADO A LLEVAR CONTABILIDAD: {obligado}", SMALL)])
    # Para retenciones: mostrar resolucion de agente de retencion
    agente_ret = data.get("agenteRetencion", "")
    if agente_ret:
        izq_rows.append([_p(f"Agente de Retencion Resolucion No. {agente_ret}", SMALL)])

    tabla_izq = Table(izq_rows, colWidths=[8.5 * cm])
    tabla_izq.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))

    # Derecha: tarjeta con datos tributarios.
    # Los strings largos (numeroAutorizacion, claveAcceso = 49 chars) se ponen en
    # filas que SPAN las dos columnas, usando fuente monoespaciada pequena para
    # que entren en una sola linea sin cortarse.
    clave_acceso = data.get("claveAcceso", "")
    num_autorizacion = data.get("numeroAutorizacion", "")

    der_rows = [
        [_p("R.U.C.:", LABEL), _p(data.get("ruc", ""), VALUE)],                          # 0
        [_p(data.get("tipo_label", ""), TITLE), _p("")],                                  # 1
        [_p("No.:", LABEL), _p(data.get("numeroComprobante", ""), VALUE)],                # 2
        [_p("NUMERO DE AUTORIZACION:", LABEL), _p("")],                                   # 3 (label span)
        [_p(num_autorizacion, TINY_MONO), _p("")],                                        # 4 (valor span)
        [_p("FECHA Y HORA DE AUTORIZACION:", LABEL),
         _p(_fmt_fecha_auth(data.get("fechaAutorizacion", "")), VALUE)],                  # 5
        [_p("AMBIENTE:", LABEL), _p(data.get("ambiente", ""), VALUE)],                    # 6
        [_p("EMISION:", LABEL), _p(data.get("tipoEmision", ""), VALUE)],                  # 7
        [_p("CLAVE DE ACCESO:", LABEL), _p("")],                                          # 8 (label span)
        [_p(clave_acceso, TINY_MONO), _p("")],                                            # 9 (texto span)
    ]
    fila_label_autoriz = 3
    fila_valor_autoriz = 4
    fila_label_clave = 8
    fila_valor_clave = 9

    # Barcode (ocupa ambas columnas debajo)
    barcode_img = None
    bc_bytes = _generar_barcode_png(clave_acceso)
    if bc_bytes:
        barcode_img = Image(io.BytesIO(bc_bytes), width=9 * cm, height=1.5 * cm)
        der_rows.append([barcode_img, ""])
    fila_barcode = len(der_rows) - 1 if barcode_img is not None else None

    tabla_der = Table(der_rows, colWidths=[4 * cm, 5.5 * cm])
    estilo_der = [
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        # SPAN para que los strings largos ocupen ancho completo y no se corten
        ("SPAN", (0, fila_label_autoriz), (1, fila_label_autoriz)),
        ("SPAN", (0, fila_valor_autoriz), (1, fila_valor_autoriz)),
        ("SPAN", (0, fila_label_clave), (1, fila_label_clave)),
        ("SPAN", (0, fila_valor_clave), (1, fila_valor_clave)),
    ]
    if fila_barcode is not None:
        estilo_der.append(("SPAN", (0, fila_barcode), (1, fila_barcode)))
        estilo_der.append(("ALIGN", (0, fila_barcode), (1, fila_barcode), "CENTER"))
    tabla_der.setStyle(TableStyle(estilo_der))

    cabecera = Table(
        [[tabla_izq, tabla_der]],
        colWidths=[9 * cm, 9.5 * cm],
    )
    cabecera.setStyle(TableStyle([
        ("BOX", (0, 0), (0, 0), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return cabecera


def _fmt_fecha_auth(fecha_iso: str) -> str:
    """Convierte '2026-01-02T06:05:50-05:00' -> '02/01/2026 06:05:50'."""
    if not fecha_iso:
        return ""
    try:
        from datetime import datetime
        # Eliminar timezone para simplificar
        fecha_iso_clean = fecha_iso.split("-")[0:3]
        if "T" in fecha_iso:
            dt = datetime.fromisoformat(fecha_iso.split("+")[0].rsplit("-", 1)[0]) \
                if fecha_iso.count("-") > 2 else datetime.fromisoformat(fecha_iso)
            return dt.strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        pass
    return fecha_iso


def _bloque_comprador(data: dict) -> Table:
    """
    Bloque con datos del comprador / sujeto retenido.
    Replica el formato del SRI: 2 columnas con etiquetas Razon Social,
    Identificacion, Fecha, Guia, Placa/Matricula, Direccion.
    """
    razon = data.get("razonSocialComprador", "")
    ident = data.get("identificacionComprador", "")
    fecha = data.get("fechaEmision", "")
    periodo = data.get("periodoFiscal", "")

    # Para retenciones, layout simple sin Guia/Placa/Direccion (no aplican).
    # Para facturas y notas de credito, layout completo estilo SRI.
    if data.get("tipo") == "comprobanteRetencion":
        rows = [
            [_p("Razon Social / Nombres y Apellidos:", LABEL), _p(razon, VALUE),
             _p("", LABEL), _p("", VALUE)],
            [_p("Identificacion:", LABEL), _p(ident, VALUE),
             _p("Fecha Emision:", LABEL), _p(fecha, VALUE)],
        ]
        if periodo:
            rows.append([_p("Periodo Fiscal:", LABEL), _p(periodo, VALUE),
                         _p("", LABEL), _p("", VALUE)])
    else:
        # Extraer datos opcionales de infoAdicional (solo para factura/NC)
        info_ad = {c["nombre"].upper(): c["valor"] for c in data.get("infoAdicional", [])}
        direccion = info_ad.get("DIRECCION") or info_ad.get("DIRECCION_CLIENTE") or ""
        guia = data.get("guiaRemision", "")
        placa = data.get("placa", "") or info_ad.get("PLACA", "")

        rows = [
            [_p("Razon Social / Nombres y Apellidos:", LABEL), _p(razon, VALUE),
             _p("", LABEL), _p("", VALUE)],
            [_p("Identificacion:", LABEL), _p(ident, VALUE),
             _p("Fecha Emision:", LABEL), _p(fecha, VALUE)],
            [_p("Guia:", LABEL), _p(guia, VALUE),
             _p("Placa / Matricula:", LABEL), _p(placa, VALUE)],
            [_p("Direccion:", LABEL), _p(direccion, VALUE),
             _p("", LABEL), _p("", VALUE)],
        ]

        if periodo:
            rows.append([_p("Periodo Fiscal:", LABEL), _p(periodo, VALUE),
                         _p("", LABEL), _p("", VALUE)])

    # Para nota credito: mostrar referencia al documento modificado
    num_mod = data.get("numDocModificado", "")
    if num_mod:
        rows.append([_p("Comprobante Modificado:", LABEL), _p(num_mod, VALUE),
                     _p("Fecha Doc Sustento:", LABEL),
                     _p(data.get("fechaEmisionDocSustento", ""), VALUE)])
        motivo = data.get("motivo", "")
        if motivo:
            rows.append([_p("Motivo:", LABEL), _p(motivo, VALUE),
                         _p("", LABEL), _p("", VALUE)])

    tabla = Table(rows, colWidths=[4 * cm, 5.5 * cm, 3.5 * cm, 5.5 * cm])
    tabla.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return tabla


def _tabla_detalles(data: dict) -> Optional[Table]:
    """
    Tabla de items para Factura / Nota de Credito.
    Replica formato SRI con 10 columnas:
    Cod.Principal | Cod.Auxiliar | Cantidad | Descripcion | Detalle Adicional |
    Precio Unitario | Subsidio | Precio sin Subsidio | Descuento | Precio Total
    """
    detalles = data.get("detalles", [])
    if not detalles:
        return None

    encabezados = [
        _ph("Cod.<br/>Principal"),
        _ph("Cod.<br/>Auxiliar"),
        _ph("Cantidad"),
        _ph("Descripcion"),
        _ph("Detalle<br/>Adicional"),
        _ph("Precio<br/>Unitario"),
        _ph("Subsidio"),
        _ph("Precio sin<br/>Subsidio"),
        _ph("Descuento"),
        _ph("Precio<br/>Total"),
    ]
    rows = [encabezados]
    for det in detalles:
        det_ad = "; ".join(
            f"{d['nombre']}: {d['valor']}" for d in det.get("detallesAdicionales", [])
        )
        precio_unit = det.get("precioUnitario", "0")
        rows.append([
            _p(det.get("codigoPrincipal", ""), CELL),
            _p(det.get("codigoAuxiliar", ""), CELL),
            _p(_fmt_num(det.get("cantidad", "0"), 2), CELL),
            _p(det.get("descripcion", ""), CELL),
            _p(det_ad, SMALL),
            _p(_fmt_num(precio_unit, 2), CELL),
            _p("0.00", CELL),  # Subsidio (no presente en XML estandar)
            _p(_fmt_num(precio_unit, 2), CELL),  # Precio sin Subsidio = precioUnitario
            _p(_fmt_num(det.get("descuento", "0"), 2), CELL),
            _p(_fmt_num(det.get("precioTotalSinImpuesto", "0"), 2), CELL),
        ])

    tabla = Table(
        rows,
        colWidths=[1.7 * cm, 1.5 * cm, 1.3 * cm, 3.8 * cm, 2.2 * cm,
                   1.6 * cm, 1.4 * cm, 1.6 * cm, 1.5 * cm, 1.5 * cm],
        repeatRows=1,
    )
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0e0e0")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 1), (2, -1), "RIGHT"),       # Cantidad
        ("ALIGN", (5, 1), (-1, -1), "RIGHT"),      # Precios y descuentos
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return tabla


# Mapeos para etiquetas legibles en la tabla de retenciones (estilo SRI RIDE)
_COD_DOC_SUSTENTO = {
    "01": "FACTURA",
    "02": "NOTA DE VENTA",
    "03": "LIQUIDACION DE COMPRA",
    "04": "NOTA DE CREDITO",
    "05": "NOTA DE DEBITO",
    "06": "GUIA DE REMISION",
    "07": "COMPROBANTE DE RETENCION",
    "08": "BOLETO ENTRETENIMIENTO",
    "09": "TIQUETE ELECTRONICO",
    "11": "PASAJE AEREO",
    "12": "DOCUMENTOS INSTITUCIONES FINANCIERAS",
    "15": "COMPROBANTE PAGO IMPUESTO",
    "16": "COMPROBANTE INGRESO CAJA",
    "19": "COMPROBANTE PAGO SERVICIOS",
    "20": "DOCUMENTO TRANSPORTE",
    "21": "CARTA DE PORTE",
    "41": "DOCUMENTO COMERCIO EXTERIOR",
    "42": "COMPROBANTE LIQUIDACION OFICIO",
    "43": "LIQUIDACION SERVICIOS FINANCIEROS",
    "45": "COMPROBANTE EXTRACCION OPERACIONES",
    "47": "NOTA CREDITO POR REEMBOLSO",
    "48": "NOTA DEBITO POR REEMBOLSO",
}

_COD_IMPUESTO_RETENCION = {
    "1": "Impuesto a la Renta",
    "2": "IVA",
    "6": "ISD",
}


def _tabla_impuestos_retencion(data: dict) -> Optional[Table]:
    """
    Tabla de retenciones al estilo del RIDE oficial del SRI.
    Columnas: Comprobante | Numero | Fecha Emision | Ejercicio Fiscal |
              Base Imponible | Impuesto | % Retencion | Valor Retenido
    """
    impuestos = data.get("impuestos_retencion", [])
    if not impuestos:
        return None

    periodo_global = data.get("periodoFiscal", "")

    encabezados = [
        _ph("Comprobante"),
        _ph("Numero"),
        _ph("Fecha<br/>Emision"),
        _ph("Ejercicio<br/>Fiscal"),
        _ph("Base Imponible<br/>para la Retencion"),
        _ph("Impuesto"),
        _ph("Porcentaje<br/>Retencion"),
        _ph("Valor<br/>Retenido"),
    ]
    rows = [encabezados]
    for imp in impuestos:
        cod_doc = imp.get("codDocSustento", "")
        cod_impuesto = imp.get("codigo", "")
        rows.append([
            _p(_COD_DOC_SUSTENTO.get(cod_doc, cod_doc), CELL),
            _p(imp.get("numDocSustento", ""), CELL),
            _p(imp.get("fechaEmisionDocSustento", ""), CELL),
            _p(imp.get("periodoFiscal", "") or periodo_global, CELL),
            _p(_fmt_num(imp.get("baseImponible", "0"), 2), CELL),
            _p(_COD_IMPUESTO_RETENCION.get(cod_impuesto, cod_impuesto), CELL),
            _p(_fmt_num(imp.get("porcentajeRetener", "0"), 2), CELL),
            _p(_fmt_num(imp.get("valorRetenido", "0"), 2), CELL),
        ])

    tabla = Table(
        rows,
        colWidths=[2.0 * cm, 3.0 * cm, 1.8 * cm, 1.8 * cm,
                   2.5 * cm, 2.4 * cm, 1.8 * cm, 2.0 * cm],
        repeatRows=1,
    )
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0e0e0")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (4, 1), (4, -1), "RIGHT"),
        ("ALIGN", (6, 1), (-1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return tabla


def _bloque_info_adicional(data: dict) -> Optional[Table]:
    info = data.get("infoAdicional", [])
    if not info:
        return None
    rows = [[_p("Informacion Adicional", CELL_BOLD), _p("")]]
    for campo in info:
        rows.append([
            _p(campo["nombre"], LABEL),
            _p(campo["valor"], VALUE),
        ])
    tabla = Table(rows, colWidths=[5 * cm, 13.5 * cm])
    tabla.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0e0e0")),
        ("SPAN", (0, 0), (1, 0)),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return tabla


def _bloque_pagos_y_totales(data: dict) -> Table:
    """
    Layout 2 columnas:
      Izquierda: forma de pago (si aplica)
      Derecha: tabla de subtotales/IVA/total (todas las filas estandar del SRI,
               aun cuando sean 0.00, para replicar exactamente el RIDE oficial)
    """
    impuestos_tot = data.get("totalConImpuestos", [])

    # Sumar bases imponibles por codigoPorcentaje (codigo=2 => IVA)
    bases_iva = {}  # codigoPorcentaje -> suma de baseImponible
    iva_total = 0.0
    ice_total = 0.0
    irbpnr_total = 0.0
    tarifa_principal = None  # el % de IVA "principal" para etiquetar IVA XX%

    for imp in impuestos_tot:
        cod = imp.get("codigo", "")
        cod_pct = imp.get("codigoPorcentaje", "")
        try:
            base = float(imp.get("baseImponible", "0"))
        except ValueError:
            base = 0.0
        try:
            valor = float(imp.get("valor", "0"))
        except ValueError:
            valor = 0.0

        if cod == "2":  # IVA
            bases_iva[cod_pct] = bases_iva.get(cod_pct, 0.0) + base
            iva_total += valor
            if cod_pct in ("2", "3", "4", "5", "8") and valor > 0 and tarifa_principal is None:
                tarifa_principal = {"2": "12%", "3": "14%", "4": "15%",
                                    "5": "5%", "8": "8%"}.get(cod_pct, "")
        elif cod == "3":  # ICE
            ice_total += valor
        elif cod == "5":  # IRBPNR
            irbpnr_total += valor

    if tarifa_principal is None:
        # Si no hay IVA con valor, usar el porcentaje de la mayor base con tarifa
        for cp, b in bases_iva.items():
            if cp in ("2", "3", "4", "5", "8") and b > 0:
                tarifa_principal = {"2": "12%", "3": "14%", "4": "15%",
                                    "5": "5%", "8": "8%"}.get(cp, "")
                break
    tarifa_label = tarifa_principal or "15%"

    def _v(x):
        return f"{x:.2f}"

    # Helper para sumar bases por categoria
    sub_grav = sum(b for cp, b in bases_iva.items() if cp in ("2", "3", "4", "5", "8"))
    sub_cero = bases_iva.get("0", 0.0)
    sub_no_obj = bases_iva.get("6", 0.0)
    sub_exento = bases_iva.get("7", 0.0)

    try:
        total_sin_imp = float(data.get("totalSinImpuestos", "0") or "0")
    except ValueError:
        total_sin_imp = 0.0
    try:
        total_desc = float(data.get("totalDescuento", "0") or "0")
    except ValueError:
        total_desc = 0.0
    try:
        propina = float(data.get("propina", "0") or "0")
    except ValueError:
        propina = 0.0
    try:
        valor_total = float(data.get("importeTotal", "0") or data.get("valorModificacion", "0") or "0")
    except ValueError:
        valor_total = 0.0

    # Filas FIJAS al estilo SRI (siempre se muestran, aunque sean 0.00)
    sub_rows = [
        [_p(f"SUBTOTAL {tarifa_label}", LABEL), _p(_v(sub_grav), VALUE)],
        [_p("SUBTOTAL 0%", LABEL), _p(_v(sub_cero), VALUE)],
        [_p("SUBTOTAL NO OBJETO DE IVA", LABEL), _p(_v(sub_no_obj), VALUE)],
        [_p("SUBTOTAL EXENTO DE IVA", LABEL), _p(_v(sub_exento), VALUE)],
        [_p("SUBTOTAL SIN IMPUESTOS", LABEL), _p(_v(total_sin_imp), VALUE)],
        [_p("TOTAL DESCUENTO", LABEL), _p(_v(total_desc), VALUE)],
        [_p("ICE", LABEL), _p(_v(ice_total), VALUE)],
        [_p(f"IVA {tarifa_label}", LABEL), _p(_v(iva_total), VALUE)],
        [_p("IRBPNR", LABEL), _p(_v(irbpnr_total), VALUE)],
        [_p("PROPINA", LABEL), _p(_v(propina), VALUE)],
        [_p("VALOR TOTAL", CELL_BOLD), _p(_v(valor_total), CELL_BOLD)],
    ]

    tabla_sub = Table(sub_rows, colWidths=[5 * cm, 3 * cm])
    tabla_sub.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))

    # ---- Pagos (solo factura) ----
    pagos = data.get("pagos", [])
    forma_pago_map = {
        "01": "SIN UTILIZACION DEL SISTEMA FINANCIERO",
        "15": "COMPENSACION DE DEUDAS",
        "16": "TARJETA DE DEBITO",
        "17": "DINERO ELECTRONICO",
        "18": "TARJETA PREPAGO",
        "19": "TARJETA DE CREDITO",
        "20": "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
        "21": "ENDOSO DE TITULOS",
    }

    if pagos:
        pago_rows = [[_p("Forma de Pago", CELL_BOLD), _p("Valor", CELL_BOLD)]]
        for p in pagos:
            cod = p.get("formaPago", "")
            label = f"{cod} - {forma_pago_map.get(cod, '')}"
            pago_rows.append([_p(label, CELL), _p(_fmt_num(p.get("total", "0")), VALUE)])
        tabla_pagos = Table(pago_rows, colWidths=[7 * cm, 3 * cm])
        tabla_pagos.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0e0e0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 1), (1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
    else:
        tabla_pagos = Spacer(1, 1)

    contenedor = Table(
        [[tabla_pagos, tabla_sub]],
        colWidths=[10 * cm, 8.5 * cm],
    )
    contenedor.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return contenedor


# -------------------- Punto de entrada --------------------

def generar_pdf_desde_xml(ruta_xml: str, ruta_pdf_destino: str) -> bool:
    """
    Genera un PDF (RIDE) en `ruta_pdf_destino` a partir del XML del SRI.
    Devuelve True si tuvo exito, False si fallo.
    """
    try:
        data = parsear_xml_comprobante(ruta_xml)
    except Exception as e:
        # No logueamos aqui — el caller decide que hacer
        raise

    os.makedirs(os.path.dirname(ruta_pdf_destino) or ".", exist_ok=True)

    doc = SimpleDocTemplate(
        ruta_pdf_destino,
        pagesize=A4,
        leftMargin=1.2 * cm, rightMargin=1.2 * cm,
        topMargin=1.0 * cm, bottomMargin=1.0 * cm,
        title=f"{data.get('tipo_label', 'RIDE')} {data.get('numeroComprobante', '')}",
        author=data.get("razonSocial", ""),
    )

    story = []
    story.append(_cabecera(data))
    story.append(Spacer(1, 4 * mm))
    story.append(_bloque_comprador(data))
    story.append(Spacer(1, 3 * mm))

    if data["tipo"] == "comprobanteRetencion":
        tabla = _tabla_impuestos_retencion(data)
    else:
        tabla = _tabla_detalles(data)
    if tabla is not None:
        story.append(tabla)
        story.append(Spacer(1, 3 * mm))

    info_ad = _bloque_info_adicional(data)
    if info_ad is not None:
        story.append(info_ad)
        story.append(Spacer(1, 3 * mm))

    # Retenciones no tienen totales/pagos al estilo de las facturas
    if data["tipo"] != "comprobanteRetencion":
        story.append(_bloque_pagos_y_totales(data))

    doc.build(story)
    return True
