// ===========================================================================
// MATRIZ DE PROVEEDORES
//
// Una sola tabla para todo el sistema: public.fc_proveedores. La misma que
// usa Flujo de Caja y la misma que se edita desde la ficha del producto. Lo
// que se corrige aqui se ve en los tres lados, porque es la misma fila.
//
// Antes esto vivia en un boton dentro de Flujo de Caja y habia ademas dos
// espejos muertos de Airtable con la mitad de los proveedores. Se unificaron
// el 22-sep-2026.
// ===========================================================================
const PROV_ESTADO = {
    lista: [],          // todo lo que trajo el servidor
    filtrada: [],       // lo que se esta mostrando, ya filtrado
    abierto: null,      // el proveedor en edicion
    q: '',
    reloj: null,
};

/* Llena un desplegable con los valores que de verdad existen, conservando lo
   que ya estaba elegido. */
function provLlenarFiltro(id, vacio, valores) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const antes = sel.value;
    const ops = Array.from(new Set(valores.filter(v => (v || '').trim()))).sort();
    sel.innerHTML = `<option value="">${vacio}</option>`
        + ops.map(o => `<option value="${provEsc(o)}">${provEsc(o)}</option>`).join('');
    sel.value = antes;
}

const PROV_TIPOS = ['RECURRENTE', 'EVENTUAL'];
const PROV_CRITICIDAD = ['BAJO', 'MEDIO', 'ALTO', 'CRITICO'];
const PROV_DIAS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes',
                   'Sabado', 'Domingo'];
// Los que no entregan en dias fijos. Va DENTRO de la caja de los dias, no en
// un desplegable aparte: es una respuesta mas a la misma pregunta.
const PROV_SIN_DIA = 'Bajo solicitud';

// Bodegas y franjas las manda el servidor: las bodegas viven en otra base y
// las franjas se definen una sola vez, en el backend.
let PROV_BODEGAS = [];
let PROV_FRANJAS = [];
// Bancos del SPI: 208 activos. Es un catalogo fijo que vive en el backend
// (bancos_spi.py), no una tabla: cambia una vez al ano.
let PROV_BANCOS = [];
let PROV_TIPOS_CUENTA = ['CTE', 'AHO'];
let PROV_TIPOS_DOC = [{codigo: 'C', nombre: 'Cedula'},
                      {codigo: 'R', nombre: 'RUC'},
                      {codigo: 'P', nombre: 'Pasaporte'}];

// El recuadro de los campos de varios valores, igual en los tres
// Alto fijo y no max-height: asi las tres cajas quedan parejas aunque una
// tenga 7 opciones y otra 12.
const PROV_CAJA = `border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;
                   height:190px;overflow-y:auto;overflow-x:hidden;
                   background:#fff;`;
const PROV_FILA = `display:flex;align-items:flex-start;gap:7px;padding:3px 0;
                   cursor:pointer;font-size:12.5px;color:#334155;
                   line-height:1.35;`;

/* Un recuadro de casillas. `valor` viene como 'A/B'; se guarda igual. */
function provRecuadro(etiqueta, col, valor, opciones) {
    const marcados = String(valor || '').split('/').map(x => x.trim()).filter(Boolean);
    // Lo guardado que ya no este en la lista se muestra igual, para no borrarlo
    const extras = marcados.filter(v => opciones.indexOf(v) === -1);
    return `
        <div>
            <label style="display:block;font-size:11px;font-weight:700;color:#64748b;
                          text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">
                ${etiqueta}</label>
            <div class="prov-caja" data-col-multi="${col}" style="${PROV_CAJA}">
                ${opciones.concat(extras).map(o => `
                    <label style="${PROV_FILA}">
                        <input type="checkbox" value="${provEsc(o)}"
                               ${marcados.indexOf(o) !== -1 ? 'checked' : ''}
                               style="width:15px;height:15px;cursor:pointer;accent-color:#1d4ed8;flex:0 0 auto;margin-top:1px;">
                        <span style="min-width:0;overflow-wrap:anywhere;">${provEsc(o)}${extras.indexOf(o) !== -1
                            ? ' <span class="fd-tenue">(fuera de lista)</span>' : ''}</span></label>`).join('')}
            </div>
            <input type="hidden" data-col="${col}" value="${provEsc(valor || '')}">
        </div>`;
}

// [etiqueta, columna, ayuda, opciones]
const PROV_CAMPOS = [
    ['RUC', 'ruc', '10 o 13 digitos'],
    // El nombre legal, sacado del SRI por RUC. `nombre` no se puede cambiar
    // aqui: es la clave que referencian los productos y Flujo de Caja.
    ['Razon social', 'razon_social', 'nombre legal del SRI'],
    ['Nombre comercial', 'nombre_comercial', ''],
    ['Telefono', 'telefono', ''],
    ['Celular secundario', 'celular_secundario', ''],
    ['Contacto', 'nombre_contacto', ''],
    ['Correo', 'correo', ''],
    ['Tipo de proveedor', 'tipo_proveedor', '', PROV_TIPOS],
    ['Criticidad', 'criticidad', '', PROV_CRITICIDAD],
    ['Dias de credito', 'dias_credito', '0'],
    ['Productos / servicios', 'productos_servicios', ''],
    ['Observaciones', 'observaciones', ''],
];

