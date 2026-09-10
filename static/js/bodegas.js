// Bodegas: el catalogo y su vinculo con Contifico.
//
// El id de Contifico NO se teclea: se elige de la lista que trae la propia
// Contifico. Son cadenas como 'QEMaxD5QSPDoa5GB' y una letra mal copiada manda
// el traslado a otra bodega sin que nadie se entere.
//
// Todo boton lleva texto, no solo icono: los iconos no siempre cargan.

const bodegasEstado = {
    lista: [],
    contifico: null,     // catalogo de Contifico, se trae una vez
    abierta: null,       // { id, datos, esNueva }
};

function bodegasEsAdmin() {
    return typeof state !== 'undefined' && state.user && state.user.rol === 'admin';
}

function bodegasUsuario() {
    return (typeof state !== 'undefined' && state.user) ? state.user.username : '';
}

function bodEsc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ------------------------------------------------------------ arranque

async function bodegasInit() {
    bodegasEnganchar();
    bodegasCargar();
}

let _bodegasEnganchado = false;
function bodegasEnganchar() {
    if (_bodegasEnganchado) return;
    _bodegasEnganchado = true;

    const btn = document.getElementById('bodegas-btn-nueva');
    if (btn) btn.addEventListener('click', () => bodegasAbrir(null));

    const cuerpo = document.getElementById('bodegas-tbody');
    if (cuerpo) {
        cuerpo.addEventListener('click', ev => {
            const b = ev.target.closest('button[data-accion]');
            if (!b) return;
            const id = b.getAttribute('data-bodega');
            if (b.getAttribute('data-accion') === 'editar') bodegasAbrir(id);
            if (b.getAttribute('data-accion') === 'borrar') bodegasBorrar(id);
        });
    }
}

async function bodegasCargar() {
    const cuerpo = document.getElementById('bodegas-tbody');
    if (cuerpo) {
        cuerpo.innerHTML = `<tr><td colspan="6" class="fd-vacio">Cargando...</td></tr>`;
    }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/bodegas`);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo cargar');
        bodegasEstado.lista = d.bodegas;
        bodegasPintar(d);
    } catch (e) {
        if (cuerpo) {
            cuerpo.innerHTML = `<tr><td colspan="6" class="fd-vacio" style="color:var(--color-negative);">
                ${bodEsc(e.message)}</td></tr>`;
        }
    }
}

function bodegasPintar(d) {
    const cuerpo = document.getElementById('bodegas-tbody');
    if (!cuerpo) return;

    cuerpo.innerHTML = bodegasEstado.lista.map(b => {
        const sinCont = !b.contifico_id;
        return `<tr class="${b.activo ? '' : 'fd-off'}">
            <td>
                <div style="font-weight:500;">${bodEsc(b.nombre)}</div>
                <div class="fd-mono" style="font-size:11px;">${bodEsc(b.id)}</div></td>
            <td class="fd-tenue">${bodEsc(b.contifico_codigo) || '&mdash;'}</td>
            <td class="fd-tenue">${bodEsc(b.contifico_nombre) || '&mdash;'}</td>
            <td>${sinCont
                ? '<span class="fd-badge fd-badge-alerta">Sin vincular</span>'
                : `<span class="fd-mono" style="font-size:11px;">${bodEsc(b.contifico_id)}</span>`}</td>
            <td class="fd-centro">
                <span class="fd-badge ${b.activo ? 'fd-badge-ok' : 'fd-badge-mal'}">
                    ${b.activo ? 'Activa' : 'Inactiva'}</span></td>
            <td class="fd-der">
                <button type="button" class="fd-accion fd-accion-primaria"
                        data-accion="editar" data-bodega="${bodEsc(b.id)}">Editar</button>
                ${bodegasEsAdmin() ? `<button type="button" class="fd-accion fd-accion-peligro"
                        data-accion="borrar" data-bodega="${bodEsc(b.id)}">Borrar</button>` : ''}
            </td></tr>`;
    }).join('') || `<tr><td colspan="6" class="fd-vacio">Todavia no hay bodegas</td></tr>`;

    const info = document.getElementById('bodegas-info');
    if (info) {
        const aviso = d.sin_contifico
            ? ` · <span style="color:var(--color-warning);font-weight:600;">${d.sin_contifico} sin vincular a Contifico</span>`
            : '';
        info.innerHTML = `${d.total} bodegas${aviso}`;
    }
}


// ------------------------------------------------------------ ficha

async function bodegasAbrir(id) {
    let datos = { activo: true, orden: 100 };
    if (id) {
        datos = bodegasEstado.lista.find(b => b.id === id);
        if (!datos) return;
        datos = Object.assign({}, datos);
    }
    bodegasEstado.abierta = { id: id, datos: datos, esNueva: !id };

    if (!bodegasEstado.contifico) {
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/bodegas/contifico`);
            const d = await r.json();
            bodegasEstado.contifico = d.success ? d.contifico : [];
        } catch (e) {
            bodegasEstado.contifico = [];
        }
    }

    document.getElementById('bodegas-ficha-titulo').textContent =
        id ? `Bodega: ${datos.nombre}` : 'Nueva bodega';
    bodegasPintarFicha();
    document.getElementById('bodegas-ficha').style.display = 'flex';
}

