"""
Galeria de evidencias: los registros migrados de Airtable, con sus fotos.

Las fotos NO estan en la base (pesan 14,6 GB en total): viven en disco, fuera
de OneDrive, y cada fila guarda la ruta relativa. Aqui se sirven redimensionadas
al vuelo, porque las originales son panoramicas de celular de hasta 12 MB y
mandarlas tal cual al navegador seria inusable.

Cuando exista la cuenta de Azure Blob Storage, solo cambia de donde se leen.
"""
import io
import os
import mimetypes
from flask import Blueprint, request, jsonify, send_file, abort, Response

bp_evidencias = Blueprint('evidencias', __name__)

RAIZ = os.path.join(os.path.expanduser('~'), 'foodix_evidencias')
CACHE = os.path.join(RAIZ, '_miniaturas')

# Cada galeria: de donde salen las filas y como se arma la ficha
GALERIAS = {
    'equipos': {
        'titulo': 'Equipos y Mobiliario',
        'tabla':  'goti.gma_listado_de_equipos_y_mobiliario',
        'rutas':  'fotografia_rutas',
        'campos': """codigo, equipos AS titulo, marca, modelo, serie,
                     categorias AS categoria, tipo, responsable, estado_carga AS estado,
                     observacion_inicial AS nota""",
        'busca':  ['codigo', 'equipos', 'marca', 'modelo', 'categorias', 'responsable'],
        'orden':  'codigo',
    },
    'caja-chica': {
        'titulo': 'Registros de Caja Chica',
        'tabla':  'goti.gfc_registros_caja_chica',
        'rutas':  'fotografia_rutas',
        'campos': """id_caja_chica AS codigo, tipo_de_gasto AS titulo,
                     proveedor AS marca, centro_de_costos_1 AS modelo,
                     numero_de_documento AS serie, grupo AS categoria,
                     subgrupo AS tipo, fecha_de_pago::text AS responsable,
                     estado, descripcion AS nota""",
        'busca':  ['id_caja_chica', 'tipo_de_gasto', 'proveedor', 'grupo', 'descripcion'],
        'orden':  'fecha_de_pago DESC',
    },
}


def _db():
    from app import get_db
    return get_db()


def _soltar(conn):
    if conn is not None:
        from app import release_db
        release_db(conn)


@bp_evidencias.route('/api/evidencias/<galeria>', methods=['GET'])
def evidencias_listar(galeria):
    g = GALERIAS.get(galeria)
    if not g:
        return jsonify({'success': False, 'error': 'Galeria desconocida'}), 404

    q = (request.args.get('q') or '').strip()
    try:
        limite = min(int(request.args.get('limite', 60)), 200)
        pagina = max(int(request.args.get('pagina', 1)), 1)
    except ValueError:
        limite, pagina = 60, 1

    sql = "SELECT %s, %s AS rutas FROM %s WHERE %s IS NOT NULL" % (
        g['campos'], g['rutas'], g['tabla'], g['rutas'])
    params = []
    if q:
        sql += " AND (" + " OR ".join("coalesce(%s::text,'') ILIKE %%s" % c for c in g['busca']) + ")"
        params += ['%' + q + '%'] * len(g['busca'])
    sql += " ORDER BY %s LIMIT %%s OFFSET %%s" % g['orden']
    params += [limite, (pagina - 1) * limite]

    conteo = "SELECT count(*) AS n FROM %s WHERE %s IS NOT NULL" % (g['tabla'], g['rutas'])
    conteo_params = []
    if q:
        conteo += " AND (" + " OR ".join("coalesce(%s::text,'') ILIKE %%s" % c for c in g['busca']) + ")"
        conteo_params = ['%' + q + '%'] * len(g['busca'])

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute(conteo, conteo_params)
        total = cur.fetchone()['n']
        cur.execute(sql, params)
        filas = [dict(r) for r in cur.fetchall()]
        return jsonify({'success': True, 'titulo': g['titulo'], 'total': total,
                        'pagina': pagina, 'limite': limite, 'registros': filas})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)[:300]}), 500
    finally:
        _soltar(conn)


@bp_evidencias.route('/evidencias/foto')
def evidencias_foto():
    """Sirve una foto. Con ?ancho=N la devuelve redimensionada y cacheada."""
    rel = (request.args.get('r') or '').replace('\\', '/')
    # Nunca dejar salir de la carpeta de evidencias
    destino = os.path.normpath(os.path.join(RAIZ, rel))
    if not destino.startswith(os.path.normpath(RAIZ)) or not os.path.isfile(destino):
        abort(404)

    try:
        ancho = int(request.args.get('ancho', 0))
    except ValueError:
        ancho = 0

    tipo = mimetypes.guess_type(destino)[0] or 'application/octet-stream'
    if not ancho or not tipo.startswith('image/'):
        return send_file(destino, mimetype=tipo)

    mini = os.path.join(CACHE, str(ancho), rel.replace('/', '__') + '.jpg')
    if not os.path.exists(mini):
        try:
            from PIL import Image
            os.makedirs(os.path.dirname(mini), exist_ok=True)
            im = Image.open(destino)
            im.thumbnail((ancho, ancho))
            im.convert('RGB').save(mini, 'JPEG', quality=80, optimize=True)
        except Exception:
            return send_file(destino, mimetype=tipo)   # si falla, la original
    return send_file(mini, mimetype='image/jpeg')


@bp_evidencias.route('/evidencias')
@bp_evidencias.route('/evidencias/<galeria>')
def evidencias_pagina(galeria='equipos'):
    if galeria not in GALERIAS:
        abort(404)
    html = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                'static', 'evidencias.html'), encoding='utf-8').read()
    return Response(html.replace('{{GALERIA}}', galeria), mimetype='text/html')
