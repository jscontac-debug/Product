/**
 * validacion.js
 * -----------------------------------------------------------------------
 * Pantalla "Validacion": audita el cuadrante generado (o cualquier
 * cuadrante presente en LocalStorage) y detecta incidencias:
 *  - Falta de personal / cobertura insuficiente
 *  - Exceso de personal
 *  - Horas superadas (diarias o semanales)
 *  - Descansos incumplidos
 *  - Operaciones sin cubrir
 *  - Incumplimientos de convenio (dias consecutivos, turnos/dia)
 * -----------------------------------------------------------------------
 */

import { leer, KEYS, DIAS, DIAS_LABEL, numeroSemanaISO, formatoFechaCorta } from './storage.js';

let semanaSeleccionada = null;

export async function render(container) {
  const contenedor = leer(KEYS.CUADRANTE);
  const tienda = leer(KEYS.TIENDA);
  const personal = leer(KEYS.PERSONAL, []);
  const cobertura = leer(KEYS.COBERTURA, []);
  const operaciones = leer(KEYS.OPERACIONES, []);

  if (!contenedor || !contenedor.semanas || !Object.keys(contenedor.semanas).length) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h3>No hay ningun cuadrante que validar</h3>
          <p class="muted">Genera un cuadrante primero desde la pantalla "Generar".</p>
          <button class="btn" id="btn-ir-generar">Ir a Generar</button>
        </div>
      </div>
    `;
    document.getElementById('btn-ir-generar').addEventListener('click', () => window.irA('generar'));
    return;
  }

  const semanasKeys = Object.keys(contenedor.semanas).sort();
  if (!semanaSeleccionada || !contenedor.semanas[semanaSeleccionada]) semanaSeleccionada = semanasKeys[0];

  pintar(container, contenedor, semanasKeys, tienda, personal, cobertura, operaciones);
}

function pintar(container, contenedor, semanasKeys, tienda, personal, cobertura, operaciones) {
  const semana = contenedor.semanas[semanaSeleccionada];
  const problemas = validarCuadrante(tienda, personal, cobertura, operaciones, semana);
  const errores = problemas.filter(p => p.gravedad === 'bad').length;
  const avisos = problemas.filter(p => p.gravedad === 'warn').length;
  const w = numeroSemanaISO(semanaSeleccionada);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Validacion</h1>
          <p>Revision automatica de la semana ${w.anio}-${String(w.semana).padStart(2, '0')} (${formatoFechaCorta(semanaSeleccionada)}), generada el ${new Date(contenedor.generadoEl).toLocaleString('es-ES')}.</p>
        </div>
        <div class="field" style="min-width:200px;">
          <label for="sel-semana-val">Semana a validar</label>
          <select id="sel-semana-val">
            ${semanasKeys.map(k => {
              const ww = numeroSemanaISO(k);
              return `<option value="${k}" ${k === semanaSeleccionada ? 'selected' : ''}>${ww.anio}-${String(ww.semana).padStart(2, '0')} (${formatoFechaCorta(k)})</option>`;
            }).join('')}
          </select>
        </div>
      </div>

      <div class="grid grid-3" style="margin-bottom:16px;">
        <div class="stat ${errores === 0 ? 'stat--ok' : 'stat--bad'}">
          <div class="stat__value">${errores}</div><div class="stat__label">Incumplimientos</div>
        </div>
        <div class="stat ${avisos === 0 ? 'stat--ok' : 'stat--warn'}">
          <div class="stat__value">${avisos}</div><div class="stat__label">Avisos</div>
        </div>
        <div class="stat stat--ok">
          <div class="stat__value">${problemas.length - errores - avisos}</div><div class="stat__label">Comprobaciones correctas</div>
        </div>
      </div>

      <div class="card">
        <h3>Incidencias detectadas</h3>
        ${problemas.length ? `
          <ul class="issue-list">
            ${problemas.map(p => `
              <li class="issue-item issue-item--${p.gravedad}">
                <span class="issue-item__icon">${p.gravedad === 'bad' ? '✕' : (p.gravedad === 'warn' ? '!' : '✓')}</span>
                <span><strong>${esc(p.categoria)}:</strong> ${esc(p.mensaje)}</span>
              </li>
            `).join('')}
          </ul>
        ` : '<p class="muted">No se ha detectado ninguna incidencia.</p>'}
      </div>
    </div>
  `;

  document.getElementById('sel-semana-val').addEventListener('change', (ev) => {
    semanaSeleccionada = ev.target.value;
    pintar(container, contenedor, semanasKeys, tienda, personal, cobertura, operaciones);
  });
}

