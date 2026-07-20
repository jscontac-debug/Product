/**
 * tienda.js
 * -----------------------------------------------------------------------
 * Pantalla "Tienda": configuracion general del centro de trabajo.
 * Estos datos son la base sobre la que el motor calcula el cuadrante
 * (horario de apertura/cierre, convenio, limites legales, etc).
 * -----------------------------------------------------------------------
 */

import { leer, guardar, KEYS, estructuraTiendaVacia } from './storage.js';

/** Pinta la pantalla de configuracion de tienda. */
export async function render(container) {
  const tienda = leer(KEYS.TIENDA) || estructuraTiendaVacia();

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Tienda</h1>
          <p>Configuracion general del centro de trabajo y del convenio aplicable.</p>
        </div>
      </div>

      <form id="form-tienda" class="card" novalidate>
        <h3>Datos generales</h3>
        <div class="form-grid">
          <div class="field">
            <label for="ti-nombre">Nombre de la tienda</label>
            <input id="ti-nombre" name="nombre" type="text" value="${esc(tienda.nombre)}" required>
          </div>
          <div class="field">
            <label for="ti-convenio">Convenio colectivo</label>
            <input id="ti-convenio" name="convenio" type="text" value="${esc(tienda.convenio)}" placeholder="Ej. Comercio General 2024">
          </div>
          <div class="field">
            <label for="ti-rotacion">Rotacion de horarios</label>
            <select id="ti-rotacion" name="rotacion">
              <option value="diaria" ${tienda.rotacion === 'diaria' ? 'selected' : ''}>Diaria</option>
              <option value="semanal" ${tienda.rotacion === 'semanal' ? 'selected' : ''}>Semanal</option>
            </select>
          </div>
        </div>

        <hr class="sep">
        <h3>Horario de apertura al publico</h3>
        <div class="form-grid">
          <div class="field">
            <label for="ti-apertura">Hora de apertura</label>
            <input id="ti-apertura" name="apertura" type="time" value="${esc(tienda.horario.apertura)}" required>
          </div>
          <div class="field">
            <label for="ti-cierre">Hora de cierre</label>
            <input id="ti-cierre" name="cierre" type="time" value="${esc(tienda.horario.cierre)}" required>
          </div>
          <div class="field">
            <label for="ti-antes">Tiempo antes de abrir (min)</label>
            <input id="ti-antes" name="tiempoAntes" type="number" min="0" step="5" value="${tienda.tiempoAntes}">
          </div>
          <div class="field">
            <label for="ti-despues">Tiempo despues de cerrar (min)</label>
            <input id="ti-despues" name="tiempoDespues" type="number" min="0" step="5" value="${tienda.tiempoDespues}">
          </div>
        </div>

        <hr class="sep">
        <h3>Limites del convenio</h3>
        <div class="form-grid">
          <div class="field">
            <label for="ti-maxhoras">Maximo horas / dia</label>
            <input id="ti-maxhoras" name="maxHorasDia" type="number" min="1" max="24" step="0.5" value="${tienda.maxHorasDia}">
          </div>
          <div class="field">
            <label for="ti-duracionturnomin">Duracion minima de un turno (h)</label>
            <input id="ti-duracionturnomin" name="duracionTurnoMin" type="number" min="0.5" max="14" step="0.5" value="${tienda.duracionTurnoMin || 4}">
          </div>
          <div class="field">
            <label for="ti-duracionturno">Duracion maxima de un turno (h)</label>
            <input id="ti-duracionturno" name="duracionTurnoMax" type="number" min="1" max="14" step="0.5" value="${tienda.duracionTurnoMax || 6}">
          </div>
          <div class="field">
            <label for="ti-maxturnos">Maximo turnos / dia</label>
            <input id="ti-maxturnos" name="maxTurnos" type="number" min="1" max="4" value="${tienda.maxTurnos}">
          </div>
          <div class="field">
            <label for="ti-maxdias">Maximo dias consecutivos</label>
            <input id="ti-maxdias" name="maxDiasConsecutivos" type="number" min="1" max="14" value="${tienda.maxDiasConsecutivos}">
          </div>
          <div class="field">
            <label for="ti-descanso">Descanso minimo entre turnos (h)</label>
            <input id="ti-descanso" name="descansoMinimo" type="number" min="0" max="48" value="${tienda.descansoMinimo}">
          </div>
        </div>
        <p class="muted" style="margin-top:6px;">Si la rotacion es semanal, un empleado que empiece la semana por la manana se mantendra en turnos de manana el resto de esa semana (y lo mismo para tarde).</p>

        <hr class="sep">
        <h3>Coste de personal</h3>
        <div class="field-inline">
          <input id="ti-coste" name="costeHabilitado" type="checkbox" ${tienda.costeHabilitado !== false ? 'checked' : ''}>
          <label for="ti-coste" style="font-size:0.9rem; font-weight:500;">Tener en cuenta el coste del personal (regla de coste e informes)</label>
        </div>
        <p class="muted" style="margin-top:6px;">El coste por hora se configura por empleado en la pantalla "Personal".</p>

        <div class="actions-row">
          <button type="submit" class="btn">Guardar cambios</button>
          <span class="muted" id="ti-guardado" style="align-self:center;"></span>
        </div>
      </form>
    </div>
  `;

  document.getElementById('form-tienda').addEventListener('submit', (ev) => {
    ev.preventDefault();
    guardarFormulario(ev.target);
  });
}

/** Lee el formulario, valida coherencia basica y persiste la tienda. */
function guardarFormulario(form) {
  const datos = new FormData(form);
  const apertura = datos.get('apertura');
  const cierre = datos.get('cierre');

  if (apertura >= cierre) {
    window.UI.toast('La hora de apertura debe ser anterior a la de cierre.');
    return;
  }

  const duracionTurnoMin = Number(datos.get('duracionTurnoMin')) || 4;
  const duracionTurnoMax = Number(datos.get('duracionTurnoMax')) || 6;
  if (duracionTurnoMin > duracionTurnoMax) {
    window.UI.toast('La duracion minima de turno no puede ser mayor que la maxima.');
    return;
  }

  const tienda = {
    nombre: datos.get('nombre').trim(),
    convenio: datos.get('convenio').trim(),
    horario: { apertura, cierre },
    tiempoAntes: Number(datos.get('tiempoAntes')) || 0,
    tiempoDespues: Number(datos.get('tiempoDespues')) || 0,
    rotacion: datos.get('rotacion'),
    maxHorasDia: Number(datos.get('maxHorasDia')) || 8,
    duracionTurnoMin,
    duracionTurnoMax,
    maxTurnos: Number(datos.get('maxTurnos')) || 1,
    maxDiasConsecutivos: Number(datos.get('maxDiasConsecutivos')) || 6,
    descansoMinimo: Number(datos.get('descansoMinimo')) || 12,
    costeHabilitado: form.querySelector('[name="costeHabilitado"]').checked
  };

  guardar(KEYS.TIENDA, tienda);
  window.UI.toast('Configuracion de tienda guardada.');
}

function esc(v) { return window.UI.escapeHtml(v); }