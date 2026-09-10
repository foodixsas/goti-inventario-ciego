// Retenciones: se valida el RUC contra el SRI en vivo y se calcula la retencion.
//
// No hay tabla de RUCs ni scraping: cada consulta pega al catastro publico del
// SRI. Por eso la ficha siempre muestra la fecha en que el SRI actualizo ese
// contribuyente -- es el dato con el que se esta trabajando.

const retEstado = {
    conceptos: null,
    datos: null,      // el contribuyente consultado
    ruc: '',
};

function retEsc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function retMoneda(n) {
    return (n === null || n === undefined || isNaN(n))
        ? '—'
        : '$' + Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2 });
}


// ------------------------------------------------------------ arranque

let _retEnganchado = false;

async function retInit() {
    if (!retEstado.conceptos) {
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/sri/conceptos`);
            const d = await r.json();
            retEstado.conceptos = d.success ? d.conceptos : [];
            retLlenarConceptos();
            retPintarReferencia();
        } catch (e) {
            retEstado.conceptos = [];
        }
    }
    retEnganchar();
}

function retLlenarConceptos() {
    const sel = document.getElementById('ret-concepto');
    if (!sel) return;
    // Agrupados como en la resolucion, para no buscar entre 19 sueltos
    const grupos = {};
    retEstado.conceptos.forEach(c => {
        (grupos[c.grupo] = grupos[c.grupo] || []).push(c);
    });
    sel.innerHTML = '<option value="">Elegir concepto...</option>' +
        Object.keys(grupos).map(g =>
            `<optgroup label="${retEsc(g)}">` +
            grupos[g].map(c =>
                `<option value="${retEsc(c.codigo)}" data-tipo="${retEsc(c.tipo)}"
                         data-pct="${c.pct_ir}">${retEsc(c.codigo)} · ${retEsc(c.descripcion)}</option>`
            ).join('') +
            '</optgroup>').join('');
}

// Tabla de consulta: los 19 conceptos con su % de IR, sin tener que abrir el
// desplegable ni acordarse de los codigos.
function retPintarReferencia() {
    const caja = document.getElementById('ret-referencia');
    if (!caja || !retEstado.conceptos) return;

    const grupos = {};
    retEstado.conceptos.forEach(c => {
        (grupos[c.grupo] = grupos[c.grupo] || []).push(c);
    });

    caja.innerHTML = Object.keys(grupos).map(g => `
        <div class="fd-card" style="padding:0;">
            <div style="padding:11px 16px;border-bottom:1px solid var(--line);
                        font-size:12px;font-weight:700;color:var(--primary);">
                ${retEsc(g)}</div>
            ${grupos[g].map(c => `
                <div class="ret-ref-fila">
                    <span class="fd-mono" style="font-size:11px;">${retEsc(c.codigo)}</span>
                    <span style="flex:1;">${retEsc(c.descripcion)}</span>
                    <b style="color:var(--action);">${c.pct_ir}%</b>
                </div>`).join('')}
        </div>`).join('');
}

function retEnganchar() {
    if (_retEnganchado) return;
    _retEnganchado = true;

    const campo = document.getElementById('ret-ruc');
    if (campo) {
        campo.addEventListener('input', () => {
            campo.value = campo.value.replace(/\D/g, '');
        });
        campo.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') retConsultar();
        });
    }
    const sel = document.getElementById('ret-concepto');
    if (sel) sel.addEventListener('change', retConceptoElegido);

    ['ret-subtotal', 'ret-iva', 'ret-tipo-compra'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', retCalcular);
    });
}

// Los conceptos marcados 'ambos' no dicen si es bien o servicio: lo elige quien
// carga, y de eso depende si el IVA va 30 o 70.
function retConceptoElegido() {
    const sel = document.getElementById('ret-concepto');
    const caja = document.getElementById('ret-caja-tipo');
    const chapa = document.getElementById('ret-chapa');
    if (!sel) return;

    const opcion = sel.options[sel.selectedIndex];
    const tipo = opcion ? opcion.getAttribute('data-tipo') : '';
    const pct = opcion ? opcion.getAttribute('data-pct') : null;

    if (caja) caja.style.display = tipo === 'ambos' ? '' : 'none';

    // El % de IR a la vista antes de calcular: es el dato que se quiere
    // confirmar al elegir el concepto.
    if (chapa) {
        if (pct === null || !sel.value) {
            chapa.style.display = 'none';
        } else {
            chapa.style.display = '';
            chapa.innerHTML = `<span class="ret-chapa-pct">${pct}%</span>
                <span>de retencion de renta sobre el subtotal</span>`;
        }
    }
    retCalcular();
}

// El IVA de la factura casi siempre es el 15% del subtotal; se ofrece calcularlo
// en vez de obligar a sacarlo aparte.
function retIva15() {
    const sub = parseFloat((document.getElementById('ret-subtotal') || {}).value) || 0;
    const iva = document.getElementById('ret-iva');
    if (!iva) return;
    iva.value = (Math.round(sub * 15) / 100).toFixed(2);
    retCalcular();
}


// ------------------------------------------------------------ consulta

async function retConsultar() {
    const ruc = (document.getElementById('ret-ruc') || {}).value || '';
    const ficha = document.getElementById('ret-ficha');
    if (!ficha) return;

    if (ruc.trim().length !== 13) {
        ficha.innerHTML = `<div class="fd-error">El RUC tiene que ser de 13 digitos.</div>`;
        retEstado.datos = null;
        retPintarCalculo(null);
        return;
    }

    ficha.innerHTML = `<div class="fd-vacio">Consultando al SRI...</div>`;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/validar-ruc/${encodeURIComponent(ruc.trim())}`);
        const d = await r.json();
        if (!d.success) {
            retEstado.datos = null;
            ficha.innerHTML = `<div class="fd-error">${retEsc(d.error)}</div>`;
            retPintarCalculo(null);
            return;
        }
        retEstado.datos = d.datos;
        retEstado.ruc = ruc.trim();
        retPintarFicha(d);
        retAplicarSugerencia(d.sugerencia);
        retCalcular();
    } catch (e) {
        retEstado.datos = null;
        ficha.innerHTML = `<div class="fd-error">No se pudo consultar: ${retEsc(e.message)}</div>`;
    }
}

