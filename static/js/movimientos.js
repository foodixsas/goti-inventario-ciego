// ============================================================
// MODULO SOLICITUD DE MOVIMIENTO ENTRE BODEGAS
// Replica del formulario de Airtable "Registro de Egresos
// Emergentes entre Tiendas". Los datos viven en Supabase.
// ============================================================

const movEstado = {
    catalogos: null,
    productos: null,    // lista completa (Activos y no para la venta), se trae una vez
    colaboradores: null, // personal activo de Talento Humano
    producto: null,     // { codigo, nombre, unidad } el elegido
    buscando: null,     // timer del debounce
};

const MOV_ESTADO_COLOR = {
    pendiente: { fondo: '#fef3c7', texto: '#92400e' },
    ejecutado: { fondo: '#d1fae5', texto: '#065f46' },
    error:     { fondo: '#fee2e2', texto: '#991b1b' },
    anulado:   { fondo: '#e2e8f0', texto: '#475569' },
};

// La cantidad se escribe con coma o con punto y siempre queda como punto,
// que es lo unico que entiende Postgres. Se normaliza mientras se teclea.
function movNormalizarCantidad(input) {
    const posicion = input.selectionStart;
    const antes = input.value;

    let v = antes.replace(/,/g, '.')      // coma -> punto
                 .replace(/[^0-9.]/g, ''); // fuera todo lo que no sea numero o punto

    const primer = v.indexOf('.');        // un solo separador decimal
    if (primer !== -1) {
        v = v.slice(0, primer + 1) + v.slice(primer + 1).replace(/\./g, '');
    }

    if (v !== antes) {
        input.value = v;
        const desfase = v.length - antes.length;
        try { input.setSelectionRange(posicion + desfase, posicion + desfase); } catch (e) {}
    }
}

function movLeerCantidad() {
    const v = (document.getElementById('mov-cantidad').value || '').replace(',', '.').trim();
    if (v === '' || v === '.') return NaN;
    return parseFloat(v);
}

// Mensaje visible DENTRO del formulario. El toast solo dura unos segundos y
// se pierde de vista; esto se queda hasta la siguiente accion.
function movResultado(mensaje, tipo) {
    const el = document.getElementById('mov-aviso');
    if (typeof showToast === 'function') showToast(mensaje, tipo === 'ok' ? 'success' : 'error');
    if (!el) return;
    if (!mensaje) { el.classList.add('hidden'); return; }
    const ok = tipo === 'ok';
    el.style.padding      = '10px 12px';
    el.style.borderRadius = '8px';
    el.style.fontSize     = '14px';
    el.style.fontWeight   = '600';
    el.style.background   = ok ? '#d1fae5' : '#fee2e2';
    el.style.color        = ok ? '#065f46' : '#991b1b';
    el.style.border       = '1px solid ' + (ok ? '#6ee7b7' : '#fca5a5');
    el.textContent = mensaje;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function movAviso(mensaje) {
    const el = document.getElementById('mov-aviso');
    if (!el) return;
    if (!mensaje) { el.classList.add('hidden'); return; }
    el.textContent = mensaje;
    el.classList.remove('hidden');
}

// ------------------------------------------------------------ catalogos

async function movCargarCatalogos() {
    if (movEstado.catalogos) {
        await movCargarColaboradores();   // por si esa parte fallo antes
        return movEstado.catalogos;
    }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/catalogos`);
        const d = await r.json();
        if (!d.success) {
            movAviso(d.sin_configurar
                ? 'Falta configurar SUPABASE_SERVICE_KEY en el servidor. Sin eso no se pueden cargar bodegas ni motivos.'
                : ('No se pudieron cargar los catalogos: ' + (d.error || '')));
            return null;
        }
        movEstado.catalogos = d;
        movAviso('');

        const opciones = d.bodegas.map(b => `<option value="${b.id}">${b.nombre}</option>`).join('');
        ['mov-origen', 'mov-destino'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel) sel.innerHTML = '<option value="">Seleccionar...</option>' + opciones;
        });
        const selBodegaHist = document.getElementById('mov-hist-bodega');
        if (selBodegaHist) selBodegaHist.innerHTML = '<option value="">Todas</option>' + opciones;

        const selMotivo = document.getElementById('mov-motivo');
        if (selMotivo) {
            selMotivo.innerHTML = '<option value="">Seleccionar...</option>' +
                d.motivos.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
        }

        await movCargarColaboradores();
        return d;
    } catch (e) {
        movAviso('Error de conexion con el servidor: ' + e.message);
        return null;
    }
}

// ------------------------------------------------------------ colaboradores
// Quien envia y quien recibe salen de la Matriz de Colaboradores de Talento
// Humano (gth_matriz_colaboradores). Solo personal activo.

async function movCargarColaboradores() {
    if (movEstado.colaboradores) return movEstado.colaboradores;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/colaboradores`);
        const d = await r.json();
        if (!d.success) {
            movAviso('No se pudo cargar el personal: ' + (d.error || ''));
            return null;
        }
        movEstado.colaboradores = d.colaboradores;
        return d.colaboradores;
    } catch (e) {
        movAviso('Error al cargar el personal: ' + e.message);
        return null;
    }
}

