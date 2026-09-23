// Matriz General de Productos
//
// El formulario NO tiene los campos escritos a mano: son 80 columnas y se
// desincronizarian del backend a la primera. /api/matriz/campos manda la
// definicion y aqui se dibuja. Agregar una columna alla la hace aparecer aca.
//
// Los botones de cada fila van por data-codigo + addEventListener y no por
// onclick inline: los codigos y nombres traen comillas y apostrofes que rompen
// el atributo.

const matrizEstado = {
    campos: null,        // definicion que manda el backend
    catalogos: null,     // valores existentes para los desplegables
    productos: [],
    pagina: 1,
    paginas: 1,
    total: 0,
    porPagina: 50,
    abierto: null,       // ficha abierta: { codigo, datos, esNuevo }
    grupoActivo: 'identificacion',
    buscando: null,      // timer del debounce
    abiertos: null,      // categorias desplegadas; null = todavia no se decidio
};

const MATRIZ_TODAS = 3000;      // tope de filas al agrupar (hoy hay 1264)
const MATRIZ_ABRIR_HASTA = 6;   // con mas categorias que esto, arrancan cerradas

const MATRIZ_GRUPOS = [
    ['identificacion', 'Identificacion',  'fa-tag'],
    ['conteo',         'Conteo x bodega', 'fa-clipboard-check'],
    ['conteo_diario',  'Conteo diario',   'fa-calendar-check'],
    ['equivalencias',  'Equivalencias',   'fa-scale-balanced'],
    ['precios',        'Precios',         'fa-dollar-sign'],
    ['contable',       'Contable',        'fa-book'],
    ['proveedor',      'Proveedor',       'fa-truck'],
    ['auditoria',      'Auditoria',       'fa-clock-rotate-left'],
];

// Las bodegas que tienen flag de conteo, con su nombre corto para la grilla
const MATRIZ_BODEGAS = [
    ['conteo_chios',                 'CH'],
    ['conteo_simon_bolon',           'SB'],
    ['conteo_santo_cachon',          'SC'],
    ['conteo_planta_produccion',     'PL'],
    ['conteo_bodega_principal',      'BP'],
    ['conteo_bodega_materia_prima',  'MP'],
    ['conteo_bodega_pulmon',         'PU'],
];

function matrizEsAdmin() {
    return typeof state !== 'undefined' && state.user && state.user.rol === 'admin';
}

function matrizUsuario() {
    return (typeof state !== 'undefined' && state.user) ? state.user.username : '';
}

function matrizEscapar(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ------------------------------------------------------------ arranque

async function matrizInit() {
    if (matrizEstado.campos) {          // ya se cargo antes, solo refrescar
        matrizCargar(1);
        return;
    }
    try {
        const [rc, rk] = await Promise.all([
            fetch(`${CONFIG.API_URL}/api/matriz/campos`),
            fetch(`${CONFIG.API_URL}/api/matriz/catalogos`),
        ]);
        const dc = await rc.json();
        const dk = await rk.json();
        if (!dc.success) throw new Error(dc.error || 'No se pudo leer la definicion de campos');
        matrizEstado.campos = dc.campos;
        matrizEstado.catalogos = dk.success ? dk.catalogos : {};
        matrizLlenarFiltros();
        matrizEnganchar();
        matrizCargar(1);
    } catch (e) {
        showToast('Matriz de productos: ' + e.message, 'error');
    }
}

function matrizLlenarFiltros() {
    const c = matrizEstado.catalogos || {};
    const poner = (id, valores, etiquetaTodos) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = `<option value="">${etiquetaTodos}</option>` +
            (valores || []).map(v => `<option value="${matrizEscapar(v)}">${matrizEscapar(v)}</option>`).join('');
    };
    poner('matriz-f-estado',    c.estado,       'Todos los estados');
    poner('matriz-f-categoria', c.categoria,    'Todas las categorias');
    poner('matriz-f-uso',       c.uso_producto, 'Todos los usos');

    const sel = document.getElementById('matriz-f-cuenta');
    if (sel) {
        sel.innerHTML = '<option value="">Se cuenta en: cualquiera</option>' +
            matrizEstado.campos.filter(x => x.columna.startsWith('conteo_'))
                .map(x => `<option value="${x.columna}">Se cuenta en: ${matrizEscapar(x.etiqueta)}</option>`)
                .join('');
    }
}

let _matrizClicksEnganchados = false;

function matrizEnganchar() {
    const buscador = document.getElementById('matriz-buscar');
    if (buscador) {
        buscador.addEventListener('input', () => {
            clearTimeout(matrizEstado.buscando);
            matrizEstado.buscando = setTimeout(() => {
                matrizEstado.abiertos = null;
                matrizCargar(1);
            }, 350);
        });
    }
    ['matriz-f-estado', 'matriz-f-categoria', 'matriz-f-uso',
     'matriz-f-venta', 'matriz-f-cuenta', 'matriz-orden'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            matrizEstado.abiertos = null;   // el filtro cambio: se decide de nuevo
            matrizCargar(1);
        });
    });

    const btnNuevo = document.getElementById('matriz-btn-nuevo');
    if (btnNuevo) btnNuevo.addEventListener('click', () => matrizAbrirFicha(null));

    // Un solo listener para todo el listado. Cuelga de document y no del
    // contenedor: asi no importa si #matriz-lista todavia no existe cuando esto
    // corre, ni si mas adelante se reemplaza entero.
    if (!_matrizClicksEnganchados) {
        _matrizClicksEnganchados = true;
        document.addEventListener('click', ev => {
            const cab = ev.target.closest('[data-categoria]');
            if (cab) {
                matrizAlternarGrupo(cab.getAttribute('data-categoria'));
                return;
            }
            const btn = ev.target.closest('button[data-accion]');
            if (!btn) return;
            const codigo = btn.getAttribute('data-codigo');
            if (btn.getAttribute('data-accion') === 'editar') matrizAbrirFicha(codigo);
            if (btn.getAttribute('data-accion') === 'borrar') matrizBorrar(codigo);
        });
    }
}


// ------------------------------------------------------------ listado

