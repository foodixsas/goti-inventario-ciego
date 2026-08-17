"""
Bot Produccion Simon Bolon: Airtable -> Contifico
Registra producciones (materia prima → producto terminado)

Flujo:
  1. Leer Airtable - registros pendientes (Hecho=False)
  2. Login Contifico
  3. Nueva produccion (+)
  4. Fecha / Bodega Origen / Bodega Destino / Descripcion
  5. Agregar Detalle -> producto terminado + unidades producidas
  6. Editar Formula -> kilos reales (sin conversion) -> Guardar -> Cerrar
  7. Producir
  8. Capturar codigo PRO -> Actualizar Airtable (Hecho=True + numero)
"""
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from pyairtable import Api
from datetime import datetime
import time
import os
import sys
from notificar_telegram import notificar_error, notificar_exito, nombre_producto
import re
from urllib.parse import urlparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================
# CONFIGURACION
# ============================================
AIRTABLE_TOKEN    = os.getenv('AIRTABLE_TOKEN_A', '')
AIRTABLE_BASE_ID  = 'apppZXgUChlBLbVpR'
AIRTABLE_TABLE_ID = 'tblgn5VZkeb6HW6XQ'  # Registro Producciones de Simon Bolon

CONTIFICO_LOGIN_URL      = 'https://base.contifico.com/sistema/accounts/login/'
CONTIFICO_PRODUCCION_URL = 'https://1793168604001.contifico.com/sistema/inventario/produccion/'
CONTIFICO_USUARIO        = os.getenv('CONTIFICO_WEB_USUARIO', '')
CONTIFICO_PASSWORD       = os.getenv('CONTIFICO_WEB_PASSWORD', '')

BODEGA = 'BODEGA SIMON BOLON'

# SIMULAR=1 -> lee la cola y muestra que registraria, sin tocar Contifico.
SIMULAR = os.getenv('SIMULAR', '1') == '1'

# Este bot NUNCA genero asiento contable, ni en su version Selenium: no hay
# rastro de 'generar_asiento' ni de centro de costo en test_produccion.py.
# Migrarlo tal cual no pierde nada contablemente.


# ============================================
# DRIVER
# ============================================
def crear_driver():
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('--disable-gpu')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    # En la imagen de Docker el chromedriver ya viene instalado; fuera de ahi
    # se resuelve con webdriver_manager como hacia el bot original.
    ruta_sistema = os.environ.get('CHROMEDRIVER', '/usr/bin/chromedriver')
    binario_chrome = os.environ.get('CHROME_BIN')
    if binario_chrome:
        options.binary_location = binario_chrome
    if os.path.exists(ruta_sistema):
        return webdriver.Chrome(service=Service(ruta_sistema), options=options)
    from webdriver_manager.chrome import ChromeDriverManager
    return webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)


# ============================================
# AIRTABLE
# ============================================
def obtener_registro_pendiente(omitir=()):
    print('\n1. LEYENDO AIRTABLE - PRODUCCIONES...')
    print('-' * 40)

    api = Api(AIRTABLE_TOKEN)
    table = api.table(AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID)
    records = table.all()

    for record in records:
        fields = record['fields']

        # OJO: el campo es 'hecho' en MINUSCULA en esta tabla; los otros bots
        # usan 'Hecho'. Buscarlo con mayuscula da 384 pendientes de 384.
        if fields.get('hecho', False):
            continue

        if record['id'] in omitir:
            continue

        # Fecha
        fecha_raw = fields.get('Fecha', '')
        try:
            fecha = datetime.strptime(fecha_raw[:10], '%Y-%m-%d').strftime('%d/%m/%Y')
        except:
            fecha = datetime.now().strftime('%d/%m/%Y')

        # Producto terminado
        codigos_pt = fields.get('Código (from producto_terminado)', [])
        codigo_pt  = codigos_pt[0] if codigos_pt else ''

        # Producto materia prima
        codigos_mp = fields.get('Código (from producto_mp)', [])
        codigo_mp  = codigos_mp[0] if codigos_mp else ''

        unidades_terminadas = fields.get('Unidades Terminadas', 0) or 0
        kilos_reales        = fields.get('Kilos Reales', 0) or 0
        lote                = fields.get('Lote', '') or ''
        observacion         = fields.get('Observación', '') or ''

        if not codigo_pt or not unidades_terminadas:
            print(f'   [SKIP] Sin producto terminado o unidades: {record["id"]}')
            continue

        if not kilos_reales:
            print(f'   [SKIP] Sin kilos reales: {record["id"]}')
            continue

        print(f'   Record ID:          {record["id"]}')
        print(f'   Fecha:              {fecha}')
        print(f'   Producto MP:        {codigo_mp}')
        print(f'   Kilos Reales:       {kilos_reales} kg')
        print(f'   Producto Terminado: {codigo_pt}')
        print(f'   Unidades:           {unidades_terminadas}')
        print(f'   Lote:               {lote}')

        return {
            'record_id':          record['id'],
            'fecha':              fecha,
            'codigo_mp':          codigo_mp,
            'kilos_reales':       kilos_reales,
            'codigo_pt':          codigo_pt,
            'unidades_terminadas': unidades_terminadas,
            'lote':               lote,
            'observacion':        observacion,
        }

    print('   Sin registros pendientes')
    return None


