const API_URL = "https://script.google.com/macros/s/AKfycbyvh_QLXrUfOdX8ZEX7cctcDGqLyM3bHBzD6X2VJ1_Nz7YdZxDykw5fpUdFcmdDqiHbpw/exec";
const AUTH_TOKEN_KEY = 'eurocoach_auth_token';
const AUTH_USER_KEY = 'eurocoach_auth_user';
const LOGIN_PAGE = 'login.html';

// Global State
let allReservations = [];
let filteredReservations = [];
let systemSlots = {};
let systemPrograms = [];
let currentEditingId = null;

let itiPhone = null;

let statusChartInstance = null;
let instChartInstance = null;
let datePickerInstance = null;
let dtInstance = null;

let currentSessionImages = [];

function getAuthToken() {
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function clearSessionAndGoLogin() {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    window.location.href = LOGIN_PAGE;
}

function isUnauthorizedResult(result) {
    if (!result) return false;
    const txt = `${result.error || ''} ${result.message || ''}`.toLowerCase();
    return txt.includes('no autorizado') || txt.includes('sesión inválida') || txt.includes('sesion invalida') || txt.includes('expirada');
}

async function apiGet(action, params = {}) {
    const token = getAuthToken();
    const query = new URLSearchParams({ action, ...params, token }).toString();
    const response = await fetch(`${API_URL}?${query}`);
    const json = await response.json();

    if (isUnauthorizedResult(json)) {
        clearSessionAndGoLogin();
        throw new Error('Sesión inválida o expirada.');
    }

    return json;
}

async function apiPost(payload = {}) {
    const token = getAuthToken();
    const body = { ...payload, token };
    const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'text/plain' }
    });
    const json = await response.json();

    if (isUnauthorizedResult(json)) {
        clearSessionAndGoLogin();
        throw new Error('Sesión inválida o expirada.');
    }

    return json;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    if (!getAuthToken()) {
        clearSessionAndGoLogin();
        return;
    }

    datePickerInstance = flatpickr("#filter-date-range", {
        mode: "range",
        dateFormat: "d/m/Y",
        locale: "es",
        onChange: function (selectedDates, dateStr) {
            applyFilters();
        }
    });

    try {
        await loadInitialData();
        setupEventListeners();
        closeLoader();
    } catch (err) {
        console.error(err);
        closeLoader();
        Swal.fire('Error', 'Hubo un error de conexión con la hoja (Apps Script). Revise la consola del navegador.', 'error');
    }
});

async function loadInitialData() {
    // We need both all reservations AND the availability slots for rescheduling
    const [resJson, initData] = await Promise.all([
        apiGet('getAllReservations'),
        apiGet('getInitialData')
    ]);

    if (initData.error) {
        throw new Error('API Data Slots Error: ' + initData.error);
    }
    systemSlots = initData.slots;
    systemPrograms = initData.programs;

    if (!Array.isArray(resJson)) {
        console.error("API Error Payload: ", resJson);
        throw new Error(resJson.error || "La hoja(código.gs) no devolvió las filas limpiamente. Asegúrate de haber publicado como Nueva Implementación.");
    }

    // Remove empty ghost rows
    allReservations = resJson.filter(r => r && r.id);

    filteredReservations = [...allReservations];

    // Populate Filters
    populateInstituteFilter();

    // Initial Render
    updateDashboard();
}

function closeLoader() {
    document.getElementById('loader').classList.remove('active');
}

function showLoader() {
    document.getElementById('loader').classList.add('active');
}

// ----------------------------------------------------
// Dashboard & Filters
// ----------------------------------------------------
function populateInstituteFilter() {
    const filterSelect = document.getElementById('filter-institute');
    const institutes = [...new Set(allReservations.map(r => r.instituto).filter(i => i))];

    institutes.forEach(inst => {
        const opt = document.createElement('option');
        opt.value = inst;
        opt.textContent = inst;
        filterSelect.appendChild(opt);
    });
}

let isClearingFilters = false;

function setupEventListeners() {
    // Filters
    document.getElementById('filter-institute').addEventListener('change', applyFilters);
    document.getElementById('filter-status').addEventListener('change', applyFilters);

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
        isClearingFilters = true;
        if (datePickerInstance) datePickerInstance.clear();
        document.getElementById('filter-institute').value = 'Todos';
        document.getElementById('filter-status').value = 'Todos';
        isClearingFilters = false;
        applyFilters();
    });

    // Image Upload Events
    const dropzone = document.getElementById('dropzone');
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault(); dropzone.classList.remove('dragover');
        if (e.dataTransfer.files) handleImageFiles(e.dataTransfer.files);
    });

    document.getElementById('file-input').addEventListener('change', e => {
        if (e.target.files) handleImageFiles(e.target.files);
        e.target.value = ''; // Reset
    });

    document.addEventListener('paste', e => {
        // Only if modal is open and on tab 2
        if (!document.getElementById('management-modal').classList.contains('hidden') &&
            document.getElementById('tab-sesion').classList.contains('active')) {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            const files = [];
            for (let item of items) {
                if (item.type.indexOf('image') === 0) files.push(item.getAsFile());
            }
            if (files.length > 0) handleImageFiles(files);
        }
    });

    // Logout
    document.querySelector('.btn-logout').addEventListener('click', () => {
        clearSessionAndGoLogin();
    });

    // Modal Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.tab).classList.add('active');
        });
    });
}

