/**
 * motor.js
 * -----------------------------------------------------------------------
 * El motor de generacion de cuadrantes de Product.
 *
 * DISENO: el motor NO es un algoritmo cerrado. Es un bucle de asignacion
 * por bloques de 30 minutos que, en cada decision, pregunta a un
 * REGISTRO de reglas independientes cuanto "puntua" cada candidato
 * posible. Anadir una regla nueva consiste en anadir una funcion mas al
 * registro (REGISTRO_REGLAS) sin tocar el bucle principal ni el resto de
 * reglas existentes.
 *
 * El bucle respeta un orden de prioridades:
 *   P1 Cumplir convenio       -> filtro duro (esElegible), nunca se salta.
 *   P2 Cubrir minimos/deseado -> orden de asignacion de huecos de cobertura.
 *   P3 Cubrir operaciones     -> se asignan despues de la cobertura base.
 *   P4-P9 (aperturas, cierres, domingos, horas sobrantes, coste,
 *          productividad) -> funciones de puntuacion que desempatan
 *          entre candidatos igualmente elegibles.
 *
 * Este archivo expone dos pantallas: "Generar" (render) y "Resultado"
 * (renderResultado), reutilizando el mismo modulo porque comparten el
 * mismo dominio de datos (el cuadrante).
 * -----------------------------------------------------------------------
 */

import { leer, guardar, KEYS, DIAS, DIAS_LABEL } from './storage.js';

const BLOQUE_MIN = 30; // resolucion temporal del motor, en minutos

/* =========================================================================
   REGISTRO DE REGLAS (prioridades 4 a 9)
   Cada regla es: (empleado, estado, contexto, peso) => puntuacion numerica.
   Puntuaciones mas altas hacen al candidato mas atractivo para el hueco.
   Anadir una regla nueva: agrega una entrada aqui con su "id" coincidiendo
   con el id configurado en la pantalla "Reglas".
   ========================================================================= */
const REGISTRO_REGLAS = {

  aperturas(empleado, estado, ctx, peso) {
    if (!ctx.esApertura) return 0;
    return peso / (1 + estado.aperturas);
  },

  cierres(empleado, estado, ctx, peso) {
    if (!ctx.esCierre) return 0;
    return peso / (1 + estado.cierres);
  },

  domingos(empleado, estado, ctx, peso) {
    if (ctx.dia !== 'domingo') return 0;
    return peso / (1 + estado.domingos);
  },

  horasSobrantes(empleado, estado, ctx, peso) {
    // Prioriza a quien mas lejos esta de cumplir su jornada contratada,
    // para repartir las horas y no dejar huecos de contrato sin cubrir.
    const restante = Math.max(0, empleado.horasSemanales - estado.horasAsignadas);
    return peso * (restante / Math.max(1, empleado.horasSemanales));
  },

  coste(empleado, estado, ctx, peso) {
    // Coste relativo aproximado segun categoria (usado tambien en Informes).
    return -peso * costeHoraPorCategoria(empleado.categoria);
  },

  productividad(empleado, estado, ctx, peso) {
    // Favorece asignar a cada empleado en su propia seccion.
    if (!ctx.seccion) return 0;
    return empleado.seccion && empleado.seccion === ctx.seccion ? peso : 0;
  }
};

/** Coste horario relativo aproximado por categoria, para las reglas de coste e informes. */
export function costeHoraPorCategoria(categoria) {
  const tabla = { 'Encargado': 14, 'Responsable': 13, 'Dependiente': 10.5, 'Auxiliar': 9.5 };
  return tabla[categoria] || 10;
}

/* =========================================================================
   GENERACION DEL CUADRANTE
   ========================================================================= */

/**
 * Genera un cuadrante semanal completo.
 * @param {object} tienda configuracion de tienda
 * @param {array} personal lista de empleados
 * @param {array} cobertura franjas de cobertura
 * @param {array} operaciones operaciones puntuales
 * @param {array} reglas configuracion de reglas (peso/activa)
 * @param {string} semanaInicio fecha ISO (lunes) de la semana a generar
 */