async function matrizCargar(pagina) {
    if (pagina) matrizEstado.pagina = pagina;
    const valor = id => (document.getElementById(id) || {}).value || '';

    // Agrupado por categoria no se pagina: partir una categoria a la mitad de
    // una pagina no le sirve a nadie. Se traen todas las que entren al filtro.
    const agrupado = matrizAgrupado();
    if (agrupado) matrizEstado.pagina = 1;

    const p = new URLSearchParams({
        q:          valor('matriz-buscar'),
        estado:     valor('matriz-f-estado'),
        categoria:  valor('matriz-f-categoria'),
        uso:        valor('matriz-f-uso'),
        venta:      valor('matriz-f-venta'),
        cuenta_en:  valor('matriz-f-cuenta'),
        orden:      valor('matriz-orden'),
        pagina:     matrizEstado.pagina,
        por_pagina: agrupado ? MATRIZ_TODAS : matrizEstado.porPagina,
    });

    const lista = document.getElementById('matriz-lista');
    if (lista) {
        lista.innerHTML = `<div class="mx-vacio">Cargando...</div>`;
    }

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos?` + p.toString());
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo cargar');
        matrizEstado.productos = d.productos;
        matrizEstado.total     = d.total;
        matrizEstado.paginas   = d.paginas;
        matrizPintar();
    } catch (e) {
        if (lista) {
            lista.innerHTML = `<div class="mx-vacio" style="color:#E24B4A;">
                ${matrizEscapar(e.message)}</div>`;
        }
    }
}

function matrizAgrupado() {
    const sel = document.getElementById('matriz-orden');
    return !sel || sel.value === 'categoria' || sel.value === '';
}

function matrizChip(activo, texto) {
    return `<span class="mx-chip${activo ? ' on' : ''}">${texto}</span>`;
}

// La categoria se muestra como columna solo cuando NO se esta agrupando: dentro
// de un grupo, repetirla en cada fila es ruido.
function matrizCabecera(conCategoria) {
    return `<thead><tr>
        <th>Codigo</th>
        <th>Producto</th>
        ${conCategoria ? '<th>Categoria</th>' : ''}
        <th>Uso</th>
        <th>Und. min</th>
        <th class="mx-centro">Venta</th>
        <th title="Bodegas donde este producto se cuenta">Se cuenta en</th>
        <th class="mx-centro">Estado</th>
        <th></th>
    </tr></thead>`;
}

function matrizFila(p, conCategoria) {
    const inactivo = p.estado !== 'Activo';
    const chips = MATRIZ_BODEGAS.map(([col, corto]) => matrizChip(p[col], corto)).join('');
    const cod = matrizEscapar(p.codigo);
    return `<tr class="${inactivo ? 'mx-off' : ''}">
        <td class="mx-cod">${cod}</td>
        <td class="mx-nombre">${matrizEscapar(p.nombre_producto)}</td>
        ${conCategoria ? `<td class="mx-tenue">${matrizEscapar(p.categoria)}</td>` : ''}
        <td class="mx-tenue">${matrizEscapar(p.uso_producto)}</td>
        <td class="mx-tenue">${matrizEscapar(p.und_min)}</td>
        <td class="mx-centro"><span class="mx-badge ${p.para_la_venta ? 'mx-ok' : 'mx-no'}">
            ${p.para_la_venta ? 'Si' : 'No'}</span></td>
        <td style="line-height:1.7;">${chips}</td>
        <td class="mx-centro"><span class="mx-badge ${inactivo ? 'mx-no' : 'mx-ok'}">
            ${matrizEscapar(p.estado)}</span></td>
        <td class="mx-der">
            <button type="button" class="mx-accion mx-editar" data-accion="editar"
                    data-codigo="${cod}" title="Ver y editar la ficha de ${cod}">Editar</button>
            ${matrizEsAdmin() ? `<button type="button" class="mx-accion mx-borrar" data-accion="borrar"
                    data-codigo="${cod}" title="Borrar definitivamente ${cod} de la matriz">Borrar</button>` : ''}
        </td></tr>`;
}

function matrizPintar() {
    const lista = document.getElementById('matriz-lista');
    if (!lista) return;

    if (!matrizEstado.productos.length) {
        lista.innerHTML = `<div class="mx-vacio">Ningun producto con esos filtros</div>`;
    } else if (matrizAgrupado()) {
        matrizPintarAgrupado(lista);
    } else {
        lista.innerHTML = `<div class="mx-cat abierta"><div style="overflow-x:auto;">
            <table class="mx-tabla">${matrizCabecera(true)}<tbody>
            ${matrizEstado.productos.map(p => matrizFila(p, true)).join('')}
            </tbody></table></div></div>`;
    }

    matrizPintarPie();
}

// Los productos ya vienen ordenados por categoria y codigo desde el servidor,
// asi que agrupar es solo cortar donde cambia la categoria.
function matrizAgrupar() {
    const grupos = [];
    let actual = null;
    matrizEstado.productos.forEach(p => {
        const cat = p.categoria || '(sin categoria)';
        if (!actual || actual.categoria !== cat) {
            actual = { categoria: cat, filas: [] };
            grupos.push(actual);
        }
        actual.filas.push(p);
    });
    return grupos;
}

function matrizPintarAgrupado(lista) {
    const grupos = matrizAgrupar();

    // Con pocas categorias se abren todas; con muchas se dejan cerradas y la
    // pantalla queda como un indice en el que se elige adonde entrar.
    if (matrizEstado.abiertos === null) {
        matrizEstado.abiertos = new Set(
            grupos.length <= MATRIZ_ABRIR_HASTA ? grupos.map(g => g.categoria) : []);
    }

    lista.innerHTML = grupos.map(g => {
        const abierto = matrizEstado.abiertos.has(g.categoria);
        const cat = matrizEscapar(g.categoria);
        const inactivos = g.filas.filter(p => p.estado !== 'Activo').length;
        return `<div class="mx-cat${abierto ? ' abierta' : ''}">
            <div class="mx-cat-head" data-categoria="${cat}">
                <span class="mx-chev">&#9654;</span>
                <span class="mx-cat-nombre">${cat}</span>
                <span class="mx-cat-meta">${g.filas.length}
                    ${g.filas.length === 1 ? 'producto' : 'productos'}${
                    inactivos ? ` &middot; <b>${inactivos} inactivo${inactivos === 1 ? '' : 's'}</b>` : ''}</span>
            </div>
            ${abierto ? `<div style="overflow-x:auto;">
                <table class="mx-tabla">${matrizCabecera(false)}<tbody>
                ${g.filas.map(p => matrizFila(p, false)).join('')}
                </tbody></table></div>` : ''}
        </div>`;
    }).join('');
}

function matrizAlternarGrupo(categoria) {
    if (!matrizEstado.abiertos) matrizEstado.abiertos = new Set();
    if (matrizEstado.abiertos.has(categoria)) {
        matrizEstado.abiertos.delete(categoria);
    } else {
        matrizEstado.abiertos.add(categoria);
    }
    matrizPintarAgrupado(document.getElementById('matriz-lista'));
}

function matrizPintarPie() {
    const agrupado = matrizAgrupado();
    const info = document.getElementById('matriz-info');
    if (info) {
        if (agrupado) {
            const grupos = matrizAgrupar().length;
            info.textContent = `${matrizEstado.total} productos en ${grupos} categorias`;
        } else {
            const desde = matrizEstado.total ? (matrizEstado.pagina - 1) * matrizEstado.porPagina + 1 : 0;
            const hasta = Math.min(matrizEstado.pagina * matrizEstado.porPagina, matrizEstado.total);
            info.textContent = `${desde}\u2013${hasta} de ${matrizEstado.total} productos`;
        }
    }

    // La paginacion no aplica agrupado: se muestran los botones de plegar
    const paginador = document.getElementById('matriz-paginador');
    if (paginador) paginador.style.display = agrupado ? 'none' : 'flex';
    const plegado = document.getElementById('matriz-plegado');
    if (plegado) plegado.style.display = agrupado ? 'flex' : 'none';

    const pag = document.getElementById('matriz-paginas');
    if (pag) pag.textContent = `Pagina ${matrizEstado.pagina} de ${matrizEstado.paginas || 1}`;
    const btnAnt = document.getElementById('matriz-ant');
    const btnSig = document.getElementById('matriz-sig');
    if (btnAnt) btnAnt.disabled = matrizEstado.pagina <= 1;
    if (btnSig) btnSig.disabled = matrizEstado.pagina >= matrizEstado.paginas;
}

function matrizTodos(abrir) {
    const grupos = matrizAgrupar();
    matrizEstado.abiertos = new Set(abrir ? grupos.map(g => g.categoria) : []);
    matrizPintarAgrupado(document.getElementById('matriz-lista'));
}

function matrizPagina(salto) {
    const destino = matrizEstado.pagina + salto;
    if (destino < 1 || destino > matrizEstado.paginas) return;
    matrizCargar(destino);
}


// ------------------------------------------------------------ ficha

async function matrizAbrirFicha(codigo) {
    let datos = {};
    if (codigo) {
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'No se pudo abrir');
            datos = d.producto;
        } catch (e) {
            showToast(e.message, 'error');
            return;
        }
    } else {
        datos = { estado: 'Activo' };
    }

    matrizEstado.abierto = { codigo: codigo, datos: datos, esNuevo: !codigo };
    matrizEstado.grupoActivo = 'identificacion';

    // El conteo por marca vive en otra tabla, asi que va en su propia consulta.
    matrizConteo = null;
    matrizProvEditado = null;
    await matrizCargarProveedores();
    if (codigo) await matrizCargarConteo(codigo);

    document.getElementById('matriz-ficha-titulo').innerHTML = codigo
        ? `<i class="fas fa-pen"></i> ${matrizEscapar(datos.nombre_producto || codigo)}
           <span style="font-family:'DM Mono',monospace;font-size:12px;color:#64748b;margin-left:8px;">${matrizEscapar(codigo)}</span>`
        : '<i class="fas fa-plus-circle"></i> Nuevo producto';

    matrizPintarPestanas();
    matrizPintarGrupo();
    document.getElementById('matriz-ficha').style.display = 'flex';
}

function matrizCerrarFicha() {
    document.getElementById('matriz-ficha').style.display = 'none';
    matrizEstado.abierto = null;
}

function matrizPintarPestanas() {
    const cont = document.getElementById('matriz-pestanas');
    if (!cont) return;
    cont.innerHTML = MATRIZ_GRUPOS.map(([id, etiqueta, icono]) => {
        const activa = id === matrizEstado.grupoActivo;
        return `<button type="button" data-grupo="${id}"
            style="padding:8px 14px;border:none;border-bottom:2px solid ${activa ? '#1d4ed8' : 'transparent'};
                   background:none;cursor:pointer;font-size:12px;font-weight:${activa ? '700' : '500'};
                   color:${activa ? '#1d4ed8' : '#64748b'};white-space:nowrap;">
            <i class="fas ${icono}"></i> ${etiqueta}</button>`;
    }).join('');

    cont.querySelectorAll('button[data-grupo]').forEach(b => {
        b.addEventListener('click', () => {
            matrizGuardarVisible();          // no perder lo tecleado al cambiar de pestana
            matrizEstado.grupoActivo = b.getAttribute('data-grupo');
            matrizPintarPestanas();
            matrizPintarGrupo();
        });
    });
}

// Lo que este escrito en la pestana visible vuelve al objeto en memoria. Sin
// esto, cambiar de pestana borraria lo que se acaba de escribir.
function matrizGuardarVisible() {
    const a = matrizEstado.abierto;
    if (!a) return;
    document.querySelectorAll('#matriz-campos [data-columna]').forEach(el => {
        const col = el.getAttribute('data-columna');
        a.datos[col] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    // Los de seleccion multiple viajan como lista, no como valor suelto
    document.querySelectorAll('#matriz-campos [data-multi]').forEach(caja => {
        a.datos[caja.getAttribute('data-multi')] = Array.from(
            caja.querySelectorAll('input[type=checkbox]:checked')).map(x => x.value);
    });
}

function matrizControl(campo, valor) {
    const col = campo.columna;
    const cat = (matrizEstado.catalogos || {})[col];
    const base = `padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:100%;
                  background:#fff;color:#0f172a;`;

    if (campo.tipo === 'ro') {
        const texto = valor === null || valor === undefined || valor === '' ? '—' : String(valor);
        return `<div style="${base}background:#f8fafc;color:#64748b;">${matrizEscapar(texto)}</div>`;
    }
    if (campo.tipo === 'bool') {
        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;">
            <input type="checkbox" data-columna="${col}" ${valor ? 'checked' : ''}
                   style="width:17px;height:17px;cursor:pointer;accent-color:#1d4ed8;">
            <span style="font-size:12px;color:#475569;">${valor ? 'Si' : 'No'}</span></label>`;
    }
    if (campo.tipo === 'area') {
        return `<textarea data-columna="${col}" rows="3" style="${base}resize:vertical;">${matrizEscapar(valor)}</textarea>`;
    }
    // Varios valores a la vez: dias de recepcion, franjas, bodegas de ingreso.
    // Casillas y no un <select multiple>: en un select hay que saber que se
    // elige con Ctrl, y aqui se ve de una lo que esta marcado.
    if (campo.tipo === 'multi') {
        const marcados = Array.isArray(valor)
            ? valor.map(x => String(x).trim())
            : String(valor || '').split(',').map(x => x.trim()).filter(Boolean);
        const opciones = campo.opciones && campo.opciones.length
            ? campo.opciones : (cat || []);
        // Lo guardado que ya no este en la lista se muestra igual, para no
        // borrarlo sin avisar al primer guardado.
        const extras = marcados.filter(v => opciones.indexOf(v) === -1);
        if (!opciones.length && !extras.length) {
            return `<div style="${base}background:#f8fafc;color:#64748b;">Sin opciones</div>`;
        }
        return `<div data-multi="${col}" style="border:1px solid #cbd5e1;border-radius:6px;
                     padding:8px 10px;max-height:150px;overflow-y:auto;
                     overflow-x:hidden;background:#fff;">
            ${opciones.concat(extras).map(v => `
                <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 0;
                              cursor:pointer;font-size:12.5px;color:#334155;line-height:1.35;">
                    <input type="checkbox" value="${matrizEscapar(v)}"
                           ${marcados.indexOf(v) !== -1 ? 'checked' : ''}
                           style="width:15px;height:15px;cursor:pointer;accent-color:#1d4ed8;flex:0 0 auto;margin-top:1px;">
                    <span style="min-width:0;overflow-wrap:anywhere;">${matrizEscapar(v)}${extras.indexOf(v) !== -1
                        ? ' <span class="mx-tenue">(fuera de lista)</span>' : ''}</span>
                </label>`).join('')}
        </div>`;
    }

    if (campo.tipo === 'array') {
        const texto = Array.isArray(valor) ? valor.join(', ') : (valor || '');
        return `<input type="text" data-columna="${col}" value="${matrizEscapar(texto)}"
                   placeholder="separar con comas" style="${base}">`;
    }
    // El codigo no se toca una vez creado: es la clave de la tabla
    if (col === 'codigo' && !matrizEstado.abierto.esNuevo) {
        return `<div style="${base}background:#f8fafc;color:#64748b;font-family:'DM Mono',monospace;">
                ${matrizEscapar(valor)}</div>`;
    }
    // Lista cerrada: se elige, no se escribe. Escribir aqui es siempre un error
    // (un 'activo' en minuscula sacaria al producto de todos los filtros).
    if (campo.opciones && campo.opciones.length) {
        const actual = (valor === null || valor === undefined) ? '' : String(valor);
        // Si lo guardado no esta en la lista se muestra igual, para no pisarlo sin avisar
        const extra = (actual && campo.opciones.indexOf(actual) === -1)
            ? `<option value="${matrizEscapar(actual)}" selected>${matrizEscapar(actual)} (valor actual)</option>`
            : '';
        const opciones = campo.opciones.map(v =>
            `<option value="${matrizEscapar(v)}"${v === actual ? ' selected' : ''}>${matrizEscapar(v)}</option>`
        ).join('');
        return `<select data-columna="${col}" style="${base}cursor:pointer;">
                    <option value=""${actual ? '' : ' selected'}>— sin definir —</option>
                    ${extra}${opciones}
                </select>`;
    }

    if (cat && cat.length) {
        // Lista con escritura libre: el valor de hoy puede no estar en el catalogo
        const opciones = cat.map(v => `<option value="${matrizEscapar(v)}">`).join('');
        return `<input type="text" data-columna="${col}" value="${matrizEscapar(valor)}"
                   list="matriz-lista-${col}" style="${base}">
                <datalist id="matriz-lista-${col}">${opciones}</datalist>`;
    }
    const tipoHtml = campo.tipo === 'num' ? 'text' : 'text';   // num como texto: aqui se escribe 1,5
    return `<input type="${tipoHtml}" data-columna="${col}" value="${matrizEscapar(valor)}" style="${base}">`;
}

function matrizPintarGrupo() {
    const cont = document.getElementById('matriz-campos');
    const a = matrizEstado.abierto;
    if (!cont || !a) return;

    const campos = matrizEstado.campos.filter(c => c.grupo === matrizEstado.grupoActivo);

    // El conteo se lee por pares flag+unidad, no como una lista suelta
    if (matrizEstado.grupoActivo === 'proveedor') {
        matrizPintarProveedor();
        return;
    }
    if (matrizEstado.grupoActivo === 'conteo_diario') {
        matrizPintarConteoDiario();
        return;
    }
    if (matrizEstado.grupoActivo === 'conteo') {
        const general = campos.find(c => c.columna === 'unidad_de_conteo_general');
        const filas = MATRIZ_BODEGAS.map(([flagCol]) => {
            const flag = campos.find(c => c.columna === flagCol);
            const uni  = campos.find(c => c.columna === flagCol.replace('conteo_', 'unidad_conteo_'));
            if (!flag) return '';
            return `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:6px 10px;font-size:12px;font-weight:600;color:#334155;">${matrizEscapar(flag.etiqueta)}</td>
                <td style="padding:6px 10px;width:90px;">${matrizControl(flag, a.datos[flag.columna])}</td>
                <td style="padding:6px 10px;">${uni ? matrizControl(uni, a.datos[uni.columna]) : ''}</td></tr>`;
        }).join('');

        cont.innerHTML = `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;
                        margin-bottom:14px;font-size:11.5px;color:#1e40af;line-height:1.5;">
                <i class="fas fa-circle-info"></i>
                Marca en que bodegas se cuenta este producto y con que unidad.
                <b>Hoy el conteo diario y el cruce operativo NO leen de aqui</b>: leen
                <i>Productos por Marca</i>. Esta parametrizacion queda guardada, pero no
                cambia el conteo hasta que se conecten las dos.
            </div>
            ${general ? `<div style="max-width:340px;margin-bottom:14px;">
                <label style="display:block;font-size:11px;font-weight:700;color:#64748b;
                              text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">
                    ${matrizEscapar(general.etiqueta)}</label>
                ${matrizControl(general, a.datos[general.columna])}</div>` : ''}
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#f8fafc;">
                    <th style="padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                               text-transform:uppercase;letter-spacing:0.05em;">Bodega</th>
                    <th style="padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                               text-transform:uppercase;letter-spacing:0.05em;">Se cuenta</th>
                    <th style="padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                               text-transform:uppercase;letter-spacing:0.05em;">Unidad de conteo</th>
                </tr></thead><tbody>${filas}</tbody></table>`;
    } else {
        cont.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">` +
            campos.map(c => `<div>
                <label style="display:block;font-size:11px;font-weight:700;color:#64748b;
                              text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">
                    ${matrizEscapar(c.etiqueta)}</label>
                ${matrizControl(c, a.datos[c.columna])}</div>`).join('') + `</div>`;
    }

    // El texto del checkbox sigue al checkbox
    cont.querySelectorAll('input[type=checkbox][data-columna]').forEach(chk => {
        chk.addEventListener('change', () => {
            const etiqueta = chk.parentElement.querySelector('span');
            if (etiqueta) etiqueta.textContent = chk.checked ? 'Si' : 'No';
        });
    });
}