function applyFilters() {
    if (isClearingFilters) return;

    const dates = datePickerInstance ? datePickerInstance.selectedDates : [];
    const inst = document.getElementById('filter-institute').value;
    const stat = document.getElementById('filter-status').value;

    const parseDate = (ddmmyyyy) => {
        if (!ddmmyyyy || typeof ddmmyyyy !== 'string') return null;
        const parts = ddmmyyyy.split('/');
        if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);

        return null;
    };

    filteredReservations = allReservations.filter(r => {
        const matchInst = inst === 'Todos' || r.instituto === inst;
        const matchStat = stat === 'Todos' || r.estado === stat;

        let matchDate = true;
        if (dates.length === 2) {
            const rDate = parseDate(r.fecha);
            if (rDate) {
                // Ignore time exactly for comparison
                const checkD = rDate.getTime();
                const startD = dates[0].getTime();
                const endD = dates[1].getTime();
                if (checkD < startD || checkD > endD) {
                    matchDate = false;
                }
            } else {
                matchDate = false;
            }
        }

        return matchInst && matchStat && matchDate;
    });

    updateDashboard();
}

function updateDashboard() {
    updateKPIs();
    renderTable();
    updateCharts();
}

function updateKPIs() {
    const total = filteredReservations.length;
    const realizadas = filteredReservations.filter(r => r.estado === 'Realizada').length;
    const programadas = filteredReservations.filter(r => r.estado === 'Programada').length;
    const reprogramadas = filteredReservations.filter(r => r.estado === 'Reprogramada').length;
    const canceladas = filteredReservations.filter(r => r.estado === 'Cancelada' || r.estado === 'No asistió').length;

    const html = `
        <div class="kpi-card total"><h2>${total}</h2><p>Total Registros</p></div>
        <div class="kpi-card realizadas"><h2>${realizadas}</h2><p>Realizadas</p></div>
        <div class="kpi-card programadas"><h2>${programadas}</h2><p>Programadas</p></div>
        <div class="kpi-card reprogramadas"><h2>${reprogramadas}</h2><p>Reprogramadas</p></div>
        <div class="kpi-card canceladas"><h2>${canceladas}</h2><p>Canc./No Asistió</p></div>
    `;
    document.getElementById('kpi-container').innerHTML = html;
}

