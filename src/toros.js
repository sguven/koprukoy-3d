// The Toros of the "Toros" (drive) mode: a late Renault 12 Toros saloon, modelled on the owner's reference picture
// (a white late-model Toros, three-quarter front view): off-white paint, black plastic wrap-around bumpers with the indicators set
// into them, a black nose panel with four round headlights and the Renault diamond, black rubbing strips, black door
// handles and mirrors, slotted silver wheel covers, the black vent on the wide rear pillar, a "5 Vites" badge on the
// front wing, a roof aerial and "RENAULT 12" plates.
// Frame: front = +X, up = +Y, right = +Z, origin on the ground midway between the axles; 1 unit = 1 m.
// Real car: 4.34 m long, 1.64 m wide, 1.43 m high, wheelbase 2.44 m, 155 SR 13 tyres.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  const lowerMesh = extrudeSide(lower, 1.62, paint, 0.04);
  // v1.9: the cabin is hollow. The body used to be one solid with a dark lid at the waist, the seats sitting on top of
  // it, so from the driver's seat everything was 30 cm too low. Drop the lid strip over the cabin (between the screen
  // base and the rear window base); the door rails and trim panels below cover the cut edges.
  { const g = lowerMesh.geometry, p = g.attributes.position, keep = [], A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2);
      n.subVectors(C, B).cross(B.clone().sub(A)).normalize(); const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3, cz = (A.z + B.z + C.z) / 3;
      if (!(cx > -1.575 && cx < 0.97 && cy > 0.88 && Math.abs(cz) < 0.75 && Math.abs(n.y) > 0.3)) keep.push(i, i + 1, i + 2);
    }
    const ng = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) { const out = new Float32Array(keep.length * a.itemSize); keep.forEach((v, j) => { for (let c = 0; c < a.itemSize; c++) out[j * a.itemSize + c] = a.array[v * a.itemSize + c]; }); ng.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize)); }
    lowerMesh.geometry = ng; g.dispose(); }
  // underbody, so the wheel arches are not see-through: tall under the engine bay and the rear seat, a flat pan under the cabin floor
  box(0.81, 0.36, 1.12, rubberM, 1.245, 0.46, 0); box(0.87, 0.28, 1.12, rubberM, -1.215, 0.42, 0); box(1.56, 0.08, 1.12, rubberM, 0.06, 0.26, 0);

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

  // ---- interior (v1.9: a real cabin, built for the driver's-seat camera; see buildCabin below) ----
  const cabin = buildCabin(car, { chrome, rubberM, darkM });

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
  // v1.12: the body's rigid exterior pieces (panels, bumpers, lamps, badges, trim …) were ~150 separate meshes, one draw
  // call each in every pass. They never move relative to the car, so they are merged per material.
  mergeRigid(car, new Set([rack, ...wheels.map(w => w.pivot)]));
  // the cabin only receives shadows (the roof and doors already shade it; casting would add draw calls to every shadow pass)
  car.traverse(o => { if (o.isMesh) { const inside = o.userData.cabin; o.castShadow = !inside; o.receiveShadow = o.material !== glassM; } });

  // ---- headlights (off until switched on: a hidden spot light costs nothing) ----
  const lights = [];
  for (const z of [-0.53, 0.53]) { const sl = new THREE.SpotLight(0xfff0d0, 0, 90, 0.45, 0.6, 1.4); sl.visible = false; sl.position.set(2.12, 0.64, z); sl.target.position.set(12, -0.6, z * 2); car.add(sl, sl.target); lights.push(sl); }
  function setLights(on) { lights.forEach(l => { l.intensity = on ? 60 : 0; l.visible = on; }); headM.emissive.setHex(on ? 0xfff0c0 : 0x000000); tailM.emissive.setHex(on ? 0x600000 : 0x200000); cabin.setPanelLights(on); }

  return { car, paint, rack, wheels, setLights, cabin };
}

/**
 * Merge the car's rigid exterior meshes per material into one mesh each, in the car's frame. Left alone: cabin parts
 * (already merged; some move), anything under the `keep` groups (wheels, roof rack), meshes with children, multi-material
 * meshes, and a material's pieces whose vertex attributes do not match (a texture needs uvs on all of them).
 */
