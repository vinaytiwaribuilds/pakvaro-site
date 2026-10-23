import { hydrateConfig } from "./config.js";
import { getTenant, getTenants, getSnapshotTime, formatLastSeen, weeklySummary } from "./simulator.js";
import { observeLineChart } from "./charts.js";

hydrateConfig();

const state = {
  tenantId: new URLSearchParams(location.search).get("tenant") === "b" ? "b" : "a",
  filter: "all",
  alertStates: new Map()
};

const elements = {
  tenantSelect: document.getElementById("tenant-select"),
  tenantName: document.getElementById("tenant-name"),
  tenantDescriptor: document.getElementById("tenant-descriptor"),
  isolationLabel: document.getElementById("isolation-label"),
  kpiOnline: document.getElementById("kpi-online"),
  kpiAlarms: document.getElementById("kpi-alarms"),
  kpiMessages: document.getElementById("kpi-messages"),
  kpiCompleteness: document.getElementById("kpi-completeness"),
  fleetPreviewBody: document.getElementById("fleet-preview-body"),
  fleetBody: document.getElementById("fleet-body"),
  fleetCount: document.getElementById("fleet-count"),
  alarmList: document.getElementById("alarm-list"),
  alarmCount: document.getElementById("alarm-count"),
  chart: document.getElementById("telemetry-chart"),
  chartTitle: document.getElementById("chart-title"),
  chartLatest: document.getElementById("chart-latest"),
  drawer: document.getElementById("device-drawer"),
  toast: document.getElementById("toast")
};

getTenants().forEach((tenant) => {
  const option = document.createElement("option");
  option.value = tenant.id;
  option.textContent = `${tenant.label} · ${tenant.descriptor}`;
  elements.tenantSelect?.appendChild(option);
});

let chartSeries = [];
let chartOptions = {};
const redrawChart = elements.chart ? observeLineChart(elements.chart, () => chartSeries, () => chartOptions) : () => {};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

function statusLabel(status) {
  return status === "online" ? "Online" : status === "warning" ? "Needs attention" : "Offline";
}

function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function fleetSeries(tenant) {
  const last24 = tenant.devices[0].readings.slice(-24);
  return last24.map((reading, index) => {
    const values = tenant.devices
      .map((device) => device.readings.at(-24 + index)?.value)
      .filter(Number.isFinite);
    return {
      time: reading.time,
      value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
    };
  });
}

function openAlarmCount(tenant) {
  return tenant.alerts.filter((alert) => state.alertStates.get(alert.id) !== "cleared").length;
}

function renderKpis(tenant) {
  const summary = weeklySummary(tenant.id);
  const online = tenant.devices.filter((device) => device.status !== "offline").length;
  elements.kpiOnline.textContent = `${online} / ${tenant.devices.length}`;
  elements.kpiAlarms.textContent = String(openAlarmCount(tenant));
  elements.kpiMessages.textContent = summary.received.toLocaleString("en-IN");
  elements.kpiCompleteness.textContent = `${summary.completeness.toFixed(2)}%`;
}

function renderChart(tenant) {
  chartSeries = fleetSeries(tenant);
  const latest = chartSeries.filter((point) => Number.isFinite(point.value)).at(-1)?.value;
  const threshold = tenant.id === "a" ? 6 : 30;
  chartOptions = {
    unit: tenant.unit,
    decimals: 0,
    threshold,
    label: (point) => new Intl.DateTimeFormat("en", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata"
    }).format(new Date(point.time))
  };
  elements.chartTitle.textContent = `${tenant.metric} · fleet mean`;
  elements.chartLatest.textContent = Number.isFinite(latest) ? `${latest.toFixed(1)} ${tenant.unit}` : "No recent data";
  elements.chart.setAttribute("aria-label", `24-hour chart of ${tenant.metric.toLowerCase()} for ${tenant.label}. Latest fleet mean ${elements.chartLatest.textContent}.`);
  redrawChart();
}

function filteredDevices(tenant) {
  if (state.filter === "all") return tenant.devices;
  if (state.filter === "attention") return tenant.devices.filter((device) => device.status !== "online");
  return tenant.devices.filter((device) => device.status === "online");
}