async function matrizGuardarFicha() {
    const a = matrizEstado.abierto;
    if (!a) return;
    matrizGuardarVisible();

    const cuerpo = { usuario: matrizUsuario() };
    matrizEstado.campos.forEach(c => {
        if (c.grupo === 'auditoria') return;
        if (c.columna === 'codigo' && !a.esNuevo) return;
        if (c.columna in a.datos) cuerpo[c.columna] = a.datos[c.columna];
    });

    if (a.esNuevo && !(cuerpo.codigo || '').trim()) {
        showToast('El codigo es obligatorio', 'error');
        matrizEstado.grupoActivo = 'identificacion';
        matrizPintarPestanas(); matrizPintarGrupo();
        return;
    }

    const btn = document.getElementById('matriz-btn-guardar');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

    try {
        const url = a.esNuevo
            ? `${CONFIG.API_URL}/api/matriz/productos`
            : `${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(a.codigo)}`;
        const r = await fetch(url, {
            method: a.esNuevo ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo guardar');

        // Va despues del producto a proposito: productos_por_marca exige que el
        // codigo ya exista en la matriz. Si el usuario cancela el aviso de que
        // lo va a sacar del conteo, el producto igual quedo guardado.
        const cod = a.esNuevo ? (cuerpo.codigo || '').trim() : a.codigo;
        if (cod && document.querySelector('#matriz-campos tr[data-marca]')) {
            await matrizGuardarConteo(cod);
        }
        // Los datos del proveedor van a SU tabla, no a la del producto
        await matrizGuardarProveedor();

        showToast(a.esNuevo ? 'Producto creado' : 'Cambios guardados', 'success');
        matrizCerrarFicha();
        if (a.esNuevo) matrizEstado.catalogos = null;   // pudo aparecer categoria nueva
        matrizCargar();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Guardar'; }
    }
}


// ------------------------------------------------------------ borrar

async function matrizBorrar(codigo) {
    if (!matrizEsAdmin()) {
        showToast('Solo un administrador puede borrar productos', 'error');
        return;
    }

    // Primero se mira donde esta usado: borrar deja huerfano al historico
    let usos = [];
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}/uso`);
        const d = await r.json();
        if (d.success) usos = d.usos;
    } catch (e) { /* si falla, el backend vuelve a revisar antes de borrar */ }

    if (usos.length) {
        const detalle = usos.map(u => `• ${u.donde}: ${u.registros}`).join('\n');
        alert(`No se puede borrar ${codigo}.\n\nEsta usado en:\n${detalle}\n\n` +
              `Abrilo y ponelo en estado Inactivo: deja de ofrecerse y el historico ` +
              `sigue teniendo a que apuntar.`);
        return;
    }

    // Se nombra el producto, no solo el codigo: el codigo suelto no dice nada y
    // asi se ve si el click cayo en la fila equivocada.
    const fila = matrizEstado.productos.find(x => x.codigo === codigo) || {};
    const nombre = fila.nombre_producto || '(sin nombre)';

    if (!confirm(`BORRAR DEFINITIVAMENTE\n\n` +
                 `${codigo}  ${nombre}\n\n` +
                 `Desaparece de la matriz y no se puede recuperar.\n\n` +
                 `Si lo que queres es que deje de usarse, cancela esto, ` +
                 `abri el producto y ponelo en estado Inactivo.`)) return;

    // Escribir el codigo obliga a mirar cual es. Un OK de mas no alcanza.
    const tecleado = prompt(`Para confirmar, escribi el codigo del producto:\n\n${codigo}`);
    if (tecleado === null) return;
    if ((tecleado || '').trim().toUpperCase() !== codigo.toUpperCase()) {
        showToast('El codigo no coincide. No se borro nada.', 'error');
        return;
    }

    const clave = prompt('Tu contrasena de administrador para confirmar:');
    if (!clave) return;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_user: matrizUsuario(), admin_pass: clave }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo borrar');
        showToast(`Producto ${codigo} borrado`, 'success');
        matrizCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}


// ===========================================================================
// SINCRONIZAR CON CONTIFICO
//
// Contifico es donde nacen los productos. La matriz es el maestro de
// inventario: ademas del nombre y el precio guarda conteo por bodega,
// equivalencias, tipo A/B/C y proveedor, que Contifico no tiene.
//
// Por eso esto no copia una base en la otra. Trae lo que las dos comparten,
// deja ver cuanto falta por llenar a mano, y NO aplica nada hasta que alguien
// marca que si. Inactivar 69 productos de golpe porque una API lo dijo es
// justo lo que no se puede deshacer despues.
//
// La revision tarda ~75 segundos (14 paginas de Contifico). El servidor la
// corre en un hilo aparte y aqui se pregunta como va cada 3 segundos.
// ===========================================================================
let matrizSyncDatos = null;
let matrizSyncReloj = null;

function matrizAbrirSync() {
    const m = document.getElementById('matriz-sync');
    if (!m) return;
    m.style.display = 'flex';
    matrizSyncRevisar();
}

function matrizCerrarSync() {
    const m = document.getElementById('matriz-sync');
    if (m) m.style.display = 'none';
    if (matrizSyncReloj) { clearInterval(matrizSyncReloj); matrizSyncReloj = null; }
}

function matrizSyncCuerpo(html) {
    const c = document.getElementById('matriz-sync-cuerpo');
    if (c) c.innerHTML = html;
}

function matrizSyncPie(texto, habilitar) {
    const p = document.getElementById('matriz-sync-pie');
    if (p) p.textContent = texto;
    const b = document.getElementById('matriz-sync-aplicar');
    if (b) b.disabled = !habilitar;
}

async function matrizSyncRevisar() {
    matrizSyncDatos = null;
    matrizSyncCuerpo(`<div style="padding:40px;text-align:center;color:#888780;">
        <i class="fas fa-spinner fa-spin" style="font-size:22px;"></i>
        <p style="margin-top:12px;" id="matriz-sync-paso">Conectando con Contifico...</p>
        <p class="mx-tenue" style="font-size:12px;">Son 14 paginas de catalogo; suele tardar poco mas de un minuto.</p>
    </div>`);
    matrizSyncPie('Revisando...', false);

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/contifico/revisar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const d = await r.json();
        if (!r.ok || !d.success) {
            matrizSyncCuerpo(`<div class="mx-vacio" style="padding:30px;">
                <p><b>${matrizEscapar(d.error || 'No se pudo iniciar la revision')}</b></p>
                ${d.detalle ? `<p class="mx-tenue">${matrizEscapar(d.detalle)}</p>` : ''}</div>`);
            matrizSyncPie('No se pudo revisar', false);
            return;
        }
    } catch (e) {
        matrizSyncCuerpo(`<div class="mx-vacio" style="padding:30px;">No se pudo contactar al servidor.</div>`);
        matrizSyncPie('Sin conexion', false);
        return;
    }

    if (matrizSyncReloj) clearInterval(matrizSyncReloj);
    matrizSyncReloj = setInterval(matrizSyncMirar, 3000);
    matrizSyncMirar();
}

async function matrizSyncMirar() {
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/contifico/estado`);
        const d = await r.json();

        if (d.estado === 'cargando') {
            const p = document.getElementById('matriz-sync-paso');
            if (p) p.textContent = (d.paso || 'Revisando') + '...';
            matrizSyncPie(`Revisando (${d.segundos || 0}s)`, false);
            return;
        }
        clearInterval(matrizSyncReloj); matrizSyncReloj = null;

        if (d.estado === 'error') {
            matrizSyncCuerpo(`<div class="mx-vacio" style="padding:30px;">
                <p><b>La revision fallo</b></p>
                <p class="mx-tenue">${matrizEscapar(d.error || '')}</p></div>`);
            matrizSyncPie('Fallo', false);
            return;
        }
        if (d.estado === 'listo' && d.resultado) {
            matrizSyncDatos = d.resultado;
            matrizPintarSync(d.segundos);
        }
    } catch (e) { /* el siguiente tic reintenta */ }
}

