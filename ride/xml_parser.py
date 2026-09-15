"""
Parser de XML de comprobantes electronicos del SRI Ecuador.

Soporta: factura, comprobanteRetencion, notaCredito.
Devuelve un dict normalizado independiente del tipo en los campos comunes.
"""
from __future__ import annotations
import xml.etree.ElementTree as ET
from typing import Optional


TIPOS_SOPORTADOS = {
    "factura": "FACTURA",
    "comprobanteRetencion": "COMPROBANTE DE RETENCION",
    "notaCredito": "NOTA DE CREDITO",
}


def _text(elem: Optional[ET.Element], tag: str, default: str = "") -> str:
    if elem is None:
        return default
    sub = elem.find(tag)
    if sub is None or sub.text is None:
        return default
    return sub.text.strip()


def _parse_info_adicional(root: ET.Element) -> list[dict]:
    res = []
    info = root.find("infoAdicional")
    if info is None:
        return res
    for campo in info.findall("campoAdicional"):
        res.append({
            "nombre": campo.get("nombre", ""),
            "valor": (campo.text or "").strip(),
        })
    return res


def parsear_xml_comprobante(ruta_xml: str) -> dict:
    """
    Lee un XML de comprobante autorizado por SRI y devuelve un dict normalizado.

    Estructura del archivo:
      <autorizacion>
        <estado>AUTORIZADO</estado>
        <numeroAutorizacion>...</numeroAutorizacion>
        <fechaAutorizacion>...</fechaAutorizacion>
        <ambiente>PRODUCCION</ambiente>
        <comprobante><![CDATA[ <factura|comprobanteRetencion|notaCredito> ... ]]></comprobante>
      </autorizacion>
    """
    tree = ET.parse(ruta_xml)
    autorizacion = tree.getroot()

    estado = _text(autorizacion, "estado")
    num_autorizacion = _text(autorizacion, "numeroAutorizacion")
    fecha_autorizacion = _text(autorizacion, "fechaAutorizacion")
    ambiente_auth = _text(autorizacion, "ambiente")

    # El XML interno esta dentro del CDATA del nodo <comprobante>
    comp_elem = autorizacion.find("comprobante")
    if comp_elem is None or not comp_elem.text:
        raise ValueError("XML no contiene nodo <comprobante> con CDATA")

    inner = ET.fromstring(comp_elem.text)
    tipo_raiz = inner.tag

    if tipo_raiz not in TIPOS_SOPORTADOS:
        raise ValueError(f"Tipo de comprobante no soportado: {tipo_raiz}")

    # ---- infoTributaria (comun a los 3 tipos) ----
    info_trib = inner.find("infoTributaria")
    if info_trib is None:
        raise ValueError("Falta <infoTributaria>")

    cabecera = {
        "tipo": tipo_raiz,
        "tipo_label": TIPOS_SOPORTADOS[tipo_raiz],
        "estado": estado,
        "numeroAutorizacion": num_autorizacion,
        "fechaAutorizacion": fecha_autorizacion,
        "ambiente": ambiente_auth or ("PRODUCCION" if _text(info_trib, "ambiente") == "2" else "PRUEBAS"),
        "tipoEmision": "NORMAL" if _text(info_trib, "tipoEmision") == "1" else "INDISPONIBILIDAD",
        "razonSocial": _text(info_trib, "razonSocial"),
        "nombreComercial": _text(info_trib, "nombreComercial"),
        "ruc": _text(info_trib, "ruc"),
        "claveAcceso": _text(info_trib, "claveAcceso"),
        "codDoc": _text(info_trib, "codDoc"),
        "estab": _text(info_trib, "estab"),
        "ptoEmi": _text(info_trib, "ptoEmi"),
        "secuencial": _text(info_trib, "secuencial"),
        "dirMatriz": _text(info_trib, "dirMatriz"),
        "agenteRetencion": _text(info_trib, "agenteRetencion"),
    }
    cabecera["numeroComprobante"] = f"{cabecera['estab']}-{cabecera['ptoEmi']}-{cabecera['secuencial']}"

    # Dispatch al parser especifico
    if tipo_raiz == "factura":
        cuerpo = _parsear_factura(inner)
    elif tipo_raiz == "comprobanteRetencion":
        cuerpo = _parsear_retencion(inner)
    elif tipo_raiz == "notaCredito":
        cuerpo = _parsear_nota_credito(inner)
    else:
        cuerpo = {}

    cabecera.update(cuerpo)
    cabecera["infoAdicional"] = _parse_info_adicional(inner)
    return cabecera