function updateCharts() {
    const statesCount = { Programada: 0, Realizada: 0, Cancelada: 0, 'No asistió': 0, Reprogramada: 0 };
    const instCount = {};

    filteredReservations.forEach(r => {
        if (statesCount[r.estado] !== undefined) statesCount[r.estado]++;
        else statesCount[r.estado] = 1;

        if (!instCount[r.instituto]) instCount[r.instituto] = 0;
        instCount[r.instituto]++;
    });

    // Chart 1: Status
    const ctxStat = document.getElementById('statusChart').getContext('2d');
    if (statusChartInstance) statusChartInstance.destroy();
    statusChartInstance = new Chart(ctxStat, {
        type: 'doughnut',
        data: {
            labels: Object.keys(statesCount),
            datasets: [{
                data: Object.values(statesCount),
                backgroundColor: ['#3498db', '#2ecc71', '#e74c3c', '#95a5a6', '#f1c40f']
            }]
        },
        options: {
            cutout: '60%',
            maintainAspectRatio: false,
            responsive: true,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });

    const shortNames = {
        'Blackwell Global University': 'Blackwell',
        'Instituto de la Empresa': 'IE',
        'Jhonn Vonn Neumann': 'Neumann',
        'Universidad Autónoma': 'Autónoma'
    };

    const instColors = {
        'Blackwell Global University': '#003c8f',
        'Instituto de la Empresa': '#df6621',
        'Jhonn Vonn Neumann': '#7b2282',
        'Universidad Autónoma': '#e3000f'
    };

    const instLabels = Object.keys(instCount).map(k => shortNames[k] || k);
    const instBg = Object.keys(instCount).map(k => instColors[k] || '#3498db');

    // Chart 2: Institutions
    const ctxInst = document.getElementById('instituteChart').getContext('2d');
    if (instChartInstance) instChartInstance.destroy();
    instChartInstance = new Chart(ctxInst, {
        type: 'bar',
        data: {
            labels: instLabels,
            datasets: [{
                data: Object.values(instCount),
                backgroundColor: instBg
            }]
        },
        options: {
            maintainAspectRatio: false,
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function getBadgeClass(status) {
    status = status.toLowerCase();
    if (status === 'programada') return 'badge-status-programada';
    if (status === 'realizada') return 'badge-status-realizada';
    if (status === 'reprogramada') return 'badge-status-reprogramada';
    if (status === 'cancelada') return 'badge-status-cancelada';
    return 'badge-status-no-asistio';
}

function getInstClass(inst) {
    if (!inst) return '';
    inst = inst.toLowerCase();
    if (inst.includes('blackwell')) return 'badge-inst-blackwell';
    if (inst.includes('empresa')) return 'badge-inst-instituto';
    if (inst.includes('neumann')) return 'badge-inst-neumann';
    if (inst.includes('autónoma')) return 'badge-inst-ua';
    return '';
}

function getRowBg(inst) {
    if (!inst) return '';
    inst = inst.toLowerCase();
    if (inst.includes('blackwell')) return 'row-bg-blackwell';
    if (inst.includes('empresa')) return 'row-bg-instituto';
    if (inst.includes('neumann')) return 'row-bg-neumann';
    if (inst.includes('autónoma')) return 'row-bg-ua';
    return '';
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    let html = '';

    if ($.fn.DataTable.isDataTable('#admin-table')) {
        $('#admin-table').DataTable().destroy();
    }

    const parseDateISO = (ddmmyyyy) => {
        if (!ddmmyyyy) return '';
        const p = ddmmyyyy.split('/');
        if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`;
        return ddmmyyyy;
    };

    filteredReservations.forEach(r => {
        html += `
            <tr class="${getRowBg(r.instituto)}" onclick="openModal('${r.id}')">
                <td><span class="badge ${getBadgeClass(r.estado)}">${r.estado}</span></td>
                <td><strong>${r.sesionNumero || 1}</strong></td>
                <td data-order="${parseDateISO(r.fecha)}">${r.fecha}</td>
                <td><i class="far fa-clock"></i> ${r.hora}</td>
                <td><strong>${r.nombres}</strong></td>
                <td><span class="badge ${getInstClass(r.instituto)}">${r.instituto}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    dtInstance = $('#admin-table').DataTable({
        language: { url: "//cdn.datatables.net/plug-ins/1.13.6/i18n/es-ES.json" },
        order: [[2, 'desc']], // Sort by Fecha Reserva (Col 2)
        pageLength: 25,
        columnDefs: [
            { targets: '_all', className: 'dt-head-left' }
        ]
    });
}

// ----------------------------------------------------
// Image Uploading Logic
// ----------------------------------------------------
function handleImageFiles(files) {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (currentSessionImages.length + arr.length > 5) {
        Swal.fire('Límite excedido', 'Max 5 imágenes permitidas', 'warning');
        return;
    }
    arr.forEach(file => {
        // Create temp local preview
        const localUrl = URL.createObjectURL(file);
        const tempObj = { localUrl, loading: true };
        currentSessionImages.push(tempObj);
        renderImagePreviews();

        // Compress and upload
        compressImage(file, (base64, mimeType, filename) => {
            uploadToDrive(base64, mimeType, filename, tempObj);
        });
    });
}

function compressImage(file, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 1200;
            let width = img.width;
            let height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64Str = dataUrl.split(',')[1];

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            callback(base64Str, 'image/jpeg', `captura_${timestamp}.jpg`);
        }
    }
}

async function uploadToDrive(base64, mimeType, filename, tempObj) {
    try {
        const payload = { action: 'uploadImage', base64, mimeType, filename };
        const ans = await apiPost(payload);
        console.log("Upload Response: ", ans);

        const idx = currentSessionImages.indexOf(tempObj);
        if (ans.success && idx !== -1) {
            currentSessionImages[idx] = ans.url;
        } else if (idx !== -1) {
            currentSessionImages.splice(idx, 1);
            Swal.fire('Error del Servidor', ans.message || ans.error || 'Error desconocido revisa la consola', 'error');
        }
        renderImagePreviews();
    } catch (err) {
        console.error(err);
        const idx = currentSessionImages.indexOf(tempObj);
        if (idx !== -1) currentSessionImages.splice(idx, 1);
        renderImagePreviews();
    }
}

function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');
    container.innerHTML = '';
    currentSessionImages.forEach((imgObj, i) => {
        const isObj = typeof imgObj === 'object';
        const urlToView = isObj ? imgObj.localUrl : imgObj;

        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `<img src="${urlToView}" onclick="viewFullImage('${urlToView}')">`;

        if (isObj && imgObj.loading) {
            div.innerHTML += `<div class="loader-spinner"><i class="fas fa-spinner fa-spin fa-lg" style="color:#3498db;"></i></div>`;
        } else {
            div.innerHTML += `<div class="remove-btn" onclick="removeImage(${i})">X</div>`;
        }
        container.appendChild(div);
    });
}

function removeImage(idx) {
    currentSessionImages.splice(idx, 1);
    renderImagePreviews();
}

function viewFullImage(url) {
    // If it's a Drive URL without explicit viewer, attempting naive load. lh3 works.
    document.getElementById('viewer-img').src = url;
    const aLink = document.getElementById('viewer-link');
    if (aLink) aLink.href = url;
    document.getElementById('image-viewer-modal').classList.remove('hidden');
}

// ----------------------------------------------------
// Modals
// ----------------------------------------------------
function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function openModal(id) {
    currentEditingId = id;
    const data = allReservations.find(r => r.id === id);
    if (!data) return;

    // Reset Tabs
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="tab-alumno"]').classList.add('active');
    document.getElementById('tab-alumno').classList.add('active');

    // Setting Modal Subtitle
    const sub = document.getElementById('modal-subtitle');
    if (sub) {
        sub.innerHTML = `
            <span style="color:#311b54;font-weight:700;"><i class="far fa-calendar-alt" style="color:#06c0cf;margin-right:4px;"></i>${data.fecha}</span>
            <span style="color:#888;">|</span>
            <span style="color:#311b54;font-weight:700;"><i class="far fa-clock" style="color:#06c0cf;margin-right:4px;"></i>${data.hora}</span>
            <span style="color:#888;">|</span>
            <span style="color:#311b54;font-weight:600;"><i class="fas fa-map-marker-alt" style="color:#e74c3c;margin-right:4px;"></i>${data.instituto}</span>
            <span style="color:#888;">|</span>
            <span style="color:#06c0cf;font-weight:700;">${data.sesionNumero || 'Nueva Cita'}</span>
        `;
    }

    // Tab 1: Info (Grouped using ficha-section)
    document.getElementById('alumno-info').innerHTML = `
        <div class="ficha-section sec-estudiante">
            <h5 class="section-title"><i class="fas fa-user"></i> Datos del Estudiante</h5>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px;">
                <div class="info-item"><label>Nombre Completo</label><span>${data.nombres}</span></div>
                <div class="info-item"><label>Teléfono</label><span>${data.telefono}</span></div>
                <div class="info-item"><label>Correo Electrónico</label><span>${data.correo}</span></div>
                <div class="info-item"><label>Profesión / Ocup.</label><span>${data.dedicacion || 'N/A'}</span></div>
                <div class="info-item"><label>Edad</label><span>${data.edad || 'N/A'}</span></div>
            </div>
        </div>
        
        <div class="ficha-section sec-instituto">
            <h5 class="section-title"><i class="fas fa-university"></i> Instituto y Programa</h5>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px;">
                <div class="info-item"><label>Instituto / Univ.</label><span>${data.instituto}</span></div>
                <div class="info-item"><label>Programa Académico</label><span>${data.programa || 'N/A'}</span></div>
            </div>
        </div>
        
        <div class="ficha-section sec-motivo">
            <h5 class="section-title"><i class="fas fa-bullseye"></i> Registro de Sesión</h5>
            <div style="display:grid; grid-template-columns:1fr; gap:15px;">
                <div class="info-item"><label>Creado</label><span>${data.creado}</span></div>
                <div class="info-item"><label>Motivo Central de la Cita</label><span>${data.motivo || 'No especificó'}</span></div>
            </div>
        </div>
    `;

    // Process Historial
    const helperISO = (d) => {
        if (!d) return '';
        const p = d.split('/');
        return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
    };
    const historialHtml = allReservations
        .filter(x => x.correo.toLowerCase() === data.correo.toLowerCase() && x.id !== data.id)
        .sort((a, b) => helperISO(b.fecha).localeCompare(helperISO(a.fecha)))
        .map(h => `
            <div style="background:var(--primary-light); padding:10px; border-radius:6px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <strong>${h.sesionNumero || '-'}</strong>
                    <span class="badge ${getBadgeClass(h.estado)}">${h.estado}</span>
                </div>
                <div style="font-size:0.85rem; color:#555; margin-bottom:5px;">
                    <i class="far fa-calendar"></i> ${h.fecha} &nbsp;&nbsp; <i class="far fa-clock"></i> ${h.hora}
                </div>
                <div style="font-size:0.85rem;"><strong>Motivo:</strong> ${h.motivo || 'N/A'}</div>
            </div>
        `).join('') || '<div style="font-size:0.9rem; color:#7f8c8d;">No hay citas pasadas u otras reservas registradas.</div>';

    document.getElementById('alumno-historial').innerHTML = historialHtml;

    // Tab 2: Sesión Info
    document.getElementById('ses-estado').value = data.estado;
    document.getElementById('ses-numero').value = data.sesionNumero;
    document.getElementById('ses-problema').value = data.problema;
    document.getElementById('ses-profundidad').value = data.profundidad;
    document.getElementById('ses-objetivo').value = data.objetivo;
    document.getElementById('ses-impacto').value = data.impacto;
    document.getElementById('ses-dificultad').value = data.tipoDificultad;
    document.getElementById('ses-compromiso').value = data.nivelCompromiso;
    document.getElementById('ses-notas').value = data.notas;

    currentSessionImages = data.capturas ? data.capturas.split('|').map(x => x.trim()).filter(x => x) : [];
    renderImagePreviews();

    // Tab 3: Reprogramación
    document.getElementById('reprog-motivo').value = '';
    renderMiniCalendar();

    // Tab 4: Recordatorio Setup
    document.getElementById('email-subject').value = `Recordatorio de Sesión de Coaching - EUROCOACH`;

    document.getElementById('management-modal').classList.remove('hidden');
}

// ----------------------------------------------------
// Save Session Info
// ----------------------------------------------------
async function saveSessionInfo() {
    showLoader();
    const payload = {
        action: 'updateReservation',
        id: currentEditingId,
        estado: document.getElementById('ses-estado').value,
        sesionNumero: document.getElementById('ses-numero').value,
        problema: document.getElementById('ses-problema').value,
        profundidad: document.getElementById('ses-profundidad').value,
        objetivo: document.getElementById('ses-objetivo').value,
        impacto: document.getElementById('ses-impacto').value,
        tipoDificultad: document.getElementById('ses-dificultad').value,
        nivelCompromiso: document.getElementById('ses-compromiso').value,
        notas: document.getElementById('ses-notas').value,
        capturas: currentSessionImages.join(' | ')
    };

    try {
        await apiPost(payload);

        // Update local object
        const idx = allReservations.findIndex(r => r.id === currentEditingId);
        if (idx !== -1) {
            Object.assign(allReservations[idx], payload);
        }

        applyFilters();
        closeLoader();
        Swal.fire('Guardado', 'Información de la sesión actualizada.', 'success');
    } catch (e) {
        closeLoader();
        Swal.fire('Error', 'No se pudo guardar la información.', 'error');
    }
}

// ----------------------------------------------------
// Edit Student Info
// ----------------------------------------------------
function openEditStudentModal() {
    const data = allReservations.find(r => r.id === currentEditingId);
    if (!data) return;

    document.getElementById('edit-nombres').value = data.nombres;
    document.getElementById('edit-correo').value = data.correo;
    document.getElementById('edit-edad').value = data.edad;
    document.getElementById('edit-dedicacion').value = data.dedicacion;
    document.getElementById('edit-instituto').value = data.instituto;

    // Load available programs dynamic dropdown
    const selPrograma = document.getElementById('edit-programa');
    selPrograma.innerHTML = '';
    let foundProgs = [];
    systemPrograms.forEach(instGroup => {
        if (instGroup.instituto.toLowerCase().includes(data.instituto.toLowerCase())) {
            foundProgs = foundProgs.concat(instGroup.programas);
        }
    });

    // Default to unique array using set
    [...new Set(foundProgs)].forEach(prog => {
        const opt = document.createElement('option');
        opt.value = prog;
        opt.textContent = prog;
        selPrograma.appendChild(opt);
    });
    // Set actual value or fallback
    if (selPrograma.querySelector(`option[value="${data.programa}"]`)) {
        selPrograma.value = data.programa;
    } else if (data.programa) {
        // Just in case it's an old program that was deleted, keep it visible
        const opt = document.createElement('option');
        opt.value = data.programa;
        opt.textContent = data.programa;
        selPrograma.appendChild(opt);
        selPrograma.value = data.programa;
    }

    // Phone setup with iti
    const telInput = document.getElementById('edit-telefono');
    telInput.value = data.telefono || '';
    if (itiPhone) {
        itiPhone.destroy();
    }
    itiPhone = window.intlTelInput(telInput, {
        initialCountry: "auto",
        separateDialCode: true
    });

    document.getElementById('edit-student-modal').classList.remove('hidden');
}

async function saveStudentEdit() {
    showLoader();
    let finalPhone = document.getElementById('edit-telefono').value;
    if (itiPhone && itiPhone.isValidNumber()) {
        finalPhone = itiPhone.getNumber();
    }

    const payload = {
        action: 'updateStudent',
        id: currentEditingId,
        nombres: document.getElementById('edit-nombres').value,
        telefono: finalPhone,
        edad: document.getElementById('edit-edad').value,
        dedicacion: document.getElementById('edit-dedicacion').value,
        instituto: document.getElementById('edit-instituto').value,
        programa: document.getElementById('edit-programa').value
    };

    try {
        await apiPost(payload);

        // Update local
        const idx = allReservations.findIndex(r => r.id === currentEditingId);
        if (idx !== -1) {
            Object.assign(allReservations[idx], payload);
        }

        applyFilters();
        closeModal('edit-student-modal');
        openModal(currentEditingId); // Refresh main modal
        closeLoader();
        Swal.fire('Guardado', 'Datos del alumno actualizados.', 'success');
    } catch (e) {
        closeLoader();
        Swal.fire('Error', 'No se pudo guardar.', 'error');
    }
}

// ----------------------------------------------------
// Reprogrammation mini calendar
// ----------------------------------------------------
let selectedReschedDate = null;
let selectedReschedTime = null;

function parseReservationDateFlexible(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const clean = dateStr.trim();
    if (!clean) return null;

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
        const [day, month, year] = clean.split('/').map(part => parseInt(part, 10));
        return new Date(year, month - 1, day);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        const [year, month, day] = clean.split('-').map(part => parseInt(part, 10));
        return new Date(year, month - 1, day);
    }

    return null;
}

function getAdminRescheduleSlots() {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 15);

    const bookedSlots = {};

    allReservations.forEach(reservation => {
        if (reservation.estado !== 'Programada') return;

        const reservationDate = parseReservationDateFlexible(reservation.fecha);
        if (!reservationDate) return;

        const key = `${reservationDate.getFullYear()}-${String(reservationDate.getMonth() + 1).padStart(2, '0')}-${String(reservationDate.getDate()).padStart(2, '0')}`;
        const hourMatch = (reservation.hora || '').toString().match(/^(\d{1,2})/);
        if (!hourMatch) return;

        const hour = parseInt(hourMatch[1], 10);
        if (!bookedSlots[key]) bookedSlots[key] = [];
        bookedSlots[key].push(hour);
    });

    const slotsByDate = {};

    for (let i = 0; i <= 15; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);

        if (checkDate.getDay() === 0) continue;

        const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        const currentBooked = bookedSlots[key] || [];
        const available = [];

        for (let hour = 8; hour <= 18; hour++) {
            if (i === 0 && checkDate.getHours() >= hour) continue;
            if (currentBooked.includes(hour)) continue;

            const ampm = hour >= 12 ? 'PM' : 'AM';
            const h = hour % 12 || 12;
            available.push({ hour, label: `${h}:00 ${ampm}` });
        }

        slotsByDate[key] = available;
    }

    return slotsByDate;
}

