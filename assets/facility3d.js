export function startFacility3D(canvas, devices, options = {}) {
  const G = window.GL3D;
  if (!G || !G.supported() || !canvas) return null;

  const compact = matchMedia("(max-width: 760px)").matches;
  const view = G.view(canvas, {
    shadow: compact ? 512 : 1024,
    shadowBounds: 5.6,
    shadowSoft: 2.2,
    maxDpr: compact ? 1.25 : 1.6,
    fov: compact ? 43 : 36,
    rootMargin: "120px"
  });
  if (!view) return null;

  const materials = {
    floor: G.material({ color: "#dce8e4", roughness: 0.86 }),
    wall: G.material({ color: "#edf3f1", roughness: 0.82 }),
    frame: G.material({ color: "#29413c", roughness: 0.48, metalness: 0.12 }),
    online: G.material({ color: "#0b8f7b", roughness: 0.28, emissive: "#06392f", emissiveIntensity: 0.32 }),
    warning: G.material({ color: "#d77b18", roughness: 0.28, emissive: "#532600", emissiveIntensity: 0.38 }),
    offline: G.material({ color: "#c44949", roughness: 0.32, emissive: "#4b1010", emissiveIntensity: 0.32 })
  };

  const root = G.node({});
  view.scene.add(G.node({ geo: G.plane(16, 16), mat: G.material({ shadowCatcher: true, opacity: 0.26, catchRadius: 6 }), castShadow: false }));
  root.add(G.node({ geo: G.box(8.2, 0.12, 4.8, { r: 0.06 }), mat: materials.floor, pos: [0, 0.07, 0] }));

  [-2.72, 0, 2.72].forEach((x) => {
    root.add(G.node({ geo: G.box(0.07, 1.35, 4.45), mat: materials.wall, pos: [x, 0.74, 0] }));
  });
  [-2.22, 2.22].forEach((z) => {
    root.add(G.node({ geo: G.box(8.05, 1.35, 0.07), mat: materials.wall, pos: [0, 0.74, z] }));
  });

  const positions = [[-3.25, 0.35, -1.25], [-1.45, 0.35, 1.15], [-0.35, 0.35, -0.9], [1.35, 0.35, 1.05], [3.15, 0.35, -1.15], [2.75, 0.35, 1.25]];
  const sensorNodes = [];
  const beacons = [];
  positions.forEach((position, index) => {
    const device = devices[index] || { id: "", status: "offline" };
    const [x, y, z] = position;
    const assembly = G.node({ pos: [x, y, z], visible: Boolean(devices[index]) });
    const beacon = G.node({ geo: G.sphere(0.19, { seg: 18, rings: 12 }), mat: materials[device.status], pos: [0, 0.48, 0] });
    assembly.add(
      G.node({ geo: G.cylinder(0.08, 0.08, 0.5, { seg: 14 }), mat: materials.frame, pos: [0, 0.12, 0] }),
      beacon
    );
    assembly.userData = { device };
    sensorNodes.push(assembly);
    beacons.push(beacon);
    root.add(assembly);
  });
  view.scene.add(root);
  const syncContacts = () => {
    view.contacts = sensorNodes.filter((node) => node.visible).map((node) => [node.pos[0], 0.04, node.pos[2], 0.34]);
  };
  syncContacts();
  view.camera.pos = compact ? [7.4, 6.1, 8.4] : [7.8, 5.6, 8.2];
  view.camera.target = [0, 0.5, 0];

  let yaw = -0.18;
  let targetYaw = yaw;
  let dragging = false;
  G.drag(canvas, (dx) => {
    dragging = true;
    targetYaw += dx * 0.008;
    view.wake();
  }, () => {
    dragging = false;
  });

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  view.frame((dt, time) => {
    if (!dragging && !reduced.matches && options.autoRotate !== false) targetYaw += dt * 0.055;
    yaw = G.damp(yaw, targetYaw, 8, dt);
    root.rot[1] = yaw;
    if (!reduced.matches) {
      sensorNodes.forEach((node, index) => {
        node.scale[0] = node.scale[1] = node.scale[2] = 1 + Math.sin(time * 1.4 + index) * 0.018;
      });
    }
    return !reduced.matches || dragging || Math.abs(targetYaw - yaw) > 0.001;
  });

  canvas.dataset.renderer = "webgl2";
  return {
    view,
    root,
    sensorNodes,
    updateDevices(nextDevices) {
      sensorNodes.forEach((node, index) => {
        const device = nextDevices[index];
        node.visible = Boolean(device);
        if (!device) return;
        beacons[index].mat = materials[device.status];
        node.userData = { device };
      });
      syncContacts();
      view.wake();
    }
  };
}