function provEsc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function provUsuario() {
    return (typeof state !== 'undefined' && state.user) ? state.user.username : '';
}

async function proveedoresInit() {
    const b = document.getElementById('prov-buscar');
    if (b && !b.dataset.enganchado) {
        b.dataset.enganchado = '1';
        b.addEventListener('input', () => {
            // Se espera a que deje de escribir, si no seria una consulta por tecla
            if (PROV_ESTADO.reloj) clearTimeout(PROV_ESTADO.reloj);
            PROV_ESTADO.reloj = setTimeout(proveedoresCargar, 250);
        });
    }
    // Los desplegables filtran sobre lo ya cargado: no hace falta ir al
    // servidor para esconder filas.
    ['prov-f-tipo', 'prov-f-criticidad', 'prov-f-dato'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.enganchado) {
            el.dataset.enganchado = '1';
            el.addEventListener('change', () => proveedoresPintar());
        }
    });
    const n = document.getElementById('prov-btn-nuevo');
    if (n && !n.dataset.enganchado) {
        n.dataset.enganchado = '1';
        n.addEventListener('click', () => proveedoresAbrir(null));
    }
    proveedoresCargar();
}

async function proveedoresCargar() {
    const q = (document.getElementById('prov-buscar') || {}).value || '';
    PROV_ESTADO.q = q.trim();
    const cont = document.getElementById('prov-lista');
    cont.innerHTML = `<div class="fd-vacio" style="padding:26px;">
        <i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
    try {
        // Con busqueda se usa /buscar, que ademas ofrece emisores del SRI que
        // todavia no estan dados de alta. Sin busqueda, el catalogo completo.
        const url = PROV_ESTADO.q
            ? `${CONFIG.API_URL}/api/matriz/proveedores/buscar?`
              + new URLSearchParams({ q: PROV_ESTADO.q })
            : `${CONFIG.API_URL}/api/matriz/proveedores`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo cargar');
        PROV_ESTADO.lista = d.proveedores || [];
        if (d.bodegas) PROV_BODEGAS = d.bodegas;
        if (d.franjas) PROV_FRANJAS = d.franjas;
        if (d.bancos) PROV_BANCOS = d.bancos;
        if (d.tipos_cuenta) PROV_TIPOS_CUENTA = d.tipos_cuenta;
        if (d.tipos_doc) PROV_TIPOS_DOC = d.tipos_doc;
        proveedoresPintar(d);
    } catch (e) {
        cont.innerHTML = `<div class="fd-vacio" style="padding:26px;">${provEsc(e.message)}</div>`;
    }
}

function proveedoresPintar(d) {
    const cont = document.getElementById('prov-lista');
    const info = document.getElementById('prov-info');
    const todos = PROV_ESTADO.lista;

    // Los desplegables se llenan con lo que de verdad hay
    provLlenarFiltro('prov-f-tipo', 'Tipo: todos',
                     todos.map(p => p.tipo_proveedor));
    provLlenarFiltro('prov-f-criticidad', 'Criticidad: todas',
                     todos.map(p => p.criticidad));

    const vale = (id) => (document.getElementById(id) || {}).value || '';
    const fTipo = vale('prov-f-tipo');
    const fCrit = vale('prov-f-criticidad');
    const fDato = vale('prov-f-dato');

    const lista = todos.filter(p => {
        if (fTipo && (p.tipo_proveedor || '') !== fTipo) return false;
        if (fCrit && (p.criticidad || '') !== fCrit) return false;
        if (fDato === 'sin_ruc' && (p.ruc || '').trim()) return false;
        if (fDato === 'sin_tel' && (p.telefono || '').trim()) return false;
        if (fDato === 'sin_dia' && (p.dia_despacho || '').trim()) return false;
        if (fDato === 'sin_bodega' && (p.bodega_ingreso || '').trim()) return false;
        if (fDato === 'del_sri' && p.registrado !== false) return false;
        if (fDato === 'suspendido'
            && (p.sri_estado || '').toUpperCase() === 'ACTIVO') return false;
        if (fDato === 'suspendido' && !(p.sri_estado || '').trim()) return false;
        if (fDato === 'sin_verificar' && (p.sri_verificado_en || '')) return false;
        if (fDato === 'sin_banco' && (p.banco_cuenta || '').trim()) return false;
        if (fDato === 'benef_otro' && provMismoDocumento(p)) return false;
        return true;
    });
    PROV_ESTADO.filtrada = lista;

    if (info) {
        const sinRuc = todos.filter(p => p.registrado !== false && !p.ruc).length;
        const sinTel = todos.filter(p => p.registrado !== false
                                     && !(p.telefono || '').trim()).length;
        const filtrando = lista.length !== todos.length;
        info.innerHTML = (filtrando ? `${lista.length} de ${todos.length}` : `${todos.length}`)
            + ' proveedores'
            + (sinRuc ? ` &middot; <span style="color:var(--color-warning);font-weight:600;">${sinRuc} sin RUC</span>` : '')
            + (sinTel ? ` &middot; <span style="color:var(--color-warning);font-weight:600;">${sinTel} sin telefono</span>` : '')
            + (d && d.del_sri ? ` &middot; ${d.del_sri} del SRI sin registrar` : '');
        const sinCta = todos.filter(p => p.registrado !== false
                                     && !(p.banco_cuenta || '').trim()).length;
        if (sinCta) {
            info.innerHTML += ` &middot; <span style="color:var(--color-warning);font-weight:600;">`
                + `${sinCta} sin cuenta bancaria</span>`;
        }
        const susp = todos.filter(p => (p.sri_estado || '')
                                       && (p.sri_estado || '').toUpperCase() !== 'ACTIVO').length;
        if (susp) {
            info.innerHTML += ` &middot; <span style="color:var(--color-negative);font-weight:600;">`
                + `${susp} suspendido(s) en el SRI</span>`;
        }
    }

    if (!lista.length) {
        cont.innerHTML = `<div class="fd-vacio" style="padding:26px;">Sin coincidencias.</div>`;
        return;
    }

    cont.innerHTML = `
        <table class="fd-tabla" style="width:100%;font-size:12.5px;
                     table-layout:auto;word-break:break-word;">
            <thead><tr>
                <th>Proveedor / razon social</th><th>RUC</th><th>SRI</th>
                <th>Telefono</th><th>Contacto</th>
                <th>Tipo</th><th>Criticidad</th><th style="text-align:right;">Credito</th>
                <th>Dia despacho</th><th>Bodega habitual</th><th>Cuenta</th><th></th>
            </tr></thead>
            <tbody>
            ${lista.map((p, i) => {
                const nuevo = p.registrado === false;
                return `<tr data-idx="${i}"${nuevo ? ' style="background:#FFFBEB;"' : ''}>
                    <td><b>${provEsc(p.nombre)}</b>${nuevo
                        ? ` <span class="fd-tenue" style="color:#BA7517;">del SRI, ${p.facturas} factura(s)</span>` : ''}
                        ${p.razon_social && p.razon_social.trim().toUpperCase() !== (p.nombre || '').trim().toUpperCase()
                          ? `<div class="fd-tenue" style="font-size:11.5px;">${provEsc(p.razon_social)}</div>` : ''}</td>
                    <td class="fd-mono">${provEsc(p.ruc) || '&mdash;'}</td>
                    <td>${provEstadoSri(p)}</td>
                    <td class="fd-mono">${provEsc(p.telefono) || '&mdash;'}</td>
                    <td>${provEsc(p.nombre_contacto) || '&mdash;'}</td>
                    <td>${provEsc(p.tipo_proveedor) || '&mdash;'}</td>
                    <td>${provEsc(p.criticidad) || '&mdash;'}</td>
                    <td style="text-align:right;">${p.dias_credito === null || p.dias_credito === undefined ? '&mdash;' : p.dias_credito}</td>
                    <td>${provEsc(p.dia_despacho) || '&mdash;'}</td>
                    <td>${provEsc(p.bodega_ingreso) || '&mdash;'}</td>
                    <td>${provCeldaBanco(p)}</td>
                    <td style="text-align:right;">
                        <button type="button" class="fd-btn-ghost" data-accion="${nuevo ? 'crear' : 'editar'}">
                            ${nuevo ? 'Dar de alta' : 'Editar'}</button></td>
                </tr>`;
            }).join('')}
            </tbody>
        </table>`;

    // Delegacion: los indices viajan en data-idx, sin onclick en linea
    cont.onclick = async e => {
        const b = e.target.closest('[data-accion]');
        if (!b) return;
        const p = (PROV_ESTADO.filtrada || PROV_ESTADO.lista)[
            parseInt(b.closest('tr').dataset.idx, 10)];
        if (!p) return;
        if (b.dataset.accion === 'crear') {
            if (!confirm(`${p.nombre}\n\nDarlo de alta con el RUC ${p.ruc || '(sin RUC)'}?`)) return;
            const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: p.nombre, ruc: p.ruc })
            });
            const d2 = await r.json();
            if (!d2.success) { showToast(d2.error || 'No se pudo crear', 'error'); return; }
            showToast('Proveedor creado', 'success');
            proveedoresCargar();
            return;
        }
        proveedoresAbrir(p);
    };
}

function proveedoresAbrir(p) {
    PROV_ESTADO.abierto = p ? Object.assign({}, p) : { _nuevo: true };
    const a = PROV_ESTADO.abierto;
    const inp = `padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;
                 font-size:13px;width:100%;background:#fff;color:#0f172a;`;
    const etq = `display:block;font-size:11px;font-weight:700;color:#64748b;
                 text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;`;

    document.getElementById('prov-ficha-titulo').textContent =
        a._nuevo ? 'Nuevo proveedor' : a.nombre;

    const guardado = provNormalizarDias(a.dia_despacho);
    // Lo guardado que no sea un dia ni 'Bajo solicitud': se respeta, no se ofrece
    const sueltos = guardado.filter(
        v => PROV_DIAS.indexOf(v) === -1 && v !== PROV_SIN_DIA);

    document.getElementById('prov-ficha-campos').innerHTML = `
        ${a._nuevo ? `
        <div style="background:#F8FAFC;border:1px solid rgba(203,213,225,0.30);
                    border-radius:12px;padding:14px 16px;margin-bottom:16px;">
            <label style="${etq}">Empieza por el RUC</label>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input type="text" id="prov-nuevo-ruc" placeholder="10 o 13 digitos"
                       style="${inp}max-width:210px;">
                <button type="button" class="fd-btn-ghost" onclick="provTraerDelSri()">
                    <i class="fas fa-download"></i> Traer del SRI
                </button>
                <span id="prov-nuevo-aviso" class="fd-tenue" style="font-size:11.5px;"></span>
            </div>
            <div style="margin-top:12px;">
                <label style="${etq}">Nombre del proveedor (razon social)</label>
                <input type="text" data-col="nombre" value="" style="${inp}">
            </div>
        </div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;">
            ${PROV_CAMPOS.map(([lbl, col, ph, ops]) => {
                const val = (a[col] === null || a[col] === undefined) ? '' : String(a[col]);
                if (ops && ops.length) {
                    const fuera = val && ops.indexOf(val) === -1;
                    return `<div><label style="${etq}">${lbl}</label>
                        <select data-col="${col}" style="${inp}cursor:pointer;">
                            <option value=""${val ? '' : ' selected'}>— sin definir —</option>
                            ${fuera ? `<option value="${provEsc(val)}" selected>${provEsc(val)} (valor actual)</option>` : ''}
                            ${ops.map(o => `<option value="${o}"${o === val ? ' selected' : ''}>${o}</option>`).join('')}
                        </select></div>`;
                }
                return `<div><label style="${etq}">${lbl}</label>
                    <input type="text" data-col="${col}" value="${provEsc(val)}"
                           ${ph ? `placeholder="${provEsc(ph)}"` : ''} style="${inp}"></div>`;
            }).join('')}
        </div>

        <div style="margin-top:16px;border-top:1px solid rgba(203,213,225,0.45);
                    padding-top:14px;display:grid;
                    grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;">

            <div>
                <label style="${etq}">Dia de recepcion / despacho</label>
                <div id="prov-dias" style="${PROV_CAJA}">
                    ${PROV_DIAS.map(dd => `
                        <label style="${PROV_FILA}">
                            <input type="checkbox" class="prov-dia" value="${dd}"
                                   ${guardado.indexOf(dd) !== -1 ? 'checked' : ''}
                                   style="width:15px;height:15px;cursor:pointer;accent-color:#1d4ed8;flex:0 0 auto;margin-top:1px;">
                            <span style="min-width:0;overflow-wrap:anywhere;">${dd}</span></label>`).join('')}
                    <div style="border-top:1px solid rgba(203,213,225,0.7);margin:6px 0 3px;"></div>
                    <label style="${PROV_FILA}">
                        <input type="checkbox" class="prov-nodia" value="${PROV_SIN_DIA}"
                               ${guardado.indexOf(PROV_SIN_DIA) !== -1 ? 'checked' : ''}
                               style="width:15px;height:15px;cursor:pointer;accent-color:#1d4ed8;flex:0 0 auto;margin-top:1px;">
                        <span style="min-width:0;overflow-wrap:anywhere;">${PROV_SIN_DIA}</span></label>
                    ${sueltos.map(v => `
                        <label style="${PROV_FILA}">
                            <input type="checkbox" class="prov-nodia" value="${provEsc(v)}" checked
                                   style="width:15px;height:15px;cursor:pointer;accent-color:#94a3b8;flex:0 0 auto;margin-top:1px;">
                            <span style="min-width:0;overflow-wrap:anywhere;color:#64748b;">
                                ${provEsc(v)} <i style="font-size:11px;">(valor actual)</i></span></label>`).join('')}
                </div>
                <span class="fd-tenue" style="display:block;margin-top:6px;font-size:11.5px;">
                    Queda como <b id="prov-dias-vista">${provEsc(a.dia_despacho || '—')}</b></span>
                <input type="hidden" data-col="dia_despacho" value="${provEsc(a.dia_despacho || '')}">
            </div>

            ${provRecuadro('Horario de recepcion', 'horario_recepcion',
                           a.horario_recepcion, PROV_FRANJAS)}
            ${provRecuadro('Bodega de ingreso habitual', 'bodega_ingreso',
                           a.bodega_ingreso, PROV_BODEGAS)}
        </div>
        <p class="fd-tenue" style="font-size:11.5px;margin:10px 0 0;">
            La bodega es la <b>habitual</b>: 25 proveedores entregan en bodegas
            distintas segun el producto, y eso se define en la ficha del producto.</p>

        ${provBloqueBanco(a, etq, inp)}`;

    provEngancharDias();
    // Los recuadros escriben su campo oculto, que es lo que se guarda
    document.querySelectorAll('#prov-ficha-campos .prov-caja').forEach(caja => {
        const oculto = caja.parentElement.querySelector('[data-col]');
        caja.addEventListener('change', () => {
            oculto.value = Array.from(
                caja.querySelectorAll('input[type=checkbox]:checked'))
                .map(x => x.value).join('/');
        });
    });
    document.getElementById('prov-ficha').style.display = 'flex';
}

/* Deja lo guardado con la escritura de la lista: la tabla traia 'viernes' en
   minuscula y 'Bajo pedido' donde el resto dice 'Bajo solicitud'. Asi una
   diferencia de mayusculas no convierte un dia normal en un valor suelto. */
function provNormalizarDias(valor) {
    const lista = PROV_DIAS.concat([PROV_SIN_DIA]);
    return String(valor || '').split('/').map(x => x.trim()).filter(Boolean)
        .map(v => lista.find(o => o.toLowerCase() === v.toLowerCase()) || v);
}

function provEngancharDias() {
    const cont = document.getElementById('prov-dias');
    const oculto = document.querySelector('#prov-ficha-campos [data-col="dia_despacho"]');
    const vista = document.getElementById('prov-dias-vista');
    if (!cont || !oculto) return;

    const recalcular = () => {
        // En el orden en que estan dibujadas, que es el de la semana: asi sale
        // 'Lunes/Miercoles' y nunca 'Miercoles/Lunes'.
        oculto.value = Array.from(
            cont.querySelectorAll('input[type=checkbox]:checked'))
            .map(x => x.value).join('/');
        if (vista) vista.textContent = oculto.value || '—';
    };

    // Dias fijos y 'sin dia fijo' son excluyentes: marcar uno apaga al otro
    cont.addEventListener('change', ev => {
        const t = ev.target;
        if (!t || t.type !== 'checkbox') return;
        if (t.checked && t.classList.contains('prov-nodia')) {
            cont.querySelectorAll('input[type=checkbox]').forEach(
                ch => { if (ch !== t) ch.checked = false; });
        } else if (t.checked && t.classList.contains('prov-dia')) {
            cont.querySelectorAll('.prov-nodia').forEach(ch => { ch.checked = false; });
        }
        recalcular();
    });
}

function proveedoresCerrar() {
    document.getElementById('prov-ficha').style.display = 'none';
    PROV_ESTADO.abierto = null;
    // El panel de verificacion lo esconde; hay que devolverlo
    const g = document.getElementById('prov-btn-guardar');
    if (g) g.style.display = '';
}

async function proveedoresGuardar() {
    const a = PROV_ESTADO.abierto;
    if (!a) return;
    const cuerpo = {};
    document.querySelectorAll('#prov-ficha-campos [data-col]').forEach(el => {
        cuerpo[el.getAttribute('data-col')] = el.value;
    });

    const btn = document.getElementById('prov-btn-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    try {
        let r;
        if (a._nuevo) {
            const nombre = (cuerpo.nombre || '').trim();
            if (!nombre) throw new Error('El nombre es obligatorio');
            r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: nombre, ruc: cuerpo.ruc })
            });
            let d = await r.json();
            if (!d.success) throw new Error(d.error || 'No se pudo crear');
            // El alta solo guarda nombre y RUC; el resto va en un segundo paso
            delete cuerpo.nombre;
            r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores/${encodeURIComponent(nombre)}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo)
            });
        } else {
            r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores/${encodeURIComponent(a.nombre)}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo)
            });
        }
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo guardar');
        showToast(a._nuevo ? 'Proveedor creado' : 'Cambios guardados', 'success');
        proveedoresCerrar();
        proveedoresCargar();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}


/* ---------------------------------------------------------------------------
   ESTADO EN EL SRI

   El catastro dice si un RUC esta ACTIVO o SUSPENDIDO, y eso cambia sin que
   nadie avise. Facturarle a un proveedor suspendido trae problemas, asi que
   el dato se guarda con la fecha en que se consulto y se puede volver a pedir.
   --------------------------------------------------------------------------- */
function provEstadoSri(p) {
    const e = (p.sri_estado || '').trim().toUpperCase();
    if (!e) return '<span class="fd-tenue">sin verificar</span>';
    if (e === 'ACTIVO') {
        return `<span style="color:var(--color-positive);font-weight:600;">Activo</span>`;
    }
    return `<span style="color:var(--color-negative);font-weight:600;">`
         + `${provEsc(e.charAt(0) + e.slice(1).toLowerCase())}</span>`;
}

let PROV_SRI_RELOJ = null;

async function proveedoresVerificarSri() {
    if (!confirm('Se van a consultar los RUC uno por uno en el catastro del SRI.\n'
               + 'Tarda unos dos minutos y actualiza la razon social y el estado.\n\n'
               + 'Continuar?')) return;
    const b = document.getElementById('prov-btn-sri');
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores/verificar-sri`,
                              { method: 'POST' });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo iniciar');
    } catch (e) { showToast(e.message, 'error'); return; }

    if (b) { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando...'; }
    if (PROV_SRI_RELOJ) clearInterval(PROV_SRI_RELOJ);
    PROV_SRI_RELOJ = setInterval(provMirarSri, 3000);
    provMirarSri();
}