// Buscador de personas, igual que el de productos. Sirve para los dos campos:
// el prefijo es 'mov-envia' o 'mov-recibe'.

function movPersonaPintar(pref, filtro) {
    const lista = document.getElementById(pref + '-lista');
    const todos = movEstado.colaboradores || [];
    const texto = (filtro || '').trim().toLowerCase();

    const filtrados = !texto ? todos : todos.filter(c =>
        (c.nombre || '').toLowerCase().includes(texto) ||
        (c.cargo || '').toLowerCase().includes(texto));

    if (!filtrados.length) {
        lista.innerHTML = '<div style="padding:10px;color:#64748b;font-size:13px;">Sin resultados</div>';
        lista.classList.remove('hidden');
        return;
    }

    const cabecera = `<div style="padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;
        font-size:11px;color:#64748b;position:sticky;top:0;">
        ${filtrados.length} persona${filtrados.length === 1 ? '' : 's'} activa${filtrados.length === 1 ? '' : 's'}
    </div>`;

    lista.innerHTML = cabecera + filtrados.map((c, i) => `
        <div class="mov-persona" data-idx="${i}"
             style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <strong>${c.nombre}</strong>
            <div style="color:#64748b;font-size:12px;">${c.cargo || 'sin cargo'}</div>
        </div>`).join('');
    lista.classList.remove('hidden');

    lista.querySelectorAll('.mov-persona').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = '#f1f5f9');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => movPersonaElegir(pref, filtrados[parseInt(el.dataset.idx, 10)]));
    });
}

async function movPersonaAbrir(pref) {
    if (!movEstado.colaboradores) {
        const ok = await movCargarColaboradores();
        if (!ok) return;
    }
    movPersonaPintar(pref, document.getElementById(pref + '-busca').value);
}

function movPersonaElegir(pref, c) {
    document.getElementById(pref).value = c.nombre;
    document.getElementById(pref + '-lista').classList.add('hidden');

    const busca  = document.getElementById(pref + '-busca');
    const flecha = document.getElementById(pref + '-flecha');
    busca.value = '';
    busca.classList.add('hidden');
    if (flecha) flecha.classList.add('hidden');

    const caja = document.getElementById(pref + '-elegido');
    caja.innerHTML = `<strong>${c.nombre}</strong>
        ${c.cargo ? `<span style="color:#047857;"> — ${c.cargo}</span>` : ''}
        <button type="button" onclick="movPersonaQuitar('${pref}')" title="Cambiar persona"
                style="float:right;background:none;border:none;cursor:pointer;color:#b91c1c;font-size:14px;">
            <i class="fas fa-xmark"></i></button>`;
    caja.classList.remove('hidden');
}