function mergeRigid(car, keep) {
  car.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(car.matrixWorld).invert(), m = new THREE.Matrix4(), buckets = new Map();
  car.traverse(o => {
    if (!o.isMesh || o.userData.cabin || o.children.length || Array.isArray(o.material) || o.isInstancedMesh) return;
    for (let a = o.parent; a && a !== car; a = a.parent) if (keep.has(a) || !a.visible) return;
    if (!o.visible) return;
    const k = o.material.uuid + '|' + o.renderOrder; let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const mat = list[0].material, all = (n) => list.every(o => o.geometry.attributes[n]);
    const names = ['position', 'normal'];
    if (all('uv')) names.push('uv'); else if (mat.map || mat.normalMap || mat.roughnessMap || mat.alphaMap || mat.aoMap) continue;
    if (mat.vertexColors) { if (!all('color')) continue; names.push('color'); }
    if (!all('normal')) continue;
    const geos = list.map(o => {
      const g = new THREE.BufferGeometry();
      for (const n of names) g.setAttribute(n, o.geometry.attributes[n].clone());
      if (o.geometry.index) g.setIndex(o.geometry.index.clone()); else g.setIndex([...Array(g.attributes.position.count).keys()]);
      m.copy(inv).multiply(o.matrixWorld); g.applyMatrix4(m);
      if (m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
      return g;
    });
    const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat); mesh.name = 'Toros_' + (mat.name || 'part'); mesh.renderOrder = list[0].renderOrder;
    for (const o of list) o.parent.remove(o);
    car.add(mesh);
  }
}

// ======================================================================================================================
// v1.9 cabin. Everything is in the car frame (front +X, up +Y, right +Z; the driver sits on the left, z < 0).
// Static parts are merged into one mesh per material (about a dozen draw calls for the whole interior); the moving
// parts (steering wheel, gauge needles) and the mirror glasses stay separate.
// Proportions follow the real car: floor 0.30 m above the ground, seat cushion top ~0.52, driver's eye ~1.16 and
// just behind the B pillar, headliner 1.335, 380 mm two-spoke wheel ~0.52 m in front of the eye, instruments under a hood behind it.
// ======================================================================================================================
export const EYE = new THREE.Vector3(-0.12, 1.16, -0.36);   // just behind the B pillar, as in the real car
const UP = new THREE.Vector3(0, 1, 0);

function noiseTex(w, h, base, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, w, h); if (draw) draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
function speckle(x, w, h, n, a, light) { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${a * Math.random()})`; x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5); } }

/** Mirror: the glass faces so the driver's line of sight reflects straight back along `out`. */
function mirrorNormal(centre, out) { const d = centre.clone().sub(EYE).normalize(); return out.clone().normalize().sub(d).normalize(); }

function buildCabin(car, { chrome, rubberM, darkM }) {
  // ---- materials ----
  const plasticM = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.74, map: noiseTex(256, 256, '#d8d8d8', (x, w, h) => speckle(x, w, h, 9000, 0.22)) });
  const trimM = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.7, side: THREE.DoubleSide });                    // pillar trims, console sides
  const vinylM = new THREE.MeshStandardMaterial({ color: 0x3b3c3f, roughness: 0.62, map: noiseTex(256, 512, '#cfcfcf', (x, w, h) => {
    // door card: plain lower half, an upper band of horizontal stitched pleats
    for (let y = 40; y < 220; y += 22) { x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, y, w, 3); x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, y + 3, w, 2); }
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 236, w, 5); speckle(x, w, h, 6000, 0.15); }) });
  const fabricTex = noiseTex(256, 256, '#bdbdbd', (x, w, h) => {
    // late-Toros velour: fine vertical ribs with a darker insert stripe pattern
    for (let i = 0; i < w; i += 8) { x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(i, 0, 3, h); }
    for (let i = 0; i < w; i += 64) { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(i + 20, 0, 24, h); }
    speckle(x, w, h, 12000, 0.25); speckle(x, w, h, 4000, 0.12, true); });
  fabricTex.repeat.set(2, 2);
  const fabricM = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.96, map: fabricTex });
  const boltM = new THREE.MeshStandardMaterial({ color: 0x2d2e31, roughness: 0.9, map: noiseTex(128, 128, '#c8c8c8', (x, w, h) => speckle(x, w, h, 3000, 0.25)) });
  const carpetM = new THREE.MeshStandardMaterial({ color: 0x202022, roughness: 1, map: noiseTex(256, 256, '#a8a8a8', (x, w, h) => { speckle(x, w, h, 20000, 0.5); speckle(x, w, h, 8000, 0.2, true); }) });
  const headlinerM = new THREE.MeshStandardMaterial({ color: 0xb8b1a4, roughness: 0.95, map: noiseTex(256, 256, '#f2f2f2', (x, w, h) => {
    for (let i = 4; i < w; i += 9) for (let j = 4; j < h; j += 9) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(i, j, 2, 2); } speckle(x, w, h, 3000, 0.08); }) });
  headlinerM.map.repeat.set(5, 5);
  const wheelM = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.68 });
  const lampM = new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.4, emissive: 0x000000 });
  const all = [plasticM, trimM, vinylM, fabricM, boltM, carpetM, headlinerM, wheelM, chrome, rubberM, darkM, lampM];
  const parts = new Map(all.map(m => [m, []]));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S1 = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
  /** Queue a geometry for the merged cabin mesh of its material. */
  function put(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
    const g = geo.index ? geo.toNonIndexed() : geo; if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(M4.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, order)), S1)); parts.get(mat).push(g); return g;
  }
  const rbox = (sx, sy, sz, r, mat, x, y, z, rx, ry, rz) => put(new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3)), mat, x, y, z, rx, ry, rz);
  const bx = (sx, sy, sz, mat, x, y, z, rx, ry, rz) => put(new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z, rx, ry, rz);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), XA = new THREE.Vector3(1, 0, 0);
  function rod(p0, p1, w, t, mat) { _a.set(...p0); _b.set(...p1); const L = _a.distanceTo(_b), g = new THREE.BoxGeometry(L, w, t);
    g.applyQuaternion(Q.setFromUnitVectors(XA, _b.clone().sub(_a).normalize())); g.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2); return put(g, mat, 0, 0, 0); }
  function cyl(p0, p1, r0, r1, mat, seg = 10) { _a.set(...p0); _b.set(...p1); const L = _a.distanceTo(_b), g = new THREE.CylinderGeometry(r1, r0, L, seg);
    g.applyQuaternion(Q.setFromUnitVectors(UP, _b.clone().sub(_a).normalize())); g.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2); return put(g, mat, 0, 0, 0); }
  /** Side profile (x, y) extruded across z from z0 to z1. */
  function prof(points, z0, z1, mat, bevel = 0.006) { const s = new THREE.Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, z0 + bevel); return put(g, mat, 0, 0, 0); }

  // ---- floor, footwell, tunnel ----
  bx(2.52, 0.02, 1.49, carpetM, -0.31, 0.30, 0);                          // carpet, firewall to rear seat
  prof([[0.84, 0.30], [0.95, 0.30], [0.95, 0.66], [0.84, 0.64]], -0.745, 0.745, carpetM);   // toe board / firewall
  rbox(1.0, 0.14, 0.24, 0.04, carpetM, 0.34, 0.36, 0);                    // transmission tunnel
  rbox(0.62, 0.16, 0.2, 0.025, plasticM, 0.32, 0.44, 0);                  // console on the tunnel
  // ---- door cards, window rails, rear quarters (both sides) ----
  for (const s of [-1, 1]) {
    bx(0.96, 0.64, 0.03, vinylM, 0.45, 0.61, s * 0.76);                   // front door card
    bx(0.97, 0.64, 0.03, vinylM, -0.515, 0.61, s * 0.76);                 // rear door card
    bx(0.6, 0.66, 0.03, vinylM, -1.29, 0.62, s * 0.76);                   // rear quarter trim
    rbox(2.56, 0.045, 0.1, 0.012, plasticM, -0.30, 0.935, s * 0.745);     // window rail (covers the cut body edge)
    bx(0.006, 0.6, 0.012, rubberM, -0.03, 0.62, s * 0.744); bx(0.006, 0.6, 0.012, rubberM, 0.935, 0.62, s * 0.744);   // door gaps
    // front door: armrest with pull cup, chrome inner handle, window crank, map pocket, lock knob
    rbox(0.34, 0.055, 0.075, 0.02, plasticM, 0.24, 0.70, s * 0.71);
    rbox(0.09, 0.035, 0.04, 0.012, darkM, 0.32, 0.735, s * 0.69);
    rbox(0.1, 0.026, 0.02, 0.008, chrome, 0.74, 0.80, s * 0.737); bx(0.13, 0.05, 0.01, darkM, 0.74, 0.80, s * 0.743);
    put(new THREE.TorusGeometry(0.02, 0.006, 6, 14), chrome, 0.56, 0.60, s * 0.738, 0, 0, 0);
    rod([0.56, 0.60, s * 0.725], [0.56, 0.52, s * 0.725], 0.012, 0.01, chrome); cyl([0.56, 0.52, s * 0.725], [0.56, 0.52, s * 0.69], 0.009, 0.009, darkM, 8);
    rbox(0.46, 0.12, 0.04, 0.012, plasticM, 0.55, 0.40, s * 0.735);
    cyl([0.02, 0.955, s * 0.765], [0.02, 0.99, s * 0.765], 0.006, 0.005, darkM, 8);
    // rear door: armrest, crank, ashtray
    rbox(0.28, 0.05, 0.065, 0.018, plasticM, -0.45, 0.68, s * 0.715);
    put(new THREE.TorusGeometry(0.018, 0.005, 6, 12), chrome, -0.2, 0.58, s * 0.738, 0, 0, 0);
    rod([-0.2, 0.58, s * 0.725], [-0.2, 0.51, s * 0.725], 0.011, 0.01, chrome);
    rbox(0.1, 0.04, 0.02, 0.006, chrome, -0.72, 0.76, s * 0.737);
    // pillar trims: A (dark plastic over the painted pillar), B (with the hanging seat belt), C
    rod([0.97, 0.955, s * 0.73], [0.425, 1.345, s * 0.588], 0.085, 0.022, trimM);
    rod([-0.04, 0.95, s * 0.735], [-0.06, 1.34, s * 0.6], 0.11, 0.02, trimM);
    rod([-0.08, 1.27, s * 0.695], [-0.24, 0.62, s * 0.715], 0.045, 0.006, darkM);   // belt down the pillar
    rbox(0.05, 0.03, 0.03, 0.008, darkM, -0.07, 1.28, s * 0.69);
    { const g = new THREE.BufferGeometry(), v = [[-0.99, 0.955, 0.722], [-1.57, 0.962, 0.702], [-1.03, 1.345, 0.592], [-0.85, 1.352, 0.6]].map(([x, y, z]) => [x, y, s * z]);   // C pillar trim, following the sloping pillar
      g.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); put(g, trimM, 0, 0, 0); }
  }
  // ---- headliner, visors, dome light, rear-view mirror stalk ----
  rbox(1.47, 0.02, 1.24, 0.008, headlinerM, -0.30, 1.336, 0);
  for (const s of [-1, 1]) {
    rbox(0.17, 0.016, 0.36, 0.006, headlinerM, 0.34, 1.318, s * 0.37, 0, 0, -0.08);
    cyl([0.42, 1.322, s * 0.56], [0.42, 1.322, s * 0.17], 0.006, 0.006, chrome, 6);
    rbox(0.02, 0.012, 0.03, 0.005, darkM, 0.41, 1.328, s * 0.15);
    rod([-0.18, 1.32, s * 0.56], [-0.18, 1.32, s * 0.47], 0.02, 0.03, plasticM);   // grab handle over the rear door
  }
  rbox(0.07, 0.014, 0.13, 0.005, lampM, -0.42, 1.324, 0); bx(0.09, 0.008, 0.15, plasticM, -0.42, 1.33, 0);
  cyl([0.41, 1.334, 0], [0.375, 1.295, 0], 0.008, 0.007, darkM, 8);
  // ---- front seats (buckets with headrests) and the rear bench ----
  for (const s of [-1, 1]) {
    const z = s * 0.36;
    bx(0.42, 0.1, 0.36, darkM, -0.14, 0.36, z);                                    // runners
    rbox(0.5, 0.13, 0.48, 0.045, fabricM, -0.12, 0.47, z, 0, 0, 0.07);              // cushion (front edge a little higher)
    for (const o of [-1, 1]) rbox(0.46, 0.08, 0.07, 0.03, boltM, -0.13, 0.53, z + o * 0.215, 0, 0, 0.07);
    rbox(0.12, 0.6, 0.48, 0.045, fabricM, -0.42, 0.82, z, 0, 0, 0.22);              // backrest, leaning back
    for (const o of [-1, 1]) rbox(0.1, 0.5, 0.07, 0.03, boltM, -0.38, 0.81, z + o * 0.215, 0, 0, 0.22);
    rbox(0.13, 0.62, 0.5, 0.03, plasticM, -0.49, 0.81, z, 0, 0, 0.22);              // shell on the back
    rbox(0.09, 0.17, 0.27, 0.04, fabricM, -0.52, 1.2, z, 0, 0, 0.15);               // headrest
    for (const o of [-0.08, 0.08]) cyl([-0.505, 1.08, z + o], [-0.49, 1.13, z + o], 0.006, 0.006, chrome, 6);
    rbox(0.08, 0.06, 0.04, 0.015, darkM, -0.22, 0.41, s * 0.61);                    // recline lever
  }
  rbox(0.52, 0.18, 1.4, 0.05, fabricM, -1.03, 0.47, 0, 0, 0, 0.05);                 // rear bench cushion
  rbox(0.13, 0.46, 1.4, 0.05, fabricM, -1.34, 0.76, 0, 0, 0, 0.32);                 // rear backrest
  bx(0.2, 0.62, 1.42, darkM, -1.48, 0.62, 0);                                        // fill behind it
  bx(0.26, 0.018, 1.42, plasticM, -1.46, 0.945, 0);                                  // parcel shelf
  for (const o of [-0.4, 0.4]) rbox(0.16, 0.05, 0.22, 0.02, darkM, -1.45, 0.96, o);  // rear speakers
  // ---- pedals ----
  for (const [z, w] of [[-0.49, 0.07], [-0.36, 0.08], [-0.22, 0.05]]) { rbox(0.02, 0.07, w, 0.006, rubberM, 0.74, 0.42, z, 0, 0, 0.5); rod([0.76, 0.45, z], [0.8, 0.62, z], 0.015, 0.01, darkM); }

  // ---- dashboard: three sections across the car, the driver's one with the instrument recess, plus the hood ----
  const dashProf = [[0.975, 0.935], [0.8, 0.976], [0.62, 0.996], [0.565, 0.988], [0.538, 0.958], [0.532, 0.885], [0.545, 0.78], [0.565, 0.72], [0.63, 0.62], [0.8, 0.6], [0.93, 0.62], [0.985, 0.9]];
  const recessProf = [[0.975, 0.935], [0.8, 0.976], [0.655, 0.992], [0.645, 0.9], [0.545, 0.9], [0.532, 0.885], [0.545, 0.78], [0.565, 0.72], [0.63, 0.62], [0.8, 0.6], [0.93, 0.62], [0.985, 0.9]];
  prof(dashProf, -0.745, -0.585, plasticM); prof(recessProf, -0.585, -0.135, plasticM); prof(dashProf, -0.135, 0.745, plasticM);
  prof([[0.66, 0.99], [0.66, 1.045], [0.6, 1.062], [0.53, 1.058], [0.508, 1.042], [0.514, 1.03], [0.545, 1.036], [0.62, 1.03], [0.64, 0.99]], -0.6, -0.12, plasticM);   // instrument hood
  for (const z of [-0.598, -0.122]) bx(0.13, 0.15, 0.02, plasticM, 0.585, 0.975, z);    // its cheeks
  bx(0.1, 0.008, 0.46, darkM, 0.6, 0.903, -0.36);                                      // shelf under the dials
  // glovebox lid, its lock, the defrost grille along the screen
  rbox(0.02, 0.13, 0.42, 0.006, plasticM, 0.534, 0.84, 0.42, 0, 0, 0.04); rbox(0.012, 0.018, 0.05, 0.004, chrome, 0.53, 0.885, 0.42);
  for (let i = 0; i < 9; i++) bx(0.012, 0.004, 1.1, darkM, 0.9 - i * 0.012, 0.947 + i * 0.002, 0);
  // vents: one at each end, two in the middle (dark mouths with slats)
  for (const z of [-0.66, -0.06, 0.06, 0.66]) { bx(0.02, 0.05, 0.1, darkM, 0.536, 0.935, z); for (let k = 0; k < 4; k++) bx(0.012, 0.004, 0.096, plasticM, 0.534, 0.917 + k * 0.012, z); }
  // centre stack: heater sliders, radio, ashtray, switches
  rbox(0.03, 0.06, 0.24, 0.006, darkM, 0.54, 0.855, 0);
  for (const z of [-0.07, 0, 0.07]) { bx(0.004, 0.004, 0.05, plasticM, 0.524, 0.862, z); rbox(0.016, 0.018, 0.012, 0.004, trimM, 0.522, 0.862, z + 0.01); }
  rbox(0.04, 0.06, 0.2, 0.006, darkM, 0.55, 0.785, 0);                     // radio body (its face is the separate lit plane)
  rbox(0.03, 0.04, 0.14, 0.008, plasticM, 0.565, 0.73, 0);                  // ashtray
  for (const z of [-0.18, -0.145, 0.145, 0.18]) rbox(0.014, 0.02, 0.024, 0.004, trimM, 0.54, 0.86, z);
  // gear lever (5 speed) with its boot, handbrake between the seats
  cyl([0.26, 0.52, 0], [0.2, 0.69, 0], 0.075, 0.018, rubberM, 12);
  cyl([0.2, 0.69, 0], [0.17, 0.76, 0], 0.007, 0.007, chrome, 8);
  put(new THREE.SphereGeometry(0.027, 14, 10), wheelM, 0.165, 0.78, 0, 0, 0, 0);
  bx(0.32, 0.1, 0.1, plasticM, 0.0, 0.48, 0); rod([0.1, 0.53, 0], [-0.15, 0.6, 0], 0.035, 0.04, plasticM); rbox(0.12, 0.045, 0.05, 0.02, wheelM, -0.12, 0.6, 0, 0, 0, -0.27);
  // steering column shroud and stalks (the wheel itself is separate: it turns)
  const WC = new THREE.Vector3(0.38, 0.91, -0.36), COL = new THREE.Vector3(Math.cos(0.44), -Math.sin(0.44), 0);   // column runs forward and down
  { const a = WC.clone().addScaledVector(COL, 0.05), b = WC.clone().addScaledVector(COL, 0.19); rod(a.toArray(), b.toArray(), 0.09, 0.1, plasticM);
    for (const s of [-1, 1]) rod(a.clone().addScaledVector(COL, 0.05).toArray(), [a.x + 0.06, a.y - 0.02, -0.36 + s * 0.17], 0.012, 0.012, darkM); }

  // ---- merge ----
  const group = new THREE.Group(); group.name = 'cabin'; car.add(group);
  for (const [mat, list] of parts) { if (!list.length) continue; const m = new THREE.Mesh(mergeGeometries(list), mat); m.userData.cabin = true; group.add(m); list.forEach(g => g.dispose()); }

  // ---- steering wheel: two spokes dropping a little to a wide padded hub, turns with the front wheels ----
  const sw = new THREE.Group(); sw.position.copy(WC); sw.rotation.z = -0.44; car.add(sw);   // local X = column axis (forward)
  const spin = new THREE.Group(); sw.add(spin);
  { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.0165, 10, 40), wheelM); rim.rotation.y = Math.PI / 2; spin.add(rim);
    for (const s of [-1, 1]) { const sp = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.032, 0.15, 2, 0.008), wheelM); sp.position.set(0.012, -0.018, s * 0.1); sp.rotation.x = s * 0.22; spin.add(sp); }
    const hub = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.11, 0.16, 3, 0.02), wheelM); hub.position.set(0.012, -0.012, 0); spin.add(hub);
    const d = new THREE.Shape(); d.moveTo(0, 0.022); d.lineTo(0.015, 0); d.lineTo(0, -0.022); d.lineTo(-0.015, 0); d.closePath();
    const h = new THREE.Path(); h.moveTo(0, 0.012); h.lineTo(-0.008, 0); h.lineTo(0, -0.012); h.lineTo(0.008, 0); h.closePath(); d.holes.push(h);
    const em = new THREE.Mesh(new THREE.ShapeGeometry(d), chrome); em.rotation.y = -Math.PI / 2; em.position.set(-0.012, -0.005, 0); spin.add(em); }
  sw.traverse(o => { if (o.isMesh) o.userData.cabin = true; });

  // ---- instruments: speedometer, rev counter, fuel and temperature, warning lamps (canvas face + live needles) ----
  const CW = 0.44, CH = 0.11, FW = 1024, FH = 256;
  const faceTex = canvasTex(FW, FH, (x, w, h) => {
    x.fillStyle = '#08090a'; x.fillRect(0, 0, w, h);
    const dial = (cx, cy, r, max, step, minor, labelK, redFrom, unit) => {
      x.fillStyle = '#111214'; x.beginPath(); x.arc(cx, cy, r + 8, 0, 6.2832); x.fill(); x.strokeStyle = '#3a3c40'; x.lineWidth = 3; x.stroke();
      for (let v = 0; v <= max + 1e-6; v += minor) {
        const a = (225 - 270 * v / max) * Math.PI / 180, major = Math.abs(v / step - Math.round(v / step)) < 1e-6, L = major ? 16 : 8;
        x.strokeStyle = redFrom !== null && v >= redFrom ? '#d8382c' : '#eeeeea'; x.lineWidth = major ? 4 : 2;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * r, cy - Math.sin(a) * r); x.lineTo(cx + Math.cos(a) * (r - L), cy - Math.sin(a) * (r - L)); x.stroke();
        if (major) { x.fillStyle = redFrom !== null && v >= redFrom ? '#d8382c' : '#eeeeea'; x.font = `600 ${r > 100 ? 22 : 20}px Arial, Helvetica, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(Math.round(v * labelK)), cx + Math.cos(a) * (r - 36), cy - Math.sin(a) * (r - 36)); }
      }
      x.fillStyle = '#9fa1a4'; x.font = '500 15px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.fillText(unit, cx, cy - r * 0.36);
    };
    dial(360, 128, 112, 160, 20, 10, 1, null, 'km/h');
    dial(664, 128, 104, 7, 1, 0.5, 1, 6, 'x1000/min');
    // odometer window in the speedometer
    x.fillStyle = '#d9d9d4'; x.fillRect(322, 150, 76, 19); x.fillStyle = '#121212'; x.font = '600 15px "Courier New", monospace'; x.textAlign = 'center'; x.fillText('148 372', 360, 160);
    // small gauges at the ends: fuel (left), coolant temperature (right)
    const small = (cx, lo, hi) => { x.strokeStyle = '#eeeeea'; x.lineWidth = 3; x.beginPath(); x.arc(cx, 150, 62, (180 + 40) * Math.PI / 180, (360 - 40) * Math.PI / 180); x.stroke();
      for (const k of [0, 0.5, 1]) { const a = (180 + 40 + k * 100) * Math.PI / 180; x.beginPath(); x.moveTo(cx + Math.cos(a) * 62, 150 + Math.sin(a) * 62); x.lineTo(cx + Math.cos(a) * 50, 150 + Math.sin(a) * 50); x.stroke(); }
      x.fillStyle = '#eeeeea'; x.font = '700 18px Arial, sans-serif'; x.fillText(lo, cx - 52, 120); x.fillText(hi, cx + 52, 120); };
    small(112, 'E', 'F'); small(912, 'C', 'H'); x.fillStyle = '#d8382c'; x.fillRect(958, 116, 8, 8);
    // warning lamps (unlit): indicators, oil, charge, high beam
    const lamp = (cx, col) => { x.fillStyle = col; x.globalAlpha = 0.35; x.beginPath(); x.arc(cx, 232, 7, 0, 6.2832); x.fill(); x.globalAlpha = 1; };
    lamp(476, '#2fa84f'); lamp(512, '#c33'); lamp(548, '#c33'); lamp(584, '#3a6fd8'); lamp(620, '#c8a020');
    x.fillStyle = '#9fa1a4'; x.font = 'italic 600 14px Arial, sans-serif'; x.fillText('TOROS', 512, 30);
  });
  const faceM = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.35, metalness: 0, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.32 });
  const cluster = new THREE.Group(); cluster.position.set(0.635, 0.962, -0.36); cluster.rotation.set(0, -Math.PI / 2, 0, 'YXZ'); cluster.rotation.x = -0.2; car.add(cluster);   // facing the driver, tipped back
  cluster.add(new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), faceM));
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18, envMapIntensity: 1.2, depthWrite: false }));
  lens.position.z = 0.012; cluster.add(lens);
  const needleM = new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff4a10, emissiveIntensity: 0.5, roughness: 0.4 });
  const capM = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.5 });
  const px = (u, v) => [(u / FW - 0.5) * CW, (0.5 - v / FH) * CH];
  function needle(u, v, len, width = 0.0028) {
    const piv = new THREE.Group(); const [x0, y0] = px(u, v); piv.position.set(x0, y0, 0.004); cluster.add(piv);
    const n = new THREE.Mesh(new THREE.PlaneGeometry(len, width), needleM); n.position.x = len / 2 - 0.004; piv.add(n);
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 12), capM); c.position.z = 0.001; piv.add(c); return piv;
  }
  const rU = CW / FW;   // metres per canvas pixel
  const speedN = needle(360, 128, 100 * rU), revN = needle(664, 128, 94 * rU), fuelN = needle(112, 150, 56 * rU, 0.0022), tempN = needle(912, 150, 56 * rU, 0.0022);
  const ang = (k) => (225 - 270 * k) * Math.PI / 180;
  // the small dials' arcs run from 220° to 320° in canvas angles (y down), i.e. -220°..-320° on the upright face
  fuelN.rotation.z = -(220 + 0.68 * 100) * Math.PI / 180;   // about 2/3 full
  tempN.rotation.z = -(220 + 0.45 * 100) * Math.PI / 180;   // just under half: warm engine
  cluster.traverse(o => { if (o.isMesh) o.userData.cabin = true; });

  // ---- radio face (lit when the music plays) ----
  const radioTex = canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = '#141517'; x.fillRect(0, 0, w, h); x.fillStyle = '#050505'; x.fillRect(150, 28, 210, 52);
    x.fillStyle = '#ffae3a'; x.font = '600 34px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('FM 98.4', 255, 55);
    x.fillStyle = '#2a2b2e'; for (let i = 0; i < 6; i++) x.fillRect(150 + i * 36, 92, 30, 20);
    x.fillStyle = '#9a9a96'; for (let i = 0; i < 6; i++) { x.font = '500 13px Arial'; x.fillText(String(i + 1), 165 + i * 36, 102); }
    for (const cx of [60, 452]) { x.fillStyle = '#26272a'; x.beginPath(); x.arc(cx, 64, 34, 0, 6.2832); x.fill(); x.strokeStyle = '#4a4c50'; x.lineWidth = 3; x.stroke(); x.fillStyle = '#3a3b3e'; x.fillRect(cx - 2, 34, 4, 16); }
  });
  const radioM = new THREE.MeshStandardMaterial({ map: radioTex, roughness: 0.5, emissive: 0x000000, emissiveMap: radioTex });
  { const r = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.048), radioM); r.position.set(0.5285, 0.785, 0); r.rotation.y = -Math.PI / 2; r.rotation.order = 'YXZ'; r.rotation.x = -0.1; r.userData.cabin = true; car.add(r); }

  // ---- mirrors: rear-view on the screen top, and the glass of the driver's door mirror (images drawn by the page) ----
  const mirrors = [];
  function mirror(centre, out, w, h, parentHousing) {
    const n = mirrorNormal(centre, out);
    const glassM = new THREE.MeshBasicMaterial({ color: 0x8a9095 });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassM); glass.position.copy(centre); glass.lookAt(centre.clone().add(n)); glass.userData.cabin = true; car.add(glass);
    if (parentHousing) { const hs = new THREE.Mesh(new RoundedBoxGeometry(w + 0.02, h + 0.022, 0.035, 2, 0.01), darkM); hs.position.copy(centre).addScaledVector(n, -0.019); hs.quaternion.copy(glass.quaternion); hs.userData.cabin = true; car.add(hs); }
    mirrors.push({ glass, centre, n, w, h }); return glass;
  }
  mirror(new THREE.Vector3(0.37, 1.27, -0.01), new THREE.Vector3(-1, -0.02, 0), 0.2, 0.055, true);
  mirror(new THREE.Vector3(0.832, 1.0, -0.86), new THREE.Vector3(-1, 0, -0.06), 0.115, 0.075, false);

  // ---- live parts ----
  let lit = false;
  function update(kmh, rpm, steer, music) {
    speedN.rotation.z = ang(Math.min(165, kmh) / 160) + (kmh < 0.5 ? 0.04 : Math.sin(performance.now() * 0.02) * 0.004);
    revN.rotation.z = ang(Math.min(7.2, rpm / 1000) / 7);
    spin.rotation.x = -steer * 12;   // 0.6 rad at the wheels ≈ 1.15 turns of the wheel, like the real car's slow rack
    radioM.emissive.setHex(music ? 0xffffff : 0x000000); radioM.emissiveIntensity = music ? 0.55 : 0;
  }
  function setPanelLights(on) { lit = on; faceM.emissiveIntensity = on ? 0.75 : 0.32; needleM.emissiveIntensity = on ? 1.1 : 0.5; }
  return { group, update, setPanelLights, mirrors };
}