function matrizPintarSync(segundos) {
    const r = matrizSyncDatos;
    const nuevos = r.nuevos || [];
    const cambios = r.cambios_estado || [];

    // Los de prueba se marcan pero NO se ocultan: si alguien los ve, que sepa
    // que estan ahi y que en Contifico habria que borrarlos.
    const esPrueba = n => /TEST|PRUEBA/i.test(n.codigo) || /BORRAR|PRUEBA/i.test(n.nombre);

    matrizSyncCuerpo(`
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
            <span class="mx-chip">Contifico: ${r.contifico}</span>
            <span class="mx-chip">Matriz: ${r.matriz}</span>
            <span class="mx-chip">Revisado en ${segundos || '?'}s</span>
        </div>

        <h4 style="margin:0 0 4px;font-size:14px;color:#1A3A5C;">
            Productos nuevos en Contifico (${nuevos.length})</h4>
        <p class="mx-tenue" style="font-size:12px;margin:0 0 10px;">
            Se crea el producto con lo que Contifico comparte. El resto de campos
            &mdash;conteo por bodega, equivalencias, tipo A/B/C, proveedor&mdash;
            los llenas tu despues, abriendo la ficha.</p>
        <div style="margin-bottom:8px;">
            <button type="button" class="mx-btn-ghost" data-sync-todos="nuevos">Marcar todos</button>
            <button type="button" class="mx-btn-ghost" data-sync-ninguno="nuevos">Desmarcar</button>
            <button type="button" class="mx-btn-ghost" data-sync-reales="1">Solo los que no son de prueba</button>
        </div>
        ${nuevos.length ? `
        <div style="max-height:260px;overflow:auto;border:1px solid #E8E6E0;border-radius:8px;">
        <table class="mx-tabla" style="width:100%;font-size:12.5px;">
            <thead><tr>
                <th style="width:34px;"></th><th>Codigo</th><th>Nombre</th>
                <th>Estado</th><th>Tipo</th><th style="text-align:right;">Stock</th>
                <th>Trae</th><th>Faltan</th>
            </tr></thead>
            <tbody>
            ${nuevos.map((n, i) => `
                <tr${esPrueba(n) ? ' style="opacity:.55;"' : ''}>
                    <td><input type="checkbox" class="sync-nuevo" data-codigo="${matrizEscapar(n.codigo)}"
                               data-prueba="${esPrueba(n) ? '1' : '0'}"></td>
                    <td class="mx-cod">${matrizEscapar(n.codigo)}</td>
                    <td>${matrizEscapar(n.nombre)}${esPrueba(n)
                        ? ' <span class="mx-badge" style="background:#FDF2E3;color:#BA7517;">prueba</span>' : ''}</td>
                    <td>${matrizEscapar(n.estado_contifico)}</td>
                    <td>${matrizEscapar(n.tipo_contifico)}</td>
                    <td style="text-align:right;">${matrizEscapar(String(n.stock ?? ''))}</td>
                    <td>${Object.keys(n.datos || {}).length} campos${
                        (n.dudosos || []).length
                          ? ` <span title="Valor deducido, confirmalo" style="color:#BA7517;">&#9679;</span>` : ''}</td>
                    <td class="mx-tenue">${(n.faltan || []).length}</td>
                </tr>`).join('')}
            </tbody>
        </table></div>` : '<p class="mx-vacio">Nada nuevo. La matriz esta al dia.</p>'}

        <h4 style="margin:22px 0 4px;font-size:14px;color:#1A3A5C;">
            Cambios de estado (${cambios.length})</h4>
        <p class="mx-tenue" style="font-size:12px;margin:0 0 10px;">
            Productos que en Contifico se activaron o inactivaron y aqui siguen como estaban.</p>
        <div style="margin-bottom:8px;">
            <button type="button" class="mx-btn-ghost" data-sync-todos="estados">Marcar todos</button>
            <button type="button" class="mx-btn-ghost" data-sync-ninguno="estados">Desmarcar</button>
        </div>
        ${cambios.length ? `
        <div style="max-height:240px;overflow:auto;border:1px solid #E8E6E0;border-radius:8px;">
        <table class="mx-tabla" style="width:100%;font-size:12.5px;">
            <thead><tr><th style="width:34px;"></th><th>Codigo</th><th>Nombre</th>
                       <th>En la matriz</th><th>En Contifico</th></tr></thead>
            <tbody>
            ${cambios.map(c => `
                <tr>
                    <td><input type="checkbox" class="sync-estado" data-codigo="${matrizEscapar(c.codigo)}"></td>
                    <td class="mx-cod">${matrizEscapar(c.codigo)}</td>
                    <td>${matrizEscapar(c.nombre)}</td>
                    <td>${matrizEscapar(c.estado_matriz)}</td>
                    <td><b style="color:${c.estado_contifico === 'Activo' ? '#0F6E56' : '#E24B4A'};">
                        ${matrizEscapar(c.estado_contifico)}</b></td>
                </tr>`).join('')}
            </tbody>
        </table></div>` : '<p class="mx-vacio">Ningun estado desfasado.</p>'}

        <h4 style="margin:22px 0 4px;font-size:14px;color:#1A3A5C;">
            Precios y cuentas que cambiaron (${(r.cambios_datos || []).length})</h4>
        <p class="mx-tenue" style="font-size:12px;margin:0 0 10px;">
            Productos que ya estan aqui y en Contifico tienen otro precio o
            cuenta. El nombre y la categoria no se comparan: esos se editan aqui
            con criterio propio y pisarlos seria perder trabajo.</p>
        <div style="margin-bottom:8px;">
            <button type="button" class="mx-btn-ghost" data-sync-todos="datos">Marcar todos</button>
            <button type="button" class="mx-btn-ghost" data-sync-ninguno="datos">Desmarcar</button>
            <button type="button" class="mx-btn-ghost" data-sync-reales-datos="1">Solo los que ya tenian valor</button>
        </div>
        ${(r.cambios_datos || []).length ? `
        <div style="max-height:260px;overflow:auto;border:1px solid #E8E6E0;border-radius:8px;">
        <table class="data-table mx-tabla" style="width:100%;font-size:12.5px;">
            <thead><tr>
                <th style="width:34px;"></th><th>Codigo</th><th>Producto</th><th>Que cambia</th>
            </tr></thead>
            <tbody>
            ${r.cambios_datos.map(x => `
                <tr${x.solo_huecos ? ' style="opacity:.6;"' : ''}>
                    <td><input type="checkbox" class="sync-datos"
                               data-codigo="${matrizEscapar(x.codigo)}"
                               data-hueco="${x.solo_huecos ? '1' : '0'}"></td>
                    <td class="mx-cod">${matrizEscapar(x.codigo)}</td>
                    <td>${matrizEscapar(x.nombre)}${x.solo_huecos
                        ? ' <span class="mx-badge" style="background:#F1F5F9;color:#64748b;">estaba vacio</span>' : ''}</td>
                    <td>${x.difs.map(dd => `<span style="display:inline-block;margin-right:10px;">
                            <b>${matrizEscapar(dd.campo)}</b>
                            <span class="mx-tenue">${dd.actual === null || dd.actual === '' ? '—' : matrizEscapar(String(dd.actual))}</span>
                            &rarr; ${matrizEscapar(String(dd.nuevo))}${dd.dudoso
                              ? ' <span title="Cuenta deducida, confirmala" style="color:#BA7517;">&#9679;</span>' : ''}
                          </span>`).join('')}</td>
                </tr>`).join('')}
            </tbody>
        </table></div>` : '<p class="mx-vacio">Ningun precio ni cuenta cambio.</p>'}

        ${(r.huerfanos || []).length ? `
        <p class="mx-tenue" style="font-size:12px;margin-top:18px;">
            ${r.huerfanos.length} producto(s) estan en la matriz y no en Contifico
            (${r.huerfanos.slice(0, 8).map(matrizEscapar).join(', ')}${
              r.huerfanos.length > 8 ? '...' : ''}). No se tocan: casi siempre son
            fichas viejas, no un error.</p>` : ''}
    `);

    // Sin onclick inline: los codigos viajan en data-codigo y todo se maneja
    // por delegacion, que es lo que aguanta 184 filas sin ensuciar el HTML.
    //
    // El contenedor NO se reemplaza al repintar (solo su innerHTML), asi que
    // los escuchadores se enganchan una sola vez. Sin esta marca, cada repintado
    // sumaba otro par y un clic terminaba contando varias veces.
    const cuerpo = document.getElementById('matriz-sync-cuerpo');
    if (cuerpo.dataset.enganchado === '1') { matrizSyncContar(); return; }
    cuerpo.dataset.enganchado = '1';

    cuerpo.addEventListener('click', e => {
        const t = e.target.closest('[data-sync-todos],[data-sync-ninguno],[data-sync-reales],[data-sync-reales-datos]');
        if (!t) return;
        if (t.dataset.syncReales) {
            cuerpo.querySelectorAll('.sync-nuevo').forEach(
                ch => { ch.checked = ch.dataset.prueba !== '1'; });
        } else if (t.dataset.syncRealesDatos) {
            // Los "huecos" son campos que aqui estaban vacios o en 0: llenarlos
            // no es lo mismo que cambiar un precio que ya existia.
            cuerpo.querySelectorAll('.sync-datos').forEach(
                ch => { ch.checked = ch.dataset.hueco !== '1'; });
        } else {
            const cual = t.dataset.syncTodos || t.dataset.syncNinguno;
            const marca = !!t.dataset.syncTodos;
            const clase = cual === 'nuevos' ? '.sync-nuevo'
                        : cual === 'datos' ? '.sync-datos' : '.sync-estado';
            cuerpo.querySelectorAll(clase).forEach(ch => { ch.checked = marca; });
        }
        matrizSyncContar();
    });
    cuerpo.addEventListener('change', e => {
        if (e.target.matches('.sync-nuevo,.sync-estado,.sync-datos')) matrizSyncContar();
    });

    matrizSyncContar();
}

function matrizSyncContar() {
    const n = document.querySelectorAll('.sync-nuevo:checked').length;
    const e = document.querySelectorAll('.sync-estado:checked').length;
    const p = document.querySelectorAll('.sync-datos:checked').length;
    matrizSyncPie(`${n} por crear, ${e} estado(s), ${p} precio/cuenta`, (n + e + p) > 0);
}

async function matrizAplicarSync() {
    const crear = Array.from(document.querySelectorAll('.sync-nuevo:checked'))
        .map(c => c.dataset.codigo);
    const estados = Array.from(document.querySelectorAll('.sync-estado:checked'))
        .map(c => c.dataset.codigo);
    const datos = Array.from(document.querySelectorAll('.sync-datos:checked'))
        .map(c => c.dataset.codigo);
    if (!crear.length && !estados.length && !datos.length) return;

    if (!confirm(`Se van a crear ${crear.length} producto(s), cambiar el estado de `
               + `${estados.length} y actualizar precio o cuenta en ${datos.length}. `
               + `Los creados quedan incompletos hasta que llenes el resto de `
               + `campos.\n\nContinuar?`)) return;

    const boton = document.getElementById('matriz-sync-aplicar');
    if (boton) { boton.disabled = true; boton.textContent = 'Aplicando...'; }

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/contifico/aplicar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ crear, estados, datos, usuario: matrizUsuario() })
        });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo aplicar');

        const partes = [];
        if (d.creados.length) partes.push(`${d.creados.length} creado(s)`);
        if (d.actualizados.length) partes.push(`${d.actualizados.length} estado(s) alineado(s)`);
        if ((d.refrescados || []).length) partes.push(`${d.refrescados.length} con precio/cuenta al dia`);
        if (d.fallidos.length) partes.push(`${d.fallidos.length} con problema`);
        showToast(partes.join(', ') || 'Sin cambios',
                  d.fallidos.length ? 'warning' : 'success');
        if (d.fallidos.length) console.warn('Sincronizacion, fallidos:', d.fallidos);

        matrizSyncDatos.nuevos = (matrizSyncDatos.nuevos || [])
            .filter(n => !d.creados.includes(n.codigo));
        const hechos = d.actualizados.map(a => a.codigo);
        matrizSyncDatos.cambios_estado = (matrizSyncDatos.cambios_estado || [])
            .filter(c => !hechos.includes(c.codigo));
        const puestos = (d.refrescados || []).map(x => x.codigo);
        matrizSyncDatos.cambios_datos = (matrizSyncDatos.cambios_datos || [])
            .filter(x => !puestos.includes(x.codigo));
        matrizPintarSync('—');
        matrizCargar();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (boton) { boton.disabled = false; boton.textContent = 'Aplicar lo seleccionado'; }
    }
}


// ===========================================================================
// PESTAÑA "CONTEO DIARIO"  ->  goti.productos_por_marca
//
// Es la tabla que de verdad mueve la operacion: de ahi salen los productos que
// la gente cuenta cada dia y los que entran al cruce operativo. La pestaña
// "Conteo x bodega" es otra cosa (los flags de la matriz, todavia sin
// conectar), y por eso los numeros no coinciden.
//
// Se edita desde aqui para no tener que abrir otro panel, pero nada se copia
// solo desde los flags: quitar la marca BORRA la fila y el producto deja de
// pedirse manana. Por eso el destildado pide confirmacion.
// ===========================================================================
const MATRIZ_MARCAS_ETIQUETA = {
    CHIOS: 'Chios (los 3 locales)',
    CACHON: 'Santo Cachon',
    SIMON_BOLON: 'Simon Bolon',
    PLANTA: 'Planta de Produccion',
    BODEGA_PRINCIPAL: 'Bodega Principal',
    MATERIA_PRIMA: 'Bodega Materia Prima',
};
const MATRIZ_TIPO_AYUDA = {
    diario: 'Se cuenta todos los dias',
    cruce: 'Entra al cruce operativo contra Contifico',
    fijo: 'Siempre cae en la muestra del dia',
    variable: 'Entra en la seleccion aleatoria del dia',
};

let matrizConteo = null;      // { filas, tipos, unidades }

async function matrizCargarConteo(codigo) {
    matrizConteo = null;
    try {
        const r = await fetch(
            `${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}/conteo`);
        const d = await r.json();
        if (d.success) matrizConteo = d;
    } catch (e) { /* se dibuja el aviso de que no se pudo leer */ }
}

function matrizPintarConteoDiario() {
    const cont = document.getElementById('matriz-campos');
    const a = matrizEstado.abierto;
    if (!cont || !a) return;

    if (a.esNuevo) {
        cont.innerHTML = `<div class="mx-vacio" style="padding:30px;">
            Primero guarda el producto. Despues puedes decidir en que conteos entra.</div>`;
        return;
    }
    if (!matrizConteo) {
        cont.innerHTML = `<div class="mx-vacio" style="padding:30px;">
            No se pudo leer la parametrizacion de conteo.</div>`;
        return;
    }

    const tipos = matrizConteo.tipos || [];
    const unidades = matrizConteo.unidades || [];
    const sel = `padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;
                 font-size:12.5px;width:100%;background:#fff;color:#0f172a;cursor:pointer;`;

    const filas = (matrizConteo.filas || []).map(f => `
        <tr style="border-bottom:1px solid #f1f5f9;${f.participa ? '' : 'opacity:.5;'}"
            data-marca="${matrizEscapar(f.marca)}">
            <td style="padding:6px 10px;font-size:12px;font-weight:600;color:#334155;">
                ${matrizEscapar(MATRIZ_MARCAS_ETIQUETA[f.marca] || f.marca)}</td>
            <td style="padding:6px 10px;width:80px;">
                <input type="checkbox" class="cd-participa" ${f.participa ? 'checked' : ''}
                       style="width:17px;height:17px;cursor:pointer;accent-color:#1d4ed8;"></td>
            <td style="padding:6px 10px;">
                <select class="cd-tipo" style="${sel}">
                    ${tipos.map(t => `<option value="${t}"${t === f.tipo_conteo ? ' selected' : ''}>${t}</option>`).join('')}
                </select></td>
            <td style="padding:6px 10px;">
                <select class="cd-unidad" style="${sel}">
                    <option value="">— sin definir —</option>
                    ${unidades.map(u => `<option value="${matrizEscapar(u)}"${u === f.unidad ? ' selected' : ''}>${matrizEscapar(u)}</option>`).join('')}
                </select></td>
            <td style="padding:6px 10px;width:110px;">
                <input type="text" class="cd-equiv" value="${f.equivalencia === null || f.equivalencia === undefined ? '' : matrizEscapar(String(f.equivalencia))}"
                       placeholder="1" style="${sel}cursor:text;text-align:right;"></td>
            <td style="padding:6px 10px;width:80px;">
                <input type="checkbox" class="cd-activo" ${f.activo ? 'checked' : ''}
                       style="width:17px;height:17px;cursor:pointer;accent-color:#1d4ed8;"></td>
        </tr>`).join('');

    const th = `padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                text-transform:uppercase;letter-spacing:0.05em;`;

    cont.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;
                    margin-bottom:14px;font-size:11.5px;color:#1e40af;line-height:1.5;">
            <i class="fas fa-circle-info"></i>
            <b>Esto si mueve la operacion.</b> De aqui salen los productos que la gente
            cuenta cada dia y los que entran al cruce operativo.
            Destildar una marca <b>quita</b> el producto de ese conteo desde manana.
        </div>
        <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;">
                <th style="${th}">Marca / bodega</th>
                <th style="${th}">Entra</th>
                <th style="${th}">Tipo de conteo</th>
                <th style="${th}">Unidad</th>
                <th style="${th}">Equivalencia</th>
                <th style="${th}">Activo</th>
            </tr></thead><tbody>${filas}</tbody></table>
        <p class="mx-tenue" style="font-size:11.5px;margin-top:12px;line-height:1.6;">
            ${Object.entries(MATRIZ_TIPO_AYUDA).map(([k, v]) =>
                `<b>${k}</b>: ${v}`).join(' &middot; ')}
        </p>`;

    // La fila se apaga o enciende al vuelo, para que se vea que quedo fuera
    cont.querySelectorAll('.cd-participa').forEach(ch => {
        ch.addEventListener('change', () => {
            const tr = ch.closest('tr');
            if (tr) tr.style.opacity = ch.checked ? '' : '.5';
        });
    });
}

/* Lo que la pestaña va a mandar. Se lee del DOM en el momento de guardar: la
   ficha no guarda copia de estas filas porque no son columnas del producto. */
function matrizConteoDelDom() {
    const filas = {};
    document.querySelectorAll('#matriz-campos tr[data-marca]').forEach(tr => {
        const g = c => tr.querySelector(c);
        filas[tr.getAttribute('data-marca')] = {
            participa: g('.cd-participa').checked,
            tipo_conteo: g('.cd-tipo').value,
            unidad: g('.cd-unidad').value,
            equivalencia: g('.cd-equiv').value,
            activo: g('.cd-activo').checked,
        };
    });
    return filas;
}

async function matrizGuardarConteo(codigo) {
    const filas = matrizConteoDelDom();
    if (!Object.keys(filas).length) return true;     // no se abrio la pestaña

    const quitadas = (matrizConteo.filas || [])
        .filter(f => f.participa && filas[f.marca] && !filas[f.marca].participa)
        .map(f => MATRIZ_MARCAS_ETIQUETA[f.marca] || f.marca);
    if (quitadas.length && !confirm(
            `Vas a sacar este producto del conteo de:\n\n  ${quitadas.join('\n  ')}\n\n`
          + `Desde manana deja de pedirse ahi. Continuar?`)) {
        return false;
    }

    const r = await fetch(
        `${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}/conteo`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas, usuario: matrizUsuario() })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'No se pudo guardar el conteo');
    return true;
}



// ===========================================================================
// PESTAÑA PROVEEDOR  ->  public.fc_proveedores
//
// UNA sola tabla de proveedores en todo el sistema: la misma que usa Flujo de
// Caja. Lo que se corrige aqui se ve alla, y al reves.
//
// El producto guarda solo a QUIEN le compra. RUC, telefono, contacto y
// condiciones de pago son del proveedor y se guardan una vez, no copiados en
// cada uno de sus productos.
// ===========================================================================
let matrizProveedores = null;     // catalogo completo
let matrizProvEditado = null;     // proveedor cuyos datos se tocaron
let matrizProvReloj = null;       // para no consultar en cada tecla

async function matrizCargarProveedores() {
    if (matrizProveedores) return;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores`);
        const d = await r.json();
        matrizProveedores = d.success ? d.proveedores : [];
    } catch (e) { matrizProveedores = []; }
}

