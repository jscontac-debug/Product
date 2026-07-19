/**
 * dashboard.js
 * -----------------------------------------------------------------------
 * Pantalla "Dashboard": vision general del estado de la aplicacion:
 * datos configurados, ultimo cuadrante generado y accesos rapidos.
 * -----------------------------------------------------------------------
 */

import { leer, KEYS } from './storage.js';
import { validarCuadrante } from './validacion.js';

export async function render(container) {
  const tienda = leer(KEYS.TIENDA);
  const personal = leer(KEYS.PERSONAL, []);
  const cobertura = leer(KEYS.COBERTURA, []);
  const operaciones = leer(KEYS.OPERACIONES, []);
  const contenedor = leer(KEYS.CUADRANTE);
  const semanasKeys = contenedor && contenedor.semanas ? Object.keys(contenedor.semanas).sort() : [];
  const ultimaSemana = semanasKeys.length ? contenedor.semanas[semanasKeys[0]] : null;

  let resumenValidacion = null;
  if (ultimaSemana) {
    const problemas = validarCuadrante(tienda, personal, cobertura, operaciones, ultimaSemana);
    resumenValidacion = {
      errores: problemas.filter(p => p.gravedad === 'bad').length,
      avisos: problemas.filter(p => p.gravedad === 'warn').length
    };
  }

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Dashboard</h1>
          <p>Resumen general de ${tienda && tienda.nombre ? esc(tienda.nombre) : 'tu tienda'}.</p>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:16px;">
        <div class="stat"><div class="stat__value">${personal.length}</div><div class="stat__label">Empleados</div></div>
        <div class="stat"><div class="stat__value">${cobertura.length}</div><div class="stat__label">Franjas de cobertura</div></div>
        <div class="stat"><div class="stat__value">${operaciones.length}</div><div class="stat__label">Operaciones planificadas</div></div>
        <div class="stat ${estadoStat(resumenValidacion)}">
          <div class="stat__value">${ultimaSemana ? (resumenValidacion.errores === 0 ? 'OK' : resumenValidacion.errores) : '—'}</div>
          <div class="stat__label">${ultimaSemana ? (resumenValidacion.errores === 0 ? 'Cuadrante valido' : 'Incumplimientos') : 'Sin cuadrante'}</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>Configuracion de la tienda</h3>
          ${tienda && tienda.nombre ? `
            <p><strong>${esc(tienda.nombre)}</strong> · ${esc(tienda.convenio) || 'sin convenio definido'}</p>
            <p class="muted">Horario: ${tienda.horario.apertura} - ${tienda.horario.cierre} · Rotacion ${tienda.rotacion}</p>
          ` : `<p class="muted">Todavia no has configurado los datos de la tienda.</p>`}
          <button class="btn btn--secondary btn--sm" data-ir="tienda">Ir a Tienda</button>
        </div>

        <div class="card">
          <h3>Ultimo cuadrante</h3>
          ${contenedor ? `
            <p>Generado el ${new Date(contenedor.generadoEl).toLocaleString('es-ES')}</p>
            <p class="muted">${semanasKeys.length} semana(s) · primera semana: ${semanasKeys[0] || '-'}</p>
            ${resumenValidacion ? `<p>${resumenValidacion.errores} incumplimientos · ${resumenValidacion.avisos} avisos (1ª semana)</p>` : ''}
          ` : `<p class="muted">Aun no se ha generado ningun cuadrante.</p>`}
          <button class="btn btn--sm" data-ir="generar">Generar cuadrante</button>
          ${contenedor ? '<button class="btn btn--secondary btn--sm" data-ir="resultado">Ver resultado</button>' : ''}
        </div>
      </div>

      <div class="card">
        <h3>Accesos rapidos</h3>
        <div class="actions-row">
          <button class="btn btn--secondary" data-ir="personal">Personal</button>
          <button class="btn btn--secondary" data-ir="cobertura">Cobertura</button>
          <button class="btn btn--secondary" data-ir="operaciones">Operaciones</button>
          <button class="btn btn--secondary" data-ir="reglas">Reglas</button>
          <button class="btn btn--secondary" data-ir="validacion">Validacion</button>
          <button class="btn btn--secondary" data-ir="informes">Informes</button>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-ir]').forEach(btn => {
    btn.addEventListener('click', () => window.irA(btn.dataset.ir));
  });
}

function estadoStat(resumen) {
  if (!resumen) return '';
  if (resumen.errores > 0) return 'stat--bad';
  if (resumen.avisos > 0) return 'stat--warn';
  return 'stat--ok';
}

function esc(v) { return window.UI.escapeHtml(v); }
