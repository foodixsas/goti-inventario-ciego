// Facturas recibidas del SRI: listado, detalle de linea y el RIDE en PDF.
//
// De donde salen los datos: el XML completo de cada comprobante se guarda en
// goti.gfc_sri_comprobantes (Azure) cuando se sube el TXT del portal. El PDF no
// se almacena: el servidor lo arma al vuelo desde ese XML, asi que siempre
// coincide con lo que autorizo el SRI.
//
// Por que hay que subir un TXT y no se trae solo: el portal de comprobantes
// recibidos del SRI no tiene API -- es una app JSF con un firewall delante. El
// XML de cada comprobante SI es API publica, y eso es lo que se automatiza.
//
// Ojo con el tiempo: el SRI solo entrega el XML los primeros dias despues de la
// emision (de 5 dias en adelante devuelve vacio). Por eso conviene subir el TXT
// a diario; lo que caduco no se recupera.

const sfEstado = {
    facturas: [],
    porClave: {},
    cargando: false,
};

function sfEsc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sfMoneda(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2,
                                                     maximumFractionDigits: 2 });
}

function sfNum(n, dec) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('es-EC', { minimumFractionDigits: dec === undefined ? 2 : dec,
                                               maximumFractionDigits: dec === undefined ? 2 : dec });
}

function sfFecha(f) {
    if (!f) return '—';
    const s = String(f).slice(0, 10).split('-');
    return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(f);
}

function sfAviso(texto, tipo) {
    const c = document.getElementById('sf-aviso');
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


// ------------------------------------------------------------ arranque

let _sfEnganchado = false;

function sfInit() {
    const desde = document.getElementById('sf-desde');
    const hasta = document.getElementById('sf-hasta');
    if (desde && !desde.value) {
        // Por defecto, ayer: es el dia que ya tiene los comprobantes completos.
        const ayer = new Date();
        ayer.setDate(ayer.getDate() - 1);
        const iso = ayer.toISOString().slice(0, 10);
        desde.value = iso;
        if (hasta) hasta.value = iso;
    }
    sfEnganchar();
    sfConsultar();
}

function sfEnganchar() {
    if (_sfEnganchado) return;
    _sfEnganchado = true;

    document.getElementById('sf-btn-consultar')?.addEventListener('click', sfConsultar);
    document.getElementById('sf-buscar')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') sfConsultar();
    });

    // El boton verde solo abre el selector de archivos; la carga va en el change.
    const inputFile = document.getElementById('sf-archivo');
    document.getElementById('sf-btn-subir')?.addEventListener('click', () => inputFile?.click());
    inputFile?.addEventListener('change', () => {
        if (inputFile.files && inputFile.files[0]) sfSubirTxt(inputFile.files[0]);
    });

    document.getElementById('sf-btn-cruce')?.addEventListener('click', sfCruce);
    document.getElementById('sf-btn-directo')?.addEventListener('click', sfImportarDirecto);
    document.getElementById('sf-modal-cerrar')?.addEventListener('click', sfCerrarModal);
    document.getElementById('sf-modal')?.addEventListener('click', e => {
        if (e.target.id === 'sf-modal') sfCerrarModal();   // clic fuera de la ficha
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') sfCerrarModal();
    });
}


// ------------------------------------------------------------ listado