function matrizProvPorNombre(nombre) {
    const n = (nombre || '').trim().toUpperCase();
    return (matrizProveedores || []).find(
        p => (p.nombre || '').trim().toUpperCase() === n) || null;
}

/* Campos del proveedor: etiqueta, columna y ancho. `telefono` y no
   `celular_principal`: asi se llama en fc_proveedores. */
const MATRIZ_PROV_TIPOS = ['RECURRENTE', 'EVENTUAL'];
const MATRIZ_PROV_CRITICIDAD = ['BAJO', 'MEDIO', 'ALTO', 'CRITICO'];

// [etiqueta, columna, ayuda, opciones]. Con opciones se dibuja un desplegable.
const MATRIZ_PROV_CAMPOS = [
    ['RUC', 'ruc', '10 o 13 digitos'],
    ['Razon social', 'razon_social', 'nombre legal del SRI'],
    ['Nombre comercial', 'nombre_comercial', ''],
    ['Telefono', 'telefono', ''],
    ['Celular secundario', 'celular_secundario', ''],
    ['Contacto', 'nombre_contacto', ''],
    ['Correo', 'correo', ''],
    ['Tipo de proveedor', 'tipo_proveedor', '', MATRIZ_PROV_TIPOS],
    ['Criticidad', 'criticidad', '', MATRIZ_PROV_CRITICIDAD],
    ['Dias de credito', 'dias_credito', '0'],
];