/**
 * Ejecuta todas las comprobaciones sobre el cuadrante y devuelve una
 * lista plana de incidencias con su categoria, gravedad y mensaje.
 */
export function validarCuadrante(tienda, personal, cobertura, operaciones, cuadrante) {
  const problemas = [];
  const mapaPersonal = {};
  personal.forEach(p => { mapaPersonal[p.id] = p; });

  comprobarCobertura(cuadrante, cobertura, tienda, problemas);
  comprobarOperaciones(cuadrante, operaciones, problemas);
  comprobarConvenio(cuadrante, personal, tienda, problemas);

  if (!problemas.length) {
    problemas.push({ categoria: 'General', gravedad: 'ok', mensaje: 'El cuadrante cumple todas las comprobaciones automaticas.' });
  }
  return problemas;
}

/** Comprueba minimos/deseados de cobertura, bloque a bloque, en cada franja. */
function comprobarCobertura(cuadrante, cobertura, tienda, problemas) {
  DIAS.forEach(dia => {
    const turnosDia = cuadrante.dias[dia] || [];
    cobertura.filter(c => c.dias.includes(dia)).forEach(c => {
      const desde = window.UI.horaAMinutos(c.horaInicio);
      const hasta = window.UI.horaAMinutos(c.horaFin);
      let minAsignados = Infinity;
      let maxAsignados = 0;

      for (let t = desde; t < hasta; t += 30) {
        const enEsteBloque = turnosDia.filter(turno => {
          const ti = window.UI.horaAMinutos(turno.horaInicio);
          const tf = window.UI.horaAMinutos(turno.horaFin);
          return ti <= t && tf > t;
        }).length;
        minAsignados = Math.min(minAsignados, enEsteBloque);
        maxAsignados = Math.max(maxAsignados, enEsteBloque);
      }
      if (minAsignados === Infinity) minAsignados = 0;

      if (minAsignados < c.personalMinimo) {
        problemas.push({
          categoria: 'Falta personal',
          gravedad: 'bad',
          mensaje: `${DIAS_LABEL[dia]} ${c.horaInicio}-${c.horaFin}: solo ${minAsignados} de ${c.personalMinimo} minimo critico.`
        });
      } else if (maxAsignados < c.personalDeseado) {
        problemas.push({
          categoria: 'Cobertura insuficiente',
          gravedad: 'warn',
          mensaje: `${DIAS_LABEL[dia]} ${c.horaInicio}-${c.horaFin}: ${maxAsignados} de ${c.personalDeseado} personal deseado.`
        });
      }
      if (maxAsignados > c.personalDeseado + 1) {
        problemas.push({
          categoria: 'Sobra personal',
          gravedad: 'warn',
          mensaje: `${DIAS_LABEL[dia]} ${c.horaInicio}-${c.horaFin}: ${maxAsignados} personas frente a ${c.personalDeseado} deseadas.`
        });
      }
    });
  });
}

/** Comprueba que cada operacion tiene el numero de personas requerido. */
function comprobarOperaciones(cuadrante, operaciones, problemas) {
  operaciones.forEach(op => {
    const turnosDia = cuadrante.dias[op.dia] || [];
    const asignados = turnosDia.filter(t => t.operacionId === op.id).length;
    if (asignados < op.personasNecesarias) {
      problemas.push({
        categoria: 'Operacion sin cubrir',
        gravedad: 'bad',
        mensaje: `"${op.nombre}" (${DIAS_LABEL[op.dia]} ${op.hora}): ${asignados} de ${op.personasNecesarias} personas asignadas.`
      });
    }
  });
}