export function generarCuadrante(tienda, personal, cobertura, operaciones, reglas, semanaInicio) {
  const reglasActivas = {};
  reglas.forEach(r => { reglasActivas[r.id] = r.activa ? r.peso : 0; });

  const jornada = calcularVentanaJornada(tienda);
  const estado = inicializarEstado(personal);
  const dias = {};

  DIAS.forEach((dia, indiceDia) => {
    const fechaDia = sumarDias(semanaInicio, indiceDia);
    const demanda = construirDemandaDia(dia, cobertura, jornada);

    dias[dia] = [];

    // --- Prioridad 2a: cubrir minimos criticos ---
    asignarCobertura(dias[dia], demanda, 'minimo', dia, indiceDia, fechaDia, jornada, tienda, personal, estado, reglasActivas);

    // --- Prioridad 2b: cubrir personal deseado (si quedan recursos) ---
    asignarCobertura(dias[dia], demanda, 'deseado', dia, indiceDia, fechaDia, jornada, tienda, personal, estado, reglasActivas);

    // --- Prioridad 3: cubrir operaciones ---
    const operacionesDia = operaciones.filter(o => o.dia === dia)
      .sort((a, b) => valorPrioridad(b.prioridad) - valorPrioridad(a.prioridad));
    operacionesDia.forEach(op => {
      asignarOperacion(dias[dia], op, dia, indiceDia, fechaDia, tienda, personal, estado, reglasActivas);
    });
  });

  const cuadrante = {
    generadoEl: new Date().toISOString(),
    semanaInicio,
    dias,
    resumenEmpleado: construirResumenEmpleado(personal, estado)
  };

  guardar(KEYS.CUADRANTE, cuadrante);
  return cuadrante;
}

/** Convierte la prioridad textual de una operacion en un numero para ordenar. */
function valorPrioridad(p) {
  return { 'Alta': 3, 'Media': 2, 'Baja': 1 }[p] || 1;
}

/** Calcula la ventana horaria de trabajo real (incluye tiempos antes/despues). */
function calcularVentanaJornada(tienda) {
  const inicio = window.UI.horaAMinutos(tienda.horario.apertura) - tienda.tiempoAntes;
  const fin = window.UI.horaAMinutos(tienda.horario.cierre) + tienda.tiempoDespues;
  const numBloques = Math.ceil((fin - inicio) / BLOQUE_MIN);
  return { inicio, fin, numBloques };
}

/** Inicializa el estado acumulado (horas, turnos...) de cada empleado. */
function inicializarEstado(personal) {
  const estado = {};
  personal.forEach(e => {
    estado[e.id] = {
      horasAsignadas: 0,
      turnos: {},              // dia -> [{inicioMin, finMin}]
      aperturas: 0,
      cierres: 0,
      domingos: 0,
      consecutivos: 0,
      ultimoDiaIdx: -99
    };
    DIAS.forEach(d => { estado[e.id].turnos[d] = []; });
  });
  return estado;
}

/** Construye los arrays de demanda (minimo y deseado) por bloque para un dia. */
function construirDemandaDia(dia, cobertura, jornada) {
  const minimo = new Array(jornada.numBloques).fill(0);
  const deseado = new Array(jornada.numBloques).fill(0);

  cobertura.filter(c => c.dias.includes(dia)).forEach(c => {
    const desde = window.UI.horaAMinutos(c.horaInicio);
    const hasta = window.UI.horaAMinutos(c.horaFin);
    for (let t = desde; t < hasta; t += BLOQUE_MIN) {
      const idx = Math.floor((t - jornada.inicio) / BLOQUE_MIN);
      if (idx < 0 || idx >= jornada.numBloques) continue;
      minimo[idx] = Math.max(minimo[idx], c.personalMinimo);
      deseado[idx] = Math.max(deseado[idx], c.personalDeseado);
    }
  });

  return { minimo, deseado, asignado: new Array(jornada.numBloques).fill(0) };
}

/**
 * Asigna empleados a huecos de cobertura hasta alcanzar el objetivo
 * indicado ('minimo' o 'deseado') o hasta agotar candidatos elegibles.
 */
