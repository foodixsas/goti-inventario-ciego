"""
CARGA MOVIMIENTOS CONTIFICO VIA API
=====================================
Reemplaza los bots Selenium con llamadas directas a la API de Contifico.
No requiere Chrome, no requiere PC encendida.

Bots cubiertos:
  1. Ingresos Extraordinarios  (ING)
  2. Traslados entre bodegas   (TRA)
  3. Bajas de Tiendas          (EGR, hasta 10 productos por registro)
  4. Conteo de Inventario      (ING si sobrante, EGR si faltante)

Bot NO cubierto (requiere endpoint especial de produccion):
  5. Produccion Simon Bolon -> sigue corriendo via Selenium

Ejecucion manual:  python carga_api.py
Ejecucion auto:    GitHub Actions 3x/dia (ver .github/workflows/carga_movimientos.yml)
"""

import json
import os
import requests
import sys
from pyairtable import Api
from datetime import datetime, timezone, timedelta
from notificar_telegram import notificar_exito, notificar_error, nombre_producto

# ============================================================
# CREDENCIALES - Se leen de variables de entorno o quedan aqui
# ============================================================
CONTIFICO_API_KEY = os.getenv("CONTIFICO_API_KEY", "")
CONTIFICO_API_URL = "https://api.contifico.com/sistema/api/v1"

# ============================================================
# MODO DE EJECUCION
# ============================================================
# SIMULAR=1  -> muestra lo que enviaria, NO crea nada ni marca Hecho.
# SIMULAR=0  -> ejecucion real.
SIMULAR = os.getenv("SIMULAR", "1") == "1"

# Asiento contable. Jonathan exige que SIEMPRE se genere, pero al 2026-08-14 la
# API de Contifico no lo permite: v1 ignora el campo en silencio y v2 devuelve
# HTTP 500 aunque se envien los cuatro campos requeridos
# (generar_asiento + cuenta + centro_costo + proyecto), con valores reales o no.
# Queda pendiente la respuesta de soporte de Contifico.
# Cuando respondan: poner GENERAR_ASIENTO=1 y llenar CUENTA_ASIENTO/PROYECTO_ASIENTO.
GENERAR_ASIENTO = os.getenv("GENERAR_ASIENTO", "0") == "1"
CUENTA_ASIENTO = os.getenv("CUENTA_ASIENTO", "")
PROYECTO_ASIENTO = os.getenv("PROYECTO_ASIENTO", "")
if GENERAR_ASIENTO:
    CONTIFICO_API_URL = "https://api.contifico.com/sistema/api/v2"

# AirTable - Base A (Ingresos, Bajas, Conteo)
AIRTABLE_TOKEN_A = os.getenv("AIRTABLE_TOKEN_A", "")
AIRTABLE_BASE_A = "apppZXgUChlBLbVpR"

# AirTable - Base GLOG (Traslados)
AIRTABLE_TOKEN_GLOG = os.getenv("AIRTABLE_TOKEN_GLOG", "")
AIRTABLE_BASE_GLOG = "appETTeYKD0DQpuN7"

# ============================================================
# TABLAS AIRTABLE
# ============================================================
TABLE_INGRESOS       = "tblHQF6oqAo13dJDD"   # Ingresos Extraordinarios
TABLE_TRASLADOS      = "tblpeKmVHSsMopxBQ"   # Egresos Emergentes Tiendas (Traslados)
TABLE_BAJAS          = "tbl6Y8ZfViG8sepGi"   # Registro De Bajas Tiendas
TABLE_CONTEO         = "tblWBbKhBk4Pz9bNz"   # Conteo Inventario
TABLE_GLOG_PRODUCTOS = "tblOCyYpGJDFcGVvr"   # Matriz General de Productos (GLOG)
TABLE_GLOG_CONTIFICO = "tblxC58veM7i1UnYc"   # Matriz Contifico (GLOG)
TABLE_BAJAS_MATRIZ   = "tblTUHpdmQgULTY1y"   # Matriz Contifico Base A (para P8-P10)