def actualizar_airtable(record_id, num_documento):
    print('\n   ACTUALIZANDO AIRTABLE...')
    try:
        api   = Api(AIRTABLE_TOKEN)
        table = api.table(AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID)
        if num_documento:
            table.update(record_id, {
                'hecho': True,
                'num_documento': str(num_documento)
            })
            print(f'   [OK] Hecho=True | num={num_documento}')
            return True
        else:
            print('   [WARN] Sin numero — Hecho NO se marca')
            return False
    except Exception as e:
        print(f'   [ERROR] Airtable: {e}')
        return False


# ============================================
# CONTIFICO - HELPERS
# ============================================
def _autocomplete(driver, data_id, valor, timeout=10):
    wait = WebDriverWait(driver, timeout)
    driver.execute_script(f"var h=document.getElementById('{data_id}'); if(h) h.value='';")
    campo = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, f"input[data_id='{data_id}']")))
    driver.execute_script('arguments[0].scrollIntoView(true);', campo)
    time.sleep(0.3)
    campo.click()
    campo.send_keys(Keys.CONTROL + 'a')
    campo.send_keys(Keys.DELETE)
    campo.send_keys(valor)
    time.sleep(2.5)
    opciones = [o for o in driver.find_elements(By.CSS_SELECTOR, 'ul.ui-autocomplete li.ui-menu-item') if o.is_displayed()]
    if opciones:
        elegida = next((o for o in opciones if valor.upper() in o.text.upper()), opciones[0])
        elegida.click()
        time.sleep(1)
    else:
        campo.send_keys(Keys.DOWN)
        time.sleep(0.3)
        campo.send_keys(Keys.ENTER)
        time.sleep(1)
    val_hidden = driver.execute_script(f"var h=document.getElementById('{data_id}'); return h ? h.value : '';") or ''
    return bool(val_hidden)


# ============================================
# CONTIFICO - PASOS
# ============================================
def login_contifico(driver):
    print('\n2. LOGIN EN CONTIFICO...')
    driver.get(CONTIFICO_LOGIN_URL)
    wait = WebDriverWait(driver, 15)
    wait.until(EC.presence_of_element_located((By.NAME, 'username'))).send_keys(CONTIFICO_USUARIO)
    driver.find_element(By.NAME, 'password').send_keys(CONTIFICO_PASSWORD)
    driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
    time.sleep(3)
    print('   [OK] Login')


def nueva_produccion(driver):
    driver.get(CONTIFICO_PRODUCCION_URL)
    time.sleep(4)
    driver.find_element(By.CSS_SELECTOR, 'span.ico-plus').click()
    time.sleep(4)
    print(f'   [OK] Nueva produccion: {driver.current_url}')


def paso_fecha(driver, fecha):
    campo = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, 'id_fecha')))
    campo.clear()
    campo.send_keys(fecha)
    campo.send_keys(Keys.ESCAPE)
    time.sleep(0.5)
    driver.find_element(By.TAG_NAME, 'body').click()
    time.sleep(0.5)
    print(f'   [OK] Fecha: {fecha}')


def paso_bodegas(driver):
    for intento in range(1, 4):
        ok = _autocomplete(driver, 'id_bodega_id', BODEGA)
        if ok:
            print(f'   [OK] Bodega Origen: {BODEGA}')
            break
        print(f'   [REINTENTO {intento}/3] bodega origen')
        time.sleep(1)

    for intento in range(1, 4):
        ok = _autocomplete(driver, 'id_bodega_destino_id', BODEGA)
        if ok:
            print(f'   [OK] Bodega Destino: {BODEGA}')
            break
        print(f'   [REINTENTO {intento}/3] bodega destino')
        time.sleep(1)