function movPersonaQuitar(pref) {
    document.getElementById(pref).value = '';
    document.getElementById(pref + '-elegido').classList.add('hidden');
    const busca  = document.getElementById(pref + '-busca');
    const flecha = document.getElementById(pref + '-flecha');
    if (busca) { busca.value = ''; busca.classList.remove('hidden'); }
    if (flecha) flecha.classList.remove('hidden');
}

function movPersonaEnganchar(pref) {
    const busca  = document.getElementById(pref + '-busca');
    const flecha = document.getElementById(pref + '-flecha');
    if (!busca) return;

    let temporizador = null;
    busca.addEventListener('input', e => {
        clearTimeout(temporizador);
        const v = e.target.value;
        temporizador = setTimeout(() => movPersonaAbrir(pref).then(() => movPersonaPintar(pref, v)), 120);
    });
    busca.addEventListener('focus', () => movPersonaAbrir(pref));
    busca.addEventListener('click', () => movPersonaAbrir(pref));

    if (flecha) flecha.addEventListener('click', () => {
        const lista = document.getElementById(pref + '-lista');
        if (lista && !lista.classList.contains('hidden')) { lista.classList.add('hidden'); return; }
        busca.focus();
        movPersonaAbrir(pref);
    });

    document.addEventListener('click', e => {
        const lista = document.getElementById(pref + '-lista');
        if (lista && !lista.classList.contains('hidden') &&
            !e.target.closest('#' + pref + '-lista') && !e.target.closest('#' + pref + '-busca')) {
            lista.classList.add('hidden');
        }
    });
}

// ------------------------------------------------------------ desplegable de productos
// Solo productos Activos que NO son para la venta. La lista completa se trae
// una sola vez y se filtra en el navegador, para que abra al instante.

const MOV_MAX_VISIBLES = 200;   // tope de items dibujados a la vez

// La unidad que se muestra y se guarda es SIEMPRE la menor (Und. Min. de la
// matriz). Un paquete de chistorras se mueve por unidades, no por paquetes.
function movUnidad(p) {
    return p.und_min || p.unidad_contifico || p.unid_max || '';
}

