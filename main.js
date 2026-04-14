// CONFIGURACIÓN DE LA URL DE APPS SCRIPT
// REEMPLAZAR ESTA CADENA CON LA URL PUBLICADA COMO APLICACIÓN WEB DE APPS SCRIPT
const API_URL = "https://script.google.com/macros/s/AKfycbx29MKCBivEqklwhrJA6TMkToCGeGA0RuINMPdKeiYFanapmWuNBnuatLn2MaHAAMQyig/exec";

const tenants = {
    'instituto_empresa': {
        name: 'Instituto de la Empresa',
        logo: 'https://cdn.bitrix24.es/b15495391/landing/7a8/7a88860fb02485c824de9be805faee6d/ie_1x.png',
        primary: '#df6621',
        primaryLight: '#f18244',
        primaryDark: '#8a3307',
        secondary: '#182a4d', /* Las rayas de los margenes en azul marino */
        hasCategories: false,
        heroTitle: 'Reserva tu Sesión de Coaching',
        heroSubtitle: 'Acompañamiento personalizado para estudiantes del Instituto de la Empresa',
        welcomeTheme: {
            headerBg: 'linear-gradient(135deg, #8a3307 0%, #df6621 100%)',
            accentColor: '#df6621',
            cardBg: '#fff7f3',
            cardBorder: '#f18244'
        }
    },
    'blackwell': {
        name: 'Blackwell Global University',
        logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR5_cFkfTk5W0cZjL7FMg-Cm-sm_INdEjYtFQ&s',
        primary: '#003c8f', /* Azul encendido y oscuro del logo */
        primaryLight: '#2c64b5',
        primaryDark: '#061d4a',
        secondary: '#003c8f',
        hasCategories: true,
        heroTitle: 'Sesiones de Coaching Académico',
        heroSubtitle: 'Potenciando tu formación de postgrado en Blackwell Global University',
        welcomeTheme: {
            headerBg: 'linear-gradient(135deg, #061d4a 0%, #2c64b5 100%)',
            accentColor: '#003c8f',
            cardBg: '#f0f4ff',
            cardBorder: '#2c64b5'
        }
    },
    'neumann': {
        name: 'Jhonn Vonn Neumann',
        logo: 'https://i.postimg.cc/DfgKYQTK/LOGO-NEUMANN.png',
        primary: '#00559c', /* Base de azul cruzado al morado para degradado */
        primaryLight: '#3a87c9',
        primaryDark: '#7b2282',
        secondary: '#33b2e3', /* Rayas secundarias celestes en base al logo */
        hasCategories: false,
        heroTitle: 'Agenda tu Sesión de Coaching',
        heroSubtitle: 'Espacio profesional para tu desarrollo académico en Neumann',
        welcomeTheme: {
            headerBg: 'linear-gradient(135deg, #00559c 0%, #7b2282 100%)',
            accentColor: '#00559c',
            cardBg: '#f0f8ff',
            cardBorder: '#3a87c9'
        }
    },
    'ua_chile': {
        name: 'Universidad Autónoma',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Universidad-autonoma-de-chile.png',
        primary: '#3a3a3a', /* Degradado de grises oscuros */
        primaryLight: '#555555',
        primaryDark: '#1a1a1a',
        secondary: '#e3000f', /* Rayas separadoras en rojo institucional */
        hasCategories: true,
        heroTitle: 'Reserva tu Sesión de Coaching',
        heroSubtitle: 'Acompañamiento personalizado para estudiantes de postgrado de la Universidad Autónoma.',
        welcomeTheme: {
            headerBg: 'linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 60%, #e3000f 100%)',
            accentColor: '#e3000f',
            cardBg: '#fdf5f5',
            cardBorder: '#e3000f'
        }
    }
};

let currentTenant = null;
let programsData = [];
let availableSlots = {};
let profilesData = []; // Store the user profiles
let monthlyQuotaInfo = null;
let iti = null; // Intl-tel-input instance

document.addEventListener('DOMContentLoaded', () => {
    initTenant();
    initPhoneInput();
    bindEvents();
    loadExternalData();
});

function initTenant() {
    const urlParams = new URLSearchParams(window.location.search);
    const tenantKey = urlParams.get('tenant') || 'neumann'; // Default a neumann

    currentTenant = tenants[tenantKey] || tenants['neumann'];

    // Set UI
    document.getElementById('tenant-logo').src = currentTenant.logo;
    document.getElementById('tenant-title').textContent = currentTenant.heroTitle || currentTenant.name;
    document.getElementById('tenant-subtitle').textContent = currentTenant.heroSubtitle || 'Sistema de Reserva de Citas Profesionales';
    document.getElementById('tenant-input').value = currentTenant.name;

    // Configure CSS variables
    const root = document.documentElement;
    root.style.setProperty('--primary', currentTenant.primary);
    root.style.setProperty('--primary-light', currentTenant.primaryLight);
    root.style.setProperty('--primary-dark', currentTenant.primaryDark);
    root.style.setProperty('--secondary', currentTenant.secondary || currentTenant.primary);
    if (currentTenant.bannerBg) root.style.setProperty('--banner-bg', currentTenant.bannerBg);

    // Configure program selectors based on tenant rules
    if (currentTenant.hasCategories) {
        document.getElementById('cat-col').classList.remove('hidden');
    }
}

