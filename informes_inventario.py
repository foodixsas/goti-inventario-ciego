# -*- coding: utf-8 -*-
"""
Informes de inventario dentro del panel: los semanales y los mensuales que
antes eran archivos HTML sueltos en el disco de una PC.

Por que en la base y no leyendo la carpeta
------------------------------------------
Los informes los arma `generar_informe_semanal.py` / `generar_informe_mensual.py`
y quedaban como HTML en la carpeta del proyecto. Servirlos desde ahi solo
funciona en la PC que los genero: en Render ese disco no existe. Aca el HTML
terminado se guarda en `goti.gfc_informes_inventario` y el panel lo sirve
igual en local y en produccion.

El HTML se guarda TAL CUAL se genero. Son documentos autocontenidos (llevan la
tipografia y los iconos incrustados) y eso es justo lo que los hace servibles
sin internet y archivables: un informe consultado en diciembre debe verse
exactamente como el dia que se emitio, aunque la plantilla haya cambiado.

Quien genera
------------
La generacion NO pasa por aca: la hace el script `cargar_informes_a_bd.py`,
que construye las semanas que falten y las sube. El panel es de LECTURA. Se
hizo asi a proposito: generar un informe toma segundos de consulta pesada y,
sobre todo, un informe ya emitido no debe poder reescribirse desde un boton
(asi se destruyo el original de la semana 27jul-02ago).

Endpoints
---------
    GET  /api/informes-inv                -> listado (sin el HTML)
    GET  /api/informes-inv/<id>/ver       -> el HTML del informe
    GET  /api/informes-inv/periodos       -> que semanas/meses hay con datos
                                             y cuales aun no tienen informe
"""
import io
import os
import re
from datetime import date, datetime, timedelta

import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Blueprint, jsonify, request, Response

bp_informes_inv = Blueprint('informes_inventario', __name__)

TIPOS = ('semanal', 'mensual', 'evolucion', 'bodegas')

MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
         'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']


def _conn():
    """Usa la conexion del app para no repetir credenciales."""
    from app import DB_CONFIG
    cfg = dict(DB_CONFIG)
    cfg['cursor_factory'] = RealDictCursor
    return psycopg2.connect(**cfg)