async function movCargarProductos() {
    if (movEstado.productos) return movEstado.productos;
    const lista = document.getElementById('mov-producto-lista');
    lista.innerHTML = '<div style="padding:10px;color:#64748b;font-size:13px;">Cargando productos...</div>';
    lista.classList.remove('hidden');
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/productos`);
        const d = await r.json();
        if (!d.success) {
            lista.innerHTML = `<div style="padding:10px;color:#b91c1c;font-size:13px;">${d.error || 'Error'}</div>`;
            return null;
        }
        movEstado.productos = d.productos;
        return d.productos;
    } catch (e) {
        lista.innerHTML = `<div style="padding:10px;color:#b91c1c;font-size:13px;">Error: ${e.message}</div>`;
        return null;
    }
}

function movPintarProductos(filtro) {
    const lista = document.getElementById('mov-producto-lista');
    const todos = movEstado.productos || [];
    const texto = (filtro || '').trim().toLowerCase();

    const filtrados = !texto ? todos : todos.filter(p =>
        (p.nombre_producto || '').toLowerCase().includes(texto) ||
        (p.codigo || '').toLowerCase().includes(texto) ||
        (p.categoria || '').toLowerCase().includes(texto));

    if (!filtrados.length) {
        lista.innerHTML = '<div style="padding:10px;color:#64748b;font-size:13px;">Sin resultados</div>';
        lista.classList.remove('hidden');
        return;
    }

    const visibles = filtrados.slice(0, MOV_MAX_VISIBLES);
    const encabezado = `<div style="padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;
        font-size:11px;color:#64748b;position:sticky;top:0;">
        ${filtrados.length} producto${filtrados.length === 1 ? '' : 's'} disponible${filtrados.length === 1 ? '' : 's'}
        ${filtrados.length > MOV_MAX_VISIBLES ? ` &middot; mostrando ${MOV_MAX_VISIBLES}, escribe para filtrar` : ''}
    </div>`;

    lista.innerHTML = encabezado + visibles.map((p, i) => `
        <div class="mov-item" data-idx="${i}"
             style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <strong>${p.nombre_producto || '(sin nombre)'}</strong>
            <div style="color:#64748b;font-size:12px;">
                ${p.codigo} &middot; ${p.categoria || 'sin categoria'} &middot; ${movUnidad(p)}
            </div>
        </div>`).join('');
    lista.classList.remove('hidden');

    lista.querySelectorAll('.mov-item').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = '#f1f5f9');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => movElegirProducto(visibles[parseInt(el.dataset.idx, 10)]));
    });
}

async function movAbrirProductos() {
    if (!movEstado.productos) {
        const ok = await movCargarProductos();
        if (!ok) return;
    }
    movPintarProductos(document.getElementById('mov-producto-busca').value);
}

function movBuscarProducto(texto) {
    clearTimeout(movEstado.buscando);
    movEstado.buscando = setTimeout(() => {
        if (!movEstado.productos) { movAbrirProductos(); return; }
        movPintarProductos(texto);
    }, 120);
}

function movElegirProducto(p) {
    movEstado.producto = {
        codigo: p.codigo,
        nombre: p.nombre_producto || '',
        unidad: movUnidad(p),
    };
    document.getElementById('mov-producto-lista').classList.add('hidden');
    document.getElementById('mov-unidad').value = movEstado.producto.unidad;

    // Solo se mueve un producto por solicitud: mientras haya uno elegido se
    // oculta el buscador, para que no parezca que se puede agregar otro.
    const busca  = document.getElementById('mov-producto-busca');
    const flecha = document.getElementById('mov-producto-flecha');
    busca.value = '';
    busca.classList.add('hidden');
    if (flecha) flecha.classList.add('hidden');

    const caja = document.getElementById('mov-producto-elegido');
    caja.innerHTML = `<strong>${movEstado.producto.nombre}</strong>
        <span style="color:#047857;">(${movEstado.producto.codigo})</span>
        <button type="button" onclick="movQuitarProducto()" title="Cambiar producto"
                style="float:right;background:none;border:none;cursor:pointer;color:#b91c1c;font-size:14px;">
            <i class="fas fa-xmark"></i></button>`;
    caja.style.marginTop = '0';
    caja.classList.remove('hidden');
}

function movQuitarProducto() {
    movEstado.producto = null;
    document.getElementById('mov-producto-elegido').classList.add('hidden');
    document.getElementById('mov-unidad').value = '';

    const busca  = document.getElementById('mov-producto-busca');
    const flecha = document.getElementById('mov-producto-flecha');
    if (busca) { busca.value = ''; busca.classList.remove('hidden'); }
    if (flecha) flecha.classList.remove('hidden');
}

// ------------------------------------------------------------ guardar

async function movGuardar() {
    const fecha   = document.getElementById('mov-fecha').value;
    const origen  = document.getElementById('mov-origen').value;
    const destino = document.getElementById('mov-destino').value;
    const envia   = document.getElementById('mov-envia').value.trim();
    const recibe  = document.getElementById('mov-recibe').value.trim();
    const cantidad = movLeerCantidad();
    const motivo  = document.getElementById('mov-motivo').value;

    // Se nombra cada campo que falta: un aviso generico no dice donde mirar
    const faltan = [];
    if (!fecha)                 faltan.push('Fecha de Registro');
    if (!origen)                faltan.push('Origen');
    if (!destino)               faltan.push('Destino');
    if (!envia)                 faltan.push('Quien Envia');
    if (!recibe)                faltan.push('Quien Recibe');
    if (!movEstado.producto)    faltan.push('Producto');
    if (isNaN(cantidad))        faltan.push('Cantidad');
    if (!motivo)                faltan.push('Motivo');

    if (faltan.length) {
        movResultado('Falta llenar: ' + faltan.join(', '), 'error');
        return;
    }
    if (origen === destino) {
        movResultado('El origen y el destino no pueden ser la misma bodega', 'error');
        return;
    }
    if (cantidad <= 0) {
        movResultado('La cantidad debe ser mayor a cero', 'error');
        return;
    }

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/solicitar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fecha_registro: fecha,
                bodega_origen: origen,
                bodega_destino: destino,
                quien_envia: envia,
                quien_recibe: recibe,
                producto_codigo: movEstado.producto.codigo,
                producto_nombre: movEstado.producto.nombre,
                unidad: movEstado.producto.unidad,
                cantidad: cantidad,
                motivo_id: motivo,
                observacion: document.getElementById('mov-observacion').value.trim(),
                registrado_por: (typeof state !== 'undefined' && state.user) ? state.user.username : '',
            })
        });
        const d = await r.json();
        if (d.success) {
            const id = d.solicitud && d.solicitud.id;
            movLimpiar();
            movResultado('Solicitud enviada' + (id ? ' (numero ' + id + ')' : '') +
                         '. Puedes verla en Movimientos Solicitados.', 'ok');
        } else {
            movResultado(d.error || 'No se pudo guardar la solicitud', 'error');
        }
    } catch (e) {
        movResultado('No se pudo conectar con el servidor: ' + e.message, 'error');
    }
}

function movLimpiar() {
    ['mov-cantidad', 'mov-observacion', 'mov-producto-busca', 'mov-unidad'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ['mov-origen', 'mov-destino', 'mov-motivo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    movQuitarProducto();
    movPersonaQuitar('mov-envia');
    movPersonaQuitar('mov-recibe');
    // el mensaje de resultado se pinta despues de limpiar, no se toca aqui
    const f = document.getElementById('mov-fecha');
    if (f) f.value = new Date().toISOString().slice(0, 10);
}

// ------------------------------------------------------------ cambio de estado

const MOV_ETIQUETA = {
    pendiente: 'Pendiente',
    ejecutado: 'Ejecutado',
    error:     'Error',
    anulado:   'Anulado',
};

function movEtiquetaEstado(e) {
    return MOV_ETIQUETA[e] || e;
}

function movBoton(texto, icono, color, onclick) {
    return `<button type="button" onclick="${onclick}"
        style="margin-right:4px;margin-bottom:2px;padding:4px 9px;border:1px solid ${color};
               background:#fff;color:${color};border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">
        <i class="fas ${icono}"></i> ${texto}</button>`;
}

// Anular es la unica salida que tiene una persona para frenar un movimiento, y
// solo la tiene el administrador.
function movEsAdmin() {
    return typeof state !== 'undefined' && state.user && state.user.rol === 'admin';
}

function movBotonesEstado(s) {
    const partes = [];

    if (s.estado === 'pendiente') {
        partes.push('<span style="color:#92400e;font-size:11px;margin-right:6px;">' +
                    '<i class="fas fa-hourglass-half"></i> En cola</span>');
    } else if (s.estado === 'error') {
        // Devolverla a la cola: lo unico que una persona puede hacer con el estado
        partes.push(movBoton('Reprocesar', 'fa-rotate-right', '#1d4ed8', `movReprocesar(${s.id})`));
    } else if (s.estado === 'anulado') {
        const quien = s.anulado_por ? ' por ' + s.anulado_por : '';
        return `<span style="color:#64748b;font-size:11px;" title="${(s.motivo_anulacion || '').replace(/"/g, '&quot;')}">` +
               `<i class="fas fa-ban"></i> Anulado${quien}</span>`;
    }

    // Ejecutado no se anula: el traslado ya existe en Contifico
    if (movEsAdmin() && (s.estado === 'pendiente' || s.estado === 'error')) {
        partes.push(movBoton('Anular', 'fa-ban', '#b91c1c', `movAnular(${s.id})`));
    }

    return partes.length ? partes.join('') : '<span style="color:#64748b;font-size:11px;">—</span>';
}