async function provMirarSri() {
    const b = document.getElementById('prov-btn-sri');
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores/verificar-sri`);
        const d = await r.json();

        if (d.estado === 'cargando') {
            if (b) b.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${provEsc(d.paso || 'Consultando')}`;
            return;
        }
        clearInterval(PROV_SRI_RELOJ); PROV_SRI_RELOJ = null;
        if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-shield-halved"></i> Verificar con el SRI'; }

        if (d.estado === 'error') { showToast(d.error || 'Fallo la verificacion', 'error'); return; }
        if (d.estado !== 'listo' || !d.resultado) return;

        const x = d.resultado;
        showToast(`${x.revisados} verificados en ${d.segundos}s`,
                  x.suspendidos.length ? 'warning' : 'success');
        provPanelSri(x);
        proveedoresCargar();
    } catch (e) { /* el siguiente tic reintenta */ }
}

/* Lo que hay que mirar despues de verificar: quien quedo suspendido, a quien no
   lo encuentra el catastro y a quien le cambio la razon social. */
function provPanelSri(x) {
    if (!x.suspendidos.length && !x.sin_catastro.length && !x.cambiaron.length) return;
    const cuerpo = document.getElementById('prov-ficha-campos');
    document.getElementById('prov-ficha-titulo').textContent = 'Resultado de la verificacion';
    cuerpo.innerHTML = `
        <p class="fd-tenue" style="font-size:12px;margin:0 0 14px;">
            ${x.revisados} de ${x.total} RUC consultados en el catastro del SRI.</p>
        ${x.suspendidos.length ? `
            <h4 style="margin:0 0 6px;font-size:14px;color:var(--color-negative);">
                Suspendidos (${x.suspendidos.length})</h4>
            <p class="fd-tenue" style="font-size:11.5px;margin:0 0 8px;">
                Facturarles con el RUC suspendido trae problemas.</p>
            <table class="fd-tabla" style="width:100%;font-size:12.5px;margin-bottom:18px;">
                <thead><tr><th>Proveedor</th><th>RUC</th><th>Estado</th></tr></thead>
                <tbody>${x.suspendidos.map(s => `<tr>
                    <td>${provEsc(s.razon_social || s.nombre)}</td>
                    <td class="fd-mono">${provEsc(s.ruc)}</td>
                    <td style="color:var(--color-negative);font-weight:600;">${provEsc(s.estado)}</td>
                </tr>`).join('')}</tbody></table>` : ''}
        ${x.sin_catastro.length ? `
            <h4 style="margin:0 0 6px;font-size:14px;color:var(--color-warning);">
                No estan en el catastro (${x.sin_catastro.length})</h4>
            <table class="fd-tabla" style="width:100%;font-size:12.5px;margin-bottom:18px;">
                <thead><tr><th>Proveedor</th><th>RUC</th><th>Motivo</th></tr></thead>
                <tbody>${x.sin_catastro.map(s => `<tr>
                    <td>${provEsc(s.nombre)}</td><td class="fd-mono">${provEsc(s.ruc)}</td>
                    <td class="fd-tenue">${provEsc(s.motivo)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${x.cambiaron.length ? `
            <h4 style="margin:0 0 6px;font-size:14px;color:#1A3A5C;">
                Razon social actualizada (${x.cambiaron.length})</h4>
            <table class="fd-tabla" style="width:100%;font-size:12.5px;">
                <thead><tr><th>Proveedor</th><th>Antes</th><th>Segun el SRI</th></tr></thead>
                <tbody>${x.cambiaron.map(s => `<tr>
                    <td>${provEsc(s.nombre)}</td>
                    <td class="fd-tenue">${provEsc(s.antes || '(vacia)')}</td>
                    <td>${provEsc(s.ahora)}</td></tr>`).join('')}</tbody></table>` : ''}`;
    const g = document.getElementById('prov-btn-guardar');
    if (g) g.style.display = 'none';
    document.getElementById('prov-ficha').style.display = 'flex';
}


/* Trae del catastro del SRI lo que ya se sabe del RUC, para no teclear la
   razon social a mano ni equivocarse en una tilde. Una cedula de 10 digitos se
   completa con 001. */
async function provTraerDelSri() {
    const caja = document.getElementById('prov-nuevo-ruc');
    const aviso = document.getElementById('prov-nuevo-aviso');
    const ruc = (caja.value || '').replace(/[^0-9]/g, '');
    if (!ruc) { aviso.textContent = 'Escribe el RUC primero'; return; }
    aviso.innerHTML = '<i class="fas fa-spinner fa-spin"></i> consultando...';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores/sri/${ruc}`);
        const d = await r.json();
        if (!d.success) { aviso.innerHTML = `<span style="color:var(--color-negative);">${provEsc(d.error)}</span>`; return; }

        if (d.ya_existe) {
            aviso.innerHTML = `<span style="color:var(--color-warning);">`
                + `Ese RUC ya esta dado de alta como <b>${provEsc(d.ya_existe)}</b></span>`;
            return;
        }
        caja.value = d.ruc;
        const pon = (col, val) => {
            const el = document.querySelector(`#prov-ficha-campos [data-col="${col}"]`);
            if (el && val) el.value = val;
        };
        pon('nombre', d.razon_social);
        pon('razon_social', d.razon_social);
        pon('ruc', d.ruc);
        const susp = (d.estado || '').toUpperCase() !== 'ACTIVO';
        aviso.innerHTML = `<b>${provEsc(d.razon_social)}</b> &middot; `
            + `<span style="color:${susp ? 'var(--color-negative)' : 'var(--color-positive)'};font-weight:600;">`
            + `${provEsc(d.estado || '')}</span>`
            + (d.tipo_persona ? ` &middot; ${provEsc(d.tipo_persona)}` : '')
            + (d.regimen ? ` &middot; ${provEsc(d.regimen)}` : '');
    } catch (e) {
        aviso.innerHTML = '<span style="color:var(--color-negative);">No se pudo consultar</span>';
    }
}


