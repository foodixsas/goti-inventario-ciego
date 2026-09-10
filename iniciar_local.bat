@echo off
REM ---------------------------------------------------------------------
REM  Control Contable en local  ->  http://127.0.0.1:5055
REM
REM  Doble clic aqui y dejar la ventana ABIERTA: mientras este abierta, el
REM  servidor vive. Se cierra con Ctrl+C o cerrando la ventana.
REM
REM  Conviene levantarlo asi y no desde Claude: las tareas en segundo plano
REM  de la sesion se cortan solas cada tanto y el servidor se cae con ellas.
REM
REM  Las credenciales se leen de %USERPROFILE%\.foodix\supabase.env, que
REM  queda fuera de OneDrive a proposito.
REM ---------------------------------------------------------------------

cd /d "%~dp0"

title Control Contable - local :5055

echo.
echo   Control Contable  ->  http://127.0.0.1:5055
echo   Dejar esta ventana abierta. Ctrl+C para detener.
echo.

python run_local.py

echo.
echo   El servidor se detuvo.
pause