function initPhoneInput() {
    const input = document.querySelector("#phone");
    iti = window.intlTelInput(input, {
        initialCountry: "auto",
        separateDialCode: true,
        autoPlaceholder: false,
        geoIpLookup: function (success, failure) {
            fetch("https://ipapi.co/json")
                .then(res => res.json())
                .then(data => success(data.country_code))
                .catch(() => success("pe")); // default perú
        }
    });
}

function bindEvents() {
    // Formulario Submit
    document.getElementById('reservation-form').addEventListener('submit', handleFormSubmit);

    // Select category changes options in programs
    document.getElementById('categoria').addEventListener('change', updateProgramsDropdown);

    // Modal close
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);

    // Drag-to-scroll logic for tabs
    initDragScroll(document.getElementById('date-tabs'));

    // Autocomplete for email
    const emailInput = document.getElementById('correo');
    emailInput.addEventListener('input', handleEmailInput);

    // Hide autocomplete when clicking outside
    document.addEventListener("click", function (e) {
        if (e.target !== emailInput) {
            document.getElementById('autocomplete-list').classList.add('hidden');
        }
    });

    document.getElementById('welcome-modal-close').addEventListener('click', closeWelcomeModal);
    document.getElementById('welcome-modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'welcome-modal-overlay') {
            closeWelcomeModal();
        }
    });
}

function initDragScroll(slider) {
    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        slider.style.cursor = 'grabbing';
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });
    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.style.cursor = 'grab';
    });
    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.style.cursor = 'grab';
    });
    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2; // Scroll-fast
        slider.scrollLeft = scrollLeft - walk;
    });
}

// ==========================================
// API Calls (Mock or Real)
// ==========================================

async function loadExternalData() {
    showLoader(true);

    if (!API_URL) {
        console.warn("API_URL no configurada. Usando datos Mockeados para demostración.");
        await sleep(1000);
        programsData = mockProgramsData();
        availableSlots = mockAvailabilityData();
        profilesData = [{ correo: 'admin@test.com', nombre: 'Admin Demo', telefono: '51987654321', edad: 30, dedicacion: 'Ingeniero', instituto: 'Jhonn Vonn Neumann', programa: 'ADMINISTRACIÓN' }];
        monthlyQuotaInfo = null;
        setupProgramsData();
        renderMonthlyQuotaInfo();
        renderCalendar();
        showLoader(false);
        showWelcomeModal();
        return;
    }

    try {
        const tenant = document.getElementById('tenant-input').value || '';
        // Fetch all data at once
        const res = await fetch(`${API_URL}?action=getInitialData&tenant=${encodeURIComponent(tenant)}`);
        const json = await res.json();

        programsData = json.programs || [];
        availableSlots = json.slots || {};
        profilesData = json.profiles || [];
        monthlyQuotaInfo = json.monthlyQuota || null;

        setupProgramsData();
        renderMonthlyQuotaInfo();
        renderCalendar();
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudieron cargar los datos iniciales del servidor.', 'error');
    } finally {
        showLoader(false);
        showWelcomeModal();
    }
}

function renderMonthlyQuotaInfo() {
    const el = document.getElementById('monthly-quota-info');
    if (!el) return;

    if (!monthlyQuotaInfo || typeof monthlyQuotaInfo.restantes !== 'number') {
        el.textContent = '';
        el.classList.add('hidden');
        el.classList.remove('low');
        return;
    }

    const restantes = monthlyQuotaInfo.restantes;
    const maximo = typeof monthlyQuotaInfo.maximo === 'number' ? monthlyQuotaInfo.maximo : 0;
    const claveMes = monthlyQuotaInfo.claveMes || 'mes actual';

    el.textContent = `Cupos restantes (${claveMes}): ${restantes} de ${maximo}`;
    el.classList.remove('hidden');
    el.classList.toggle('low', restantes <= 0);
}

// ==========================================
// Autocomplete Logic
// ==========================================