function renderMiniCalendar() {
    const container = document.getElementById('mini-calendar');
    let tabsHtml = `<div class="date-tabs" style="display:flex; overflow-x:auto; gap:10px; padding-bottom:10px; margin-bottom:10px;">`;

    const adminSlots = getAdminRescheduleSlots();
    const dates = Object.keys(adminSlots).sort();

    dates.forEach((date, i) => {
        const dObj = new Date(date + "T12:00:00");
        const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        tabsHtml += `
            <div class="date-tab ${i === 0 ? 'active' : ''}" onclick="selectMiniDate('${date}', this)">
                <span class="day">${days[dObj.getDay()]}</span>
                <span class="date">${dObj.getDate()}</span>
            </div>
        `;
    });
    tabsHtml += `</div><div id="mini-slots" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px;"></div>`;

    container.innerHTML = tabsHtml;

    if (dates.length > 0) {
        selectMiniDate(dates[0], container.querySelector('.date-tab'));
    } else {
        document.getElementById('mini-slots').innerHTML = `<div style="grid-column: 1/-1; text-align:center; color:#777; padding:10px 0;">No hay horarios</div>`;
    }
}

window.selectMiniDate = function (dateStr, elem) {
    document.querySelectorAll('.date-tab').forEach(e => e.classList.remove('active'));
    elem.classList.add('active');
    selectedReschedDate = dateStr;
    selectedReschedTime = null;
    document.getElementById('btn-reprogramar').disabled = true;

    const slots = getAdminRescheduleSlots()[dateStr] || [];
    let slotsHtml = '';

    if (slots.length === 0) {
        slotsHtml = `<div style="grid-column: 1/-1; text-align:center;">No hay horarios</div>`;
    } else {
        slots.forEach(slot => {
            slotsHtml += `<div class="time-slot" onclick="selectMiniTime('${slot.hour}', this)">${slot.label}</div>`;
        });
    }

    document.getElementById('mini-slots').innerHTML = slotsHtml;
}

