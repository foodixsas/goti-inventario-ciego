// Credenciales del SRI: una sola clave, cifrada en la base, para todos los
// procesos que hablan con el portal (importacion directa, capturas automaticas).
//
// La clave nunca vuelve del servidor: la pantalla solo muestra si hay una
// guardada, de cuando es y como salio la ultima prueba. "Probar conexion" hace
// UN solo intento de login (el SRI bloquea la cuenta tras varios fallos).

let _scEnganchado = false;

function scEsc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso)
        : d.toLocaleString('es-EC', { day: '2-digit', month: '2-digit',
                                      year: 'numeric', hour: '2-digit',
                                      minute: '2-digit' });
}

function scAviso(texto, tipo) {
    const c = document.getElementById('sc-aviso');
    if (!c) return;
    if (!texto) { c.style.display = 'none'; c.innerHTML = ''; return; }
    const colores = {
        ok:    ['#ecfdf5', '#065f46', '#a7f3d0'],
        error: ['#fef2f2', '#991b1b', '#fecaca'],
        info:  ['#eff6ff', '#1e40af', '#bfdbfe'],
    };
    const [fondo, letra, borde] = colores[tipo] || colores.info;
    c.style.display = 'block';
    c.innerHTML = `<div style="background:${fondo};color:${letra};border:1px solid ${borde};
                    border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.5;">
                    ${texto}</div>`;
}

function scInit() {
    scEnganchar();
    scCargarEstado();
}

function scEnganchar() {
    if (_scEnganchado) return;
    _scEnganchado = true;
    document.getElementById('sc-btn-guardar')?.addEventListener('click', scGuardar);
    document.getElementById('sc-btn-probar')?.addEventListener('click', scProbar);
}

async function scCargarEstado() {
    const caja = document.getElementById('sc-estado');
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/credenciales`);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'no se pudo consultar');

        if (!d.guardada) {
            caja.innerHTML = `<div class="fd-vacio">No hay credenciales guardadas.
                Escribe el RUC y la clave del portal y dale Guardar.</div>`;
            return;
        }

        const chapaTest = d.ultimo_test
            ? (d.ultimo_test_ok
                ? `<span style="color:#065f46;font-weight:600;">
                     <i class="fas fa-circle-check"></i> probada OK</span>
                   <span style="color:#64748b;">(${scFecha(d.ultimo_test)})</span>`
                : `<span style="color:#991b1b;font-weight:600;">
                     <i class="fas fa-circle-xmark"></i> fallo la prueba</span>
                   <span style="color:#64748b;">(${scFecha(d.ultimo_test)})</span>`)
            : `<span style="color:#64748b;">sin probar todavia</span>`;

        caja.innerHTML = `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:14px 16px;font-size:13px;line-height:1.9;">
                <div><strong style="color:#123450;">RUC guardado:</strong>
                     ${scEsc(d.ruc)}</div>
                <div><strong style="color:#123450;">Clave:</strong>
                     ${d.clave_legible
                        ? 'guardada y cifrada'
                        : '<span style="color:#991b1b;">guardada pero NO legible: ' +
                          'cambio la llave de cifrado, hay que volver a guardarla</span>'}
                </div>
                <div><strong style="color:#123450;">Actualizada:</strong>
                     ${scFecha(d.actualizado_en)}
                     ${d.actualizado_por ? 'por ' + scEsc(d.actualizado_por) : ''}</div>
                <div><strong style="color:#123450;">Ultima prueba:</strong> ${chapaTest}</div>
                ${d.ultimo_test_msg
                    ? `<div style="color:#64748b;font-size:12px;">${scEsc(d.ultimo_test_msg)}</div>`
                    : ''}
            </div>`;
        const ruc = document.getElementById('sc-ruc');
        if (ruc && !ruc.value) ruc.value = d.ruc || '';
    } catch (e) {
        caja.innerHTML = `<div class="fd-vacio">No se pudo cargar el estado:
            ${scEsc(e.message)}</div>`;
    }
}

async function scGuardar() {
    const ruc = document.getElementById('sc-ruc')?.value.trim() || '';
    const clave = document.getElementById('sc-clave')?.value || '';
    if (ruc.length !== 13 || !/^\d+$/.test(ruc)) {
        scAviso('El RUC debe tener exactamente 13 digitos.', 'error');
        return;
    }
    if (clave.length < 4) {
        scAviso('Escribe la clave del portal.', 'error');
        return;
    }
    const boton = document.getElementById('sc-btn-guardar');
    boton.disabled = true;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/credenciales`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ruc, clave, usuario: state.user?.username || '' }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'no se pudo guardar');
        document.getElementById('sc-clave').value = '';
        scAviso(scEsc(d.nota || 'Guardado.'), 'ok');
        scCargarEstado();
    } catch (e) {
        scAviso('No se pudo guardar: ' + scEsc(e.message), 'error');
    } finally {
        boton.disabled = false;
    }
}

async function scProbar() {
    const boton = document.getElementById('sc-btn-probar');
    const original = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Probando...';
    scAviso('Probando contra el SRI (un solo intento de login)...', 'info');
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/credenciales/probar`,
                              { method: 'POST' });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'no se pudo probar');
        const fila = (nombre, res) => `
            <div>${res.ok
                ? '<i class="fas fa-circle-check" style="color:#065f46;"></i>'
                : '<i class="fas fa-circle-xmark" style="color:#991b1b;"></i>'}
              <strong>${nombre}:</strong> ${scEsc(res.detalle)}</div>`;
        scAviso(fila('Login al portal', d.resultados.login) +
                fila('Catastro (RUC)', d.resultados.catastro),
                d.ok ? 'ok' : 'error');
        scCargarEstado();
    } catch (e) {
        scAviso('No se pudo probar: ' + scEsc(e.message), 'error');
    } finally {
        boton.disabled = false;
        boton.innerHTML = original;
    }
}