async function sfConsultar() {
    if (sfEstado.cargando) return;
    const desde = document.getElementById('sf-desde')?.value || '';
    const hasta = document.getElementById('sf-hasta')?.value || '';
    const buscar = document.getElementById('sf-buscar')?.value.trim() || '';

    const p = new URLSearchParams();
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    if (buscar) p.set('buscar', buscar);

    sfEstado.cargando = true;
    document.getElementById('sf-resumen').textContent = 'Consultando...';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/facturas?${p.toString()}`);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'no se pudo consultar');

        sfEstado.facturas = d.facturas || [];
        sfEstado.porClave = {};
        sfEstado.facturas.forEach(f => { sfEstado.porClave[f.clave_acceso] = f; });

        document.getElementById('sf-resumen').textContent =
            `${d.total_comprobantes} comprobantes · ${sfMoneda(d.total_importe)} · ` +
            `${d.total_lineas} lineas de detalle`;
        sfPintar();
    } catch (e) {
        document.getElementById('sf-resumen').textContent = 'Error';
        sfAviso('No se pudo traer el listado: ' + sfEsc(e.message), 'error');
    } finally {
        sfEstado.cargando = false;
    }
}

function sfPintar() {
    const cuerpo = document.getElementById('sf-cuerpo');
    if (!cuerpo) return;

    if (!sfEstado.facturas.length) {
        cuerpo.innerHTML = `<tr><td colspan="10"><div class="fd-vacio">
            No hay comprobantes guardados en ese rango. Si el dia es reciente,
            baja el TXT del portal del SRI y subilo con el boton verde.
            </div></td></tr>`;
        return;
    }

    cuerpo.innerHTML = sfEstado.facturas.map(f => `
        <tr>
            <td style="max-width:280px;">${sfEsc(f.razon_social_emisor)}</td>
            <td style="font-variant-numeric:tabular-nums;">${sfEsc(f.ruc_emisor)}</td>
            <td>${sfEsc(f.tipo_comprobante)}</td>
            <td style="font-variant-numeric:tabular-nums;">${sfEsc(f.serie)}</td>
            <td>${sfFecha(f.fecha_emision)}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums;">${sfNum(f.valor_sin_impuestos)}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums;">${sfNum(f.iva)}</td>
            <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${sfNum(f.importe_total)}</td>
            <td style="text-align:center;">${f.lineas || 0}</td>
            <td style="text-align:center;white-space:nowrap;">
                <button type="button" class="btn-primary btn-sm sf-ver"
                        data-clave="${sfEsc(f.clave_acceso)}"
                        style="padding:4px 10px;background:#123450;" title="Ver detalle">
                    <i class="fas fa-list"></i>
                </button>
                <button type="button" class="btn-primary btn-sm sf-pdf"
                        data-clave="${sfEsc(f.clave_acceso)}"
                        style="padding:4px 10px;background:#b91c1c;" title="Ver PDF">
                    <i class="fas fa-file-pdf"></i>
                </button>
            </td>
        </tr>`).join('');

    // Los botones se enganchan por data-clave: nunca onclick inline, que se
    // rompe con comillas y caracteres raros en los nombres.
    cuerpo.querySelectorAll('.sf-ver').forEach(b =>
        b.addEventListener('click', () => sfVerDetalle(b.dataset.clave)));
    cuerpo.querySelectorAll('.sf-pdf').forEach(b =>
        b.addEventListener('click', () => sfAbrirPdf(b.dataset.clave)));
}


// ------------------------------------------------------------ PDF y XML

function sfAbrirPdf(clave) {
    window.open(`${CONFIG.API_URL}/api/sri/facturas/${clave}/pdf`, '_blank');
}

function sfAbrirXml(clave) {
    window.open(`${CONFIG.API_URL}/api/sri/facturas/${clave}/xml`, '_blank');
}


// ------------------------------------------------------------ detalle

async function sfVerDetalle(clave) {
    const modal = document.getElementById('sf-modal');
    const cuerpo = document.getElementById('sf-modal-cuerpo');
    const f = sfEstado.porClave[clave] || {};

    document.getElementById('sf-modal-titulo').textContent =
        `${f.razon_social_emisor || ''} · ${f.serie || ''}`;
    document.getElementById('sf-modal-pdf').onclick = () => sfAbrirPdf(clave);
    document.getElementById('sf-modal-xml').onclick = () => sfAbrirXml(clave);
    cuerpo.innerHTML = '<div class="fd-vacio">Cargando...</div>';
    modal.style.display = 'block';

    // La factura se ve como factura: el PDF (RIDE) va incrustado aca mismo.
    // El XML crudo no se le muestra a nadie -- no hay forma de leerlo de un
    // vistazo. Queda solo como descarga de respaldo en el boton de arriba.
    const visorPdf = `
        <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;
                    margin-bottom:18px;background:#f8fafc;">
            <iframe src="${CONFIG.API_URL}/api/sri/facturas/${clave}/pdf#toolbar=1"
                    title="Factura en PDF"
                    style="width:100%;height:760px;border:0;display:block;"></iframe>
        </div>`;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/sri/facturas/${clave}`);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'no se pudo traer el detalle');

        const c = d.comprobante;
        const lineas = d.detalle || [];
        const adicional = c.info_adicional || {};
        const pagos = c.formas_pago || [];

        const ficha = [
            ['RUC emisor', c.ruc_emisor],
            ['Tipo', c.tipo_comprobante],
            ['Serie', c.serie],
            ['Emision', sfFecha(c.fecha_emision)],
            ['Autorizacion', c.fecha_autorizacion || '—'],
            ['Estado en el SRI', c.estado_sri],
            ['Establecimiento', c.dir_establecimiento || '—'],
            ['Clave de acceso', c.clave_acceso],
        ].map(([k, v]) => `
            <div style="min-width:190px;">
                <div style="font-size:11px;font-weight:600;color:#64748b;
                            text-transform:uppercase;letter-spacing:.3px;">${sfEsc(k)}</div>
                <div style="font-size:13px;color:#334155;word-break:break-all;">${sfEsc(v)}</div>
            </div>`).join('');

        const filas = lineas.length ? lineas.map(l => `
            <tr>
                <td style="text-align:center;">${l.linea}</td>
                <td>${sfEsc(l.codigo_principal || '—')}</td>
                <td>${sfEsc(l.descripcion)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${sfNum(l.cantidad, 2)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${sfNum(l.precio_unitario, 4)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${sfNum(l.descuento)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${sfNum(l.iva_tarifa, 0)}%</td>
                <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">
                    ${sfNum(l.precio_total_sin_impuesto)}</td>
            </tr>`).join('')
            : `<tr><td colspan="8"><div class="fd-vacio">
                 Este comprobante no trae lineas de detalle (pasa con las
                 retenciones y con algunos servicios).</div></td></tr>`;

        const extras = Object.keys(adicional).length
            ? `<div style="margin-top:18px;">
                 <div class="fd-barra"><span class="fd-conteo">Informacion adicional</span></div>
                 <div style="display:flex;flex-wrap:wrap;gap:18px;padding:12px 4px;">
                 ${Object.entries(adicional).map(([k, v]) => `
                     <div style="min-width:190px;">
                       <div style="font-size:11px;font-weight:600;color:#64748b;
                                   text-transform:uppercase;">${sfEsc(k)}</div>
                       <div style="font-size:13px;color:#334155;">${sfEsc(v)}</div>
                     </div>`).join('')}
                 </div></div>`
            : '';

        const formas = pagos.length
            ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">
                 Formas de pago: ${pagos.map(p =>
                     `${sfEsc(p.formaPago)} (${sfMoneda(Number(p.total))})`).join(' · ')}
               </div>`
            : '';

        cuerpo.innerHTML = `
            ${visorPdf}

            <div style="display:flex;flex-wrap:wrap;gap:18px;margin-bottom:18px;">${ficha}</div>

            <div class="fd-barra">
                <span class="fd-conteo">${lineas.length} linea(s) de detalle</span>
                <span style="flex:1;"></span>
                <span style="font-size:13px;color:#334155;">
                    Subtotal <strong>${sfMoneda(c.valor_sin_impuestos)}</strong> ·
                    IVA <strong>${sfMoneda(c.iva)}</strong> ·
                    Total <strong>${sfMoneda(c.importe_total)}</strong>
                </span>
            </div>
            <div style="overflow:auto;">
              <table class="nom-table">
                <thead><tr>
                    <th style="text-align:center;">#</th>
                    <th>Codigo</th>
                    <th>Descripcion</th>
                    <th style="text-align:right;">Cantidad</th>
                    <th style="text-align:right;">P. unitario</th>
                    <th style="text-align:right;">Descuento</th>
                    <th style="text-align:right;">IVA</th>
                    <th style="text-align:right;">Total sin imp.</th>
                </tr></thead>
                <tbody>${filas}</tbody>
              </table>
            </div>
            ${formas}
            ${extras}`;
    } catch (e) {
        cuerpo.innerHTML = `<div class="fd-vacio">No se pudo abrir el detalle: ${sfEsc(e.message)}</div>`;
    }
}

function sfCerrarModal() {
    const m = document.getElementById('sf-modal');
    if (m) m.style.display = 'none';
}


// ------------------------------------------------------------ subir TXT

// El TXT se lee aca, en el navegador, y los XML se piden al SRI en lotes de 20.
//
// Antes esto era UNA sola peticion con todo el archivo: con un TXT de un mes
// (750 comprobantes) el navegador se quedaba 16 minutos esperando, sin mostrar
// nada y sin poder cancelarse. Por lotes se ve el avance real, se puede cortar,
// y ninguna peticion queda colgada.

const SF_LOTE = 20;
let sfCancelar = false;

function sfLeerArchivo(archivo) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('no se pudo leer el archivo'));
        fr.readAsText(archivo, 'utf-8');
    });
}

function sfParsearTxt(texto) {
    const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lineas.length) return [];
    const cab = lineas[0].split('\t').map(c => c.trim());
    const iClave = cab.indexOf('CLAVE_ACCESO');
    if (iClave === -1) {
        throw new Error('El archivo no parece el TXT de comprobantes recibidos: ' +
                        'no tiene la columna CLAVE_ACCESO');
    }
    const iEmisor = cab.indexOf('RAZON_SOCIAL_EMISOR');
    const iSerie = cab.indexOf('SERIE_COMPROBANTE');
    const iFecha = cab.indexOf('FECHA_EMISION');

    const salida = [];
    for (let i = 1; i < lineas.length; i++) {
        if (!lineas[i].trim()) continue;
        const p = lineas[i].split('\t');
        const clave = (p[iClave] || '').trim();
        if (clave.length !== 49) continue;
        salida.push({
            clave,
            emisor: iEmisor > -1 ? (p[iEmisor] || '').trim() : '',
            serie:  iSerie  > -1 ? (p[iSerie]  || '').trim() : '',
            fecha:  iFecha  > -1 ? (p[iFecha]  || '').trim() : '',
        });
    }
    return salida;
}

function sfBarra(hechas, total, guardados, sinXml) {
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    return `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <strong style="color:#1e40af;">Pidiendo los XML al SRI…</strong>
          <span style="flex:1;"></span>
          <span style="font-variant-numeric:tabular-nums;color:#1e40af;">
            ${hechas} de ${total} (${pct}%)</span>
          <button type="button" id="sf-btn-cancelar" class="btn-primary btn-sm"
                  style="background:#b91c1c;padding:3px 12px;">Cancelar</button>
        </div>
        <div style="height:12px;background:#dbeafe;border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:#2563eb;transition:width .25s;"></div>
        </div>
        <div style="margin-top:10px;font-size:13px;color:#1e40af;">
          Guardadas en Azure: <strong>${guardados}</strong> ·
          sin XML: <strong>${sinXml}</strong>
        </div>
      </div>`;
}

async function sfSubirTxt(archivo) {
    const boton = document.getElementById('sf-btn-subir');
    const original = boton ? boton.innerHTML : '';
    const contenedor = document.getElementById('sf-aviso');
    sfCancelar = false;

    if (boton) {
        boton.disabled = true;
        boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando…';
    }

    try {
        // --- 1. leer y parsear el TXT aca mismo
        sfAviso('Leyendo <strong>' + sfEsc(archivo.name) + '</strong>…', 'info');
        const comprobantes = sfParsearTxt(await sfLeerArchivo(archivo));
        if (!comprobantes.length) {
            throw new Error('El archivo no trae ninguna clave de acceso valida');
        }

        // --- 2. preguntar que falta de verdad antes de gastar tiempo
        const rf = await fetch(`${CONFIG.API_URL}/api/sri/facturas/faltantes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comprobantes }),
        });
        const f = await rf.json();
        if (!f.success) throw new Error(f.error || 'no se pudo revisar que falta');

        const porPedir = f.por_pedir || [];
        const caducadas = f.caducadas || [];

        let previo = `<strong>${f.total}</strong> comprobantes en el archivo: ` +
                     `<strong>${f.ya_guardados}</strong> ya estaban en Azure, ` +
                     `<strong>${porPedir.length}</strong> por pedir al SRI`;
        if (caducadas.length) {
            previo += `, y <strong>${caducadas.length}</strong> con mas de ` +
                      `${f.dias_vivos} dias de emitidas: <u>el SRI ya no entrega ` +
                      `su XML</u>, asi que se omiten.`;
        } else {
            previo += '.';
        }

        if (!porPedir.length) {
            sfAviso(previo + '<br><br>No hay nada que traer.' +
                    (caducadas.length
                        ? ' El XML caduca a los pocos dias de la emision; para que ' +
                          'no se vuelva a perder, hay que subir el TXT a diario.'
                        : ''), caducadas.length ? 'info' : 'ok');
            return;
        }

        // --- 3. de a lotes, mostrando el avance
        let hechas = 0, guardados = 0, lineas = 0, yaEstaban = 0;
        const sinXml = [];
        contenedor.style.display = 'block';
        contenedor.innerHTML = sfBarra(0, porPedir.length, 0, 0);
        document.getElementById('sf-btn-cancelar')?.addEventListener('click', () => {
            sfCancelar = true;
        });

        for (let i = 0; i < porPedir.length; i += SF_LOTE) {
            if (sfCancelar) break;
            const lote = porPedir.slice(i, i + SF_LOTE);
            const r = await fetch(`${CONFIG.API_URL}/api/sri/facturas/importar`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claves: lote }),
            });
            const d = await r.json();
            if (d.success) {
                guardados += d.guardados || 0;
                lineas += d.lineas || 0;
                yaEstaban += d.ya_estaban || 0;
                (d.sin_xml || []).forEach(s => sinXml.push(s));
            }
            hechas += lote.length;
            contenedor.innerHTML = sfBarra(hechas, porPedir.length, guardados, sinXml.length);
            document.getElementById('sf-btn-cancelar')?.addEventListener('click', () => {
                sfCancelar = true;
            });
            sfConsultar();     // la tabla va creciendo a la vista
        }

        // --- 4. el resumen
        let msg = previo + `<br><br><strong>Resultado:</strong> ` +
                  `${guardados} comprobantes guardados en Azure con ${lineas} lineas ` +
                  `de detalle` + (yaEstaban ? `, ${yaEstaban} ya estaban` : '') + '.';
        if (sfCancelar) {
            msg += ` <strong>Cancelado</strong> tras ${hechas} de ${porPedir.length}; ` +
                   'lo guardado se queda, y volviendo a subir el TXT sigue desde ahi.';
        }
        if (sinXml.length) {
            msg += `<br><br><strong>${sinXml.length} sin XML:</strong>` +
                   '<ul style="margin:6px 0 0 18px;">' +
                   sinXml.slice(0, 10).map(s =>
                       `<li>${sfEsc(s.emisor || s.clave)} ${sfEsc(s.serie)} — ${sfEsc(s.motivo)}</li>`
                   ).join('') + '</ul>';
            if (sinXml.length > 10) msg += `<em>…y ${sinXml.length - 10} mas.</em>`;
        }
        sfAviso(msg, (sinXml.length || sfCancelar) ? 'info' : 'ok');
        sfConsultar();
    } catch (e) {
        sfAviso('No se pudo importar: ' + sfEsc(e.message), 'error');
    } finally {
        if (boton) { boton.disabled = false; boton.innerHTML = original; }
        const input = document.getElementById('sf-archivo');
        if (input) input.value = '';    // para poder subir el mismo archivo otra vez
    }
}