function asignarCobertura(turnosDia, demanda, objetivo, dia, indiceDia, fechaDia, jornada, tienda, empleados, estado, reglasActivas) {
  let progreso = true;
  let intentosSinExito = 0;

  while (progreso && intentosSinExito < 500) {
    progreso = false;
    const objetivoArray = demanda[objetivo];
    let mejorIdx = -1;
    let mejorDeficit = 0;

    for (let i = 0; i < objetivoArray.length; i++) {
      const deficit = objetivoArray[i] - demanda.asignado[i];
      if (deficit > mejorDeficit) { mejorDeficit = deficit; mejorIdx = i; }
    }

    if (mejorIdx === -1) break;

    const longitud = calcularLongitudTurno(demanda, objetivo, mejorIdx, jornada, tienda);
    const candidato = elegirMejorCandidato(empleados, estado, dia, indiceDia, fechaDia, mejorIdx, longitud, jornada, tienda, reglasActivas, null);

    if (!candidato) { intentosSinExito++; continue; }

    aplicarTurno(turnosDia, demanda, candidato, estado, dia, indiceDia, jornada, mejorIdx, longitud, tienda, 'cobertura', null);
    progreso = true;
  }
}

/** Determina cuantos bloques debe durar un turno que arranca en un indice dado. */
function calcularLongitudTurno(demanda, objetivo, idxInicio, jornada, tienda) {
  const maxBloques = Math.round((tienda.maxHorasDia * 60) / BLOQUE_MIN);
  const minBloques = Math.min(maxBloques, Math.round(4 * 60 / BLOQUE_MIN)); // turno minimo orientativo: 4h
  let fin = idxInicio;

  while (
    fin + 1 < demanda.asignado.length &&
    (fin - idxInicio + 1) < maxBloques &&
    demanda[objetivo][fin + 1] > demanda.asignado[fin + 1]
  ) {
    fin++;
  }

  const longitud = Math.max(1, fin - idxInicio + 1);
  return Math.max(Math.min(longitud, maxBloques), Math.min(minBloques, jornada.numBloques - idxInicio));
}

/** Busca, entre los empleados elegibles, el de mayor puntuacion segun las reglas activas. */
function elegirMejorCandidato(empleados, estado, dia, indiceDia, fechaDia, idxInicio, longitud, jornada, tienda, reglasActivas, seccionRequerida) {
  const inicioMin = jornada.inicio + idxInicio * BLOQUE_MIN;
  const finMin = inicioMin + longitud * BLOQUE_MIN;
  const esApertura = idxInicio === 0;
  const esCierre = (idxInicio + longitud) >= jornada.numBloques;

  let mejor = null;
  let mejorPuntuacion = -Infinity;

  empleados.forEach(emp => {
    if (seccionRequerida && emp.seccion !== seccionRequerida) {
      // No descalifica totalmente: se permite pero se penaliza en productividad.
    }
    if (!esElegible(emp, estado[emp.id], dia, indiceDia, fechaDia, inicioMin, finMin, tienda)) return;

    const ctx = { dia, esApertura, esCierre, seccion: seccionRequerida };
    let puntuacion = 0;
    Object.keys(REGISTRO_REGLAS).forEach(idRegla => {
      const peso = reglasActivas[idRegla] || 0;
      if (peso <= 0) return;
      puntuacion += REGISTRO_REGLAS[idRegla](emp, estado[emp.id], ctx, peso);
    });

    if (puntuacion > mejorPuntuacion) { mejorPuntuacion = puntuacion; mejor = emp; }
  });

  return mejor;
}

