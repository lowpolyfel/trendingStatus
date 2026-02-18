const state = {
  month: getInitialMonth(),
  tasks: [],
  records: [],
  dashboard: null,
  editingTask: null,
  editingRecord: null,
  charts: {
    performance: null,
    trend: null,
  },
};

const monthPicker = document.getElementById('monthPicker');
const tasksTableBody = document.getElementById('tasksTableBody');
const recordsTableBody = document.getElementById('recordsTableBody');
const kpiGrid = document.getElementById('kpiGrid');
const toast = document.getElementById('toast');

const taskDialog = document.getElementById('taskDialog');
const taskForm = document.getElementById('taskForm');
const taskDialogTitle = document.getElementById('taskDialogTitle');
const recordDialog = document.getElementById('recordDialog');
const recordForm = document.getElementById('recordForm');
const recordDialogTitle = document.getElementById('recordDialogTitle');
const recordTaskSelect = document.getElementById('recordTaskSelect');

document.getElementById('openTaskModal').addEventListener('click', () => openTaskModal());
document.getElementById('openRecordModal').addEventListener('click', () => openRecordModal());
monthPicker.addEventListener('change', async (event) => {
  state.month = event.target.value;
  await refresh();
});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(taskForm);
  const payload = {
    name: formData.get('name'),
    target: Number(formData.get('target')),
  };

  if (state.editingTask) {
    await request(`/api/tasks/${state.editingTask.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast('Tarea actualizada.');
  } else {
    await request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Tarea creada.');
  }

  taskDialog.close();
  taskForm.reset();
  state.editingTask = null;
  await refresh();
});

recordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(recordForm);
  const payload = {
    task_id: Number(formData.get('task_id')),
    record_date: formData.get('record_date'),
    quantity: Number(formData.get('quantity')),
  };

  if (state.editingRecord) {
    await request(`/api/records/${state.editingRecord.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast('Registro actualizado.');
  } else {
    await request('/api/records', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Registro creado.');
  }

  recordDialog.close();
  recordForm.reset();
  state.editingRecord = null;
  await refresh();
});

async function refresh() {
  monthPicker.value = state.month;
  const [tasks, records, dashboard] = await Promise.all([
    request('/api/tasks'),
    request(`/api/records?month=${state.month}`),
    request(`/api/dashboard?month=${state.month}`),
  ]);

  state.tasks = tasks;
  state.records = records;
  state.dashboard = dashboard;

  renderTaskOptions();
  renderKpis();
  renderTasksTable();
  renderRecordsTable();
  renderCharts();
}

function renderTaskOptions() {
  recordTaskSelect.innerHTML = state.tasks
    .map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`)
    .join('');
}

function renderKpis() {
  const totals = state.dashboard?.totals || { target: 0, achieved: 0, compliance: 0 };
  const topTask = [...(state.dashboard?.tasks || [])].sort((a, b) => b.compliance - a.compliance)[0];

  const cards = [
    { label: 'Meta total', value: formatNumber(totals.target) },
    { label: 'Logrado mes', value: formatNumber(totals.achieved) },
    { label: 'Cumplimiento', value: `${totals.compliance || 0}%` },
    { label: 'Mejor tarea', value: topTask ? `${topTask.name} (${topTask.compliance || 0}%)` : 'Sin datos' },
  ];

  kpiGrid.innerHTML = cards
    .map(
      (card) => `
      <div class="kpi">
        <div class="label">${escapeHtml(card.label)}</div>
        <div class="value">${escapeHtml(card.value)}</div>
      </div>
    `,
    )
    .join('');
}

function renderTasksTable() {
  tasksTableBody.innerHTML = state.tasks
    .map(
      (task) => `
      <tr>
        <td>${escapeHtml(task.name)}</td>
        <td>${formatNumber(task.target)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-ghost" data-action="edit-task" data-id="${task.id}">Editar</button>
            <button class="btn btn-danger" data-action="delete-task" data-id="${task.id}">Borrar</button>
          </div>
        </td>
      </tr>
    `,
    )
    .join('');

  tasksTableBody.querySelectorAll('[data-action="edit-task"]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = state.tasks.find((item) => item.id === Number(button.dataset.id));
      if (task) openTaskModal(task);
    });
  });

  tasksTableBody.querySelectorAll('[data-action="delete-task"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('¿Deseas eliminar esta tarea? También se eliminarán sus registros.')) return;
      await request(`/api/tasks/${button.dataset.id}`, { method: 'DELETE' });
      showToast('Tarea eliminada.');
      await refresh();
    });
  });
}

function renderRecordsTable() {
  recordsTableBody.innerHTML = state.records
    .map(
      (record) => `
      <tr>
        <td>${formatDate(record.record_date)}</td>
        <td>${escapeHtml(record.task_name)}</td>
        <td>${formatNumber(record.quantity)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-ghost" data-action="edit-record" data-id="${record.id}">Editar</button>
            <button class="btn btn-danger" data-action="delete-record" data-id="${record.id}">Borrar</button>
          </div>
        </td>
      </tr>
    `,
    )
    .join('');

  recordsTableBody.querySelectorAll('[data-action="edit-record"]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item.id === Number(button.dataset.id));
      if (record) openRecordModal(record);
    });
  });

  recordsTableBody.querySelectorAll('[data-action="delete-record"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('¿Deseas eliminar este registro?')) return;
      await request(`/api/records/${button.dataset.id}`, { method: 'DELETE' });
      showToast('Registro eliminado.');
      await refresh();
    });
  });
}

function renderCharts() {
  const tasks = state.dashboard?.tasks || [];

  const performanceCtx = document.getElementById('performanceChart');
  state.charts.performance?.destroy();
  state.charts.performance = new Chart(performanceCtx, {
    type: 'bar',
    data: {
      labels: tasks.map((task) => task.name),
      datasets: [
        {
          label: 'Meta',
          backgroundColor: '#dbe4ff',
          borderColor: '#5b7cfa',
          borderWidth: 1,
          data: tasks.map((task) => task.target),
        },
        {
          label: 'Logrado',
          backgroundColor: '#5b7cfa',
          data: tasks.map((task) => task.achieved),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
    },
  });

  const trendData = buildTrendDataset(state.dashboard?.trend || []);
  const trendCtx = document.getElementById('trendChart');
  state.charts.trend?.destroy();
  state.charts.trend = new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: trendData.months,
      datasets: trendData.datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function buildTrendDataset(rows) {
  const months = [...new Set(rows.map((row) => row.month))];
  const taskNames = [...new Set(rows.map((row) => row.name))];
  const colors = ['#5b7cfa', '#18b26a', '#e1903a', '#9f5bff', '#e15050'];

  const datasets = taskNames.map((name, index) => {
    const data = months.map((month) => {
      const found = rows.find((row) => row.month === month && row.name === name);
      return found ? Number(found.average_quantity) : null;
    });

    return {
      label: name,
      data,
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length],
      tension: 0.3,
      spanGaps: true,
    };
  });

  return { months, datasets };
}

function openTaskModal(task = null) {
  state.editingTask = task;
  taskDialogTitle.textContent = task ? 'Editar tarea' : 'Nueva tarea';
  taskForm.name.value = task?.name || '';
  taskForm.target.value = task?.target || '';
  taskDialog.showModal();
}

function openRecordModal(record = null) {
  state.editingRecord = record;
  recordDialogTitle.textContent = record ? 'Editar registro' : 'Nuevo registro';
  recordForm.task_id.value = record?.task_id || state.tasks[0]?.id || '';
  recordForm.record_date.value = record ? record.record_date.slice(0, 10) : `${state.month}-01`;
  recordForm.quantity.value = record?.quantity || '';
  recordDialog.showModal();
}

async function request(url, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  const response = await fetch(url, config);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Error inesperado' }));
    showToast(error.message || 'Error inesperado');
    throw new Error(error.message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2200);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-ES');
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getInitialMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return map[char] || char;
  });
}

refresh().catch((error) => {
  console.error(error);
  showToast('No se pudo inicializar la app.');
});