// Dia de recepcion / despacho: es el MISMO dato y se elige, no se escribe.
// Se guarda como 'Martes/Miercoles', que es el formato que la tabla ya tenia.
const MATRIZ_DIAS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes',
                     'Sabado', 'Domingo'];
// Los que no entregan en dias fijos. Va DENTRO de la caja de los dias: es una
// respuesta mas a la misma pregunta, no un campo aparte. 'Debito Automatico'
// estaba aqui y se quito -- es una forma de pago, no un dia.
const MATRIZ_SIN_DIA = 'Bajo solicitud';

/* Deja lo guardado con la escritura de la lista, para que una diferencia de
   mayusculas no convierta un dia normal en un valor suelto. */
function matrizNormalizarDias(valor) {
    const lista = MATRIZ_DIAS.concat([MATRIZ_SIN_DIA]);
    return String(valor || '').split('/').map(x => x.trim()).filter(Boolean)
        .map(v => lista.find(o => o.toLowerCase() === v.toLowerCase()) || v);
}

function matrizPintarProveedor() {
    const cont = document.getElementById('matriz-campos');
    const a = matrizEstado.abierto;
    if (!cont || !a) return;

    const campos = matrizEstado.campos.filter(c => c.grupo === 'proveedor');
    const elegido = (a.datos.proveedores || '').trim();
    const p = matrizProvPorNombre(elegido);
    const inp = `padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;
                 font-size:13px;width:100%;background:#fff;color:#0f172a;`;
    const etq = `display:block;font-size:11px;font-weight:700;color:#64748b;
                 text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;`;

    const buscador = `
        <div style="max-width:520px;margin-bottom:6px;position:relative;">
            <label style="${etq}">Proveedor</label>
            <input type="text" id="matriz-prov-q" autocomplete="off"
                   placeholder="Escribe el nombre o el RUC..."
                   value="${matrizEscapar(elegido)}" style="${inp}">
            <div id="matriz-prov-lista" style="display:none;position:absolute;z-index:40;
                 left:0;right:0;background:#fff;border:1px solid #cbd5e1;border-radius:8px;
                 margin-top:3px;max-height:260px;overflow:auto;
                 box-shadow:0 10px 24px rgba(18,52,80,.16);"></div>
        </div>`;

    const ficha = !elegido ? `
        <div class="mx-vacio" style="padding:22px;">
            Busca un proveedor y aqui apareceran sus datos.</div>`
      : !p ? `
        <div class="mx-vacio" style="padding:22px;">
            <b>${matrizEscapar(elegido)}</b> no esta en la base de proveedores.</div>`
      : `
        <div style="background:#F8FAFC;border:1px solid rgba(203,213,225,0.30);
                    border-radius:12px;padding:16px 18px;margin-bottom:18px;">
            <p style="margin:0 0 12px;font-size:11.5px;color:#64748b;">
                <i class="fas fa-circle-info"></i>
                Estos datos son del proveedor, no de este producto. Se guardan en
                la base de proveedores y los usa tambien <b>Flujo de Caja</b>.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;">
                ${MATRIZ_PROV_CAMPOS.map(([lbl, col, ph, ops]) => {
                    const val = (p[col] === null || p[col] === undefined) ? '' : String(p[col]);
                    if (ops && ops.length) {
                        // Lo guardado que no este en la lista se muestra igual,
                        // para no pisarlo sin avisar al primer guardado.
                        const fuera = val && ops.indexOf(val) === -1;
                        return `<div><label style="${etq}">${lbl}</label>
                            <select data-prov="${col}" style="${inp}cursor:pointer;">
                                <option value=""${val ? '' : ' selected'}>— sin definir —</option>
                                ${fuera ? `<option value="${matrizEscapar(val)}" selected>${matrizEscapar(val)} (valor actual)</option>` : ''}
                                ${ops.map(o => `<option value="${o}"${o === val ? ' selected' : ''}>${o}</option>`).join('')}
                            </select></div>`;
                    }
                    return `<div><label style="${etq}">${lbl}</label>
                        <input type="text" data-prov="${col}"
                               value="${matrizEscapar(val)}"
                               ${ph ? `placeholder="${matrizEscapar(ph)}"` : ''}
                               style="${inp}"></div>`;
                }).join('')}
            </div>
            ${matrizDiasDespacho(p.dia_despacho)}
        </div>`;

    const delProducto = campos.filter(c => c.columna !== 'proveedores');
    cont.innerHTML = buscador + ficha + `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">
            ${delProducto.map(c => `<div>
                <label style="${etq}">${matrizEscapar(c.etiqueta)}</label>
                ${matrizControl(c, a.datos[c.columna])}</div>`).join('')}
        </div>`;

    matrizEngancharBuscadorProv();
    cont.querySelectorAll('[data-prov]').forEach(el => {
        const marcar = () => { matrizProvEditado = elegido; };
        el.addEventListener('input', marcar);
        el.addEventListener('change', marcar);
    });

    matrizEngancharDias(elegido);
}

