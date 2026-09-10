"""
Arranca Control Contable en localhost con las credenciales de Supabase cargadas.

Solo para pruebas locales del modulo de movimientos entre bodegas.
No usar en Render: alli las variables se configuran en el panel del servicio.

    python run_local.py

La clave secreta NO vive en este archivo: esta carpeta se sincroniza con
SharePoint/OneDrive. Se lee de %USERPROFILE%\\.foodix\\supabase.env, que se
queda solo en esta maquina. Ese archivo tiene una linea por variable:

    SUPABASE_URL=https://xxxxx.supabase.co
    SUPABASE_SERVICE_KEY=sb_secret_xxxxx
"""
import io
import os
import sys

CRED = os.path.join(os.path.expanduser('~'), '.foodix', 'supabase.env')


def cargar_credenciales():
    if not os.path.exists(CRED):
        print('ERROR: no encuentro el archivo de credenciales:')
        print('   ' + CRED)
        print('\nCrealo con estas dos lineas:')
        print('   SUPABASE_URL=https://hlgtkcwecxdnyrhmcspi.supabase.co')
        print('   SUPABASE_SERVICE_KEY=sb_secret_...')
        sys.exit(1)

    for linea in io.open(CRED, encoding='utf-8'):
        linea = linea.strip()
        if not linea or linea.startswith('#') or '=' not in linea:
            continue
        clave, valor = linea.split('=', 1)
        os.environ.setdefault(clave.strip(), valor.strip())

    if not os.environ.get('SUPABASE_SERVICE_KEY'):
        print('ERROR: falta SUPABASE_SERVICE_KEY en ' + CRED)
        sys.exit(1)


cargar_credenciales()
os.environ.setdefault('PORT', '5055')

from app import app  # noqa: E402  (el import va despues de fijar el entorno)

if __name__ == '__main__':
    puerto = int(os.environ['PORT'])
    print('Control Contable (local) -> http://127.0.0.1:%d' % puerto)
    print('Supabase: ' + os.environ.get('SUPABASE_URL', '(sin definir)'))
    app.run(host='127.0.0.1', port=puerto, debug=False)