function deviceRows(devices, tenant, preview = false) {
  return devices.map((device) => {
    const cells = preview
      ? `<td>${device.value.toFixed(1)} ${tenant.unit}</td><td>${formatLastSeen(device.lastSeenSeconds)}</td><td class="mono">${device.rssi} dBm</td>`
      : `<td>${formatLastSeen(device.lastSeenSeconds)}</td><td class="mono">${device.rssi} dBm</td><td>${device.value.toFixed(1)} ${tenant.unit}</td>`;
    return `
      <tr data-device-row="${escapeHtml(device.id)}">
        <th scope="row">
          <button class="device-link" type="button" data-device="${escapeHtml(device.id)}">
            <span>${escapeHtml(device.name)}</span>
            <small>${escapeHtml(device.id)}</small>
          </button>
        </th>
        <td><span class="status status--${device.status}"><span aria-hidden="true"></span>${statusLabel(device.status)}</span></td>
        ${cells}
        <td><button class="icon-button" type="button" data-device="${escapeHtml(device.id)}" aria-label="Open ${escapeHtml(device.name)} details"><span aria-hidden="true">→</span></button></td>
      </tr>`;
  }).join("");
}

function renderFleet(tenant) {
  const devices = filteredDevices(tenant);
  elements.fleetCount.textContent = `${devices.length} of ${tenant.devices.length} devices in ${tenant.label}`;
  elements.fleetBody.innerHTML = deviceRows(devices, tenant);
  elements.fleetPreviewBody.innerHTML = deviceRows(tenant.devices, tenant, true);
  document.querySelectorAll("[data-tenant-table-scope]").forEach((element) => {
    element.textContent = `Only tenant/${tenant.id} records are in view`;
  });
  document.querySelectorAll("[data-fleet-tenant]").forEach((element) => {
    element.textContent = tenant.label;
  });
  document.querySelectorAll("[data-fleet-scope]").forEach((element) => {
    element.textContent = `tenant/${tenant.id} · ${tenant.devices.length} devices`;
  });
}

function getAlertState(alert) {
  return state.alertStates.get(alert.id) || "active";
}

function renderAlarms(tenant) {
  const active = openAlarmCount(tenant);
  elements.alarmCount.textContent = `${active} open`;
  elements.alarmList.innerHTML = tenant.alerts.map((alert) => {
    const alarmState = getAlertState(alert);
    const stateText = alarmState === "active" ? "Unacknowledged" : alarmState === "acknowledged" ? "Acknowledged in this demo" : "Cleared in this demo";
    return `
      <li class="alarm alarm--${alarmState}" data-alert-id="${escapeHtml(alert.id)}">
        <div class="alarm__icon alarm__icon--${alert.type}" aria-hidden="true">${alert.type === "offline" ? "×" : "!"}</div>
        <div class="alarm__body">
          <div class="alarm__topline"><strong>${escapeHtml(alert.message)}</strong><span>${escapeHtml(alert.age)}</span></div>
          <p>${escapeHtml(alert.deviceId)} · ${stateText}</p>
          <div class="alarm__actions">
            <button class="text-button" type="button" data-alarm-action="ack" ${alarmState !== "active" ? "disabled" : ""}>Acknowledge</button>
            <button class="text-button" type="button" data-alarm-action="clear" ${alarmState === "cleared" ? "disabled" : ""}>Clear</button>
          </div>
        </div>
      </li>`;
  }).join("");
}