/* Las casillas de dia de recepcion/despacho. Se dibujan dentro de la ficha del
   proveedor porque el dato es suyo: el dia que despacha es el dia que se
   recibe, y es igual para todos sus productos. */
function matrizDiasDespacho(valor) {
    const guardado = matrizNormalizarDias(valor);
    // Lo guardado que no sea un dia ni 'Bajo solicitud': se respeta, no se ofrece
    const sueltos = guardado.filter(
        v => MATRIZ_DIAS.indexOf(v) === -1 && v !== MATRIZ_SIN_DIA);
    return `
        <div style="margin-top:14px;border-top:1px solid rgba(203,213,225,0.45);
                    padding-top:12px;max-width:300px;">
            <label style="display:block;font-size:11px;font-weight:700;color:#64748b;
                          text-transform:uppercase;letter-spacing:0.04em;margin-bottom:7px;">
                Dia de recepcion / despacho</label>
            <div id="matriz-dias" style="border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;max-height:190px;overflow-y:auto;overflow-x:hidden;background:#fff;">
                ${MATRIZ_DIAS.map(dd => `
                    <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 0;cursor:pointer;font-size:12.5px;color:#334155;line-height:1.35;">
                        <input type="checkbox" class="mx-dia" value="${dd}"
                               ${guardado.indexOf(dd) !== -1 ? 'checked' : ''}
                               style="width:15px;height:15px;cursor:pointer;accent-color:#1d4ed8;flex:0 0 auto;margin-top:1px;">
                        <span style="min-width:0;overflow-wrap:anywhere;">${dd}</span></label>`).join('')}
                <div style="border-top:1px solid rgba(203,213,225,0.7);margin:6px 0 3px;"></div>
                <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 0;cursor:pointer;font-size:12.5px;color:#334155;line-height:1.35;">
                    <input type="checkbox" class="mx-nodia" value="${MATRIZ_SIN_DIA}"
                           ${guardado.indexOf(MATRIZ_SIN_DIA) !== -1 ? 'checked' : ''}
                           style="width:15px;height:15px;cursor:pointer;accent-color:#1d4ed8;flex:0 0 auto;margin-top:1px;">
                    <span style="min-width:0;overflow-wrap:anywhere;">${MATRIZ_SIN_DIA}</span></label>
                ${sueltos.map(v => `
                    <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 0;cursor:pointer;font-size:12.5px;color:#64748b;line-height:1.35;">
                        <input type="checkbox" class="mx-nodia" value="${matrizEscapar(v)}" checked
                               style="width:15px;height:15px;cursor:pointer;accent-color:#94a3b8;flex:0 0 auto;margin-top:1px;">
                        <span style="min-width:0;overflow-wrap:anywhere;">
                            ${matrizEscapar(v)} <i style="font-size:11px;">(valor actual)</i></span></label>`).join('')}
            </div>
            <div style="margin-top:9px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span class="mx-tenue" style="font-size:11.5px;">
                    Queda como <b id="matriz-dias-vista">${matrizEscapar(valor || '—')}</b></span>
            </div>
            <input type="hidden" data-prov="dia_despacho" value="${matrizEscapar(valor || '')}">
        </div>`;
}