/* ---------------------------------------------------------------------------
   DATOS BANCARIOS

   De aqui sale el TXT que se le sube a Produbanco para pagar. Hasta ahora esto
   vivia en una hoja de Excel suelta que alguien copiaba a mano cada semana.

   El beneficiario tiene sus propios campos porque NO siempre es el proveedor:
   PUBLIJOB factura con su RUC pero cobra a nombre de OLIMPO CARDENAS. Si se
   dedujera del proveedor, esos pagos saldrian a la cuenta equivocada.
   --------------------------------------------------------------------------- */
function provBloqueBanco(a, etq, inp) {
    const val = c => (a[c] === null || a[c] === undefined) ? '' : String(a[c]);

    // Si el banco guardado ya no esta entre los activos hay que mostrarlo
    // igual: el proveedor cobra ahi y borrarlo en silencio seria peor.
    const codb = val('banco_codigo');
    const fuera = codb && !PROV_BANCOS.some(b => b.codigo === codb);

    const mismo = provMismoDocumento(a);

    return `
    <div style="margin-top:18px;border-top:1px solid rgba(203,213,225,0.45);padding-top:14px;">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            <h4 style="margin:0;font-size:14px;color:#1A3A5C;font-weight:600;">
                Datos bancarios</h4>
            <span class="fd-tenue" style="font-size:11.5px;">
                Con esto se arma el archivo de pagos del banco</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;">
            <div>
                <label style="${etq}">Banco</label>
                <select data-col="banco_codigo" style="${inp}cursor:pointer;">
                    <option value=""${codb ? '' : ' selected'}>— sin definir —</option>
                    ${fuera ? `<option value="${provEsc(codb)}" selected>
                        ${provEsc(codb)} (ya no esta en el catalogo)</option>` : ''}
                    ${PROV_BANCOS.map(b => `<option value="${b.codigo}"${
                        b.codigo === codb ? ' selected' : ''}>${provEsc(b.nombre)}</option>`).join('')}
                </select>
            </div>
            <div>
                <label style="${etq}">Tipo de cuenta</label>
                <select data-col="banco_tipo_cuenta" style="${inp}cursor:pointer;">
                    <option value="">— sin definir —</option>
                    ${PROV_TIPOS_CUENTA.map(t => `<option value="${t}"${
                        t === val('banco_tipo_cuenta') ? ' selected' : ''}>${
                        t === 'CTE' ? 'Corriente' : 'Ahorros'}</option>`).join('')}
                </select>
            </div>
            <div>
                <label style="${etq}">Numero de cuenta</label>
                <input type="text" data-col="banco_cuenta" value="${provEsc(val('banco_cuenta'))}"
                       inputmode="numeric" class="fd-mono" style="${inp}">
            </div>
            <div>
                <label style="${etq}">Correo para el aviso de pago</label>
                <input type="text" data-col="banco_correo" value="${provEsc(val('banco_correo'))}"
                       placeholder="cobranzas@..." style="${inp}">
            </div>
        </div>

        <div style="margin-top:14px;background:#F8FAFC;
                    border:1px solid rgba(203,213,225,0.30);border-radius:12px;padding:13px 15px;">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
                <b style="font-size:12.5px;color:#1A3A5C;">A nombre de quien se acredita</b>
                <span class="fd-tenue" style="font-size:11.5px;">
                    ${mismo ? 'Es el mismo proveedor'
                            : 'Distinto del proveedor — el pago sale a este nombre'}</span>
                ${mismo ? '' : `<span style="color:var(--color-warning);font-weight:600;font-size:11.5px;">
                    <i class="fas fa-triangle-exclamation"></i> revisalo</span>`}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:13px;">
                <div>
                    <label style="${etq}">Tipo de documento</label>
                    <select data-col="benef_tipo_doc" style="${inp}cursor:pointer;">
                        <option value="">— sin definir —</option>
                        ${PROV_TIPOS_DOC.map(t => `<option value="${t.codigo}"${
                            t.codigo === val('benef_tipo_doc') ? ' selected' : ''}>${
                            provEsc(t.nombre)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label style="${etq}">Documento</label>
                    <input type="text" data-col="benef_documento" class="fd-mono"
                           value="${provEsc(val('benef_documento'))}" style="${inp}">
                </div>
                <div style="grid-column:1/-1;">
                    <label style="${etq}">Nombre del beneficiario</label>
                    <input type="text" data-col="benef_nombre"
                           value="${provEsc(val('benef_nombre'))}" style="${inp}">
                    <button type="button" class="fd-btn-ghost" style="margin-top:8px;"
                            onclick="provCopiarProveedor()">
                        <i class="fas fa-arrow-down"></i> Copiar del proveedor
                    </button>
                </div>
            </div>
        </div>
    </div>`;
}

/* El beneficiario y el proveedor son la misma persona? Se compara por los 10
   primeros digitos: la cedula 1713233680 y el RUC 1713233680001 son el mismo
   contribuyente, y en la tabla conviven las dos formas. */
function provMismoDocumento(a) {
    const n = x => String(x || '').replace(/[^0-9]/g, '').slice(0, 10);
    const doc = n(a.benef_documento);
    if (!doc) return true;                 // sin beneficiario no hay nada que avisar
    return doc === n(a.ruc);
}

/* Lo normal es que el beneficiario sea el propio proveedor. Este boton evita
   volver a teclear el RUC y la razon social, que es donde se cuelan los
   errores que el banco despues rechaza. */
function provCopiarProveedor() {
    const a = PROV_ESTADO.abierto;
    if (!a) return;
    const pon = (col, v) => {
        const el = document.querySelector(`#prov-ficha-campos [data-col="${col}"]`);
        if (el) el.value = v || '';
    };
    const ruc = String(a.ruc || '').replace(/[^0-9]/g, '');
    pon('benef_documento', ruc);
    pon('benef_tipo_doc', ruc.length === 13 ? 'R' : 'C');
    pon('benef_nombre', a.razon_social || a.nombre || '');
}


/* La cuenta en el listado: el banco y los ultimos cuatro digitos. Completa no
   hace falta para reconocerla y asi no queda una columna larguisima. El aviso
   sale cuando el pago va a nombre de otro, que es lo que hay que mirar dos
   veces antes de mandar el archivo al banco. */
function provCeldaBanco(p) {
    const cta = String(p.banco_cuenta || '').trim();
    if (!cta) return '<span class="fd-tenue">&mdash;</span>';
    const b = PROV_BANCOS.find(x => x.codigo === String(p.banco_codigo || ''));
    const tipo = p.banco_tipo_cuenta === 'AHO' ? 'Aho' : 'Cte';
    return `<span style="font-size:11.5px;">${provEsc(b ? b.nombre : (p.banco_codigo || ''))}</span>`
         + `<div class="fd-mono fd-tenue" style="font-size:11px;">`
         + `${tipo} &middot;&middot;&middot;${provEsc(cta.slice(-4))}</div>`
         + (provMismoDocumento(p) ? ''
            : `<div style="font-size:11px;color:var(--color-warning);font-weight:600;">`
              + `a nombre de otro</div>`);
}