// En RIMPE el concepto lo define el regimen, no lo que se compro: a un Negocio
// Popular no se le retiene nada y a un Emprendedor se le retiene 1%. Como en la
// factura los dos dicen solo "RIMPE", es facil elegir el que no era -- y
// retenerle a un Negocio Popular es una retencion indebida. Por eso se
// preselecciona y se avisa.
function retAplicarSugerencia(sug) {
    const caja = document.getElementById('ret-sugerencia');
    const sel = document.getElementById('ret-concepto');
    if (!caja) return;

    if (!sug) { caja.style.display = 'none'; return; }

    caja.style.display = '';
    if (sug.codigo && sel) {
        sel.value = sug.codigo;
        retConceptoElegido();
        caja.className = 'ret-sugerencia';
        caja.innerHTML = `<b>Concepto elegido automaticamente:</b> ${retEsc(sug.motivo)}.
            Se puede cambiar si corresponde otra cosa.`;
    } else {
        caja.className = 'ret-sugerencia ret-sugerencia-duda';
        caja.innerHTML = retEsc(sug.motivo);
    }
}

function retDato(etiqueta, valor, resaltar) {
    return `<div>
        <div class="ret-etiqueta">${retEsc(etiqueta)}</div>
        <div class="ret-valor${resaltar ? ' ret-fuerte' : ''}">${retEsc(valor) || '—'}</div>
    </div>`;
}

function retSiNo(etiqueta, valor) {
    const si = (valor || '').toUpperCase() === 'SI';
    return `<div>
        <div class="ret-etiqueta">${retEsc(etiqueta)}</div>
        <div><span class="fd-badge ${si ? 'fd-badge-ok' : 'fd-badge-mal'}">${si ? 'Si' : 'No'}</span></div>
    </div>`;
}