async function movAnular(id) {
    if (!movEsAdmin()) {
        showToast('Solo un administrador puede anular movimientos', 'error');
        return;
    }

    const motivo = prompt(`Anular la solicitud ${id}.

No se ejecutara en Contifico. ` +
                          `La solicitud no se borra: queda como Anulada.

` +
                          `Motivo (opcional):`);
    if (motivo === null) return;   // cancelo el prompt

    const clave = prompt('Tu contrasena de administrador para confirmar:');
    if (!clave) return;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/solicitudes/${id}/anular`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_user: state.user.username,
                admin_pass: clave,
                motivo: motivo,
            }),
        });
        const d = await r.json();
        if (d.success) {
            showToast(`Solicitud ${id} anulada`, 'success');
            movCargarHistorial();
        } else {
            showToast(d.error || 'No se pudo anular', 'error');
        }
    } catch (e) {
        showToast('Error de conexion: ' + e.message, 'error');
    }
}

async function movReprocesar(id) {
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/solicitudes/${id}/reprocesar`,
                              { method: 'POST' });
        const d = await r.json();
        if (d.success) {
            showToast(`Solicitud ${id} devuelta a la cola`, 'success');
            movCargarHistorial();
        } else {
            showToast(d.error || 'No se pudo reprocesar', 'error');
        }
    } catch (e) {
        showToast('Error de conexion: ' + e.message, 'error');
    }
}