/** Comprueba limites de convenio: horas, turnos/dia, dias consecutivos, descansos. */
function comprobarConvenio(cuadrante, personal, tienda, problemas) {
  personal.forEach(emp => {
    let horasSemana = 0;
    let diasTrabajados = [];
    let ultimoFinDia = null;

    DIAS.forEach((dia, idx) => {
      const turnosEmpleado = (cuadrante.dias[dia] || []).filter(t => t.empleadoId === emp.id);
      if (!turnosEmpleado.length) return;

      diasTrabajados.push(idx);

      if (turnosEmpleado.length > tienda.maxTurnos) {
        problemas.push({
          categoria: 'Incumplimiento convenio',
          gravedad: 'bad',
          mensaje: `${emp.nombre} tiene ${turnosEmpleado.length} turnos el ${DIAS_LABEL[dia]} (maximo ${tienda.maxTurnos}).`
        });
      }

      const horasDia = turnosEmpleado.reduce((acc, t) => acc + (window.UI.horaAMinutos(t.horaFin) - window.UI.horaAMinutos(t.horaInicio)) / 60, 0);
      horasSemana += horasDia;

      if (horasDia > tienda.maxHorasDia + 0.01) {
        problemas.push({
          categoria: 'Horas superadas',
          gravedad: 'bad',
          mensaje: `${emp.nombre} trabaja ${window.UI.formatoHoras(horasDia)} el ${DIAS_LABEL[dia]} (maximo ${tienda.maxHorasDia} h).`
        });
      }

      const inicioDia = Math.min(...turnosEmpleado.map(t => window.UI.horaAMinutos(t.horaInicio)));
      if (ultimoFinDia !== null) {
        const descansoHoras = (24 * 60 - ultimoFinDia + inicioDia) / 60;
        if (descansoHoras < tienda.descansoMinimo) {
          problemas.push({
            categoria: 'Descanso incumplido',
            gravedad: 'bad',
            mensaje: `${emp.nombre} descansa ${window.UI.formatoHoras(descansoHoras)} entre turnos antes del ${DIAS_LABEL[dia]} (minimo ${tienda.descansoMinimo} h).`
          });
        }
      }
      ultimoFinDia = Math.max(...turnosEmpleado.map(t => window.UI.horaAMinutos(t.horaFin)));
    });

    if (horasSemana > emp.horasSemanales + 0.01) {
      problemas.push({
        categoria: 'Horas superadas',
        gravedad: 'bad',
        mensaje: `${emp.nombre} suma ${window.UI.formatoHoras(horasSemana)} en la semana (contrato: ${emp.horasSemanales} h).`
      });
    }

    const maxConsecutivos = calcularMaxConsecutivos(diasTrabajados);
    if (maxConsecutivos > tienda.maxDiasConsecutivos) {
      problemas.push({
        categoria: 'Incumplimiento convenio',
        gravedad: 'bad',
        mensaje: `${emp.nombre} encadena ${maxConsecutivos} dias consecutivos (maximo ${tienda.maxDiasConsecutivos}).`
      });
    }
  });
}

/** Dada una lista ordenada de indices de dia trabajados, calcula la racha maxima. */
function calcularMaxConsecutivos(diasTrabajados) {
  if (!diasTrabajados.length) return 0;
  let maxRacha = 1;
  let rachaActual = 1;
  for (let i = 1; i < diasTrabajados.length; i++) {
    if (diasTrabajados[i] === diasTrabajados[i - 1] + 1) {
      rachaActual++;
    } else {
      rachaActual = 1;
    }
    maxRacha = Math.max(maxRacha, rachaActual);
  }
  return maxRacha;
}

function esc(v) { return window.UI.escapeHtml(v); }