function handleEmailInput(e) {
    const val = e.target.value;
    const list = document.getElementById('autocomplete-list');
    list.innerHTML = '';

    if (val.length < 6) {
        list.classList.add('hidden');
        document.getElementById('email-hint').textContent = "Escriba su correo para cargar su perfil.";
        return;
    }

    const matches = profilesData.filter(p => p.correo.toLowerCase().includes(val.toLowerCase()));

    if (matches.length === 0) {
        list.classList.add('hidden');
        document.getElementById('email-hint').textContent = "No se encontraron perfiles. Ingrese uno nuevo.";
        return;
    }

    document.getElementById('email-hint').textContent = "Seleccione un perfil de la lista para autocompletar.";
    list.classList.remove('hidden');

    matches.forEach(m => {
        const item = document.createElement('div');
        // Highlight logic
        const start = m.correo.toLowerCase().indexOf(val.toLowerCase());
        const before = m.correo.substring(0, start);
        const matchStr = m.correo.substring(start, start + val.length);
        const after = m.correo.substring(start + val.length);

        item.innerHTML = `<strong>${before}<span style="background-color: yellow; color:black;">${matchStr}</span>${after}</strong><small>${m.nombre || 'Sin nombre'}</small>`;

        item.addEventListener('click', () => {
            autofillProfile(m);
            list.classList.add('hidden');
        });

        list.appendChild(item);
    });
}

function autofillProfile(profile) {
    document.getElementById('correo').value = profile.correo;
    document.getElementById('nombre').value = profile.nombre || '';
    if (profile.telefono) iti.setNumber("+" + profile.telefono.replace(/\D/g, ''));
    document.getElementById('edad').value = profile.edad || '';
    document.getElementById('dedicacion').value = profile.dedicacion || '';

    // Programa setting
    const progSelect = document.getElementById('programa');
    const catSelect = document.getElementById('categoria');

    if (currentTenant.hasCategories) {
        let foundCat = "";
        for (let p of programsData) {
            if (p.programas.includes(profile.programa)) {
                foundCat = p.categoria; break;
            }
        }
        if (foundCat) {
            catSelect.value = foundCat;
            updateProgramsDropdown();
        }
    }

    setTimeout(() => {
        progSelect.value = profile.programa || '';
    }, 100);

    const Toast = Swal.mixin({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
    });
    Toast.fire({
        icon: "success",
        title: "Datos autocompletados"
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();

    if (!iti.isValidNumber()) {
        Swal.fire('Error', 'Por favor ingrese un número de teléfono válido', 'error');
        return;
    }

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Obtener numero con codigo
    data.telefono = iti.getNumber();

    Swal.fire({
        title: 'Confirmando reserva...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    if (!API_URL) {
        await sleep(1500);
        Swal.fire({
            title: '¡Reserva Confirmada!',
            text: `(Demo) Su reserva para el ${data.fecha} a las ${data.hora}:00 ha sido simulada con éxito.`,
            icon: 'success',
            confirmButtonColor: currentTenant.primary
        }).then(() => {
            window.location.reload();
        });
        return;
    }

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(data),
            // cors modo opcional si hay problemas en despliegue simple
            // headers: {'Content-Type': 'text/plain'}  
        });
        const result = await res.json();

        if (result.success) {
            Swal.fire({
                title: '¡Reserva Confirmada!',
                text: result.message,
                icon: 'success',
                confirmButtonColor: currentTenant.primary
            }).then(() => {
                window.location.reload();
            });
        } else {
            throw new Error(result.error);
        }
    } catch (e) {
        Swal.fire('Error', 'Ocurrió un error al reservar: ' + e.message, 'error');
    }
}

// ==========================================
// UI Logic (Programs & Calendar)
// ==========================================

function setupProgramsData() {
    const term = currentTenant.name;
    // Filtrar programas para la institución actual
    let myPrograms = programsData.filter(p => p.instituto.includes(term) || term.includes(p.instituto));

    const catSelect = document.getElementById('categoria');
    const progSelect = document.getElementById('programa');

    if (currentTenant.hasCategories) {
        const categories = [...new Set(myPrograms.map(p => p.categoria).filter(c => c))];
        categories.forEach(c => {
            let opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            catSelect.appendChild(opt);
        });
    } else {
        // Cargar defrente todos los programas
        let allProgs = [];
        myPrograms.forEach(p => allProgs.push(...p.programas));
        allProgs.forEach(p => {
            let opt = document.createElement('option');
            opt.value = p; opt.textContent = p;
            progSelect.appendChild(opt);
        });
    }
}

function updateProgramsDropdown() {
    if (!currentTenant.hasCategories) return;

    const cat = document.getElementById('categoria').value;
    const progSelect = document.getElementById('programa');
    progSelect.innerHTML = '<option value="">Seleccione un programa...</option>';

    const term = currentTenant.name;
    let myPrograms = programsData.filter(p => (p.instituto.includes(term) || term.includes(p.instituto)) && p.categoria === cat);

    let progs = [];
    myPrograms.forEach(p => progs.push(...p.programas));
    progs.forEach(p => {
        let opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        progSelect.appendChild(opt);
    });
}

