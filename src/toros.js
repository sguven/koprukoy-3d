// The Toros of the "Toros" (drive) mode: a late Renault 12 Toros saloon, modelled on the owner's reference picture
// (a white late-model Toros, three-quarter front view): off-white paint, black plastic wrap-around bumpers with the indicators set
// into them, a black nose panel with four round headlights and the Renault diamond, black rubbing strips, black door
// handles and mirrors, slotted silver wheel covers, the black vent on the wide rear pillar, a "5 Vites" badge on the
// front wing, a roof aerial and "RENAULT 12" plates.
// Frame: front = +X, up = +Y, right = +Z, origin on the ground midway between the axles; 1 unit = 1 m.
// Real car: 4.34 m long, 1.64 m wide, 1.43 m high, wheelbase 2.44 m, 155 SR 13 tyres.
import * as THREE from 'three';

export const WB = 2.44, TRACK = 1.36, WR = 0.29;
export const COLORS = [['White', 0xe9e7e3], ['Red', 0x9e2420], ['Beige', 0xd6c59c], ['Grey', 0x8f9497], ['Brown', 0x6a4a33], ['Blue', 0x2f4f7a]];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildToros() {
  const car = new THREE.Group(); car.name = 'Toros';
  const paint = new THREE.MeshStandardMaterial({ color: COLORS[0][1], roughness: 0.34, metalness: 0.1, envMapIntensity: 0.9, side: THREE.DoubleSide });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.2, metalness: 0.95, envMapIntensity: 1.2, side: THREE.DoubleSide });
  const blackM = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.62 });            // bumpers, strips, handles (plastic)
  const rubberM = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.8 });            // window rubbers, wipers
  const darkM = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.55 });             // grille slats, lamp housings
  const glassM = new THREE.MeshStandardMaterial({ color: 0x9db3aa, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.36, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
  const tyreM = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.92 });
  const headM = new THREE.MeshStandardMaterial({ color: 0xe9ecee, emissive: 0x000000, roughness: 0.15, metalness: 0.3 });
  const tailM = new THREE.MeshStandardMaterial({ color: 0x8e1010, emissive: 0x200000, roughness: 0.3 });
  const amberM = new THREE.MeshStandardMaterial({ color: 0xe8851c, roughness: 0.3 });
  const clearM = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.25 });
  const seatM = new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.92 });
  const dashM = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.85 });
  const seamM = new THREE.MeshStandardMaterial({ color: 0x6f6f6c, roughness: 0.8 });

  const add = (m, parent = car) => { parent.add(m); return m; };
  const box = (sx, sy, sz, mat, x, y, z, parent = car) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); return add(m, parent); };
  /** Side profile (x, y) extruded across the car; the bevel rounds the edges without growing the outline. */
  function extrudeSide(points, depth, mat, bevel = 0.03) {
    const s = new THREE.Shape(); s.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -(depth - 2 * bevel) / 2); return add(new THREE.Mesh(g, mat));
  }
  const arcPts = (cx, cy, r, a0, a1, n = 12) => { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; };
  /** A bar between two points (w across, t thick). */
  const X = new THREE.Vector3(1, 0, 0), va = new THREE.Vector3(), vb = new THREE.Vector3();
  function beam(p0, p1, w, t, mat) {
    va.set(...p0); vb.set(...p1); const L = va.distanceTo(vb), m = new THREE.Mesh(new THREE.BoxGeometry(L, w, t), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(X, vb.clone().sub(va).normalize()); return add(m);
  }
  /** A flat four-cornered panel. */
  function quad(a, b, c, d, mat) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return add(new THREE.Mesh(g, mat));
  }

  // ---- lower body: long nose leaning forward, level waist, boot falling away to the tail ----
  const ax = WB / 2, ar = 0.365, ay = 0.3, yb = 0.25;
  const lower = [[-2.2, 0.32], [-1.75, yb + 0.02], ...arcPts(-ax, ay, ar, Math.PI, 0), [-ax + ar + 0.02, yb], [ax - ar - 0.02, yb], ...arcPts(ax, ay, ar, Math.PI, 0), [1.75, yb + 0.02], [2.0, 0.32],
    [2.025, 0.46], [2.065, 0.775], [2.03, 0.815], [1.5, 0.875], [0.98, 0.93], [-1.585, 0.95], [-2.16, 0.86], [-2.225, 0.8], [-2.215, 0.46]];
  extrudeSide(lower, 1.62, paint, 0.04);
  box(3.3, 0.36, 1.12, rubberM, 0, 0.46, 0);   // underbody, so the wheel arches are not see-through

  // ---- cabin: roof, pillars, glass (narrower at the roof than at the waist) ----
  const zB = 0.775, zR = 0.625;
  extrudeSide([[0.44, 1.355], [0.38, 1.4], [-0.98, 1.39], [-1.04, 1.345]], 1.27, paint, 0.03);
  quad([0.985, 0.935, -0.745], [0.985, 0.935, 0.745], [0.42, 1.372, 0.6], [0.42, 1.372, -0.6], glassM);         // windscreen
  quad([-1.585, 0.955, 0.715], [-1.585, 0.955, -0.715], [-1.02, 1.365, -0.6], [-1.02, 1.365, 0.6], glassM);     // rear window
  beam([0.985, 0.94, -0.75], [0.985, 0.94, 0.75], 0.03, 0.03, rubberM); beam([0.42, 1.372, -0.6], [0.42, 1.372, 0.6], 0.025, 0.025, rubberM);
  beam([-1.585, 0.96, -0.72], [-1.585, 0.96, 0.72], 0.03, 0.03, rubberM); beam([-1.02, 1.366, -0.6], [-1.02, 1.366, 0.6], 0.025, 0.025, rubberM);
  for (const s of [-1, 1]) {
    beam([0.985, 0.93, s * 0.76], [0.41, 1.375, s * 0.615], 0.06, 0.05, paint);                                  // A pillar
    beam([0.95, 0.94, s * 0.752], [0.415, 1.355, s * 0.607], 0.022, 0.03, rubberM);
    beam([-0.03, 0.93, s * 0.772], [-0.06, 1.38, s * 0.622], 0.09, 0.035, rubberM);                              // B pillar (black)
    quad([-1.0, 0.93, s * zB], [-1.6, 0.95, s * 0.735], [-1.03, 1.372, s * 0.615], [-0.84, 1.38, s * 0.622], paint);   // wide rear pillar
    beam([-1.59, 0.95, s * 0.725], [-1.025, 1.37, s * 0.61], 0.05, 0.04, paint);
    beam([-0.99, 0.93, s * 0.774], [-0.835, 1.378, s * 0.623], 0.03, 0.03, rubberM);                             // rear door window edge
    const vent = box(0.21, 0.065, 0.014, blackM, -1.3, 1.045, s * 0.726); vent.rotation.x = -s * 0.31;           // extractor vent
    for (let i = 0; i < 3; i++) { const sl = box(0.2, 0.006, 0.018, darkM, -1.3, 1.028 + i * 0.017, s * (0.731 - i * 0.0052)); sl.rotation.x = -s * 0.31; }
    quad([0.93, 0.94, s * 0.768], [-0.03, 0.94, s * 0.768], [-0.06, 1.37, s * 0.621], [0.44, 1.366, s * 0.617], glassM);   // front door glass
    quad([-0.03, 0.94, s * 0.768], [-1.0, 0.94, s * 0.768], [-0.84, 1.372, s * 0.62], [-0.06, 1.37, s * 0.621], glassM);   // rear door glass
    beam([0.98, 0.938, s * 0.78], [-1.0, 0.938, s * 0.78], 0.028, 0.025, rubberM);                               // waist rubber
    beam([0.42, 1.376, s * 0.628], [-0.84, 1.378, s * 0.628], 0.028, 0.025, rubberM);                            // gutter
    // door shut lines, black handles, mirror, rubbing strip, sill shadow
    for (const x of [0.96, -0.03]) box(0.008, 0.62, 0.006, seamM, x, 0.61, s * 0.809);
    box(0.008, 0.3, 0.006, seamM, -0.97, 0.775, s * 0.809);
    for (const x of [-0.19, -0.86]) { box(0.15, 0.032, 0.03, blackM, x, 0.835, s * 0.818); box(0.05, 0.036, 0.034, darkM, x + 0.05, 0.835, s * 0.82); }
    box(0.05, 0.09, 0.13, blackM, 0.86, 1.0, s * 0.86); box(0.04, 0.03, 0.06, blackM, 0.86, 0.97, s * 0.79);
    box(1.69, 0.05, 0.03, blackM, 0, 0.56, s * 0.817); box(0.56, 0.05, 0.03, blackM, -1.875, 0.56, s * 0.817);
    box(1.66, 0.035, 0.02, rubberM, 0, 0.262, s * 0.8);
    // tail lamp wrapping round the corner
    box(0.14, 0.15, 0.03, tailM, -2.15, 0.69, s * 0.808);
  }
  // wipers and aerial
  for (const z0 of [0.47, -0.06]) { beam([0.975, 0.955, z0], [0.9, 1.013, z0 - 0.43], 0.014, 0.014, rubberM); box(0.03, 0.03, 0.03, rubberM, 0.985, 0.95, z0); }
  { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.62, 6), rubberM); a.position.set(0.14, 1.63, -0.26); a.rotation.z = 0.7; add(a); box(0.04, 0.02, 0.04, rubberM, 0.34, 1.405, -0.26); }

  // ---- nose: black panel, four round lamps, slatted grille with the diamond ----
  const nose = new THREE.Group(); nose.position.set(2.05, 0.635, 0); nose.rotation.z = -0.12; car.add(nose);
  box(0.04, 0.26, 1.56, blackM, 0, 0, 0, nose);
  for (let i = 0; i < 7; i++) box(0.012, 0.012, 0.6, darkM, 0.022, -0.09 + i * 0.03, 0, nose);
  { const d = new THREE.Shape(); d.moveTo(0, 0.052); d.lineTo(0.034, 0); d.lineTo(0, -0.052); d.lineTo(-0.034, 0); d.closePath();
    const h = new THREE.Path(); h.moveTo(0, 0.03); h.lineTo(-0.019, 0); h.lineTo(0, -0.03); h.lineTo(0.019, 0); h.closePath(); d.holes.push(h);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(d), chrome); m.rotation.y = Math.PI / 2; m.position.set(0.032, 0, 0); nose.add(m); }
  for (const s of [-1, 1]) {
    box(0.03, 0.2, 0.41, darkM, 0.012, 0, s * 0.53, nose);
    for (const z of [0.44, 0.62]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 20), headM); lens.rotation.z = Math.PI / 2; lens.position.set(0.03, 0, s * z); nose.add(lens);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), headM); dome.rotation.z = -Math.PI / 2; dome.scale.set(1, 0.22, 1); dome.position.set(0.044, 0, s * z); nose.add(dome);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.073, 0.007, 6, 22), darkM); ring.rotation.y = Math.PI / 2; ring.position.set(0.04, 0, s * z); nose.add(ring);
    }
  }
  // ---- wrap-around black bumpers (plan-view U extruded upwards), valance, lamps, plates ----
  function bumper(sg, y0, h) {
    const P = [[1.6, 0.855], [2.0, 0.855], [2.09, 0.83], [2.135, 0.76], [2.145, 0.6], [2.145, -0.6], [2.135, -0.76], [2.09, -0.83], [2.0, -0.855], [1.6, -0.855], [1.6, -0.8], [1.98, -0.8], [2.02, -0.74], [2.02, 0.74], [1.98, 0.8], [1.6, 0.8]];
    const s = new THREE.Shape(); P.forEach(([x, z], i) => { const px = sg > 0 ? x : -(x + 0.19); i ? s.lineTo(px, z) : s.moveTo(px, z); }); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelOffset: -0.015, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2); g.translate(0, y0 + 0.015, 0); return add(new THREE.Mesh(g, blackM));
  }
  bumper(1, 0.3, 0.2); bumper(-1, 0.33, 0.19);
  box(0.16, 0.09, 1.5, blackM, 1.99, 0.275, 0); box(0.16, 0.08, 1.5, blackM, -2.17, 0.3, 0);
  for (const s of [-1, 1]) { box(0.02, 0.07, 0.085, clearM, 2.147, 0.4, s * 0.47); box(0.02, 0.07, 0.11, amberM, 2.147, 0.4, s * 0.57); }
  // rear: lamp clusters (reverse, stop, indicator) either side of the plate
  for (const s of [-1, 1]) { box(0.03, 0.15, 0.3, tailM, -2.228, 0.69, s * 0.5); box(0.03, 0.15, 0.13, amberM, -2.226, 0.69, s * 0.715); box(0.03, 0.15, 0.1, clearM, -2.228, 0.69, s * 0.3); }
  box(0.02, 0.012, 1.5, chrome, -2.21, 0.79, 0);
  const plateTex = canvasTex(256, 64, (x, w, h) => { x.fillStyle = '#0b0b0c'; x.fillRect(0, 0, w, h); x.strokeStyle = '#f4f4f0'; x.lineWidth = 3; x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = '#f4f4f0'; x.font = '700 36px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('RENAULT 12', w / 2, h / 2 + 2, w - 26); });
  const plateM = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 });
  for (const [x, y, ry] of [[2.158, 0.4, Math.PI / 2], [-2.246, 0.69, -Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), plateM); p.position.set(x, y, 0); p.rotation.y = ry; add(p); }
  // "5 Vites" badge on the front wings
  const badgeTex = canvasTex(160, 64, (x, w, h) => { x.fillStyle = '#e6e4e0'; x.fillRect(0, 0, w, h); x.fillStyle = '#1b1b1b'; x.fillRect(6, 10, 34, 44); x.fillStyle = '#e6e4e0'; x.font = 'italic 700 38px Georgia, serif'; x.textBaseline = 'middle'; x.fillText('5', 13, 34);
    x.fillStyle = '#1b1b1b'; x.font = 'italic 700 34px Georgia, serif'; x.fillText('Vites', 48, 34); });
  const badgeM = new THREE.MeshStandardMaterial({ map: badgeTex, roughness: 0.5 });
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.052), badgeM); b.position.set(0.72, 0.68, s * 0.812); if (s < 0) b.rotation.y = Math.PI; add(b); }

  // ---- interior (seen through the glass and from the driver's seat) ----
  box(2.5, 0.02, 1.4, dashM, -0.3, 0.945, 0);
  box(0.3, 0.05, 1.4, dashM, 0.69, 0.965, 0);
  for (const z of [-0.36, 0.36]) { box(0.5, 0.12, 0.48, seatM, -0.2, 1.0, z); const b = box(0.12, 0.36, 0.46, seatM, -0.47, 1.12, z); b.rotation.z = 0.12; box(0.09, 0.13, 0.25, seatM, -0.5, 1.3, z); }
  box(0.46, 0.12, 1.28, seatM, -0.8, 1.0, 0); { const b = box(0.12, 0.3, 1.26, seatM, -1.07, 1.09, 0); b.rotation.z = 0.2; }
  box(0.3, 0.02, 1.3, dashM, -1.36, 0.965, 0);
  { const sw = new THREE.Group(); sw.position.set(0.42, 1.02, -0.36); sw.rotation.z = -0.45; car.add(sw);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.013, 6, 24), rubberM); rim.rotation.y = Math.PI / 2; sw.add(rim);
    box(0.02, 0.02, 0.32, rubberM, 0, 0, 0, sw); box(0.02, 0.16, 0.02, rubberM, 0, -0.08, 0, sw);
    beam([0.42, 1.02, -0.36], [0.62, 0.95, -0.36], 0.035, 0.035, dashM); }

  // ---- optional roof rack with a load (off by default: the reference car has none) ----
  const rack = new THREE.Group(); car.add(rack); rack.visible = false;
  for (const z of [-0.57, 0.57]) box(1.2, 0.035, 0.035, blackM, -0.32, 1.5, z, rack);
  for (const x of [-0.85, -0.5, -0.15, 0.2]) { box(0.035, 0.035, 1.17, blackM, x, 1.5, 0, rack); for (const z of [-0.57, 0.57]) box(0.035, 0.1, 0.035, blackM, x, 1.45, z, rack); }
  { const load = box(1.0, 0.34, 0.95, new THREE.MeshStandardMaterial({ color: 0x6e5a3e, roughness: 1 }), -0.32, 1.69, 0, rack); load.rotation.y = 0.04;
    const strapM = new THREE.MeshStandardMaterial({ color: 0xc8a12a }); for (const x of [-0.62, 0]) box(0.05, 0.36, 0.99, strapM, x, 1.69, 0, rack); }

  // ---- wheels: 13" tyres with the slotted silver covers ----
  const capTex = canvasTex(256, 256, (x, w) => { const c = w / 2, R = c - 2; x.clearRect(0, 0, w, w);
    const g = x.createRadialGradient(c - 18, c - 22, 8, c, c, R); g.addColorStop(0, '#f3f4f5'); g.addColorStop(0.55, '#cfd2d5'); g.addColorStop(1, '#a9adb1'); x.fillStyle = g; x.beginPath(); x.arc(c, c, R, 0, 6.2832); x.fill();
    x.strokeStyle = '#8d9195'; x.lineWidth = 3; x.beginPath(); x.arc(c, c, R - 3, 0, 6.2832); x.stroke(); x.beginPath(); x.arc(c, c, R * 0.6, 0, 6.2832); x.stroke();
    x.fillStyle = '#1c1d1f'; for (let i = 0; i < 24; i++) { x.save(); x.translate(c, c); x.rotate(i * 6.2832 / 24); x.beginPath(); x.roundRect(-4.5, -R * 0.9, 9, R * 0.24, 4); x.fill(); x.restore(); }
    x.fillStyle = '#b9bcc0'; x.beginPath(); x.arc(c, c, R * 0.2, 0, 6.2832); x.fill(); x.strokeStyle = '#8d9195'; x.stroke(); });
  const capM = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.32, metalness: 0.55, transparent: true, alphaTest: 0.5 });
  const tyreG = new THREE.CylinderGeometry(WR, WR, 0.16, 28), shoulderG = new THREE.TorusGeometry(WR - 0.03, 0.03, 8, 28), capG = new THREE.CircleGeometry(0.2, 32), wellG = new THREE.CylinderGeometry(0.2, 0.2, 0.165, 20);
  const wheels = [];
  for (const [x, z] of [[WB / 2, -TRACK / 2], [WB / 2, TRACK / 2], [-WB / 2, -TRACK / 2], [-WB / 2, TRACK / 2]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, WR, z); car.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin); const s = Math.sign(z);
    const tyre = new THREE.Mesh(tyreG, tyreM); tyre.rotation.x = Math.PI / 2; spin.add(tyre);
    for (const o of [-0.05, 0.05]) { const sh = new THREE.Mesh(shoulderG, tyreM); sh.position.z = o; spin.add(sh); }
    const well = new THREE.Mesh(wellG, darkM); well.rotation.x = Math.PI / 2; spin.add(well);
    const cap = new THREE.Mesh(capG, capM); cap.position.z = s * 0.086; if (s < 0) cap.rotation.y = Math.PI; spin.add(cap);
    wheels.push({ pivot, spin, front: x > 0 });
  }
  car.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = o.material !== glassM; } });

  // ---- headlights (off until switched on: a hidden spot light costs nothing) ----
  const lights = [];
  for (const z of [-0.53, 0.53]) { const sl = new THREE.SpotLight(0xfff0d0, 0, 90, 0.45, 0.6, 1.4); sl.visible = false; sl.position.set(2.12, 0.64, z); sl.target.position.set(12, -0.6, z * 2); car.add(sl, sl.target); lights.push(sl); }
  function setLights(on) { lights.forEach(l => { l.intensity = on ? 60 : 0; l.visible = on; }); headM.emissive.setHex(on ? 0xfff0c0 : 0x000000); tailM.emissive.setHex(on ? 0x600000 : 0x200000); }

  return { car, paint, rack, wheels, setLights };
}