function bodegasCerrar() {
    document.getElementById('bodegas-ficha').style.display = 'none';
    bodegasEstado.abierta = null;
}

function bodegasPintarFicha() {
    const a = bodegasEstado.abierta;
    const cont = document.getElementById('bodegas-campos');
    if (!a || !cont) return;

    // Inputs pill del toolkit; el textarea no es pill (radio 16)
    const base = `height:44px;padding:0 18px;border:1px solid #E5E7EB;
                  border-radius:9999px;font-size:14px;width:100%;
                  background:#fff;color:#111827;font-family:inherit;outline:none;`;

    // El desplegable muestra las de Contifico; las ya tomadas por otra bodega
    // se marcan para que no se asigne el mismo destino dos veces.
    const actual = a.datos.contifico_id || '';
    const opciones = (bodegasEstado.contifico || []).map(c => {
        const tomada = c.usada_por && c.bodega_id !== a.id;
        return `<option value="${bodEsc(c.id)}"${c.id === actual ? ' selected' : ''}
                        ${tomada ? ' disabled' : ''}>
            ${bodEsc(c.codigo)} — ${bodEsc(c.nombre)}${tomada ? ' (ya la usa ' + bodEsc(c.usada_por) + ')' : ''}
        </option>`;
    }).join('');

    cont.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">
            <div>
                <label class="fd-etiqueta">Nombre</label>
                <input type="text" id="bod-nombre" value="${bodEsc(a.datos.nombre)}" style="${base}">
            </div>
            <div>
                <label class="fd-etiqueta">Identificador</label>
                ${a.esNueva
                    ? `<input type="text" id="bod-id" value="" placeholder="se arma solo del nombre"
                              style="${base}font-family:'DM Mono',monospace;">`
                    : `<div style="${base}background:#f8fafc;color:#64748b;font-family:'DM Mono',monospace;">
                         ${bodEsc(a.datos.id)}</div>`}
            </div>
            <div>
                <label class="fd-etiqueta">Estado</label>
                <select id="bod-activo" style="${base}cursor:pointer;">
                    <option value="1"${a.datos.activo ? ' selected' : ''}>Activa</option>
                    <option value="0"${a.datos.activo ? '' : ' selected'}>Inactiva</option>
                </select>
            </div>
            <div>
                <label class="fd-etiqueta">Orden en la lista</label>
                <input type="text" id="bod-orden" value="${bodEsc(a.datos.orden)}" style="${base}">
            </div>
        </div>

        <div style="margin-top:18px;padding-top:16px;border-top:1px solid #e2e8f0;">
            <label class="fd-etiqueta">Bodega en Contifico</label>
            <select id="bod-contifico" style="${base}cursor:pointer;">
                <option value="">— sin vincular —</option>
                ${opciones}
            </select>
            <div class="fd-aviso">
                El worker de traslados necesita este vinculo. <b>Sin el, la bodega sirve para la
                operacion pero no se puede mover mercaderia</b> hacia ella ni desde ella.
                Los nombres no coinciden entre los dos sistemas, por eso se elige de la lista
                y no se escribe.
            </div>
        </div>

        <div style="margin-top:16px;">
            <label class="fd-etiqueta">Nota</label>
            <textarea id="bod-nota" rows="2" style="${base}height:auto;padding:10px 16px;border-radius:16px;resize:vertical;">${bodEsc(a.datos.nota)}</textarea>
        </div>`;
}

async function bodegasGuardar() {
    const a = bodegasEstado.abierta;
    if (!a) return;

    const val = id => (document.getElementById(id) || {}).value || '';
    const nombre = val('bod-nombre').trim();
    if (!nombre) {
        showToast('El nombre es obligatorio', 'error');
        return;
    }

    const contId = val('bod-contifico');
    // El codigo y el nombre de Contifico se copian del catalogo, no se escriben
    const elegida = (bodegasEstado.contifico || []).find(c => c.id === contId);

    const cuerpo = {
        nombre: nombre,
        activo: val('bod-activo') === '1',
        orden: val('bod-orden'),
        nota: val('bod-nota'),
        contifico_id: contId || null,
        contifico_codigo: elegida ? elegida.codigo : null,
        contifico_nombre: elegida ? elegida.nombre : null,
        usuario: bodegasUsuario(),
    };
    if (a.esNueva) {
        const idManual = val('bod-id').trim();
        if (idManual) cuerpo.id = idManual;
    }

    const btn = document.getElementById('bodegas-btn-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
        const url = a.esNueva
            ? `${CONFIG.API_URL}/api/bodegas`
            : `${CONFIG.API_URL}/api/bodegas/${encodeURIComponent(a.id)}`;
        const r = await fetch(url, {
            method: a.esNueva ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo guardar');
        showToast(a.esNueva ? 'Bodega creada' : 'Cambios guardados', 'success');
        bodegasEstado.contifico = null;      // cambio que id esta tomado
        bodegasCerrar();
        bodegasCargar();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}


// ------------------------------------------------------------ borrar

async function bodegasBorrar(id) {
    if (!bodegasEsAdmin()) {
        showToast('Solo un administrador puede borrar bodegas', 'error');
        return;
    }
    const b = bodegasEstado.lista.find(x => x.id === id) || {};

    let usos = [];
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/bodegas/${encodeURIComponent(id)}/uso`);
        const d = await r.json();
        if (d.success) usos = d.usos;
    } catch (e) { /* el backend vuelve a revisar antes de borrar */ }

    if (usos.length) {
        const detalle = usos.map(u => `• ${u.donde}: ${u.registros}`).join('\n');
        alert(`No se puede borrar "${b.nombre || id}".\n\nEsta usada en:\n${detalle}\n\n` +
              `Abrila y ponela Inactiva: deja de ofrecerse en los desplegables y ` +
              `el historico se sigue leyendo.`);
        return;
    }

    if (!confirm(`BORRAR DEFINITIVAMENTE\n\n${b.nombre || id}\n\n` +
                 `Desaparece del catalogo y no se puede recuperar.\n\n` +
                 `Si solo queres que deje de usarse, cancela y ponela Inactiva.`)) return;

    const clave = prompt('Tu contrasena de administrador para confirmar:');
    if (!clave) return;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/bodegas/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_user: bodegasUsuario(), admin_pass: clave }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo borrar');
        showToast(`Bodega "${b.nombre || id}" borrada`, 'success');
        bodegasEstado.contifico = null;
        bodegasCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}