/** PRIORIDAD 1: filtro duro de cumplimiento de convenio y disponibilidad. */
function esElegible(empleado, est, dia, indiceDia, fechaDia, inicioMin, finMin, tienda) {
  if (!empleado.disponibilidad || !empleado.disponibilidad[dia]) return false;
  if (empleado.vacaciones && empleado.vacaciones.includes(fechaDia)) return false;

  const horas = (finMin - inicioMin) / 60;
  if (horas > tienda.maxHorasDia + 0.001) return false;
  if (est.horasAsignadas + horas > empleado.horasSemanales + 0.001) return false;

  const turnosHoy = est.turnos[dia];
  if (turnosHoy.length >= tienda.maxTurnos) return false;

  // Descanso minimo respecto a otros turnos del mismo dia (turnos partidos).
  for (const t of turnosHoy) {
    const solapa = inicioMin < t.finMin && finMin > t.inicioMin;
    if (solapa) return false;
    const gapHoras = Math.min(Math.abs(inicioMin - t.finMin), Math.abs(t.inicioMin - finMin)) / 60;
    if (gapHoras < tienda.descansoMinimo) return false;
  }

  // Dias consecutivos: solo se comprueba al anadir el primer turno del dia.
  if (turnosHoy.length === 0) {
    const seriaConsecutivo = est.ultimoDiaIdx === indiceDia - 1;
    const consecutivosSiSeAnade = seriaConsecutivo ? est.consecutivos + 1 : 1;
    if (consecutivosSiSeAnade > tienda.maxDiasConsecutivos) return false;
  }

  // Turno fijo: si el empleado tiene manana/tarde fijo, respetarlo de forma orientativa.
  if (empleado.turnoFijo === 'manana' && inicioMin >= window.UI.horaAMinutos('14:00')) return false;
  if (empleado.turnoFijo === 'tarde' && inicioMin < window.UI.horaAMinutos('14:00')) return false;

  return true;
}

/** Registra el turno en el cuadrante del dia y actualiza el estado del empleado. */
function aplicarTurno(turnosDia, demanda, empleado, estado, dia, indiceDia, jornada, idxInicio, longitud, tienda, tipo, operacion) {
  const inicioMin = jornada.inicio + idxInicio * BLOQUE_MIN;
  const finMin = inicioMin + longitud * BLOQUE_MIN;
  const est = estado[empleado.id];

  for (let i = idxInicio; i < idxInicio + longitud && i < demanda.asignado.length; i++) {
    demanda.asignado[i]++;
  }

  const esPrimerTurnoDelDia = est.turnos[dia].length === 0;
  est.turnos[dia].push({ inicioMin, finMin });
  est.horasAsignadas += (finMin - inicioMin) / 60;

  if (esPrimerTurnoDelDia) {
    est.consecutivos = (est.ultimoDiaIdx === indiceDia - 1) ? est.consecutivos + 1 : 1;
    est.ultimoDiaIdx = indiceDia;
    if (dia === 'domingo') est.domingos++;
  }
  if (idxInicio === 0 && tipo === 'cobertura') est.aperturas++;
  if ((idxInicio + longitud) >= jornada.numBloques && tipo === 'cobertura') est.cierres++;

  turnosDia.push({
    empleadoId: empleado.id,
    nombre: empleado.nombre,
    tipo,
    horaInicio: window.UI.minutosAHora(inicioMin),
    horaFin: window.UI.minutosAHora(finMin),
    seccion: empleado.seccion,
    operacionNombre: operacion ? operacion.nombre : null,
    operacionId: operacion ? operacion.id : null
  });
}

/** Asigna personal a una operacion puntual, reutilizando turnos existentes si es posible. */
function asignarOperacion(turnosDia, operacion, dia, indiceDia, fechaDia, tienda, empleados, estado, reglasActivas) {
  const inicioMin = window.UI.horaAMinutos(operacion.hora);
  const finMin = inicioMin + operacion.duracion;
  let cubiertos = 0;

  // 1) Reutilizar empleados que ya tienen un turno de cobertura solapado.
  turnosDia.filter(t => t.tipo === 'cobertura').forEach(t => {
    if (cubiertos >= operacion.personasNecesarias) return;
    const tIni = window.UI.horaAMinutos(t.horaInicio);
    const tFin = window.UI.horaAMinutos(t.horaFin);
    if (tIni <= inicioMin && tFin >= finMin && !t.operacionNombre) {
      t.operacionNombre = operacion.nombre;
      t.operacionId = operacion.id;
      cubiertos++;
    }
  });

  // 2) Si falta personal, crear turnos adicionales dedicados a la operacion.
  const jornadaOperacion = { inicio: inicioMin, fin: finMin, numBloques: Math.ceil((finMin - inicioMin) / BLOQUE_MIN), tienda };
  const idxInicio = 0;
  const longitud = jornadaOperacion.numBloques || 1;

  while (cubiertos < operacion.personasNecesarias) {
    const candidato = elegirMejorCandidato(empleados, estado, dia, indiceDia, fechaDia, idxInicio, longitud, jornadaOperacion, tienda, reglasActivas, operacion.seccion);
    if (!candidato) break;
    aplicarTurno(turnosDia, { asignado: new Array(longitud).fill(0) }, candidato, estado, dia, indiceDia, jornadaOperacion, idxInicio, longitud, tienda, 'operacion', operacion);
    cubiertos++;
  }
}