def paso_descripcion(driver, codigo_pt):
    desc = f'PRODUCCION SIMON BOLON - {codigo_pt}'
    campo = driver.find_element(By.ID, 'id_descripcion')
    campo.clear()
    campo.send_keys(desc)
    print(f'   [OK] Descripcion: {desc}')


def paso_agregar_detalle(driver):
    driver.find_element(By.CSS_SELECTOR, 'a[href="javascript:add_detalle();"]').click()
    time.sleep(3)
    print('   [OK] Detalle agregado')


def paso_producto_terminado(driver, codigo_pt):
    ok = _autocomplete(driver, 'id_produccion_1-producto_id', codigo_pt)
    if ok:
        print(f'   [OK] Producto terminado: {codigo_pt}')
    else:
        print(f'   [WARN] Producto no verificado: {codigo_pt}')
    time.sleep(1)


def paso_cantidad_producida(driver, unidades):
    campo = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, 'id_produccion_1-cantidad'))
    )
    driver.execute_script('arguments[0].scrollIntoView(true);', campo)
    time.sleep(0.2)
    campo.click()
    campo.clear()
    campo.send_keys(str(round(float(unidades), 2)))
    time.sleep(0.5)
    driver.find_element(By.TAG_NAME, 'body').click()
    time.sleep(1)
    print(f'   [OK] Unidades producidas: {unidades}')


def paso_editar_formula(driver, kilos_mp):
    gramos_mp = round(float(kilos_mp) * 1000, 2)
    print(f'\n   EDITANDO FORMULA ({kilos_mp} kg -> {gramos_mp} g MP)...')

    # Esperar a que la fila se auto-guarde
    time.sleep(3)

    # Cerrar cualquier modal/bootbox que bloquee el clic
    driver.execute_script("""
        try { $('.bootbox').modal('hide'); } catch(e) {}
        try { $('.modal').modal('hide'); } catch(e) {}
        try { $('.modal-backdrop').remove(); } catch(e) {}
        try { $('body').removeClass('modal-open'); } catch(e) {}
    """)
    time.sleep(1)

    # Verificar que el boton existe
    btns_editar = driver.find_elements(By.CSS_SELECTOR, 'a.editar_formula')
    if not btns_editar:
        raise Exception('Boton Editar no encontrado en la pagina')
    print(f'   [OK] Boton Editar encontrado ({len(btns_editar)} elementos)')

    # Hay 2 botones editar_formula: el del template (sin texto) y el del producto real (con texto "Editar")
    # Usar el que tiene texto "Editar" (el del producto real)
    btn_correcto = next((b for b in btns_editar if 'Editar' in b.text), btns_editar[-1])
    driver.execute_script('arguments[0].click();', btn_correcto)
    time.sleep(5)

    print('   [OK] Modal formula abierto')

    # Esperar campo cantidad en el modal
    campo_gramos = WebDriverWait(driver, 15).until(
        EC.presence_of_element_located((By.ID, 'id_producto_1-cantidad'))
    )
    time.sleep(0.5)
    campo_gramos.click()
    time.sleep(0.5)
    # Seleccionar todo
    campo_gramos.send_keys(Keys.CONTROL + 'a')
    time.sleep(0.5)
    # Borrar seleccion
    campo_gramos.send_keys(Keys.DELETE)
    time.sleep(1)
    # Escribir nuevo valor
    campo_gramos.send_keys(str(gramos_mp))
    time.sleep(1)
    # TAB para que Contifico registre el valor
    campo_gramos.send_keys(Keys.TAB)
    time.sleep(2)
    print(f'   [OK] Gramos MP llenado: {gramos_mp} ({kilos_mp} kg x 1000)')

    # Guardar formula
    btn_guardar = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.ID, 'boton_guardar_formula'))
    )
    driver.execute_script('arguments[0].scrollIntoView(true);', btn_guardar)
    time.sleep(0.5)
    driver.execute_script('arguments[0].click();', btn_guardar)
    time.sleep(5)
    print('   [OK] Formula guardada')

    # Cerrar modal
    try:
        btn_cerrar = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[data-dismiss="modal"]'))
        )
        btn_cerrar.click()
        time.sleep(3)
        print('   [OK] Modal cerrado')
    except:
        driver.execute_script("$('.modal').modal('hide');")
        time.sleep(3)
        print('   [OK] Modal cerrado (JS)')