# ============================================================
# MAPEOS AIRTABLE record_id → nombre de bodega Contifico
# ============================================================
MAPEO_BODEGAS_A = {
    "rec9k2m1qXidQXZxy": "BODEGA CHIOS REAL",
    "recelfWEnanLrQ72h": "BODEGA CHIOS PORTUGAL",
    "recdKJEm6lv4BVhQ2": "BODEGA CHIOS FLOREANA",
    "recq7s6X8DwRScDur": "BODEGA SANTO CACHON PORTUGAL",
    "rec1D2tS9kMSI6GaZ": "BODEGA SANTO CACHON REAL",
    "reckj8kgedLqMbWN0": "BODEGA SIMON BOLON",
    "recJMdtGEzSjsbjIf": "BODEGA PLANTA DE PRODUCCION",
    "rechSRvf01UQ3u0rL": "BODEGA MATERIA PRIMA",
    "recZf01hRMV2FD61v": "BODEGA PRINCIPAL",
    "recNUlLpZcSPD2TZt": "BODEGA PULMON",
}

# Nombre corto para Telegram (igual que usaba el Selenium)
MAPEO_CENTROS_A = {
    "rec9k2m1qXidQXZxy": "REAL",
    "recelfWEnanLrQ72h": "PORTUGAL",
    "recdKJEm6lv4BVhQ2": "FLOREANA",
    "recq7s6X8DwRScDur": "SANTO CACHON PORTUGAL",
    "rec1D2tS9kMSI6GaZ": "SANTO CACHON REAL",
    "reckj8kgedLqMbWN0": "SIMON BOLON",
    "recJMdtGEzSjsbjIf": "BODEGA PLANTA DE PRODUCCION",
    "rechSRvf01UQ3u0rL": "BODEGA MATERIA PRIMA",
    "recZf01hRMV2FD61v": "BODEGA PRINCIPAL",
    "recNUlLpZcSPD2TZt": "BODEGA PULMON",
}

MAPEO_BODEGAS_GLOG = {
    "recCypzc9E9uEhJYv": "PLANTA DE PRODUCCION",
    "recGDd0jYLlVz9b6f": "BODEGA SANTO CACHON PORTUGAL",
    "recKYprt4weEisem9": "BODEGA SANTO CACHON REAL",
    "recM8vqHzgEMsff38": "BODEGA SIMON BOLON",
    "reccM8WyxFZPhS7QL": "BODEGA CHIOS REAL",
    "reco7xJnelmRE54f5": "BODEGA CHIOS PORTUGAL",
    "recwIOf9ff2VU3IuS": "BODEGA CHIOS FLOREANA",
    "recEgtaLkUBCT1fpj": "BODEGA PRINCIPAL",
    "recQtytIc02x1pZWm": "BODEGA MATERIA PRIMA",
    "recNUlLpZcSPD2TZt": "BODEGA PULMON",
}

MAPEO_CENTROS_GLOG = {
    "recCypzc9E9uEhJYv": "PLANTA DE PRODUCCION",
    "recGDd0jYLlVz9b6f": "SANTO CACHON PORTUGAL",
    "recKYprt4weEisem9": "SANTO CACHON REAL",
    "recM8vqHzgEMsff38": "SIMON BOLON",
    "reccM8WyxFZPhS7QL": "REAL",
    "reco7xJnelmRE54f5": "PORTUGAL",
    "recwIOf9ff2VU3IuS": "FLOREANA",
    "recEgtaLkUBCT1fpj": "BODEGA PRINCIPAL",
    "recQtytIc02x1pZWm": "BODEGA MATERIA PRIMA",
    "recNUlLpZcSPD2TZt": "BODEGA PULMON",
}

# ============================================================
# UTILIDADES
# ============================================================
errores_globales = []

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def log_error(contexto, msg):
    texto = f"[ERROR] {contexto}: {msg}"
    log(texto)
    errores_globales.append(texto)