// ------------------------------------------------------------ importar directo

// Trae los XML de un mes directo del portal del SRI, por HTTP y sin TXT.
// El servidor trabaja en lotes cortos (para caber en su timeout) y aca se le
// llama en bucle por cada tipo de comprobante, mostrando el avance real.
const SF_TIPOS_PORTAL = ['Facturas', 'Notas de credito', 'Liquidaciones de compra'];

async function sfImportarDirecto() {
    const valorMes = document.getElementById('sf-mes-directo')?.value || '';
    if (!/^\d{4}-\d{2}$/.test(valorMes)) {
        sfAviso('Elegi el mes a importar (campo "Mes a importar").', 'error');
        return;
    }
    const [anio, mes] = valorMes.split('-').map(Number);

    const boton = document.getElementById('sf-btn-directo');
    const original = boton ? boton.innerHTML : '';
    if (boton) {
        boton.disabled = true;
        boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando…';
    }
    sfCancelar = false;

    const contenedor = document.getElementById('sf-aviso');
    let totalGuardados = 0, totalYa = 0, totalSinXml = 0;
    const notas = [];

    const pintar = (fase) => {
        contenedor.style.display = 'block';
        contenedor.innerHTML = `
          <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;
                      padding:14px 16px;font-size:13px;line-height:1.6;">
            <div style="display:flex;align-items:center;gap:12px;">
              <strong style="color:#5b21b6;">Importando ${valorMes} directo del portal…</strong>
              <span style="flex:1;"></span>
              <button type="button" id="sf-btn-cancelar-dir" class="btn-primary btn-sm"
                      style="background:#b91c1c;padding:3px 12px;">Cancelar</button>
            </div>
            <div style="margin-top:8px;color:#5b21b6;">
              ${sfEsc(fase)} · guardados <strong>${totalGuardados}</strong>
              · ya estaban <strong>${totalYa}</strong>
              · sin XML <strong>${totalSinXml}</strong>
            </div>
          </div>`;
        document.getElementById('sf-btn-cancelar-dir')
            ?.addEventListener('click', () => { sfCancelar = true; });
    };

    try {
        for (let tipoIdx = 0; tipoIdx < 3 && !sfCancelar; tipoIdx++) {
            let vueltasSinAvance = 0;
            // por tipo: repetir mientras el servidor reporte pendientes
            for (let vuelta = 0; vuelta < 40 && !sfCancelar; vuelta++) {
                pintar(SF_TIPOS_PORTAL[tipoIdx] + ' — lote ' + (vuelta + 1));
                const r = await fetch(`${CONFIG.API_URL}/api/sri/portal/importar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ anio, mes, tipo_idx: tipoIdx, lote: 10 }),
                });
                const d = await r.json();
                if (!d.success) {
                    notas.push(`${SF_TIPOS_PORTAL[tipoIdx]}: ${d.error || 'error'}`);
                    break;
                }
                totalGuardados += d.guardados || 0;
                totalYa = Math.max(totalYa, d.ya_estaban || 0);
                totalSinXml += d.sin_xml || 0;
                if (d.nota) { notas.push(`${SF_TIPOS_PORTAL[tipoIdx]}: ${d.nota}`); }
                sfConsultar();          // la tabla va creciendo a la vista

                if (!d.pendientes) break;
                // pendientes que no bajan = el portal esta fallando esas filas;
                // dos vueltas sin avance y se pasa al siguiente tipo
                if (!d.guardados) {
                    vueltasSinAvance++;
                    if (vueltasSinAvance >= 2) {
                        notas.push(`${SF_TIPOS_PORTAL[tipoIdx]}: quedaron ` +
                                   `${d.pendientes} sin bajar (el portal no las entrego)`);
                        break;
                    }
                } else {
                    vueltasSinAvance = 0;
                }
            }
        }

        let msg = `<strong>Importacion de ${valorMes} terminada:</strong> ` +
                  `${totalGuardados} comprobantes guardados en Azure` +
                  (totalYa ? `, ${totalYa} ya estaban` : '') +
                  (totalSinXml ? `, ${totalSinXml} sin XML` : '') + '.';
        if (sfCancelar) msg += ' <strong>(cancelado; lo guardado se queda)</strong>';
        if (notas.length) {
            msg += '<ul style="margin:6px 0 0 18px;">' +
                   notas.slice(0, 6).map(n => `<li>${sfEsc(n)}</li>`).join('') + '</ul>';
        }
        sfAviso(msg, totalGuardados ? 'ok' : 'info');
        sfConsultar();
    } catch (e) {
        sfAviso('Fallo la importacion directa: ' + sfEsc(e.message), 'error');
    } finally {
        if (boton) { boton.disabled = false; boton.innerHTML = original; }
    }
}


// ------------------------------------------------------------ cruce

async function sfCruce() {
    const desde = document.getElementById('sf-desde')?.value || '';
    const hasta = document.getElementById('sf-hasta')?.value || '';
    if (!desde || !hasta) {
        sfAviso('Para cruzar hacen falta las dos fechas.', 'error');
        return;
    }
    sfAviso('Cruzando contra Contifico...', 'info');
    try {
        const r = await fetch(
            `${CONFIG.API_URL}/api/sri/facturas/cruce-contifico?desde=${desde}&hasta=${hasta}`);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'no se pudo cruzar');

        let msg = `En el SRI <strong>${d.en_sri}</strong> · en Contifico ` +
                  `<strong>${d.en_contifico}</strong>.`;

        if (d.solo_en_sri && d.solo_en_sri.length) {
            msg += `<br><br><strong>${d.solo_en_sri.length} en el SRI que no estan en ` +
                   `Contifico (${sfMoneda(d.monto_solo_en_sri)}):</strong>` +
                   '<ul style="margin:6px 0 0 18px;">' +
                   d.solo_en_sri.slice(0, 15).map(f =>
                       `<li>${sfEsc(f.razon_social_emisor)} — ${sfEsc(f.serie)} — ` +
                       `${sfMoneda(f.importe_total)}</li>`).join('') + '</ul>';
            if (d.solo_en_sri.length > 15) {
                msg += `<em>...y ${d.solo_en_sri.length - 15} mas.</em>`;
            }
        } else {
            msg += ' Todo lo del SRI esta registrado en Contifico.';
        }

        if (d.solo_en_contifico && d.solo_en_contifico.length) {
            msg += `<br><br><strong>${d.solo_en_contifico.length} en Contifico sin ` +
                   `respaldo del SRI guardado.</strong> Suele ser que ese dia todavia ` +
                   'no se subio el TXT.';
        }
        sfAviso(msg, d.solo_en_sri && d.solo_en_sri.length ? 'info' : 'ok');
    } catch (e) {
        sfAviso('No se pudo cruzar: ' + sfEsc(e.message), 'error');
    }
}