# -------------------- Parsers especificos --------------------

def _parsear_factura(inner: ET.Element) -> dict:
    info = inner.find("infoFactura")
    if info is None:
        return {}

    pagos = []
    pagos_elem = info.find("pagos")
    if pagos_elem is not None:
        for pago in pagos_elem.findall("pago"):
            pagos.append({
                "formaPago": _text(pago, "formaPago"),
                "total": _text(pago, "total"),
                "plazo": _text(pago, "plazo"),
                "unidadTiempo": _text(pago, "unidadTiempo"),
            })

    impuestos_tot = []
    tot_imp = info.find("totalConImpuestos")
    if tot_imp is not None:
        for ti in tot_imp.findall("totalImpuesto"):
            impuestos_tot.append({
                "codigo": _text(ti, "codigo"),
                "codigoPorcentaje": _text(ti, "codigoPorcentaje"),
                "baseImponible": _text(ti, "baseImponible"),
                "tarifa": _text(ti, "tarifa"),
                "valor": _text(ti, "valor"),
            })

    detalles = _parsear_detalles(inner)

    return {
        "fechaEmision": _text(info, "fechaEmision"),
        "dirEstablecimiento": _text(info, "dirEstablecimiento"),
        "contribuyenteEspecial": _text(info, "contribuyenteEspecial"),
        "obligadoContabilidad": _text(info, "obligadoContabilidad"),
        "tipoIdentificacionComprador": _text(info, "tipoIdentificacionComprador"),
        "razonSocialComprador": _text(info, "razonSocialComprador"),
        "identificacionComprador": _text(info, "identificacionComprador"),
        "totalSinImpuestos": _text(info, "totalSinImpuestos"),
        "totalDescuento": _text(info, "totalDescuento"),
        "propina": _text(info, "propina"),
        "importeTotal": _text(info, "importeTotal"),
        "moneda": _text(info, "moneda"),
        "totalConImpuestos": impuestos_tot,
        "pagos": pagos,
        "detalles": detalles,
    }


def _parsear_retencion(inner: ET.Element) -> dict:
    """
    Parsea Comprobante de Retencion. Soporta dos schemas:
    - v1.0.0: <impuestos><impuesto>...</impuesto></impuestos>
    - v2.0.0: <docsSustento><docSustento><retenciones><retencion>...
    Ambos se normalizan a 'impuestos_retencion' (lista de dicts con la misma forma).
    """
    info = inner.find("infoCompRetencion")
    if info is None:
        return {}

    periodo_global = _text(info, "periodoFiscal")
    impuestos = []

    # --- Schema v1.0.0: <impuestos><impuesto> ---
    imps = inner.find("impuestos")
    if imps is not None:
        for imp in imps.findall("impuesto"):
            impuestos.append({
                "codigo": _text(imp, "codigo"),
                "codigoRetencion": _text(imp, "codigoRetencion"),
                "baseImponible": _text(imp, "baseImponible"),
                "porcentajeRetener": _text(imp, "porcentajeRetener"),
                "valorRetenido": _text(imp, "valorRetenido"),
                "codDocSustento": _text(imp, "codDocSustento"),
                "numDocSustento": _text(imp, "numDocSustento"),
                "fechaEmisionDocSustento": _text(imp, "fechaEmisionDocSustento"),
                "periodoFiscal": periodo_global,
            })

    # --- Schema v2.0.0: <docsSustento><docSustento><retenciones><retencion> ---
    docs_sus = inner.find("docsSustento")
    if docs_sus is not None:
        for doc in docs_sus.findall("docSustento"):
            cod_doc = _text(doc, "codDocSustento")
            num_doc = _text(doc, "numDocSustento")
            fecha_doc = _text(doc, "fechaEmisionDocSustento")
            retenciones_elem = doc.find("retenciones")
            if retenciones_elem is None:
                continue
            for ret in retenciones_elem.findall("retencion"):
                impuestos.append({
                    "codigo": _text(ret, "codigo"),
                    "codigoRetencion": _text(ret, "codigoRetencion"),
                    "baseImponible": _text(ret, "baseImponible"),
                    "porcentajeRetener": _text(ret, "porcentajeRetener"),
                    "valorRetenido": _text(ret, "valorRetenido"),
                    "codDocSustento": cod_doc,
                    "numDocSustento": num_doc,
                    "fechaEmisionDocSustento": fecha_doc,
                    "periodoFiscal": periodo_global,
                })

    return {
        "fechaEmision": _text(info, "fechaEmision"),
        "dirEstablecimiento": _text(info, "dirEstablecimiento"),
        "contribuyenteEspecial": _text(info, "contribuyenteEspecial"),
        "obligadoContabilidad": _text(info, "obligadoContabilidad"),
        "tipoIdentificacionComprador": _text(info, "tipoIdentificacionSujetoRetenido"),
        "razonSocialComprador": _text(info, "razonSocialSujetoRetenido"),
        "identificacionComprador": _text(info, "identificacionSujetoRetenido"),
        "periodoFiscal": periodo_global,
        "impuestos_retencion": impuestos,
    }


