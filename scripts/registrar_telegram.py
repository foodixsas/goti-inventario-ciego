"""Registra en la BD a quien active el bot de Telegram.

Antes, para que alguien recibiera avisos habia que pedirle su chat_id, escribirlo
a mano en notificar_telegram.py y desplegar. Ahora la persona le escribe /start
al bot (@ChiosInventariosBot) y queda registrada como PENDIENTE; desde el panel
se le asigna la bodega y empieza a recibir.

Se consulta con getUpdates (el bot no tiene webhook). Telegram entrega cada
mensaje una sola vez si se confirma el offset, por eso al final se llama de
nuevo con offset = ultimo + 1: si no, los mismos mensajes vuelven en cada
corrida y se responderia varias veces a la misma persona.

Uso:  python registrar_telegram.py
Variables: TELEGRAM_TOKEN, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

import psycopg2
import psycopg2.extras

TOKEN = os.getenv('TELEGRAM_TOKEN', '')
API = f'https://api.telegram.org/bot{TOKEN}'


def log(m):
    print(f'[{datetime.now():%H:%M:%S}] {m}', flush=True)


def telegram(metodo, params=None):
    url = f'{API}/{metodo}'
    if params:
        url += '?' + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode('utf-8', 'ignore') or '{}')
    except Exception as e:
        return {'ok': False, 'description': str(e)[:120]}


def conectar():
    return psycopg2.connect(
        host=os.getenv('DB_HOST', ''), dbname=os.getenv('DB_NAME', 'InventariosLocales'),
        user=os.getenv('DB_USER', ''), password=os.getenv('DB_PASSWORD', ''),
        port=5432, sslmode='require', connect_timeout=20,
        cursor_factory=psycopg2.extras.RealDictCursor)


BIENVENIDA = (
    '👋 <b>Bot de Inventarios FOODIX</b>\n\n'
    'Quedaste registrado como <b>{nombre}</b>.\n\n'
    '⏳ Falta que contabilidad te asigne a una bodega. '
    'Cuando lo hagan empezaras a recibir los avisos de movimientos.\n\n'
    'No hace falta que hagas nada mas.'
)
YA_ESTABA = (
    '✅ Ya estabas registrado.\n\n'
    'Bodegas asignadas: <b>{bodegas}</b>\n'
    'Avisos: <b>{avisos}</b>'
)


def main():
    if not TOKEN:
        log('Falta TELEGRAM_TOKEN')
        return 1

    d = telegram('getUpdates', {'limit': 100, 'timeout': 0})
    if not d.get('ok'):
        log(f'getUpdates fallo: {d.get("description")}')
        return 1
    updates = d.get('result', [])
    log(f'{len(updates)} mensaje(s) por revisar')
    if not updates:
        return 0

    con = None
    nuevos = repetidos = 0
    try:
        con = conectar()
        cur = con.cursor()
        for u in updates:
            msg = u.get('message') or u.get('my_chat_member') or {}
            chat = msg.get('chat') or {}
            chat_id = chat.get('id')
            if not chat_id:
                continue
            texto = (msg.get('text') or '').strip().lower()
            # Solo damos de alta con /start; el resto se ignora.
            if not texto.startswith('/start'):
                continue

            nombre = (f"{chat.get('first_name','')} {chat.get('last_name','')}".strip()
                      or chat.get('title') or str(chat_id))
            usuario = chat.get('username')

            cur.execute("""SELECT bodegas, avisos, estado FROM goti.telegram_destinatarios
                           WHERE chat_id = %s""", (chat_id,))
            ya = cur.fetchone()
            if ya:
                repetidos += 1
                bods = ', '.join(ya['bodegas']) if ya['bodegas'] else 'ninguna todavia'
                telegram('sendMessage', {
                    'chat_id': chat_id, 'parse_mode': 'HTML',
                    'text': YA_ESTABA.format(bodegas=bods, avisos=ya['avisos'])})
                log(f'   ya registrado: {chat_id} ({nombre})')
                continue

            cur.execute("""
                INSERT INTO goti.telegram_destinatarios
                    (chat_id, nombre, username, bodegas, estado, activo, notas)
                VALUES (%s, %s, %s, '{}', 'pendiente', TRUE, 'alta automatica por /start')
            """, (chat_id, nombre[:120], (usuario or '')[:80]))
            con.commit()
            nuevos += 1
            telegram('sendMessage', {'chat_id': chat_id, 'parse_mode': 'HTML',
                                     'text': BIENVENIDA.format(nombre=nombre)})
            log(f'   NUEVO: {chat_id} ({nombre}) -> pendiente de asignar')
    except Exception as e:
        if con:
            con.rollback()
        log(f'ERROR: {e}')
        return 1
    finally:
        if con:
            con.close()

    # Confirmar los mensajes leidos para que no vuelvan en la proxima corrida.
    telegram('getUpdates', {'offset': updates[-1]['update_id'] + 1, 'limit': 1, 'timeout': 0})
    log(f'nuevos: {nuevos} | ya estaban: {repetidos}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