def headers_contifico():
    return {
        "Authorization": CONTIFICO_API_KEY,
        "Content-Type": "application/json"
    }

def formatear_fecha(fecha_raw):
    """Convierte yyyy-mm-dd o yyyy-mm-ddTHH:MM:SS (UTC) a dd/mm/yyyy hora Ecuador"""
    if not fecha_raw:
        return datetime.now().strftime("%d/%m/%Y")
    try:
        if "T" in fecha_raw:
            dt_utc = datetime.strptime(fecha_raw[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            return dt_utc.astimezone(timezone(timedelta(hours=-5))).strftime("%d/%m/%Y")
        return datetime.strptime(fecha_raw[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except:
        return datetime.now().strftime("%d/%m/%Y")

# ============================================================
# CARGAR BODEGAS Y PRODUCTOS DESDE CONTIFICO API
# ============================================================
def cargar_bodegas_api():
    """
    Descarga todas las bodegas de Contifico y retorna:
    { 'BODEGA CHIOS REAL': 'ljMEegJAHq0dQ5g3', ... }
    """
    log("  Cargando bodegas desde API Contifico...")
    resp = requests.get(f"{CONTIFICO_API_URL}/bodega/", headers=headers_contifico(), timeout=30)
    resp.raise_for_status()
    bodegas = resp.json()
    resultado = {}
    for b in bodegas:
        nombre = (b.get("nombre") or "").strip().upper()
        if nombre:
            resultado[nombre] = b["id"]
    log(f"  Bodegas cargadas: {len(resultado)}")
    return resultado

_cache_productos = {}
_catalogo_v2 = None


def catalogo_v2():
    """Catalogo COMPLETO de productos (codigo -> id), leido de la API v2.

    Hace falta porque v1 solo devuelve los productos de punto de venta (688 de
    1340). Los demas -empaques, materia prima- no aparecen ahi y la busqueda por
    codigo falla; asi se cayo el BOT4 con 'EMB002' (TOCINO, para_pos=false).
    v2 no acepta filtro por codigo -ni codigo, ni q, ni search-, asi que toca
    traer las 14 paginas enteras. Se hace una sola vez y solo cuando v1 falla,
    para no gastar ~75s en las corridas normales.
    """
    global _catalogo_v2
    if _catalogo_v2 is not None:
        return _catalogo_v2

    _catalogo_v2 = {}
    url = "https://api.contifico.com/sistema/api/v2/producto/"
    try:
        while url:
            resp = requests.get(url, headers=headers_contifico(), timeout=60)
            resp.raise_for_status()
            data = resp.json()
            for p in data.get("results", []):
                cod = (p.get("codigo") or "").strip().upper()
                if cod:
                    _catalogo_v2[cod] = p.get("id")
            url = data.get("next") or None
        log(f"  Catalogo v2 cargado: {len(_catalogo_v2)} productos")
    except Exception as e:
        log(f"  [WARN] No se pudo cargar el catalogo v2: {e}")
    return _catalogo_v2


def buscar_producto_api(codigo):
    """
    Busca un producto por código en la API de Contifico.
    Primero por filtro en v1 (una sola llamada); si no aparece, cae al catalogo
    completo de v2, que si trae los productos que no son de punto de venta.
    Usa caché para no repetir llamadas al mismo código en la misma ejecución.
    Retorna el id hash o None si no existe.
    """
    codigo_upper = codigo.strip().upper()
    if codigo_upper in _cache_productos:
        return _cache_productos[codigo_upper]

    def con_respaldo_v2():
        pid = catalogo_v2().get(codigo_upper)
        if pid:
            log(f"  Producto '{codigo_upper}' resuelto por catalogo v2 (no es de POS)")
        _cache_productos[codigo_upper] = pid
        return pid

    try:
        resp = requests.get(
            f"{CONTIFICO_API_URL}/producto/",
            headers=headers_contifico(),
            params={"codigo": codigo_upper},
            timeout=20
        )
        if resp.status_code == 200:
            data = resp.json()
            # Viene como lista: [{id, codigo, nombre, ...}]
            if isinstance(data, list) and data:
                prod_id = data[0].get("id")
            elif isinstance(data, dict) and data.get("id"):
                prod_id = data.get("id")
            else:
                prod_id = None
            if not prod_id:
                return con_respaldo_v2()
            _cache_productos[codigo_upper] = prod_id
            return prod_id
        else:
            return con_respaldo_v2()
    except Exception as e:
        log(f"  [WARN] Error buscando producto '{codigo}' en v1: {e}")
        return con_respaldo_v2()
        return None

# ============================================================
# POST MOVIMIENTO A CONTIFICO API
# ============================================================
def post_movimiento(tipo, bodega_id, detalles, fecha, descripcion, bodega_destino_id=None,
                    centro_costo_id=None):
    """
    Crea un movimiento de inventario en Contifico via API.

    tipo               : "ING" | "EGR" | "TRA"
    bodega_id          : hash de la bodega (origen para TRA)
    detalles           : [{"producto_id": hash, "cantidad": "1.0", "precio": "0.0"}, ...]
    fecha              : "dd/mm/yyyy"
    descripcion        : texto libre
    bodega_destino_id  : hash de bodega destino (solo para TRA)

    Retorna el codigo del movimiento (ej: "ING 202512009138") o None si falla.
    """
    payload = {
        "tipo": tipo,
        "fecha": fecha,
        "bodega_id": bodega_id,
        "descripcion": descripcion,
        "detalles": detalles,
    }
    if bodega_destino_id:
        payload["bodega_destino_id"] = bodega_destino_id

    # Asiento contable: los cuatro campos van juntos o no va ninguno.
    if GENERAR_ASIENTO:
        payload["generar_asiento"] = True
        payload["cuenta"] = CUENTA_ASIENTO
        payload["centro_costo"] = centro_costo_id or ""
        payload["proyecto"] = PROYECTO_ASIENTO

    if SIMULAR:
        log(f"   [SIMULACION] {tipo} en bodega {bodega_id} - {len(detalles)} producto(s)")
        log(f"      payload: {json.dumps(payload, ensure_ascii=False)[:220]}")
        return "SIMULADO"

    try:
        resp = requests.post(
            f"{CONTIFICO_API_URL}/movimiento-inventario/",
            headers=headers_contifico(),
            json=payload,
            timeout=30
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            codigo = data.get("codigo") or data.get("id") or str(data.get("pos", ""))
            log(f"   [OK] {tipo} creado: {codigo}")
            return str(codigo) if codigo else "CREADO"
        else:
            log(f"   [API {resp.status_code}] {resp.text[:300]}")
            return None
    except Exception as e:
        log(f"   [EXCEPTION] {e}")
        return None

def marcar_hecho(api_obj, base_id, table_id, record_id, num_doc, campo_hecho="Hecho"):
    """Marca el registro como Hecho en AirTable y guarda el numero de documento."""
    if SIMULAR:
        log(f"   [SIMULACION] no se marca Hecho en AirTable (registro {record_id})")
        return
    try:
        table = api_obj.table(base_id, table_id)
        campos = {campo_hecho: True}
        if num_doc:
            campos["num_documento"] = str(num_doc)
        table.update(record_id, campos)
        log(f"   [AT] Marcado: {campo_hecho}=True, doc={num_doc}")
    except Exception as e:
        log_error("AirTable update", str(e))

# ============================================================
# BOT 1: INGRESOS EXTRAORDINARIOS
# ING — 1 producto por registro
# ============================================================
def procesar_ingresos(bodegas):
    log("\n" + "="*55)
    log("BOT 1: INGRESOS EXTRAORDINARIOS")
    log("="*55)

    api = Api(AIRTABLE_TOKEN_A)
    records = api.table(AIRTABLE_BASE_A, TABLE_INGRESOS).all()
    pendientes = [r for r in records if not r["fields"].get("Hecho", False)]
    log(f"Pendientes: {len(pendientes)}")

    for r in pendientes:
        f = r["fields"]
        record_id = r["id"]

        # Codigo: buscar campo que contenga "digo" (para evitar problemas de encoding)
        codigo = ""
        for key, val in f.items():
            if "digo" in key.lower():
                codigo = (val[0] if isinstance(val, list) else val) or ""
                break

        unidades = f.get("Unidades", 0) or 0
        local_id = (f.get("Local") or [""])[0]
        fecha = formatear_fecha(f.get("Fecha", ""))

        nombre_bodega = MAPEO_BODEGAS_A.get(local_id, "")
        bodega_id = bodegas.get(nombre_bodega.upper())
        producto_id = buscar_producto_api(codigo)

        log(f"\n  [{record_id}] {codigo} x{unidades} -> {nombre_bodega} ({fecha})")

        if not bodega_id:
            log_error("BOT1", f"Bodega no encontrada en API: '{nombre_bodega}' (local_id={local_id})")
            continue
        if not producto_id:
            log_error("BOT1", f"Producto no encontrado en API: '{codigo}'")
            continue
        if not unidades:
            log(f"  [SKIP] Sin unidades")
            continue

        detalles = [{"producto_id": producto_id, "precio": "0.0", "cantidad": str(float(unidades))}]
        descripcion = f"INGRESO EXTRAORDINARIO-BODEGA {nombre_bodega}"
        centro = MAPEO_CENTROS_A.get(local_id, nombre_bodega)

        num_doc = post_movimiento("ING", bodega_id, detalles, fecha, descripcion)

        if num_doc and "ERROR" not in num_doc:
            marcar_hecho(api, AIRTABLE_BASE_A, TABLE_INGRESOS, record_id, num_doc)
            detalle_tg = f"📦 {nombre_producto(codigo)} ({codigo}) x {unidades}\n📅 {fecha}"
            notificar_exito("Ingreso Extraordinario", centro, detalle_tg, num_doc)
        else:
            marcar_hecho(api, AIRTABLE_BASE_A, TABLE_INGRESOS, record_id, "ERROR-VER-LOG")
            detalle_tg = f"📦 {nombre_producto(codigo)} ({codigo}) x {unidades}\n📅 {fecha}"
            notificar_error("Ingreso Extraordinario", centro, detalle_tg, "Fallo al crear via API - revisar log")


# ============================================================
# BOT 2: TRASLADOS
# TRA — 1 producto por registro, productos via lookup en GLOG
# ============================================================
def procesar_traslados(bodegas):
    log("\n" + "="*55)
    log("BOT 2: TRASLADOS")
    log("="*55)

    api = Api(AIRTABLE_TOKEN_GLOG)

    # Precargar tablas de lookup en cache (evita multiples llamadas)
    log("  Precargando Matriz General y Matriz Contifico...")
    matriz_general = {
        r["id"]: r["fields"]
        for r in api.table(AIRTABLE_BASE_GLOG, TABLE_GLOG_PRODUCTOS).all()
    }
    matriz_contifico = {
        r["id"]: r["fields"]
        for r in api.table(AIRTABLE_BASE_GLOG, TABLE_GLOG_CONTIFICO).all()
    }

    def resolver_codigo_glog(producto_record_id):
        """
        Dado un record_id de Matriz General → busca nombre →
        busca en Matriz Contifico por nombre → retorna el Código
        """
        prod = matriz_general.get(producto_record_id, {})
        nombre = (prod.get("Productos") or "").upper()
        if not nombre:
            return None
        for ct_fields in matriz_contifico.values():
            ct_nombre = (ct_fields.get("Nombre Producto") or "").upper()
            if ct_nombre == nombre or nombre in ct_nombre or ct_nombre in nombre:
                return ct_fields.get("Código", "")
        return None

    records = api.table(AIRTABLE_BASE_GLOG, TABLE_TRASLADOS).all()
    pendientes = [r for r in records if not r["fields"].get("Hecho", False)]
    log(f"Pendientes: {len(pendientes)}")

    for r in pendientes:
        f = r["fields"]
        record_id = r["id"]

        origen_id  = (f.get("Tienda Origen") or [""])[0]
        destino_id = (f.get("Tienda Destino") or [""])[0]
        prod_rec_id = (f.get("Productos") or [""])[0]
        cantidad = f.get("Cantidad", 0) or 0
        fecha = formatear_fecha(f.get("Fecha de Registro", ""))

        nombre_origen  = MAPEO_BODEGAS_GLOG.get(origen_id, "")
        nombre_destino = MAPEO_BODEGAS_GLOG.get(destino_id, "")
        bodega_origen_id  = bodegas.get(nombre_origen.upper())
        bodega_destino_id = bodegas.get(nombre_destino.upper())

        codigo = resolver_codigo_glog(prod_rec_id) or ""
        producto_id = buscar_producto_api(codigo) if codigo else None

        log(f"\n  [{record_id}] {codigo} x{cantidad} | {nombre_origen} -> {nombre_destino} ({fecha})")

        if not bodega_origen_id or not bodega_destino_id:
            log_error("BOT2", f"Bodega no mapeada: origen='{nombre_origen}' destino='{nombre_destino}'")
            continue
        if not producto_id:
            log_error("BOT2", f"Producto no encontrado en API: '{codigo}'")
            continue
        if not cantidad:
            log(f"  [SKIP] Sin cantidad")
            continue

        detalles = [{"producto_id": producto_id, "cantidad": str(float(cantidad))}]
        descripcion = f"TRASLADO ENTRE BODEGAS {nombre_origen}/{nombre_destino}"
        centro = MAPEO_CENTROS_GLOG.get(origen_id, nombre_origen)

        num_doc = post_movimiento("TRA", bodega_origen_id, detalles, fecha, descripcion, bodega_destino_id)

        if num_doc and "ERROR" not in num_doc:
            marcar_hecho(api, AIRTABLE_BASE_GLOG, TABLE_TRASLADOS, record_id, num_doc)
            detalle_tg = (
                f"📦 {nombre_producto(codigo)} ({codigo}) x {cantidad}\n"
                f"📅 {fecha}\n"
                f"🔄 {nombre_origen} ➜ {nombre_destino}"
            )
            notificar_exito("Traslado", centro, detalle_tg, num_doc)
        else:
            marcar_hecho(api, AIRTABLE_BASE_GLOG, TABLE_TRASLADOS, record_id, "ERROR-VER-LOG")
            detalle_tg = f"📦 {codigo} x {cantidad}\n📅 {fecha}\n🔄 {nombre_origen} ➜ {nombre_destino}"
            notificar_error("Traslado", centro, detalle_tg, "Fallo al crear via API - revisar log")


# ============================================================
# BOT 3: BAJAS TIENDAS
# EGR — hasta 10 productos en un solo egreso por registro
# ============================================================
def procesar_bajas(bodegas):
    log("\n" + "="*55)
    log("BOT 3: BAJAS TIENDAS")
    log("="*55)

    api = Api(AIRTABLE_TOKEN_A)

    # Cache de la Matriz para resolver P8-P10 (campos sin lookup directo)
    log("  Precargando Matriz Contifico Base A...")
    matriz_a = {
        r["id"]: r["fields"]
        for r in api.table(AIRTABLE_BASE_A, TABLE_BAJAS_MATRIZ).all()
    }

    records = api.table(AIRTABLE_BASE_A, TABLE_BAJAS).all()
    pendientes = [r for r in records if not r["fields"].get("Hecho", False)]
    log(f"Pendientes: {len(pendientes)}")

    for r in pendientes:
        f = r["fields"]
        record_id = r["id"]

        tienda_id = (f.get("tienda") or [""])[0]
        fecha = formatear_fecha(f.get("creada", ""))

        nombre_bodega = MAPEO_BODEGAS_A.get(tienda_id, "")
        bodega_id = bodegas.get(nombre_bodega.upper())

        # Resolver productos P1-P10
        detalles = []
        for i in range(1, 11):
            # P1-P7 tienen lookup directo; P8-P10 pueden no tenerlo
            codigos = f.get(f"Código (from P{i})", [])
            codigo = (codigos[0] if codigos else "").strip()

            if not codigo:
                linked_ids = f.get(f"p{i}", [])
                if linked_ids:
                    mat = matriz_a.get(linked_ids[0], {})
                    codigo = (mat.get("Código") or "").strip()

            cantidad = f.get(f"p{i}_cantidad", 0) or 0

            if codigo and cantidad > 0:
                prod_id = buscar_producto_api(codigo)
                if prod_id:
                    detalles.append({
                        "producto_id": prod_id,
                        "precio": "0.0",
                        "cantidad": str(float(cantidad))
                    })
                else:
                    log(f"  [WARN] P{i} no encontrado en API: '{codigo}'")

        motivo = f.get("motivo_baja", "BAJA") or "BAJA"
        log(f"\n  [{record_id}] {len(detalles)} productos -> {nombre_bodega} ({fecha}) | {motivo}")

        if not bodega_id:
            log_error("BOT3", f"Bodega no encontrada en API: '{nombre_bodega}' (tienda_id={tienda_id})")
            continue
        if not detalles:
            log(f"  [SKIP] Sin productos validos")
            continue

        descripcion = f"BAJA DE INVENTARIO - {nombre_bodega} - {motivo}"
        centro = MAPEO_CENTROS_A.get(tienda_id, nombre_bodega)
        resumen_prods = ", ".join(
            f"{d['cantidad']}u" for d in detalles[:3]
        ) + (f" y {len(detalles)-3} más" if len(detalles) > 3 else "")

        num_doc = post_movimiento("EGR", bodega_id, detalles, fecha, descripcion)

        if num_doc and "ERROR" not in num_doc:
            marcar_hecho(api, AIRTABLE_BASE_A, TABLE_BAJAS, record_id, num_doc)
            detalle_tg = f"📦 {len(detalles)} productos ({resumen_prods})\n📅 {fecha}\n⚠️ {motivo}"
            notificar_exito("Baja de Inventario", centro, detalle_tg, num_doc)
        else:
            marcar_hecho(api, AIRTABLE_BASE_A, TABLE_BAJAS, record_id, "ERROR-VER-LOG")
            detalle_tg = f"📦 {len(detalles)} productos\n📅 {fecha}\n⚠️ {motivo}"
            notificar_error("Baja de Inventario", centro, detalle_tg, "Fallo al crear via API - revisar log")


# ============================================================
# BOT 4: CONTEO INVENTARIO
# ING si sobrante > 0, EGR si faltante > 0
# ============================================================
def procesar_conteo(bodegas):
    log("\n" + "="*55)
    log("BOT 4: CONTEO INVENTARIO")
    log("="*55)

    api = Api(AIRTABLE_TOKEN_A)
    records = api.table(AIRTABLE_BASE_A, TABLE_CONTEO).all()
    pendientes = [r for r in records if not r["fields"].get("Hecho", False)]
    log(f"Pendientes: {len(pendientes)}")

    for r in pendientes:
        f = r["fields"]
        record_id = r["id"]

        # Codigo del producto
        codigo = ""
        for key, val in f.items():
            if "digo" in key.lower():
                codigo = (val[0] if isinstance(val, list) else val) or ""
                break

        sobrantes = f.get("Unidades Sobrantes", 0) or 0
        faltantes = f.get("Unidades Faltantes", 0) or 0
        local_id = (f.get("Local") or [""])[0]
        fecha = formatear_fecha(f.get("Fecha", ""))

        nombre_bodega = MAPEO_BODEGAS_A.get(local_id, "")
        bodega_id = bodegas.get(nombre_bodega.upper())
        producto_id = buscar_producto_api(codigo)

        log(f"\n  [{record_id}] {codigo} | SOB={sobrantes} FAL={faltantes} -> {nombre_bodega} ({fecha})")

        if not bodega_id:
            log_error("BOT4", f"Bodega no encontrada en API: '{nombre_bodega}' (local_id={local_id})")
            continue
        if not producto_id:
            log_error("BOT4", f"Producto no encontrado en API: '{codigo}'")
            continue

        if sobrantes > 0:
            tipo = "ING"
            cantidad = sobrantes
            descripcion = f"SOBRANTE CONTEO INVENTARIO - {nombre_bodega}"
        elif faltantes > 0:
            tipo = "EGR"
            cantidad = faltantes
            descripcion = f"FALTANTE CONTEO INVENTARIO - {nombre_bodega}"
        else:
            log(f"  [SKIP] Sin sobrantes ni faltantes")
            continue

        detalles = [{"producto_id": producto_id, "precio": "0.0", "cantidad": str(float(cantidad))}]
        centro = MAPEO_CENTROS_A.get(local_id, nombre_bodega)

        num_doc = post_movimiento(tipo, bodega_id, detalles, fecha, descripcion)

        if num_doc and "ERROR" not in num_doc:
            marcar_hecho(api, AIRTABLE_BASE_A, TABLE_CONTEO, record_id, num_doc)
            detalle_tg = f"📦 {nombre_producto(codigo)} ({codigo}) x {cantidad}\n📅 {fecha}"
            notificar_exito("Conteo Inventario", centro, detalle_tg, num_doc)
        else:
            marcar_hecho(api, AIRTABLE_BASE_A, TABLE_CONTEO, record_id, "ERROR-VER-LOG")
            detalle_tg = f"📦 {nombre_producto(codigo)} ({codigo}) x {cantidad}\n📅 {fecha}"
            notificar_error("Conteo Inventario", centro, detalle_tg, "Fallo al crear via API - revisar log")


# ============================================================
# MAIN
# ============================================================
def main():
    inicio = datetime.now()
    log("=" * 55)
    log("CARGA MOVIMIENTOS CONTIFICO VIA API")
    log(f"Inicio: {inicio.strftime('%Y-%m-%d %H:%M:%S')}")
    log("=" * 55)

    # Cargar solo el catálogo de bodegas (los productos se buscan por código individual)
    log("\nCargando bodegas desde Contifico API...")
    try:
        bodegas = cargar_bodegas_api()
    except Exception as e:
        log(f"[ERROR CRITICO] No se pudo cargar bodegas de Contifico: {e}")
        sys.exit(1)

    # Ejecutar cada bot de forma independiente
    for nombre_bot, funcion in [
        ("Ingresos Extraordinarios", procesar_ingresos),
        ("Traslados",               procesar_traslados),
        ("Bajas Tiendas",           procesar_bajas),
        ("Conteo Inventario",       procesar_conteo),
    ]:
        try:
            funcion(bodegas)
        except Exception as e:
            log_error(nombre_bot, str(e))

    # Resumen final
    fin = datetime.now()
    duracion = (fin - inicio).seconds
    log("\n" + "=" * 55)
    log(f"PROCESO COMPLETADO en {duracion}s")
    if errores_globales:
        log(f"ERRORES ({len(errores_globales)}):")
        for err in errores_globales:
            log(f"  {err}")
    else:
        log("Sin errores.")
    log("=" * 55)

    # Salir con codigo de error si hubo problemas (util para GitHub Actions)
    if errores_globales:
        sys.exit(1)


if __name__ == "__main__":
    main()