def _parsear_nota_credito(inner: ET.Element) -> dict:
    info = inner.find("infoNotaCredito")
    if info is None:
        return {}

    impuestos_tot = []
    tot_imp = info.find("totalConImpuestos")
    if tot_imp is not None:
        for ti in tot_imp.findall("totalImpuesto"):
            impuestos_tot.append({
                "codigo": _text(ti, "codigo"),
                "codigoPorcentaje": _text(ti, "codigoPorcentaje"),
                "baseImponible": _text(ti, "baseImponible"),
                "tarifa": _text(ti, "tarifa"),
                "valor": _text(ti, "valor"),
            })

    detalles = _parsear_detalles(inner)

    return {
        "fechaEmision": _text(info, "fechaEmision"),
        "dirEstablecimiento": _text(info, "dirEstablecimiento"),
        "contribuyenteEspecial": _text(info, "contribuyenteEspecial"),
        "obligadoContabilidad": _text(info, "obligadoContabilidad"),
        "tipoIdentificacionComprador": _text(info, "tipoIdentificacionComprador"),
        "razonSocialComprador": _text(info, "razonSocialComprador"),
        "identificacionComprador": _text(info, "identificacionComprador"),
        "codDocModificado": _text(info, "codDocModificado"),
        "numDocModificado": _text(info, "numDocModificado"),
        "fechaEmisionDocSustento": _text(info, "fechaEmisionDocSustento"),
        "totalSinImpuestos": _text(info, "totalSinImpuestos"),
        "valorModificacion": _text(info, "valorModificacion"),
        "moneda": _text(info, "moneda"),
        "motivo": _text(info, "motivo"),
        "totalConImpuestos": impuestos_tot,
        "detalles": detalles,
    }


def _parsear_detalles(inner: ET.Element) -> list[dict]:
    """Parsea <detalles>/<detalle> usado por factura y notaCredito."""
    detalles = []
    det_elem = inner.find("detalles")
    if det_elem is None:
        return detalles

    for det in det_elem.findall("detalle"):
        impuestos_det = []
        imps_elem = det.find("impuestos")
        if imps_elem is not None:
            for imp in imps_elem.findall("impuesto"):
                impuestos_det.append({
                    "codigo": _text(imp, "codigo"),
                    "codigoPorcentaje": _text(imp, "codigoPorcentaje"),
                    "tarifa": _text(imp, "tarifa"),
                    "baseImponible": _text(imp, "baseImponible"),
                    "valor": _text(imp, "valor"),
                })

        det_adicionales = []
        det_ad_elem = det.find("detallesAdicionales")
        if det_ad_elem is not None:
            for da in det_ad_elem.findall("detAdicional"):
                det_adicionales.append({
                    "nombre": da.get("nombre", ""),
                    "valor": da.get("valor", ""),
                })

        detalles.append({
            "codigoPrincipal": _text(det, "codigoPrincipal") or _text(det, "codigoInterno"),
            "codigoAuxiliar": _text(det, "codigoAuxiliar"),
            "descripcion": _text(det, "descripcion"),
            "cantidad": _text(det, "cantidad"),
            "precioUnitario": _text(det, "precioUnitario"),
            "descuento": _text(det, "descuento"),
            "precioTotalSinImpuesto": _text(det, "precioTotalSinImpuesto"),
            "detallesAdicionales": det_adicionales,
            "impuestos": impuestos_det,
        })
    return detalles