// ------------------------------------------------------------ historial

async function movCargarHistorial() {
    const cont = document.getElementById('mov-hist-tabla');
    cont.innerHTML = '<div style="padding:20px;color:#64748b;">Cargando...</div>';

    const params = new URLSearchParams();
    const desde  = document.getElementById('mov-hist-desde').value;
    const hasta  = document.getElementById('mov-hist-hasta').value;
    const estado = document.getElementById('mov-hist-estado').value;
    const bodega = document.getElementById('mov-hist-bodega').value;
    if (desde)  params.set('desde', desde);
    if (hasta)  params.set('hasta', hasta);
    if (estado) params.set('estado', estado);
    if (bodega) params.set('bodega', bodega);

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/movimientos/solicitudes?` + params.toString());
        const d = await r.json();
        if (!d.success) {
            cont.innerHTML = `<div style="padding:20px;color:#b91c1c;">${d.error || 'Error'}</div>`;
            return;
        }
        const nombres = {};
        (movEstado.catalogos?.bodegas || []).forEach(b => nombres[b.id] = b.nombre);

        document.getElementById('mov-hist-resumen').innerHTML =
            `<div style="padding:10px 12px;background:#f1f5f9;border-radius:8px;display:inline-block;font-size:14px;">
                <strong>${d.total}</strong> solicitud${d.total === 1 ? '' : 'es'}
             </div>`;

        if (!d.solicitudes.length) {
            cont.innerHTML = '<div style="padding:20px;color:#64748b;">No hay solicitudes en ese rango</div>';
            return;
        }

        cont.innerHTML = `
        <table class="tabla-datos" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="background:#f8fafc;text-align:left;">
                    <th style="padding:8px;">Fecha</th>
                    <th style="padding:8px;">Origen</th>
                    <th style="padding:8px;">Destino</th>
                    <th style="padding:8px;">Producto</th>
                    <th style="padding:8px;text-align:right;">Cantidad</th>
                    <th style="padding:8px;">Envia / Recibe</th>
                    <th style="padding:8px;">Motivo</th>
                    <th style="padding:8px;">Estado</th>
                    <th style="padding:8px;">Acciones</th>
                </tr>
            </thead>
            <tbody>
            ${d.solicitudes.map(s => {
                const c = MOV_ESTADO_COLOR[s.estado] || { fondo: '#e2e8f0', texto: '#334155' };
                return `<tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:8px;">${s.fecha_registro}</td>
                    <td style="padding:8px;">${nombres[s.bodega_origen] || s.bodega_origen}</td>
                    <td style="padding:8px;">${nombres[s.bodega_destino] || s.bodega_destino}</td>
                    <td style="padding:8px;">${s.producto_nombre}<br>
                        <span style="color:#64748b;font-size:11px;">${s.producto_codigo}</span></td>
                    <td style="padding:8px;text-align:right;">${s.cantidad} ${s.unidad || ''}</td>
                    <td style="padding:8px;">${s.quien_envia}<br>
                        <span style="color:#64748b;font-size:11px;">${s.quien_recibe}</span></td>
                    <td style="padding:8px;">${s.motivo_nombre || ''}</td>
                    <td style="padding:8px;">
                        <span style="padding:3px 8px;border-radius:999px;background:${c.fondo};color:${c.texto};font-size:11px;font-weight:600;">
                            ${movEtiquetaEstado(s.estado)}
                        </span>
                        ${s.num_documento ? `<div style="color:#047857;font-size:11px;margin-top:4px;font-weight:600;">${s.num_documento}</div>` : ''}
                        ${s.nota_estado ? `<div style="color:#b91c1c;font-size:11px;margin-top:4px;">${s.nota_estado}</div>` : ''}
                    </td>
                    <td style="padding:8px;white-space:nowrap;" id="mov-acc-${s.id}">
                        ${movBotonesEstado(s)}
                    </td>
                </tr>`;
            }).join('')}
            </tbody>
        </table>`;
    } catch (e) {
        cont.innerHTML = `<div style="padding:20px;color:#b91c1c;">Error: ${e.message}</div>`;
    }
}

// ------------------------------------------------------------ arranque

document.addEventListener('DOMContentLoaded', () => {
    const cant = document.getElementById('mov-cantidad');
    if (cant) {
        cant.addEventListener('input', () => movNormalizarCantidad(cant));
        cant.addEventListener('paste', () => setTimeout(() => movNormalizarCantidad(cant), 0));
    }

    const busca = document.getElementById('mov-producto-busca');
    if (busca) {
        busca.addEventListener('input', e => movBuscarProducto(e.target.value));
        // Al hacer clic o enfocar se despliega la lista completa
        busca.addEventListener('focus', movAbrirProductos);
        busca.addEventListener('click', movAbrirProductos);
    }
    const flecha = document.getElementById('mov-producto-flecha');
    if (flecha) flecha.addEventListener('click', () => {
        const lista = document.getElementById('mov-producto-lista');
        if (lista && !lista.classList.contains('hidden')) { lista.classList.add('hidden'); return; }
        busca.focus();
        movAbrirProductos();
    });

    document.addEventListener('click', e => {
        const lista = document.getElementById('mov-producto-lista');
        if (lista && !lista.classList.contains('hidden') &&
            !e.target.closest('#mov-producto-lista') && !e.target.closest('#mov-producto-busca')) {
            lista.classList.add('hidden');
        }
    });

    const hoy = new Date().toISOString().slice(0, 10);
    const f = document.getElementById('mov-fecha');
    if (f && !f.value) f.value = hoy;
    const hd = document.getElementById('mov-hist-desde');
    if (hd && !hd.value) {
        const d30 = new Date(); d30.setDate(d30.getDate() - 30);
        hd.value = d30.toISOString().slice(0, 10);
    }
    const hh = document.getElementById('mov-hist-hasta');
    if (hh && !hh.value) hh.value = hoy;

    // Los catalogos se cargan al arrancar, no al hacer clic en el menu: a la
    // vista se puede llegar sin pasar por el boton (la app recuerda la ultima
    // vista abierta en sessionStorage) y entonces los desplegables quedaban vacios.
    movPersonaEnganchar('mov-envia');
    movPersonaEnganchar('mov-recibe');

    movCargarCatalogos();

    document.querySelectorAll('.nav-btn[data-view="mov-solicitud"], .nav-btn[data-view="mov-historial"]')
        .forEach(btn => btn.addEventListener('click', async () => {
            await movCargarCatalogos();          // no hace nada si ya estan cargados
            if (btn.dataset.view === 'mov-historial') movCargarHistorial();
        }));
});
