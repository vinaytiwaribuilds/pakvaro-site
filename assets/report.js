import { hydrateConfig } from "./config.js";
import { getTenant, weeklySummary } from "./simulator.js";

hydrateConfig();

const params = new URLSearchParams(location.search);
const tenantId = params.get("tenant") === "b" ? "b" : "a";
const summary = weeklySummary(tenantId);
const tenant = getTenant(tenantId);

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[character]);
}

function statusLabel(status) {
  return status === "online" ? "Online" : status === "warning" ? "Needs attention" : "Offline";
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

setText("report-tenant", `${tenant.label} · ${tenant.descriptor}`);
setText("report-period", `${formatDate(summary.periodStart)} – ${formatDate(summary.periodEnd)} · Asia/Kolkata`);
setText("report-generated", "14 Oct 2026, 10:30 IST");
setText("report-scope", `tenant/${tenant.id} · ${tenant.devices.length} provisioned devices`);
setText("report-received", summary.received.toLocaleString("en-IN"));
setText("report-expected", summary.expected.toLocaleString("en-IN"));
setText("report-completeness", `${summary.completeness.toFixed(2)}%`);
setText("report-availability", `${summary.fleetAvailability.toFixed(1)}%`);
setText("report-average", `${summary.average.toFixed(1)} ${tenant.unit}`);
setText("report-range", `${summary.min.toFixed(1)} to ${summary.max.toFixed(1)} ${tenant.unit}`);
setText("report-alarms", String(summary.alarms));
setText("report-offline", String(summary.offlineDevices));
setText("report-completeness-label", `${summary.completeness.toFixed(2)}%`);
setText("report-availability-label", `${summary.fleetAvailability.toFixed(1)}%`);
setText("report-reconciliation", `${summary.received.toLocaleString("en-IN")} = ${summary.ledger.reduce((total, row) => total + row.received, 0).toLocaleString("en-IN")}`);

const completenessProgress = document.getElementById("report-completeness-progress");
const availabilityProgress = document.getElementById("report-availability-progress");
completenessProgress.value = summary.completeness;
completenessProgress.textContent = `${summary.completeness.toFixed(2)}%`;
availabilityProgress.value = summary.fleetAvailability;
availabilityProgress.textContent = `${summary.fleetAvailability.toFixed(1)}%`;
document.getElementById("report-back").href = `demo.html?tenant=${tenant.id}`;

document.getElementById("report-alarm-body").innerHTML = tenant.alerts.map((alert) => `
  <tr>
    <th scope="row">${escapeHtml(alert.deviceId)}</th>
    <td>${escapeHtml(alert.message)}</td>
    <td>${alert.type === "offline" ? "Offline" : "Threshold"}</td>
    <td>${escapeHtml(alert.age)}</td>
    <td><span class="status status--warning"><span aria-hidden="true"></span>Open</span></td>
  </tr>`).join("");

document.getElementById("report-device-body").innerHTML = tenant.devices.map((device) => {
  const ledger = summary.ledger.find((row) => row.id === device.id);
  const values = device.readings
    .filter((reading) => reading.tsEpochMs >= summary.periodStart.getTime() && reading.tsEpochMs < summary.periodEnd.getTime() && reading.value !== null)
    .map((reading) => reading.value);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `<tr>
    <th scope="row"><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.id)}</small></th>
    <td><span class="status status--${device.status}"><span aria-hidden="true"></span>${statusLabel(device.status)}</span></td>
    <td>${ledger.received} / ${ledger.expected}</td>
    <td>${average.toFixed(1)} ${tenant.unit}</td>
    <td>${ledger.completeness.toFixed(2)}%</td>
  </tr>`;
}).join("");

document.getElementById("print-report")?.addEventListener("click", () => window.print());