/** Construye el resumen final de horas y equilibrios por empleado. */
function construirResumenEmpleado(personal, estado) {
  const resumen = {};
  personal.forEach(e => {
    const est = estado[e.id];
    resumen[e.id] = {
      nombre: e.nombre,
      horas: Math.round(est.horasAsignadas * 100) / 100,
      horasContrato: e.horasSemanales,
      aperturas: est.aperturas,
      cierres: est.cierres,
      domingos: est.domingos
    };
  });
  return resumen;
}

/** Suma dias a una fecha ISO (yyyy-mm-dd) y devuelve otra fecha ISO. */
function sumarDias(fechaIso, dias) {
  if (!fechaIso) return '';
  const d = new Date(fechaIso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* =========================================================================
   PANTALLA "GENERAR"
   ========================================================================= */

export async function render(container) {
  const tienda = leer(KEYS.TIENDA);
  const personal = leer(KEYS.PERSONAL, []);
  const cobertura = leer(KEYS.COBERTURA, []);
  const operaciones = leer(KEYS.OPERACIONES, []);
  const reglas = leer(KEYS.REGLAS, []);
  const cuadrante = leer(KEYS.CUADRANTE);

  const problemas = [];
  if (!tienda || !tienda.nombre) problemas.push('Completa la configuracion de la Tienda.');
  if (!personal.length) problemas.push('Da de alta al menos un empleado en Personal.');
  if (!cobertura.length) problemas.push('Define al menos una franja en Cobertura.');

  const lunesSugerido = proximoLunes();

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Generar cuadrante</h1>
          <p>El motor calculara el cuadrante optimo aplicando las reglas configuradas, por orden de prioridad.</p>
        </div>
      </div>

      ${problemas.length ? `
        <div class="card">
          <h3>Antes de generar</h3>
          <ul class="issue-list">
            ${problemas.map(p => `<li class="issue-item issue-item--warn"><span class="issue-item__icon">!</span><span>${p}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="card">
        <h3>Semana a generar</h3>
        <div class="form-grid">
          <div class="field">
            <label for="gen-semana">Lunes de la semana</label>
            <input id="gen-semana" type="date" value="${lunesSugerido}">
          </div>
        </div>
        <div class="actions-row">
          <button id="btn-generar" class="btn" ${problemas.length ? 'disabled' : ''}>Generar cuadrante</button>
          ${cuadrante ? '<button id="btn-ver-resultado" class="btn btn--secondary">Ver ultimo resultado</button>' : ''}
        </div>
        <p class="muted" id="gen-estado" style="margin-top:10px;"></p>
      </div>

      <div class="card">
        <h3>Datos que usara el motor</h3>
        <div class="grid grid-4">
          <div class="stat"><div class="stat__value">${personal.length}</div><div class="stat__label">Empleados</div></div>
          <div class="stat"><div class="stat__value">${cobertura.length}</div><div class="stat__label">Franjas cobertura</div></div>
          <div class="stat"><div class="stat__value">${operaciones.length}</div><div class="stat__label">Operaciones</div></div>
          <div class="stat"><div class="stat__value">${reglas.filter(r => r.activa).length}/${reglas.length}</div><div class="stat__label">Reglas activas</div></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-generar').addEventListener('click', () => {
    const semanaInicio = document.getElementById('gen-semana').value || lunesSugerido;
    const estadoTexto = document.getElementById('gen-estado');
    estadoTexto.textContent = 'Calculando...';
    // Se difiere un instante para que el navegador pinte el mensaje antes del calculo.
    setTimeout(() => {
      try {
        generarCuadrante(tienda, personal, cobertura, operaciones, reglas, semanaInicio);
        window.UI.toast('Cuadrante generado correctamente.');
        window.irA('resultado');
      } catch (err) {
        console.error(err);
        estadoTexto.textContent = 'Se produjo un error al generar el cuadrante.';
      }
    }, 30);
  });

  const btnVer = document.getElementById('btn-ver-resultado');
  if (btnVer) btnVer.addEventListener('click', () => window.irA('resultado'));
}

/** Devuelve el lunes de la semana actual (o el proximo si hoy es domingo) en formato ISO. */
function proximoLunes() {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0 domingo .. 6 sabado
  const offsetHastaLunes = diaSemana === 0 ? 1 : (1 - diaSemana);
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + offsetHastaLunes);
  return lunes.toISOString().slice(0, 10);
}