function renderCalendar() {
    const tabsContainer = document.getElementById('date-tabs');
    tabsContainer.innerHTML = '';

    const dates = Object.keys(availableSlots).sort();

    if (dates.length === 0) {
        tabsContainer.innerHTML = '<p>No hay fechas disponibles por el momento.</p>';
        return;
    }

    dates.forEach((dateStr, index) => {
        const [y, m, d] = dateStr.split('-');
        const dateObj = new Date(y, m - 1, d);

        const dayNames = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const num = dateObj.getDate();
        const strDay = dayNames[dateObj.getDay()];

        const tab = document.createElement('div');
        tab.className = 'date-tab';
        if (index === 0) tab.classList.add('active');

        tab.innerHTML = `<span class="day">${strDay}</span><span class="date">${num}</span>`;
        tab.onclick = () => {
            document.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderTimeSlots(dateStr);
        };

        tabsContainer.appendChild(tab);
    });

    // Render initial
    renderTimeSlots(dates[0]);
}

function renderTimeSlots(dateStr) {
    const container = document.getElementById('time-slots');
    container.innerHTML = '';

    const slots = availableSlots[dateStr] || [];

    if (slots.length === 0) {
        container.innerHTML = '<div class="no-slots-msg">Día ya no disponible ó todas las reservas fueron ocupadas de este día.</div>';
        return;
    }

    slots.forEach(slot => {
        const div = document.createElement('div');
        div.className = 'time-slot';
        div.textContent = slot.label;

        div.onclick = () => {
            document.querySelectorAll('.time-slot').forEach(t => t.classList.remove('selected'));
            div.classList.add('selected');
            selectDateTime(dateStr, slot);
        };

        container.appendChild(div);
    });
}

function selectDateTime(dateStr, slot) {
    document.getElementById('selected-date').value = dateStr;
    document.getElementById('selected-hour').value = slot.hour;

    // Show modal form
    document.getElementById('form-modal-overlay').classList.remove('hidden');
    document.getElementById('modal-summary-text').textContent = `📅 ${dateStr} - ⏰ ${slot.label}`;
}

function closeModal() {
    document.getElementById('form-modal-overlay').classList.add('hidden');
    // document.querySelectorAll('.time-slot').forEach(t => t.classList.remove('selected'));
}

function showLoader(show, text = 'Cargando...') {
    const l = document.getElementById('loader');
    if (show) {
        l.querySelector('p').textContent = text;
        l.classList.add('active');
    } else {
        l.classList.remove('active');
    }
}

// ==========================================
// Welcome Modal
// ==========================================

function showWelcomeModal() {
    if (!currentTenant) return;
    document.getElementById('welcome-modal-logo').src = currentTenant.logo;
    document.getElementById('welcome-modal-title').textContent = currentTenant.name;
    document.getElementById('welcome-modal-header').style.background = currentTenant.welcomeTheme?.headerBg || 'linear-gradient(135deg, #2c3e50 0%, #4a90e2 100%)';
    document.getElementById('welcome-modal-overlay').classList.remove('hidden');
    document.getElementById('welcome-modal-overlay').setAttribute('aria-hidden', 'false');
}

function closeWelcomeModal() {
    const overlay = document.getElementById('welcome-modal-overlay');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}

// ==========================================
// Mocks Helper (Para demo inicial local)
// ==========================================
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function mockProgramsData() {
    return [
        { instituto: 'Jhonn Vonn Neumann', categoria: '', programas: ['ADMINISTRACIÓN', 'CONTABILIDAD'] },
        { instituto: 'Instituto de la Empresa', categoria: '', programas: ['ADMINISTRACIÓN', 'CONTABILIDAD'] },
        { instituto: 'Universidad Autónoma', categoria: 'Master Program', programas: ['Máster en dirección de personas', 'Máster en Administración'] },
        { instituto: 'Universidad Autónoma', categoria: 'Doctoral Program', programas: ['Doctorate in Business Administration'] },
        { instituto: 'Blackwell Global University', categoria: 'Master Program', programas: ['Master of Business Administration', 'Master of Science in Project Management'] }
    ];
}

function mockAvailabilityData() {
    const data = {};
    const now = new Date();
    for (let i = 0; i < 5; i++) {
        let d = new Date(); d.setDate(now.getDate() + i);
        if (d.getDay() !== 0) { // No domingo
            const dateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            data[dateStr] = [
                { hour: 8, label: '8:00 AM' },
                { hour: 10, label: '10:00 AM' },
                { hour: 14, label: '2:00 PM' },
                { hour: 16, label: '4:00 PM' }
            ];
        }
    }
    return data;
}
