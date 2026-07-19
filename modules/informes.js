/**
 * informes.js
 * -----------------------------------------------------------------------
 * Pantalla "Informes": indicadores agregados del cuadrante generado.
 * Horas, coste, productividad, cobertura, aperturas, cierres, domingos
 * y vacaciones.
 * -----------------------------------------------------------------------
 */

import { leer, KEYS, DIAS, DIAS_LABEL } from './storage.js';
import { costeHoraPorCategoria } from './motor.js';

export async function render(container) {
  const cuadrante = leer(KEYS.CUADRANTE);
  const personal = leer(KEYS.PERSONAL, []);
  const cobertura = leer(KEYS.COBERTURA, []);

  if (!cuadrante) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h3>No hay datos que informar todavia</h3>
          <p class="muted">Genera un cuadrante primero desde la pantalla "Generar".</p>
          <button class="btn" id="btn-ir-generar">Ir a Generar</button>
        </div>
      </div>
    `;
    document.getElementById('btn-ir-generar').addEventListener('click', () => window.irA('generar'));
    return;
  }

  const totales = calcularTotales(cuadrante, personal);
  const coberturaPct = calcularCoberturaMedia(cuadrante, cobertura);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Informes</h1>
          <p>Indicadores del cuadrante generado el ${new Date(cuadrante.generadoEl).toLocaleString('es-ES')}.</p>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:16px;">
        <div class="stat"><div class="stat__value">${window.UI.formatoHoras(totales.horasTotales)}</div><div class="stat__label">Horas totales</div></div>
        <div class="stat"><div class="stat__value">${totales.costeTotal.toFixed(0)} €</div><div class="stat__label">Coste estimado</div></div>
        <div class="stat"><div class="stat__value">${coberturaPct}%</div><div class="stat__label">Cobertura media (vs deseado)</div></div>
        <div class="stat"><div class="stat__value">${totales.productividadPct}%</div><div class="stat__label">Asignaciones en seccion propia</div></div>
      </div>

      <div class="card">
        <h3>Horas y coste por empleado</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Empleado</th><th>Horas</th><th>Contrato</th><th>Coste estimado</th><th>Aperturas</th><th>Cierres</th><th>Domingos</th></tr></thead>
            <tbody>
              ${personal.map(p => filaEmpleado(p, cuadrante)).join('') || '<tr class="empty-row"><td colspan="7">Sin empleados</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Cobertura por franja</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Dias</th><th>Horario</th><th>Deseado</th><th>Cobertura media</th></tr></thead>
            <tbody>${cobertura.map(filaCobertura(cuadrante)).join('') || '<tr class="empty-row"><td colspan="4">Sin franjas configuradas</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Vacaciones planificadas</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Empleado</th><th>Dias de vacaciones</th></tr></thead>
            <tbody>
              ${personal.filter(p => p.vacaciones && p.vacaciones.length).map(p => `
                <tr><td>${esc(p.nombre)}</td><td>${p.vacaciones.map(esc).join(', ')}</td></tr>
              `).join('') || '<tr class="empty-row"><td colspan="2">Nadie tiene vacaciones planificadas.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/** Calcula horas, coste y productividad agregados de todo el cuadrante. */
function calcularTotales(cuadrante, personal) {
  const mapaPersonal = {};
  personal.forEach(p => { mapaPersonal[p.id] = p; });

  let horasTotales = 0;
  let costeTotal = 0;
  let asignacionesTotales = 0;
  let asignacionesEnSeccion = 0;

  DIAS.forEach(dia => {
    (cuadrante.dias[dia] || []).forEach(t => {
      const horas = (window.UI.horaAMinutos(t.horaFin) - window.UI.horaAMinutos(t.horaInicio)) / 60;
      horasTotales += horas;
      const emp = mapaPersonal[t.empleadoId];
      if (emp) {
        costeTotal += horas * costeHoraPorCategoria(emp.categoria);
        asignacionesTotales++;
        if (t.seccion && emp.seccion === t.seccion) asignacionesEnSeccion++;
      }
    });
  });

  return {
    horasTotales,
    costeTotal,
    productividadPct: asignacionesTotales ? Math.round((asignacionesEnSeccion / asignacionesTotales) * 100) : 0
  };
}

/** Calcula el porcentaje medio de cobertura alcanzado frente al deseado, en todas las franjas. */
function calcularCoberturaMedia(cuadrante, cobertura) {
  if (!cobertura.length) return 0;
  let sumaRatios = 0;
  let n = 0;

  DIAS.forEach(dia => {
    const turnosDia = cuadrante.dias[dia] || [];
    cobertura.filter(c => c.dias.includes(dia)).forEach(c => {
      const desde = window.UI.horaAMinutos(c.horaInicio);
      const hasta = window.UI.horaAMinutos(c.horaFin);
      let sumaAsignados = 0;
      let bloques = 0;
      for (let t = desde; t < hasta; t += 30) {
        const asignados = turnosDia.filter(turno => {
          const ti = window.UI.horaAMinutos(turno.horaInicio);
          const tf = window.UI.horaAMinutos(turno.horaFin);
          return ti <= t && tf > t;
        }).length;
        sumaAsignados += asignados;
        bloques++;
      }
      const media = bloques ? sumaAsignados / bloques : 0;
      const ratio = c.personalDeseado ? Math.min(1, media / c.personalDeseado) : 1;
      sumaRatios += ratio;
      n++;
    });
  });

  return n ? Math.round((sumaRatios / n) * 100) : 0;
}

function filaEmpleado(p, cuadrante) {
  const r = cuadrante.resumenEmpleado[p.id] || { horas: 0, aperturas: 0, cierres: 0, domingos: 0 };
  const coste = r.horas * costeHoraPorCategoria(p.categoria);
  return `
    <tr>
      <td>${esc(p.nombre)}</td>
      <td>${window.UI.formatoHoras(r.horas)}</td>
      <td>${p.horasSemanales} h</td>
      <td>${coste.toFixed(2)} €</td>
      <td>${r.aperturas}</td>
      <td>${r.cierres}</td>
      <td>${r.domingos}</td>
    </tr>
  `;
}

function filaCobertura(cuadrante) {
  return function (c) {
    const dias = c.dias.map(d => DIAS_LABEL[d].slice(0, 2)).join(' ');
    let sumaAsignados = 0;
    let bloques = 0;
    c.dias.forEach(dia => {
      const turnosDia = cuadrante.dias[dia] || [];
      const desde = window.UI.horaAMinutos(c.horaInicio);
      const hasta = window.UI.horaAMinutos(c.horaFin);
      for (let t = desde; t < hasta; t += 30) {
        const asignados = turnosDia.filter(turno => {
          const ti = window.UI.horaAMinutos(turno.horaInicio);
          const tf = window.UI.horaAMinutos(turno.horaFin);
          return ti <= t && tf > t;
        }).length;
        sumaAsignados += asignados;
        bloques++;
      }
    });
    const media = bloques ? (sumaAsignados / bloques) : 0;
    return `<tr><td>${dias}</td><td>${c.horaInicio}-${c.horaFin}</td><td>${c.personalDeseado}</td><td>${media.toFixed(1)}</td></tr>`;
  };
}

function esc(v) { return window.UI.escapeHtml(v); }