def paso_producir(driver):
    print('\n   PRODUCIENDO...')
    btn = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.ID, 'boton_guardar_producir'))
    )
    driver.execute_script('arguments[0].scrollIntoView(true);', btn)
    time.sleep(0.5)
    btn.click()
    time.sleep(5)
    print('   [OK] Producir clickeado')

    # Confirmar modal si aparece
    try:
        btn_cont = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.ID, 'btndlgContinuar'))
        )
        btn_cont.click()
        time.sleep(4)
        print('   [OK] Modal confirmado')
    except:
        pass


def obtener_numero_produccion(driver):
    print('\n   CAPTURANDO NUMERO PRO...')

    def _buscar():
        # Método 1: buscar texto PRO en divs
        for el in driver.find_elements(By.CSS_SELECTOR, 'div, span, td'):
            t = el.text.strip()
            if t.startswith('PRO '):
                return t
        # Método 2: regex en page_source
        m = re.search(r'PRO\s+\d+', driver.page_source)
        if m:
            return m.group(0)
        # Método 3: numero en URL
        path = urlparse(driver.current_url).path
        nums = re.findall(r'/(\d{4,})', path)
        if nums:
            return nums[-1]
        return None

    for intento in range(1, 6):
        time.sleep(3)
        num = _buscar()
        if num:
            print(f'   [OK] Numero ({intento}): {num}')
            return num
        print(f'   [REINTENTO {intento}/5]')

    # Diagnostico si falla
    try:
        driver.save_screenshot(os.path.join(SCRIPT_DIR, 'debug_produccion_error.png'))
        print(f'   [DEBUG] URL: {driver.current_url}')
        print(f'   [DEBUG] Titulo: {driver.title}')
        errores = driver.find_elements(By.CSS_SELECTOR, '.alert, .alert-danger, .errorlist')
        for e in errores:
            txt = e.text.strip()
            if txt:
                print(f'   [DEBUG] Error: {txt}')
    except:
        pass

    print('   [WARN] No se capturo numero')
    return None


# ============================================
# PROCESAMIENTO PRINCIPAL
# ============================================
def procesar_registro(registro):
    driver = crear_driver()
    try:
        login_contifico(driver)

        print('\n3. NUEVA PRODUCCION EN CONTIFICO...')
        print('-' * 40)
        nueva_produccion(driver)

        print('\n4. LLENANDO FORMULARIO...')
        print('-' * 40)
        paso_fecha(driver, registro['fecha'])
        paso_bodegas(driver)
        paso_descripcion(driver, registro['codigo_pt'])

        print('\n5. PRODUCTO TERMINADO...')
        print('-' * 40)
        paso_agregar_detalle(driver)
        paso_producto_terminado(driver, registro['codigo_pt'])
        paso_cantidad_producida(driver, registro['unidades_terminadas'])

        print('\n6. FORMULA MATERIA PRIMA...')
        print('-' * 40)
        paso_editar_formula(driver, registro['kilos_reales'])

        print('\n7. PRODUCIR...')
        print('-' * 40)
        paso_producir(driver)

        num_doc = obtener_numero_produccion(driver)

        print('\n' + '=' * 60)
        print(f'   Resultado: {num_doc}')
        print('=' * 60)

        if num_doc:
            actualizar_airtable(registro['record_id'], num_doc)
            detalle = (
                f"📦 {nombre_producto(registro['codigo_pt'])} ({registro['codigo_pt']}) x {registro['unidades_terminadas']} uds\n"
                f"🥩 MP: {nombre_producto(registro['codigo_mp'])} ({registro['codigo_mp']}) - {registro['kilos_reales']} kg\n"
                f"📅 {registro['fecha']}"
            )
            notificar_exito('Produccion', 'SIMON BOLON', detalle, num_doc)
            print('[OK] REGISTRO PROCESADO')
            return True
        else:
            print('[ERROR] Sin numero — Airtable NO actualizado')
            detalle = f"📦 {nombre_producto(registro['codigo_pt'])} ({registro['codigo_pt']}) x {registro['unidades_terminadas']}\n📅 {registro['fecha']}"
            notificar_error('Produccion', 'SIMON BOLON', detalle, 'No se capturo numero PRO')
            return False

    except Exception as e:
        print(f'\n[ERROR GENERAL] {e}')
        import traceback
        traceback.print_exc()
        try:
            driver.save_screenshot(os.path.join(SCRIPT_DIR, 'debug_produccion_error.png'))
        except:
            pass
        detalle = f"📦 {nombre_producto(registro.get('codigo_pt', '?'))} ({registro.get('codigo_pt', '?')})\n📅 {registro.get('fecha', '?')}"
        notificar_error('Produccion', 'SIMON BOLON', detalle, str(e)[:150])
        return False
    finally:
        driver.quit()
        print('Navegador cerrado.')