function matrizEngancharDias(elegido) {
    const cont = document.getElementById('matriz-dias');
    const oculto = document.querySelector('[data-prov="dia_despacho"]');
    const vista = document.getElementById('matriz-dias-vista');
    if (!cont || !oculto) return;

    const recalcular = () => {
        // En el orden en que estan dibujadas, que es el de la semana: asi sale
        // 'Lunes/Miercoles' y nunca 'Miercoles/Lunes'.
        oculto.value = Array.from(
            cont.querySelectorAll('input[type=checkbox]:checked'))
            .map(x => x.value).join('/');
        if (vista) vista.textContent = oculto.value || '—';
        matrizProvEditado = elegido;
    };

    // Dias fijos y 'sin dia fijo' son excluyentes: marcar uno apaga al otro
    cont.addEventListener('change', ev => {
        const t = ev.target;
        if (!t || t.type !== 'checkbox') return;
        if (t.checked && t.classList.contains('mx-nodia')) {
            cont.querySelectorAll('input[type=checkbox]').forEach(
                ch => { if (ch !== t) ch.checked = false; });
        } else if (t.checked && t.classList.contains('mx-dia')) {
            cont.querySelectorAll('.mx-nodia').forEach(ch => { ch.checked = false; });
        }
        recalcular();
    });
}

function matrizEngancharBuscadorProv() {
    const caja = document.getElementById('matriz-prov-q');
    const lista = document.getElementById('matriz-prov-lista');
    if (!caja || !lista) return;

    const buscar = async () => {
        const q = caja.value.trim();
        if (q.length < 2) { lista.style.display = 'none'; return; }
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores/buscar?`
                                + new URLSearchParams({ q }));
            const d = await r.json();
            if (!d.success || !d.proveedores.length) {
                lista.innerHTML = `<div style="padding:10px 12px;color:#888780;font-size:12.5px;">
                    Sin coincidencias</div>`;
                lista.style.display = 'block';
                return;
            }
            lista.innerHTML = d.proveedores.map((x, i) => `
                <div data-idx="${i}" style="padding:8px 12px;cursor:pointer;font-size:12.5px;
                     border-bottom:1px solid #f1f5f9;${x.registrado ? '' : 'background:#FFFBEB;'}">
                    <div style="color:#1A3A5C;font-weight:600;">${matrizEscapar(x.nombre || '')}</div>
                    ${x.razon_social && x.razon_social.trim().toUpperCase() !== (x.nombre || '').trim().toUpperCase()
                      ? `<div class="mx-tenue" style="font-size:11.5px;">${matrizEscapar(x.razon_social)}</div>` : ''}
                    <div class="mx-tenue" style="font-size:11.5px;">
                        ${matrizEscapar(x.ruc || 'sin RUC')}${x.registrado ? ''
                          : ` &middot; <span style="color:#BA7517;">del SRI, ${x.facturas} factura(s), sin registrar</span>`}
                    </div>
                </div>`).join('');
            lista.style.display = 'block';
            lista._datos = d.proveedores;
        } catch (e) { lista.style.display = 'none'; }
    };

    // Se espera a que deje de escribir: sin esto seria una consulta por tecla.
    caja.addEventListener('input', () => {
        if (matrizProvReloj) clearTimeout(matrizProvReloj);
        matrizProvReloj = setTimeout(buscar, 250);
    });
    caja.addEventListener('focus', buscar);

    lista.addEventListener('mousedown', async e => {
        const fila = e.target.closest('[data-idx]');
        if (!fila) return;
        e.preventDefault();
        const x = (lista._datos || [])[parseInt(fila.dataset.idx, 10)];
        if (!x) return;

        // Uno del SRI todavia no existe como proveedor: se da de alta con lo
        // que el SRI ya sabe, y el resto lo completa una persona.
        if (!x.registrado) {
            if (!confirm(`${x.nombre}\n\nNo esta en la base de proveedores. `
                       + `Crearlo con el RUC ${x.ruc || '(sin RUC)'}?`)) return;
            const r = await fetch(`${CONFIG.API_URL}/api/matriz/proveedores`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: x.nombre, ruc: x.ruc })
            });
            const d = await r.json();
            if (!d.success) { showToast(d.error || 'No se pudo crear', 'error'); return; }
            showToast('Proveedor creado', 'success');
        }
        matrizProveedores = null;
        await matrizCargarProveedores();
        matrizEstado.abierto.datos.proveedores = x.nombre;
        lista.style.display = 'none';
        matrizPintarProveedor();
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('#matriz-prov-q,#matriz-prov-lista')) {
            lista.style.display = 'none';
        }
    });
}

/* Los datos del proveedor van a SU tabla. Es la misma que lee Flujo de Caja,
   asi que una correccion aqui se ve alla sin copiar nada. */
async function matrizGuardarProveedor() {
    if (!matrizProvEditado) return true;
    const cuerpo = {};
    document.querySelectorAll('#matriz-campos [data-prov]').forEach(el => {
        cuerpo[el.getAttribute('data-prov')] = el.value;
    });
    const r = await fetch(
        `${CONFIG.API_URL}/api/matriz/proveedores/${encodeURIComponent(matrizProvEditado)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'No se pudo guardar el proveedor');
    matrizProveedores = null;
    matrizProvEditado = null;
    return true;
}
