const observers = new WeakMap();

function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function drawLineChart(canvas, series, options = {}) {
  if (!canvas) return;
  const width = Math.max(280, canvas.clientWidth || 640);
  const height = Math.max(180, canvas.clientHeight || 260);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const pad = { top: 20, right: 16, bottom: 32, left: 46 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const valid = series.filter((point) => Number.isFinite(point.value));
  if (!valid.length) return;

  const rawMin = Math.min(...valid.map((point) => point.value));
  const rawMax = Math.max(...valid.map((point) => point.value));
  const spread = Math.max(1, rawMax - rawMin);
  const min = options.min ?? Math.floor(rawMin - spread * 0.18);
  const max = options.max ?? Math.ceil(rawMax + spread * 0.18);
  const accent = options.color || cssColor("--accent", "#087f71");
  const grid = cssColor("--line", "#dce5e2");
  const inkMuted = cssColor("--muted", "#5b6b66");

  context.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.fillStyle = inkMuted;
  context.strokeStyle = grid;
  context.lineWidth = 1;
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = pad.top + (chartHeight * tick) / 4;
    const value = max - ((max - min) * tick) / 4;
    context.beginPath();
    context.moveTo(pad.left, y + 0.5);
    context.lineTo(width - pad.right, y + 0.5);
    context.stroke();
    context.fillText(`${value.toFixed(options.decimals ?? 0)}${options.unit || ""}`, pad.left - 8, y);
  }

  context.textBaseline = "top";
  const labels = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  labels.forEach((index, labelIndex) => {
    const point = series[index];
    const x = pad.left + (chartWidth * index) / Math.max(1, series.length - 1);
    context.textAlign = labelIndex === 0 ? "left" : labelIndex === labels.length - 1 ? "right" : "center";
    context.fillText(options.label?.(point, index) || "", x, height - 20);
  });

  const pointAt = (point, index) => ({
    x: pad.left + (chartWidth * index) / Math.max(1, series.length - 1),
    y: pad.top + ((max - point.value) / Math.max(0.001, max - min)) * chartHeight
  });

  const gradient = context.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
  gradient.addColorStop(0, `${accent}2e`);
  gradient.addColorStop(1, `${accent}00`);
  context.beginPath();
  let started = false;
  series.forEach((point, index) => {
    if (!Number.isFinite(point.value)) return;
    const position = pointAt(point, index);
    if (!started) {
      context.moveTo(position.x, position.y);
      started = true;
    } else {
      context.lineTo(position.x, position.y);
    }
  });
  const last = [...series].reverse().find((point) => Number.isFinite(point.value));
  const first = series.find((point) => Number.isFinite(point.value));
  if (first && last) {
    const lastIndex = series.lastIndexOf(last);
    const firstIndex = series.indexOf(first);
    context.lineTo(pointAt(last, lastIndex).x, pad.top + chartHeight);
    context.lineTo(pointAt(first, firstIndex).x, pad.top + chartHeight);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  }

  context.beginPath();
  started = false;
  series.forEach((point, index) => {
    if (!Number.isFinite(point.value)) {
      started = false;
      return;
    }
    const position = pointAt(point, index);
    if (!started) context.moveTo(position.x, position.y);
    else context.lineTo(position.x, position.y);
    started = true;
  });
  context.strokeStyle = accent;
  context.lineWidth = 2.25;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  if (Number.isFinite(options.threshold)) {
    const y = pad.top + ((max - options.threshold) / Math.max(0.001, max - min)) * chartHeight;
    context.setLineDash([5, 5]);
    context.strokeStyle = cssColor("--warning", "#aa5b00");
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
    context.setLineDash([]);
  }
}

export function observeLineChart(canvas, getSeries, getOptions) {
  const draw = () => drawLineChart(canvas, getSeries(), getOptions());
  observers.get(canvas)?.disconnect();
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  observers.set(canvas, observer);
  draw();
  return draw;
}