function openDevice(deviceId) {
  const tenant = getTenant(state.tenantId);
  const device = tenant.devices.find((item) => item.id === deviceId);
  if (!device || !elements.drawer) return;
  const latest = device.readings.filter((reading) => reading.value !== null).at(-1);
  elements.drawer.querySelector("[data-drawer-name]").textContent = device.name;
  elements.drawer.querySelector("[data-drawer-id]").textContent = device.id;
  elements.drawer.querySelector("[data-drawer-status]").innerHTML = `<span class="status status--${device.status}"><span aria-hidden="true"></span>${statusLabel(device.status)}</span>`;
  elements.drawer.querySelector("[data-drawer-seen]").textContent = formatLastSeen(device.lastSeenSeconds);
  elements.drawer.querySelector("[data-drawer-value]").textContent = `${latest.value.toFixed(1)} ${tenant.unit}`;
  elements.drawer.querySelector("[data-drawer-humidity]").textContent = `${latest.humidity.toFixed(1)}% RH`;
  elements.drawer.querySelector("[data-drawer-health]").textContent = device.status === "offline" ? "Telemetry offline" : "Receiving";
  elements.drawer.querySelector("[data-drawer-rssi]").textContent = `${device.rssi} dBm`;
  elements.drawer.querySelector("[data-drawer-tenant]").textContent = `${tenant.label} · tenant/${tenant.id}`;
  elements.drawer.querySelector("[data-drawer-payload]").textContent = JSON.stringify({
    ts: latest.time,
    device_id: device.id,
    temperature_c: latest.value,
    humidity_rh: latest.humidity,
    rssi_dbm: device.rssi
  }, null, 2);
  if (typeof elements.drawer.showModal === "function") elements.drawer.showModal();
  else elements.drawer.setAttribute("open", "");
}

function renderAll() {
  const tenant = getTenant(state.tenantId);
  elements.tenantSelect.value = tenant.id;
  elements.tenantName.textContent = tenant.label;
  elements.tenantDescriptor.textContent = `${tenant.descriptor} · ${tenant.site}`;
  elements.isolationLabel.textContent = `Scope: tenant/${tenant.id} · ${tenant.devices.length} devices only`;
  document.querySelectorAll("[data-report-link]").forEach((link) => {
    link.href = `report.html?tenant=${tenant.id}`;
  });
  renderKpis(tenant);
  renderChart(tenant);
  renderFleet(tenant);
  renderAlarms(tenant);
}

function activatePanel(name, moveFocus = false) {
  const activeButton = document.querySelector(`[data-demo-tab="${name}"]`);
  if (!activeButton) return;
  document.querySelectorAll("[data-demo-tab]").forEach((button) => {
    const active = button === activeButton;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  if (name === "overview") redrawChart();
  if (moveFocus) activeButton.focus();
}

elements.tenantSelect?.addEventListener("change", (event) => {
  state.tenantId = event.target.value;
  state.filter = "all";
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === "all"));
  });
  elements.drawer?.close?.();
  renderAll();
  showToast(`Switched to ${getTenant(state.tenantId).label}. Other tenant data is no longer in view.`);
});

document.querySelectorAll("[data-demo-tab]").forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.demoTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(document.querySelectorAll("[data-demo-tab]"));
    const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
    const next = tabs[(tabs.indexOf(button) + direction + tabs.length) % tabs.length];
    activatePanel(next.dataset.demoTab, true);
  });
});

document.querySelector("[data-open-panel]")?.addEventListener("click", (event) => {
  activatePanel(event.currentTarget.dataset.openPanel, true);
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button));
    });
    renderFleet(getTenant(state.tenantId));
  });
});

document.querySelector(".portal-main")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-device]");
  if (button) openDevice(button.dataset.device);
});

elements.alarmList?.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-alarm-action]");
  const item = event.target.closest("[data-alert-id]");
  if (!actionButton || !item) return;
  const next = actionButton.dataset.alarmAction === "ack" ? "acknowledged" : "cleared";
  state.alertStates.set(item.dataset.alertId, next);
  const tenant = getTenant(state.tenantId);
  renderAlarms(tenant);
  renderKpis(tenant);
  showToast(next === "acknowledged" ? "Alarm acknowledged for this demo session." : "Alarm cleared for this demo session.");
});

document.querySelector("[data-drawer-close]")?.addEventListener("click", () => elements.drawer?.close?.());

const snapshot = getSnapshotTime();
document.querySelectorAll("[data-snapshot]").forEach((element) => {
  element.textContent = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata"
  }).format(snapshot);
});

renderAll();

if (location.hash.slice(1) === "fleet") activatePanel("fleet");
