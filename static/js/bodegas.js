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


// ===========================================================================
// SINCRONIZAR BODEGAS CON CONTIFICO
//
// Antes habia que entrar a Contifico, buscar el hash del id y copiarlo a mano.
// Ahi es donde se cuela el error que manda un traslado a la bodega equivocada.
// Aqui se listan las que estan en Contifico y no aqui, y se crean con el id ya
// puesto. La clave (bodega_principal, floreana...) se propone a partir del
// nombre y se puede corregir antes de crear.
// ===========================================================================
let bodegasSync = null;

async function bodegasAbrirSync() {
    const m = document.getElementById('bodegas-sync');
    if (!m) return;
    m.style.display = 'flex';
    const c = document.getElementById('bodegas-sync-cuerpo');
    c.innerHTML = `<div style="padding:34px;text-align:center;color:#888780;">
        <i class="fas fa-spinner fa-spin" style="font-size:20px;"></i>
        <p style="margin-top:10px;">Leyendo las bodegas de Contifico...</p></div>`;
    document.getElementById('bodegas-sync-crear').disabled = true;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/bodegas/sincronizar`);
        const d = await r.json();
        if (!r.ok || !d.success) {
            c.innerHTML = `<div class="fd-vacio" style="padding:26px;">
                <p><b>${bodEsc(d.error || 'No se pudo consultar Contifico')}</b></p>
                ${d.detalle ? `<p class="fd-tenue">${bodEsc(d.detalle)}</p>` : ''}</div>`;
            return;
        }
        bodegasSync = d;
        bodegasPintarSync();
    } catch (e) {
        c.innerHTML = `<div class="fd-vacio" style="padding:26px;">No se pudo contactar al servidor.</div>`;
    }
}

function bodegasCerrarSync() {
    const m = document.getElementById('bodegas-sync');
    if (m) m.style.display = 'none';
}

function bodegasPintarSync() {
    const d = bodegasSync;
    const c = document.getElementById('bodegas-sync-cuerpo');
    const inp = `padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;
                 font-size:12.5px;width:100%;background:#fff;color:#0f172a;`;

    c.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
            <span class="fd-chip">Contifico: ${d.contifico}</span>
            <span class="fd-chip">Vinculadas: ${d.vinculadas.length}</span>
            <span class="fd-chip">Nuevas: ${d.nuevas.length}</span>
        </div>

        ${d.rotas.length ? `
        <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;
                    padding:10px 14px;margin-bottom:14px;font-size:12px;color:#991B1B;">
            <b>${d.rotas.length} bodega(s) apuntan a un id que ya no existe en Contifico.</b>
            Un traslado a estas fallaria: ${d.rotas.map(x => bodEsc(x.bodega)).join(', ')}.
        </div>` : ''}

        <h4 style="margin:0 0 4px;font-size:14px;color:#1A3A5C;">
            Bodegas de Contifico que aqui no estan (${d.nuevas.length})</h4>
        <p class="fd-tenue" style="font-size:12px;margin:0 0 10px;">
            Marca las que quieras crear. El id de Contifico se guarda solo; la clave
            se propone a partir del nombre y la puedes corregir.</p>

        ${d.nuevas.length ? `
        <table class="fd-tabla" style="width:100%;font-size:12.5px;">
            <thead><tr>
                <th style="width:34px;"></th><th>Codigo</th><th>Nombre en Contifico</th>
                <th style="width:190px;">Clave aqui</th><th style="width:210px;">Nombre aqui</th>
            </tr></thead>
            <tbody>
            ${d.nuevas.map(n => `
                <tr data-cf="${bodEsc(n.contifico_id)}">
                    <td><input type="checkbox" class="bsync-sel"></td>
                    <td class="fd-mono">${bodEsc(n.codigo)}</td>
                    <td>${bodEsc(n.nombre_contifico)}</td>
                    <td><input type="text" class="bsync-id" value="${bodEsc(n.id_sugerido)}" style="${inp}"></td>
                    <td><input type="text" class="bsync-nombre" value="${bodEsc(n.nombre_sugerido || n.nombre_contifico)}" style="${inp}"></td>
                </tr>`).join('')}
            </tbody>
        </table>` : '<p class="fd-vacio">Ninguna. Todas las bodegas de Contifico ya estan registradas.</p>'}

        <h4 style="margin:22px 0 8px;font-size:14px;color:#1A3A5C;">
            Ya vinculadas (${d.vinculadas.length})</h4>
        <table class="fd-tabla" style="width:100%;font-size:12.5px;">
            <thead><tr><th>Codigo</th><th>Nombre en Contifico</th><th>Bodega aqui</th></tr></thead>
            <tbody>${d.vinculadas.map(v => `
                <tr><td class="fd-mono">${bodEsc(v.codigo)}</td>
                    <td>${bodEsc(v.nombre_contifico)}</td>
                    <td>${bodEsc(v.nombre)} <span class="fd-tenue fd-mono">${bodEsc(v.bodega)}</span></td>
                </tr>`).join('')}</tbody>
        </table>`;

    c.querySelectorAll('.bsync-sel').forEach(ch =>
        ch.addEventListener('change', bodegasContarSync));
    bodegasContarSync();
}

function bodegasContarSync() {
    const n = document.querySelectorAll('.bsync-sel:checked').length;
    const p = document.getElementById('bodegas-sync-pie');
    if (p) p.textContent = n ? `${n} bodega(s) por crear` : 'Nada seleccionado';
    const b = document.getElementById('bodegas-sync-crear');
    if (b) b.disabled = !n;
}

async function bodegasCrearDesdeSync() {
    const crear = [];
    document.querySelectorAll('#bodegas-sync-cuerpo tr[data-cf]').forEach(tr => {
        if (!tr.querySelector('.bsync-sel').checked) return;
        crear.push({
            contifico_id: tr.getAttribute('data-cf'),
            id: tr.querySelector('.bsync-id').value.trim().toLowerCase(),
            nombre: tr.querySelector('.bsync-nombre').value.trim(),
        });
    });
    if (!crear.length) return;

    if (!bodegasEsAdmin()) {
        showToast('Solo un administrador puede crear bodegas', 'error');
        return;
    }
    const clave = prompt('Contrasena de administrador para crear '
                       + crear.length + ' bodega(s):');
    if (!clave) return;

    const b = document.getElementById('bodegas-sync-crear');
    if (b) { b.disabled = true; b.textContent = 'Creando...'; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/bodegas/sincronizar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ crear, admin_user: bodegasUsuario(), admin_pass: clave })
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo crear');
        const partes = [];
        if (d.creadas.length) partes.push(`${d.creadas.length} creada(s)`);
        if (d.fallidas.length) partes.push(`${d.fallidas.length} con problema`);
        showToast(partes.join(', ') || 'Sin cambios', d.fallidas.length ? 'warning' : 'success');
        if (d.fallidas.length) {
            console.warn('Bodegas no creadas:', d.fallidas);
            alert('No se pudieron crear:\n\n'
                + d.fallidas.map(f => `  ${f.id}: ${f.motivo}`).join('\n'));
        }
        await bodegasAbrirSync();     // vuelve a consultar: la lista cambio
        bodegasCargar();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (b) { b.textContent = 'Crear las seleccionadas'; bodegasContarSync(); }
    }
}