def asegurar_tabla(cur):
    # El catalogo de tipos va en un CHECK y no en tabla aparte: son cuatro
    # valores que no se administran desde ninguna pantalla.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS goti.gfc_informes_inventario (
            id              serial PRIMARY KEY,
            tipo            text NOT NULL
                            CHECK (tipo IN ('semanal','mensual','evolucion','bodegas')),
            periodo_inicio  date NOT NULL,
            periodo_fin     date NOT NULL,
            titulo          text NOT NULL,
            archivo         text,
            html            text NOT NULL,
            bytes           integer,
            generado_en     timestamptz DEFAULT now(),
            generado_por    text,
            UNIQUE (tipo, periodo_inicio, periodo_fin)
        )
    """)
    cur.execute("""CREATE INDEX IF NOT EXISTS gfc_informes_inv_periodo_idx
                     ON goti.gfc_informes_inventario (tipo, periodo_inicio DESC)""")


# ------------------------------------------------------------------ listado

@bp_informes_inv.route('/api/informes-inv', methods=['GET'])
def listar():
    """Listado sin el HTML: son ~230 KB por informe y no hacen falta aqui."""
    tipo = (request.args.get('tipo') or '').strip()
    conn = _conn()
    try:
        cur = conn.cursor()
        asegurar_tabla(cur)
        conn.commit()
        sql = """SELECT id, tipo, periodo_inicio, periodo_fin, titulo, archivo,
                        bytes, generado_en
                   FROM goti.gfc_informes_inventario"""
        args = []
        if tipo in TIPOS:
            sql += ' WHERE tipo = %s'
            args.append(tipo)
        sql += ' ORDER BY periodo_inicio DESC, tipo'
        cur.execute(sql, args)
        filas = [dict(f) for f in cur.fetchall()]
        return jsonify({'ok': True, 'informes': filas, 'total': len(filas)})
    finally:
        conn.close()


@bp_informes_inv.route('/api/informes-inv/<int:informe_id>/ver', methods=['GET'])
def ver(informe_id):
    """Devuelve el HTML tal cual se archivo, para mostrarlo en un iframe o en
    una pestana nueva."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""SELECT titulo, html FROM goti.gfc_informes_inventario
                        WHERE id = %s""", (informe_id,))
        f = cur.fetchone()
        if not f:
            return Response('<h1>No existe ese informe</h1>', status=404,
                            mimetype='text/html')
        # content_type y no mimetype: con mimetype Flask vuelve a pegar el
        # charset y sale 'text/html; charset=utf-8; charset=utf-8'.
        return Response(f['html'], content_type='text/html; charset=utf-8')
    finally:
        conn.close()


# ------------------------------------------------------------------ periodos

def semanas_con_datos(cur, desde=None):
    """Semanas (lunes-domingo) que tienen conteos cargados.

    Solo se ofrecen desde el 06-abr-2026: antes de esa fecha hay conteos pero
    `contado_por` esta vacio, y sin responsable el informe semanal se queda sin
    su ranking de colaboradores, que es la mitad del informe.
    """
    cur.execute("""
        SELECT date_trunc('week', fecha)::date AS lunes,
               count(*) AS filas,
               count(*) FILTER (WHERE contado_por IS NOT NULL
                                  AND contado_por <> '') AS con_responsable
          FROM goti.inventario_ciego_conteos
         WHERE fecha >= %s
         GROUP BY 1 HAVING count(*) > 50
         ORDER BY 1 DESC
    """, (desde or date(2026, 4, 6),))
    salida = []
    for f in cur.fetchall():
        lunes = f['lunes']
        salida.append({'inicio': lunes, 'fin': lunes + timedelta(days=6),
                       'filas': f['filas'],
                       'con_responsable': f['con_responsable']})
    return salida


@bp_informes_inv.route('/api/informes-inv/periodos', methods=['GET'])
def periodos():
    """Que semanas y meses hay con datos, y cuales ya tienen informe.

    Sirve para que la pantalla muestre los huecos en vez de callarlos: una
    semana sin informe se ve como pendiente, no desaparece del listado.
    """
    conn = _conn()
    try:
        cur = conn.cursor()
        asegurar_tabla(cur)
        conn.commit()

        cur.execute("""SELECT tipo, periodo_inicio, periodo_fin, id, titulo
                         FROM goti.gfc_informes_inventario""")
        hechos = {}
        for f in cur.fetchall():
            hechos[(f['tipo'], f['periodo_inicio'])] = {
                'id': f['id'], 'titulo': f['titulo'],
                'fin': f['periodo_fin']}

        sem = []
        for s in semanas_con_datos(cur):
            info = hechos.get(('semanal', s['inicio']))
            sem.append({
                'inicio': s['inicio'], 'fin': s['fin'],
                'filas': s['filas'], 'con_responsable': s['con_responsable'],
                'informe_id': info['id'] if info else None,
                'titulo': info['titulo'] if info else None,
            })

        # Un mes se queda con las semanas cuyo DOMINGO cae dentro del mes (es
        # la regla que siguen los informes publicados de junio y julio).
        meses = {}
        for s in sem:
            clave = (s['fin'].year, s['fin'].month)
            m = meses.setdefault(clave, {'semanas': 0, 'con_informe': 0})
            m['semanas'] += 1
            if s['informe_id']:
                m['con_informe'] += 1
        men = []
        for (anio, mes) in sorted(meses, reverse=True):
            inicio = date(anio, mes, 1)
            info = hechos.get(('mensual', inicio))
            men.append({
                'anio': anio, 'mes': mes,
                'etiqueta': '%s %d' % (MESES[mes - 1], anio),
                'inicio': inicio,
                'semanas': meses[(anio, mes)]['semanas'],
                'semanas_con_informe': meses[(anio, mes)]['con_informe'],
                'informe_id': info['id'] if info else None,
            })

        otros = [{'id': v['id'], 'titulo': v['titulo'], 'tipo': k[0],
                  'inicio': k[1]}
                 for k, v in hechos.items() if k[0] in ('evolucion', 'bodegas')]
        otros.sort(key=lambda x: x['inicio'], reverse=True)

        return jsonify({'ok': True, 'semanas': sem, 'meses': men,
                        'otros': otros})
    finally:
        conn.close()


# ------------------------------------------------------------------ ingesta

def guardar_informe(cur, tipo, inicio, fin, titulo, html, archivo='',
                    quien='script'):
    """Upsert por (tipo, periodo). Re-subir el mismo informe lo reemplaza."""
    cur.execute("""
        INSERT INTO goti.gfc_informes_inventario
            (tipo, periodo_inicio, periodo_fin, titulo, archivo, html, bytes,
             generado_por)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (tipo, periodo_inicio, periodo_fin) DO UPDATE SET
            titulo = EXCLUDED.titulo,
            archivo = EXCLUDED.archivo,
            html = EXCLUDED.html,
            bytes = EXCLUDED.bytes,
            generado_en = now(),
            generado_por = EXCLUDED.generado_por
        RETURNING id
    """, (tipo, inicio, fin, titulo, archivo, html, len(html or ''), quien))
    return cur.fetchone()['id']
