import { hydrateConfig } from "./config.js";

const win = globalThis;
const doc = win.document;
const reducedMotion = win.matchMedia?.("(prefers-reduced-motion: reduce)");

doc?.documentElement.classList.add("js");

function initHeader() {
  const header = doc.getElementById("site-header");
  const sentinel = doc.querySelector(".header-sentinel");
  if (!header || !sentinel) return;
  if (!("IntersectionObserver" in win)) return;
  const observer = new IntersectionObserver(([entry]) => {
    header.classList.toggle("is-scrolled", !entry.isIntersecting);
  }, { threshold: 0 });
  observer.observe(sentinel);
}

function initMenu() {
  const button = doc.querySelector(".menu-toggle");
  const menu = doc.getElementById("mobile-menu");
  if (!button || !menu) return;

  const close = (restoreFocus = false) => {
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open menu");
    menu.hidden = true;
    doc.body.classList.remove("menu-is-open");
    if (restoreFocus) button.focus();
  };
  const open = () => {
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Close menu");
    menu.hidden = false;
    doc.body.classList.add("menu-is-open");
    menu.querySelector("a")?.focus();
  };

  button.addEventListener("click", () => {
    if (button.getAttribute("aria-expanded") === "true") close();
    else open();
  });
  menu.addEventListener("click", (event) => {
    if (event.target === menu || event.target.closest("a")) close();
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) close(true);
  });
}

function initReveals() {
  const elements = [...doc.querySelectorAll("[data-reveal]")];
  if (!elements.length) return;
  if (reducedMotion?.matches || !("IntersectionObserver" in win)) {
    elements.forEach((element) => element.classList.add("is-revealed"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-revealed");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -7%", threshold: 0.08 });
  elements.forEach((element) => observer.observe(element));
}

async function initHeroDashboard() {
  const dashboard = doc.querySelector("[data-hero-dashboard]");
  if (!dashboard) return;

  const { formatLastSeen, getTenant, weeklySummary } = await import("./simulator.js");

  const tenant = getTenant("a");
  const summary = weeklySummary("a");
  const online = tenant.devices.filter((device) => device.status !== "offline").length;
  const setText = (selector, value) => {
    const element = dashboard.querySelector(selector);
    if (element) element.textContent = value;
  };

  setText("[data-hero-online]", `${online}/${tenant.devices.length}`);
  setText("[data-hero-alarms]", "1");
  setText("[data-hero-completeness]", `${summary.completeness.toFixed(1)}%`);

  const rows = [...dashboard.querySelectorAll("[data-hero-device]")];
  rows.forEach((row) => {
    const device = tenant.devices[Number(row.dataset.heroDevice)];
    if (!device) return;
    row.querySelector("[data-device-value]").textContent = `${String(device.value.toFixed(1)).replace("-", "−")} °C`;
    row.querySelector("[data-device-seen]").textContent = formatLastSeen(device.lastSeenSeconds).replace(" ago", "");
  });

  let phase = 0;
  let tickTimer = 0;
  let dashboardVisible = true;
  const tick = () => {
    phase += 0.55;
    rows.forEach((row, order) => {
      const device = tenant.devices[Number(row.dataset.heroDevice)];
      if (!device || device.status === "offline") return;
      const value = device.value + Math.sin(phase + order * 0.7) * 0.18;
      row.querySelector("[data-device-value]").textContent = `${String(value.toFixed(1)).replace("-", "−")} °C`;
    });
  };
  const syncTicks = () => {
    win.clearInterval(tickTimer);
    tickTimer = 0;
    if (dashboardVisible && !doc.hidden && !reducedMotion?.matches) tickTimer = win.setInterval(tick, 2400);
  };

  const toast = dashboard.querySelector("[data-alarm-toast]");
  const alarmState = toast?.querySelector("[data-alarm-state]");
  const alarmTitle = toast?.querySelector("[data-alarm-title]");
  const alarmTime = toast?.querySelector("[data-alarm-time]");
  let alarmTimers = [];
  const clearAlarmTimers = () => {
    alarmTimers.forEach((timer) => win.clearTimeout(timer));
    alarmTimers = [];
  };
  const showAlarm = (state) => {
    if (!toast || !alarmState) return;
    toast.dataset.state = state;
    toast.classList.add("is-visible");
    alarmState.textContent = state === "cleared" ? "Cleared" : "Alarm opened";
    if (alarmTitle) alarmTitle.textContent = state === "cleared" ? "Temperature normal" : "Temperature alarm";
    if (alarmTime) alarmTime.textContent = state === "cleared" ? "2m" : "Now";
  };
  const runAlarmCycle = () => {
    clearAlarmTimers();
    if (!toast || !dashboardVisible || doc.hidden) return;
    showAlarm("open");
    if (reducedMotion?.matches) return;
    alarmTimers.push(win.setTimeout(() => showAlarm("cleared"), 3200));
    alarmTimers.push(win.setTimeout(() => toast.classList.remove("is-visible"), 5200));
    alarmTimers.push(win.setTimeout(runAlarmCycle, 6500));
  };

  if ("IntersectionObserver" in win) {
    const observer = new IntersectionObserver(([entry]) => {
      dashboardVisible = entry.isIntersecting;
      syncTicks();
      if (dashboardVisible) runAlarmCycle();
      else clearAlarmTimers();
    }, { rootMargin: "120px" });
    observer.observe(dashboard);
  } else {
    syncTicks();
    runAlarmCycle();
  }
  doc.addEventListener("visibilitychange", () => {
    syncTicks();
    if (!doc.hidden && dashboardVisible) runAlarmCycle();
    else clearAlarmTimers();
  });
}

function initAcceptancePanel() {
  const record = doc.getElementById("ar01");
  if (!record) return;
  const panel = record.closest(".acceptance-panel") || record;
  let moduleReady = false;
  let loading;
  const load = () => loading ||= import("./record.js").then((module) => {
    module.init(record);
    moduleReady = true;
    return module;
  });

  ["pointerenter", "focusin"].forEach((type) => panel.addEventListener(type, load, { once: true }));
  panel.addEventListener("click", (event) => {
    if (moduleReady) return;
    const action = event.target.closest?.("#ar01-run,#ar01-fix,#ar01-reset");
    if (!action) {
      load();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    load().then(() => action.click());
  }, { capture: true });
  panel.addEventListener("change", (event) => {
    if (moduleReady || event.target.id !== "ar01-fault") return;
    event.stopImmediatePropagation();
    load().then(() => event.target.dispatchEvent(new Event("change", { bubbles: true })));
  }, { capture: true });
}

function initPrintButtons() {
  doc.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => win.print());
  });
}

function boot() {
  hydrateConfig();
  initHeader();
  initMenu();
  initReveals();
  initHeroDashboard();
  initAcceptancePanel();
  initPrintButtons();
}

if (doc) {
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