window.selectMiniTime = function (hourStr, elem) {
    document.querySelectorAll('.time-slot').forEach(e => e.classList.remove('selected'));
    elem.classList.add('selected');
    selectedReschedTime = hourStr;
    document.getElementById('btn-reprogramar').disabled = false;
}

async function processReschedule() {
    if (!selectedReschedDate || !selectedReschedTime) return;

    const obj = allReservations.find(r => r.id === currentEditingId);
    if (!obj) return;
    const mo = document.getElementById('reprog-motivo').value;

    const result = await Swal.fire({
        title: '¿Confirmar reprogramación?',
        text: `Se creará una nueva reserva automáticamente.\n\nNueva fecha: ${selectedReschedDate} a las ${selectedReschedTime}:00 \n\n Motivo: ${mo} \n\nSe mantendrá en el historial la cita original.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, reprogramar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    showLoader();
    const payload = {
        action: 'reschedule',
        id: currentEditingId,
        motivoReprogramacion: mo,
        nuevaFecha: selectedReschedDate,
        nuevaHora: selectedReschedTime
    };

    try {
        const ans = await apiPost(payload);

        if (ans.success) {
            Swal.fire('Éxito', 'Cita reprogramada correctamente. (Por favor recargue si desea ver el nuevo ID)', 'success');
            setTimeout(() => location.reload(), 1500); // Easiest way to get new record and sync
        } else {
            Swal.fire('Error', ans.message || "Fallo en el servidor", 'error');
            closeLoader();
        }
    } catch (e) {
        closeLoader();
        Swal.fire('Error', 'No se pudo conectar', 'error');
    }
}

// ----------------------------------------------------
// Send Email Reminder
// ----------------------------------------------------
async function sendReminderEmail() {
    const obj = allReservations.find(r => r.id === currentEditingId);
    if (!obj) return;

    showLoader();
    const payload = {
        action: 'sendReminder',
        nombres: obj.nombres,
        correo: obj.correo,
        instituto: obj.instituto,
        asunto: document.getElementById('email-subject').value,
        mensaje: document.getElementById('email-body').value,
        links: document.getElementById('email-links').value
    };

    try {
        await apiPost(payload);
        closeLoader();
        Swal.fire('Enviado', 'Recordatorio enviado con éxito al correo del estudiante.', 'success');
    } catch (e) {
        closeLoader();
        Swal.fire('Error', 'Fallo al enviar correo.', 'error');
    }
}

// ----------------------------------------------------
// Deleting Records
// ----------------------------------------------------
async function deleteCurrentRecord() {
    const confirmation = await Swal.fire({
        title: '¿Estás completamente seguro?',
        text: "Vas a eliminar el registro actual, y no se verá más en la data. Esta acción es IRREVERSIBLE.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        cancelButtonColor: '#7f8c8d',
        confirmButtonText: 'Sí, Eliminar Permanentemente',
        cancelButtonText: 'Cancelar'
    });

    if (confirmation.isConfirmed) {
        showLoader('Eliminando reserva y limpiando calendario...');
        try {
            const payload = { action: 'deleteRecord', id: currentEditingId };
            const ans = await apiPost(payload);

            if (ans.success) {
                closeModal('management-modal');
                Swal.fire('¡Eliminado!', 'El registro fue completamente eliminado.', 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                Swal.fire('Error', ans.message || 'Fallo desconocido.', 'error');
                closeLoader();
            }
        } catch (e) {
            closeLoader();
            Swal.fire('Error de Conexión', e.toString(), 'error');
        }
    }
}

// ----------------------------------------------------
// Canceling Records (Just Status Change + Calendar Freeing)
// ----------------------------------------------------
async function cancelCurrentRecord() {
    const confirmation = await Swal.fire({
        title: '¿Confirmar Cancelación?',
        text: "La cita se marcará como Cancelada y se liberará su espacio en el Calendario inmediatamente. Aún se mantendrá en el historial.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        cancelButtonColor: '#7f8c8d',
        confirmButtonText: 'Sí, Cancelar Cita',
        cancelButtonText: 'No, Volver'
    });

    if (confirmation.isConfirmed) {
        showLoader('Cancelando reserva y liberando calendario...');
        try {
            const obj = allReservations.find(r => r.id === currentEditingId);

            // Reusing updateReservationData standard payload, BUT overriding 'estado' 
            const payload = {
                action: 'updateReservation',
                id: currentEditingId,
                estado: 'Cancelada',
                sesionNumero: obj.sesionNumero || '',
                problema: obj.problema || '',
                profundidad: obj.profundidad || '',
                objetivo: obj.objetivo || '',
                impacto: obj.impacto || '',
                tipoDificultad: obj.tipoDificultad || '',
                nivelCompromiso: obj.nivelCompromiso || '',
                notas: obj.notas || '',
                capturas: obj.capturas || ''
            };

            const ans = await apiPost(payload);

            if (ans.success) {
                closeModal('management-modal');
                Swal.fire('¡Cancelada!', 'La cita fue cancelada y liberada del calendario.', 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                Swal.fire('Error', ans.message || "Fallo en el servidor al intentar cancelar", 'error');
                closeLoader();
            }
        } catch (e) {
            closeLoader();
            Swal.fire('Error de Conexión', e.toString(), 'error');
        }
    }
}

// ============================================================
// VISTA CALENDARIO
// ============================================================
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-based

function getCalInstClass(inst) {
    if (!inst) return 'other';
    const i = inst.toLowerCase();
    if (i.includes('blackwell')) return 'blackwell';
    if (i.includes('empresa')) return 'ie';
    if (i.includes('neumann')) return 'neumann';
    if (i.includes('autónoma') || i.includes('autonoma')) return 'ua';
    return 'other';
}

function parseReservationDate(dateStr) {
    // Supports DD/MM/YYYY
    if (!dateStr || typeof dateStr !== 'string') return null;

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const p = dateStr.split('/');
        return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const p = dateStr.split('-');
        return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    }

    return null;
}

function switchView(view) {
    const listEl = document.getElementById('view-list');
    const calEl = document.getElementById('view-calendar');
    const btnList = document.getElementById('btn-view-list');
    const btnCal = document.getElementById('btn-view-cal');

    if (view === 'list') {
        listEl.style.display = '';
        calEl.style.display = 'none';
        btnList.classList.add('active');
        btnCal.classList.remove('active');
    } else {
        listEl.style.display = 'none';
        calEl.style.display = '';
        btnList.classList.remove('active');
        btnCal.classList.add('active');
        renderCalendarGrid();
    }
}

function calPrevMonth() {
    calCurrentMonth--;
    if (calCurrentMonth < 0) { calCurrentMonth = 11; calCurrentYear--; }
    renderCalendarGrid();
}

function calNextMonth() {
    calCurrentMonth++;
    if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
    renderCalendarGrid();
}

function renderCalendarGrid() {
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    document.getElementById('cal-month-label').textContent = `${months[calCurrentMonth]} de ${calCurrentYear}`;

    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';

    const today = new Date();
    const firstDay = new Date(calCurrentYear, calCurrentMonth, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();

    // Group filteredReservations by YYYY-MM-DD key
    const byDate = {};
    filteredReservations.forEach(r => {
        const d = parseReservationDate(r.fecha);
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(r);
    });

    // Empty leading cells
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-cell empty';
        grid.appendChild(empty);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const reservations = byDate[dateKey] || [];
        const isToday = today.getFullYear() === calCurrentYear && today.getMonth() === calCurrentMonth && today.getDate() === day;

        const cell = document.createElement('div');
        cell.className = 'cal-cell' + (isToday ? ' today' : '');
        cell.innerHTML = `<div class="cal-day-num">${day}</div>`;

        if (reservations.length > 0) {
            const dotsDiv = document.createElement('div');
            dotsDiv.className = 'cal-dots';
            const MAX_DOTS = 6;
            reservations.slice(0, MAX_DOTS).forEach(r => {
                const dot = document.createElement('span');
                dot.className = `cal-dot ${getCalInstClass(r.instituto)}`;
                dot.title = r.nombres;
                dotsDiv.appendChild(dot);
            });
            if (reservations.length > MAX_DOTS) {
                const more = document.createElement('span');
                more.style.cssText = 'font-size:0.6rem;color:#888;align-self:center;';
                more.textContent = `+${reservations.length - MAX_DOTS}`;
                dotsDiv.appendChild(more);
            }
            cell.appendChild(dotsDiv);
        }

        cell.addEventListener('click', () => {
            // Remove previous selected
            document.querySelectorAll('.cal-cell.selected').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
            renderDayPanel(day, reservations);
        });

        grid.appendChild(cell);
    }
}

function renderDayPanel(day, reservations) {
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    document.getElementById('cal-day-title').textContent =
        `${String(day).padStart(2, '0')} de ${months[calCurrentMonth]} ${calCurrentYear} — ${reservations.length} reserva(s)`;

    const list = document.getElementById('cal-day-list');

    if (reservations.length === 0) {
        list.innerHTML = '<p style="color:#aaa; text-align:center; margin-top:40px; font-size:0.9rem;">Sin reservas para este día</p>';
        return;
    }

    // Sort by hour
    const sorted = [...reservations].sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));

    list.innerHTML = sorted.map(r => {
        const instCls = getCalInstClass(r.instituto);
        const statusColors = {
            'Programada': '#3498db', 'Realizada': '#2ecc71',
            'Cancelada': '#e74c3c', 'No asistió': '#95a5a6', 'Reprogramada': '#f1c40f'
        };
        const stColor = statusColors[r.estado] || '#aaa';
        return `
            <div class="cal-reservation-card ${instCls}" onclick="openModal('${r.id}')">
                <div class="cal-res-name">${r.nombres}</div>
                <div class="cal-res-meta">
                    <i class="far fa-clock" style="color:#999;"></i> ${r.hora}
                    <span style="color:${stColor}; font-weight:600; font-size:0.8rem;">${r.estado}</span>
                </div>
                <span class="cal-res-inst ${instCls}">${r.instituto || '—'}</span>
            </div>`;
    }).join('');
}

// Re-render calendar when filters change (hook into updateDashboard)
const _origUpdateDashboard = updateDashboard;
window.updateDashboard = function () {
    _origUpdateDashboard();
    if (document.getElementById('view-calendar').style.display !== 'none') {
        renderCalendarGrid();
    }
};
