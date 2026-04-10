const API_URL = "https://script.google.com/macros/s/AKfycbzXbJ2Zps3upHueJRdG94Ww5qdEG6E6mQFDZDE8ohV6e0JtVedH8wD5vklPB7o2JSnQ5g/exec";

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

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
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
    const [reservationsRes, initialRes] = await Promise.all([
        fetch(`${API_URL}?action=getAllReservations`),
        fetch(`${API_URL}?action=getInitialData`)
    ]);

    const resJson = await reservationsRes.json();
    const initData = await initialRes.json();

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

function setupEventListeners() {
    // Filters
    document.getElementById('filter-institute').addEventListener('change', applyFilters);
    document.getElementById('filter-status').addEventListener('change', applyFilters);

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
        if (datePickerInstance) datePickerInstance.clear();
        document.getElementById('filter-institute').value = 'Todos';
        document.getElementById('filter-status').value = 'Todos';
        applyFilters();
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
        $('#admin-table').DataTable().clear().destroy();
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

    // Tab 1: Alumno
    document.getElementById('alumno-info').innerHTML = `
        <div class="info-item"><label>Creado</label><span>${data.creado}</span></div>
        <div class="info-item"><label>Nombres</label><span>${data.nombres}</span></div>
        <div class="info-item"><label>Correo</label><span>${data.correo}</span></div>
        <div class="info-item"><label>Teléfono</label><span>${data.telefono}</span></div>
        <div class="info-item"><label>Edad</label><span>${data.edad || 'N/A'}</span></div>
        <div class="info-item"><label>Ocupación</label><span>${data.dedicacion || 'N/A'}</span></div>
        <div class="info-item"><label>Instituto</label><span>${data.instituto}</span></div>
        <div class="info-item"><label>Programa</label><span>${data.programa || 'N/A'}</span></div>
        <div class="info-item full-width" style="grid-column: 1 / -1;"><label>Motivo de reserva de esta cita</label><span>${data.motivo || 'No especificó'}</span></div>
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
    document.getElementById('ses-capturas').value = data.capturas;

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
        capturas: document.getElementById('ses-capturas').value
    };

    try {
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

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
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

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

function renderMiniCalendar() {
    const container = document.getElementById('mini-calendar');
    let tabsHtml = `<div class="date-tabs" style="display:flex; overflow-x:auto; gap:10px; padding-bottom:10px; margin-bottom:10px;">`;

    const dates = Object.keys(systemSlots).sort();

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
    }
}

window.selectMiniDate = function (dateStr, elem) {
    document.querySelectorAll('.date-tab').forEach(e => e.classList.remove('active'));
    elem.classList.add('active');
    selectedReschedDate = dateStr;
    selectedReschedTime = null;
    document.getElementById('btn-reprogramar').disabled = true;

    const slots = systemSlots[dateStr] || [];
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
        text: `Se duplicarán todos los datos del alumno y la sesión para crear la nueva cita de manera automática. La cita original actual se marcará inmediatamente como "Reprogramada" en tu base de datos.\n\nNueva fecha: ${selectedReschedDate} a las ${selectedReschedTime}:00`,
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
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const ans = await res.json();

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
        await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        closeLoader();
        Swal.fire('Enviado', 'Recordatorio enviado con éxito al correo del estudiante.', 'success');
    } catch (e) {
        closeLoader();
        Swal.fire('Error', 'Fallo al enviar correo.', 'error');
    }
}