# ============================================
# MAIN
# ============================================
def verificar_entorno():
    """Prueba de humo: abre Chromium, entra a Contifico y carga el formulario.

    Hace falta porque en modo simulacion, con la cola vacia, el navegador nunca
    se abre: la corrida sale verde sin haber probado nada de Selenium. Sin esto,
    la primera produccion real seria el primer intento de usar Chrome dentro del
    contenedor. No registra nada.
    """
    print('=' * 60)
    print('   VERIFICACION DE ENTORNO (no registra nada)')
    print('=' * 60)
    print(f'   CHROME_BIN   = {os.environ.get("CHROME_BIN")}')
    print(f'   CHROMEDRIVER = {os.environ.get("CHROMEDRIVER")}')
    driver = None
    try:
        driver = crear_driver()
        print('   [OK] Chromium arranco')
        print(f'   version: {driver.capabilities.get("browserVersion")} / '
              f'driver: {driver.capabilities.get("chrome", {}).get("chromedriverVersion", "?")[:24]}')
        login_contifico(driver)
        nueva_produccion(driver)
        # Si el formulario cargo, el campo de bodega origen tiene que existir.
        driver.find_element(By.CSS_SELECTOR, "input[data_id='id_bodega_id']")
        print('   [OK] Formulario de produccion accesible')
        print('\nENTORNO CORRECTO')
        return 0
    except Exception as e:
        print(f'\n[FALLO] {type(e).__name__}: {str(e)[:300]}')
        return 1
    finally:
        if driver:
            driver.quit()
            print('Navegador cerrado.')


def main():
    """Una sola pasada: procesa todas las producciones pendientes y termina.

    El bot original corria en bucle infinito dentro de bot_maestro.py, en la PC de
    Finanzas. Como cron job tiene que terminar, asi que se recorre la cola una vez.

    Los registros que fallan se anotan para no volver a intentarlos en esta misma
    corrida: obtener_registro_pendiente() siempre devuelve el primero sin marcar,
    asi que sin esto un registro con datos malos daria vueltas para siempre.
    """
    inicio = datetime.now()
    print('=' * 60)
    print('   PRODUCCION SIMON BOLON -> CONTIFICO  (una pasada)')
    print(f'   Inicio: {inicio.strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'   Modo:   {"SIMULACION (no registra)" if SIMULAR else "REGISTRO REAL"}')
    print('=' * 60)

    for nombre, valor in (('AIRTABLE_TOKEN_A', AIRTABLE_TOKEN),
                          ('CONTIFICO_WEB_USUARIO', CONTIFICO_USUARIO),
                          ('CONTIFICO_WEB_PASSWORD', CONTIFICO_PASSWORD)):
        if not valor:
            print(f'[ERROR CRITICO] Falta la variable {nombre}')
            return 1

    if os.getenv('VERIFICAR', '0') == '1':
        return verificar_entorno()

    fallidos, procesados = set(), 0
    while True:
        registro = obtener_registro_pendiente(omitir=fallidos)
        if not registro:
            break

        if SIMULAR:
            print(f'\n   [SIMULACION] no se registra {registro["codigo_pt"]} '
                  f'x{registro["unidades_terminadas"]} (record {registro["record_id"]})')
            fallidos.add(registro['record_id'])   # para no repetirlo en esta pasada
            continue

        print('\n' + '*' * 60)
        print('REGISTRO ENCONTRADO - Procesando...')
        print('*' * 60)
        try:
            if procesar_registro(registro):
                procesados += 1
            else:
                fallidos.add(registro['record_id'])
                print(f'   [FALLO] {registro["record_id"]} queda pendiente')
        except Exception as e:
            fallidos.add(registro['record_id'])
            print(f'   [EXCEPCION] {registro["record_id"]}: {e}')

    fin = datetime.now()
    print('\n' + '=' * 60)
    print(f'PROCESO COMPLETADO en {(fin - inicio).seconds}s')
    print(f'   producciones registradas: {procesados}')
    print(f'   quedaron pendientes:      {len(fallidos)}')
    print('=' * 60)

    # Igual que el bot de movimientos: un registro con datos malos NO tumba la
    # corrida (seguiria pendiente y la dejaria en rojo cada media hora). Solo
    # falla si no se pudo ni empezar.
    return 0


if __name__ == '__main__':
    sys.exit(main())