function retPintarFicha(d) {
    const p = d.datos;
    const ficha = document.getElementById('ret-ficha');

    const avisos = (d.alertas || []).map(a =>
        `<div class="${a.nivel === 'critico' ? 'ret-critico' : 'ret-alerta'}">
            ${retEsc(a.texto)}</div>`).join('');

    ficha.innerHTML = `
        ${avisos}
        <div class="fd-card" style="padding:18px;">
            <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                <span style="font-size:17px;font-weight:600;color:var(--primary);">
                    ${retEsc(p.razon_social)}</span>
                <span class="fd-badge ${d.activo ? 'fd-badge-ok' : 'fd-badge-mal'}">
                    ${retEsc(p.estado)}</span>
                <span class="fd-mono">${retEsc(p.ruc)}</span>
            </div>
            <div class="ret-grid">
                ${retDato('Tipo de contribuyente', p.tipo_persona)}
                ${retDato('Regimen', p.regimen_completo || p.regimen, true)}
                ${retSiNo('Contribuyente especial', p.contribuyente_especial)}
                ${retSiNo('Agente de retencion', p.agente_retencion)}
                ${retSiNo('Obligado a contabilidad', p.obligado_contabilidad)}
                ${retDato('Representante legal', p.representante_legal)}
                ${retDato('Inicio de actividades', (p.fecha_inicio_actividades || '').slice(0, 10))}
                ${retDato('El SRI lo actualizo', (p.fecha_sri_actualizacion || '').slice(0, 10))}
            </div>
            <div style="margin-top:14px;">
                <div class="ret-etiqueta">Actividad economica</div>
                <div class="ret-valor" style="line-height:1.45;">${retEsc(p.actividad_economica)}</div>
            </div>
        </div>`;
}


// ------------------------------------------------------------ calculo

async function retCalcular() {
    const salida = document.getElementById('ret-calculo');
    if (!salida) return;
    if (!retEstado.datos) { retPintarCalculo(null); return; }

    const val = id => (document.getElementById(id) || {}).value || '';
    const concepto = val('ret-concepto');
    if (!concepto) { retPintarCalculo(null); return; }

    const cuerpo = {
        ruc: retEstado.ruc,
        concepto_cod: concepto,
        subtotal: val('ret-subtotal') || 0,
        iva_valor: val('ret-iva') || 0,
        tipo_compra: val('ret-tipo-compra'),
    };

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/calcular`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
        });
        const d = await r.json();
        if (!d.success) {
            salida.innerHTML = `<div class="fd-error">${retEsc(d.error)}</div>`;
            return;
        }
        retPintarCalculo(d.calculo);
    } catch (e) {
        salida.innerHTML = `<div class="fd-error">${retEsc(e.message)}</div>`;
    }
}

function retPintarCalculo(c) {
    const salida = document.getElementById('ret-calculo');
    if (!salida) return;

    if (!c) {
        salida.innerHTML = `<div class="fd-vacio">
            Consulta un RUC y elegi el concepto para ver la retencion.</div>`;
        return;
    }

    salida.innerHTML = `
        <div class="fd-card">
            <table class="fd-tabla">
                <tbody>
                    <tr><td>Subtotal</td><td class="fd-num">${retMoneda(c.subtotal)}</td></tr>
                    <tr><td>IVA</td><td class="fd-num">${retMoneda(c.iva_valor)}</td></tr>
                    <tr><td>Total de la factura</td>
                        <td class="fd-num">${retMoneda(c.total_factura)}</td></tr>
                    <tr>
                        <td>Retencion de renta
                            <span class="fd-badge fd-badge-info">${c.pct_ir}%</span></td>
                        <td class="fd-num ret-resta">− ${retMoneda(c.retencion_ir)}</td></tr>
                    <tr>
                        <td>Retencion de IVA
                            <span class="fd-badge fd-badge-info">${c.pct_iva}%</span></td>
                        <td class="fd-num ret-resta">− ${retMoneda(c.retencion_iva)}</td></tr>
                    <tr class="ret-total">
                        <td>Total a pagar al proveedor</td>
                        <td class="fd-num">${retMoneda(c.total_pagar)}</td></tr>
                </tbody>
            </table>
            <div style="padding:12px 16px;border-top:1px solid var(--line);
                        font-size:12px;color:var(--color-muted);line-height:1.5;">
                ${retEsc(c.concepto)} · compra de ${retEsc(c.tipo_compra)} ·
                total retenido ${retMoneda(c.total_retenido)}
            </div>
        </div>

        <div class="fd-aviso" style="margin-top:14px;">
            El SRI no publica quien es <b>Gran Contribuyente</b> ni <b>Exportador
            habitual de bienes</b>, asi que el calculo asume que no lo son. Si el
            proveedor es Gran Contribuyente no habria que retenerle renta, y a un
            exportador no habria que retenerle IVA. En los dos casos lo recupera
            como credito tributario.
        </div>`;
}