/* =========================================================================
   PANTALLA "RESULTADO"
   ========================================================================= */

let vistaActual = 'semanal';

export async function renderResultado(container) {
  const cuadrante = leer(KEYS.CUADRANTE);

  if (!cuadrante) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h3>Todavia no hay ningun cuadrante generado</h3>
          <p class="muted">Ve a la pantalla "Generar" para calcular el primer cuadrante.</p>
          <button class="btn" id="btn-ir-generar">Ir a Generar</button>
        </div>
      </div>
    `;
    document.getElementById('btn-ir-generar').addEventListener('click', () => window.irA('generar'));
    return;
  }

  const personal = leer(KEYS.PERSONAL, []);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Resultado</h1>
          <p>Cuadrante generado el ${new Date(cuadrante.generadoEl).toLocaleString('es-ES')} · Semana del ${cuadrante.semanaInicio || '-'}</p>
        </div>
      </div>

      <div class="tabs">
        <button class="tab-btn" data-vista="semanal">Vista semanal</button>
        <button class="tab-btn" data-vista="mensual">Vista mensual</button>
        <button class="tab-btn" data-vista="empleado">Vista por empleado</button>
        <button class="tab-btn" data-vista="dia">Vista por dia</button>
      </div>

      <div id="vista-contenido"></div>
    </div>
  `;

  container.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.vista === vistaActual);
    b.addEventListener('click', () => {
      vistaActual = b.dataset.vista;
      container.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
      pintarVista(document.getElementById('vista-contenido'), cuadrante, personal);
    });
  });

  pintarVista(document.getElementById('vista-contenido'), cuadrante, personal);
}

function pintarVista(el, cuadrante, personal) {
  if (vistaActual === 'semanal') return pintarVistaSemanal(el, cuadrante);
  if (vistaActual === 'mensual') return pintarVistaMensual(el, cuadrante, personal);
  if (vistaActual === 'empleado') return pintarVistaEmpleado(el, cuadrante, personal);
  if (vistaActual === 'dia') return pintarVistaDia(el, cuadrante);
}

