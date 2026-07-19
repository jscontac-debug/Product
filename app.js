/**
 * app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la aplicacion Product.
 * Responsabilidades:
 *  - Registrar el service worker (PWA / offline).
 *  - Inicializar los datos (demo) la primera vez que se abre la app.
 *  - Enrutar entre pantallas (SPA basada en hash), cargando cada
 *    modulo bajo demanda con import() dinamico.
 *  - Exponer utilidades comunes de interfaz (toast, escape html) en
 *    "window.UI" para que los modulos las reutilicen sin duplicarlas.
 * -----------------------------------------------------------------------
 */

import * as storage from './modules/storage.js';

/* ---------------------------------------------------------------------
 * Utilidades de interfaz compartidas (evitan duplicar codigo en cada
 * modulo). Se exponen en window.UI porque los modulos se cargan de
 * forma dinamica y esto evita dependencias circulares con app.js.
 * ------------------------------------------------------------------- */
window.UI = {

  /** Escapa texto para insertarlo de forma segura dentro de HTML. */
  escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /** Muestra un mensaje flotante temporal. */
  toast(mensaje, duracionMs = 2600) {
    const el = document.getElementById('toast');
    el.textContent = mensaje;
    el.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove('show'), duracionMs);
  },

  /** Confirmacion simple reutilizable (envuelve confirm nativo). */
  confirmar(mensaje) {
    return window.confirm(mensaje);
  },

  /** Convierte "HH:MM" a minutos desde medianoche. */
  horaAMinutos(hora) {
    const [h, m] = hora.split(':').map(Number);
    return h * 60 + m;
  },

  /** Convierte minutos desde medianoche a "HH:MM". */
  minutosAHora(mins) {
    const m = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  },

  /** Formatea un numero de horas con un decimal. */
  formatoHoras(horas) {
    return (Math.round(horas * 10) / 10).toString().replace('.', ',') + ' h';
  }
};

/* ---------------------------------------------------------------------
 * Definicion de rutas: cada una apunta al modulo que pinta la pantalla.
 * Todos los modulos exponen una funcion render(container) asincrona.
 * ------------------------------------------------------------------- */
const RUTAS = {
  dashboard: () => import('./modules/dashboard.js'),
  tienda: () => import('./modules/tienda.js'),
  personal: () => import('./modules/personal.js'),
  cobertura: () => import('./modules/cobertura.js'),
  operaciones: () => import('./modules/operaciones.js'),
  reglas: () => import('./modules/reglas.js'),
  generar: () => import('./modules/motor.js'),
  resultado: () => import('./modules/motor.js'),
  validacion: () => import('./modules/validacion.js'),
  informes: () => import('./modules/informes.js')
};

const contenedor = document.getElementById('app-container');
const nav = document.getElementById('main-nav');

/** Pinta la ruta activa en la barra de navegacion. */
function marcarNavActiva(ruta) {
  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === ruta);
  });
}

/** Resuelve la ruta actual a partir del hash de la URL. */
function rutaActual() {
  const hash = (location.hash || '#dashboard').replace('#', '');
  return RUTAS[hash] ? hash : 'dashboard';
}

/**
 * Carga y renderiza la pantalla correspondiente a la ruta indicada.
 * Cada modulo decide internamente que funcion exportar segun la
 * pantalla exacta (por ejemplo motor.js sirve tanto "generar" como
 * "resultado").
 */
async function navegar() {
  const ruta = rutaActual();
  marcarNavActiva(ruta);
  contenedor.innerHTML = '<p class="loading">Cargando...</p>';
  try {
    const modulo = await RUTAS[ruta]();
    if (ruta === 'resultado' && typeof modulo.renderResultado === 'function') {
      await modulo.renderResultado(contenedor);
    } else if (typeof modulo.render === 'function') {
      await modulo.render(contenedor);
    } else {
      contenedor.innerHTML = '<p>Esta pantalla aun no esta disponible.</p>';
    }
  } catch (err) {
    console.error('Error cargando la pantalla', ruta, err);
    contenedor.innerHTML = `<div class="card"><h3>No se pudo cargar la pantalla</h3><p class="muted">${window.UI.escapeHtml(err.message)}</p></div>`;
  }
  // Cierra el menu movil tras navegar.
  nav.classList.remove('open');
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/** Navega por codigo a una ruta (usado por botones internos de modulos). */
window.irA = function (ruta) {
  location.hash = '#' + ruta;
};

/* ---------------------------------------------------------------------
 * Eventos de navegacion
 * ------------------------------------------------------------------- */
nav.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.nav-item');
  if (!btn) return;
  location.hash = '#' + btn.dataset.route;
});

document.getElementById('btn-menu').addEventListener('click', () => {
  const abierto = nav.classList.toggle('open');
  document.getElementById('btn-menu').setAttribute('aria-expanded', String(abierto));
});

window.addEventListener('hashchange', navegar);

/* ---------------------------------------------------------------------
 * Arranque de la aplicacion
 * ------------------------------------------------------------------- */
async function iniciar() {
  if (!storage.estaInicializada()) {
    await storage.inicializarConDemo();
  }
  if (!location.hash) location.hash = '#dashboard';
  await navegar();
}

// Registro del service worker para funcionamiento offline (PWA).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('No se pudo registrar el service worker', err);
    });
  });
}

iniciar();