function pintarVistaSemanal(el, cuadrante) {
  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="cuadrante-table">
          <thead><tr>${DIAS.map(d => `<th>${DIAS_LABEL[d]}</th>`).join('')}</tr></thead>
          <tbody>
            <tr>
              ${DIAS.map(d => `<td class="turno-cell">${renderChipsDia(cuadrante.dias[d])}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderChipsDia(turnos) {
  if (!turnos || !turnos.length) return '<span class="muted">Sin turnos</span>';
  return turnos
    .slice()
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    .map(t => `
      <span class="turno-chip ${t.tipo === 'operacion' ? 'turno-op' : ''}">
        ${esc(t.nombre)}<br>${t.horaInicio}-${t.horaFin}${t.operacionNombre ? ' · ' + esc(t.operacionNombre) : ''}
      </span>
    `).join('');
}

function pintarVistaMensual(el, cuadrante, personal) {
  // Estimacion mensual: se repite el patron semanal generado x4 (rotacion semanal).
  const filas = personal.map(p => {
    const r = cuadrante.resumenEmpleado[p.id] || { horas: 0 };
    return `<tr><td>${esc(p.nombre)}</td><td>${window.UI.formatoHoras(r.horas)}</td><td>${window.UI.formatoHoras(r.horas * 4)}</td></tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <h3>Estimacion mensual (patron semanal x4)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Empleado</th><th>Horas / semana</th><th>Horas / mes (aprox.)</th></tr></thead>
          <tbody>${filas || '<tr class="empty-row"><td colspan="3">Sin datos</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function pintarVistaEmpleado(el, cuadrante, personal) {
  el.innerHTML = `
    <div class="card">
      <div class="field" style="max-width:320px;">
        <label for="sel-empleado">Empleado</label>
        <select id="sel-empleado">
          ${personal.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <div id="detalle-empleado" style="margin-top:14px;"></div>
    </div>
  `;

  const select = document.getElementById('sel-empleado');
  const pintarDetalle = () => {
    const id = select.value;
    const emp = personal.find(p => p.id === id);
    const resumen = cuadrante.resumenEmpleado[id] || {};
    const filas = DIAS.map(d => {
      const turnos = (cuadrante.dias[d] || []).filter(t => t.empleadoId === id);
      const texto = turnos.length ? turnos.map(t => `${t.horaInicio}-${t.horaFin}${t.operacionNombre ? ' (' + esc(t.operacionNombre) + ')' : ''}`).join(', ') : '<span class="muted">Libre</span>';
      return `<tr><td>${DIAS_LABEL[d]}</td><td>${texto}</td></tr>`;
    }).join('');

    document.getElementById('detalle-empleado').innerHTML = `
      <div class="grid grid-4" style="margin-bottom:14px;">
        <div class="stat"><div class="stat__value">${window.UI.formatoHoras(resumen.horas || 0)}</div><div class="stat__label">Horas asignadas</div></div>
        <div class="stat"><div class="stat__value">${emp ? emp.horasSemanales : 0} h</div><div class="stat__label">Contrato semanal</div></div>
        <div class="stat"><div class="stat__value">${resumen.aperturas || 0}</div><div class="stat__label">Aperturas</div></div>
        <div class="stat"><div class="stat__value">${resumen.cierres || 0}</div><div class="stat__label">Cierres</div></div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Dia</th><th>Turno</th></tr></thead><tbody>${filas}</tbody></table>
      </div>
    `;
  };

  select.addEventListener('change', pintarDetalle);
  if (personal.length) pintarDetalle();
}

function pintarVistaDia(el, cuadrante) {
  el.innerHTML = `
    <div class="card">
      <div class="tabs" id="tabs-dias">
        ${DIAS.map((d, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-dia="${d}">${DIAS_LABEL[d]}</button>`).join('')}
      </div>
      <div id="detalle-dia"></div>
    </div>
  `;

  const pintar = (dia) => {
    const turnos = (cuadrante.dias[dia] || []).slice().sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    document.getElementById('detalle-dia').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Empleado</th><th>Horario</th><th>Tipo</th><th>Seccion</th></tr></thead>
          <tbody>
            ${turnos.length ? turnos.map(t => `
              <tr>
                <td>${esc(t.nombre)}</td>
                <td>${t.horaInicio} - ${t.horaFin}</td>
                <td>${t.tipo === 'operacion' ? `<span class="badge badge--warn">Operacion${t.operacionNombre ? ': ' + esc(t.operacionNombre) : ''}</span>` : '<span class="badge badge--info">Cobertura</span>'}</td>
                <td>${esc(t.seccion) || '-'}</td>
              </tr>
            `).join('') : '<tr class="empty-row"><td colspan="4">Sin turnos este dia.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };

  document.getElementById('tabs-dias').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('#tabs-dias .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    pintar(btn.dataset.dia);
  });

  pintar(DIAS[0]);
}

function esc(v) { return window.UI.escapeHtml(v); }
