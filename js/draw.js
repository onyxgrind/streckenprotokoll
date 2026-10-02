// Zeichen-Editor: Formen statt Freihand. Koordinaten in Bildpixeln.
import { h, $, $$, promptSheet, infoSheet } from './util.js';
import { HILFE } from './hilfe.js';

export const COLORS = ['#ff2d3f', '#ffd500', '#1e90ff', '#00d26a', '#ffffff', '#111111'];

// Strichstärken: Dünn / Mittel / Dick / Extra (Faktor auf die Grundstärke)
export const WIDTHS = [{ v: 0.6, label: 'Dünn' }, { v: 1, label: 'Mittel' }, { v: 1.7, label: 'Dick' }, { v: 2.6, label: 'Extra' }];

// Glatte Kurve durch alle Punkte (Catmull-Rom), als dichte Punktfolge. Für eckige Linien: Punkte unverändert.
export function pathPoints(P, smooth) {
  if (!smooth || P.length < 3) return P;
  const out = [P[0]];
  const N = 14;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    for (let k = 1; k <= N; k++) {
      const t = k / N, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

// Einfüge-Stellen („+“) einer Fahrweg-Linie: Mitte jedes Segments, auf der Kurve selbst
export function segMidpoints(s) {
  const P = s.points; if (P.length < 2) return [];
  if (!s.smooth || P.length < 3) return P.slice(1).map((q, i) => ({ x: (P[i].x + q.x) / 2, y: (P[i].y + q.y) / 2, seg: i + 1 }));
  const Q = pathPoints(P, true); // 14 Zwischenpunkte je Segment
  return P.slice(1).map((q, i) => ({ ...Q[i * 14 + 7], seg: i + 1 }));
}

export function renderShapes(ctx, shapes, imgW, opts = {}) {
  const base = Math.max(2, imgW / 300); // Strichstärke relativ zur Bildbreite
  for (const s of shapes) {
    const lw = base * (s.width || 1);
    ctx.save();
    ctx.strokeStyle = s.color || COLORS[0]; ctx.fillStyle = s.color || COLORS[0];
    ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (s.dash) ctx.setLineDash([lw * 3, lw * 2]);
    const P = s.points;
    if (s.type === 'line' || s.type === 'arrow' || s.type === 'poly') {
      if (P.length >= 2) {
        const Q = pathPoints(P, s.type === 'poly' && s.smooth);
        ctx.beginPath(); ctx.moveTo(Q[0].x, Q[0].y);
        for (let i = 1; i < Q.length; i++) ctx.lineTo(Q[i].x, Q[i].y);
        ctx.stroke();
        if (s.type !== 'line' && !s.noHead) { ctx.setLineDash([]); arrowHead(ctx, Q[Math.max(0, Q.length - 3)], Q[Q.length - 1], lw); }
      }
    } else if (s.type === 'rect' && P.length === 2) {
      ctx.strokeRect(Math.min(P[0].x, P[1].x), Math.min(P[0].y, P[1].y), Math.abs(P[1].x - P[0].x), Math.abs(P[1].y - P[0].y));
    } else if (s.type === 'ellipse' && P.length === 2) {
      ctx.beginPath();
      ctx.ellipse((P[0].x + P[1].x) / 2, (P[0].y + P[1].y) / 2, Math.abs(P[1].x - P[0].x) / 2, Math.abs(P[1].y - P[0].y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'x' && P.length === 1) {
      const r = lw * 4;
      ctx.beginPath(); ctx.moveTo(P[0].x - r, P[0].y - r); ctx.lineTo(P[0].x + r, P[0].y + r); ctx.moveTo(P[0].x + r, P[0].y - r); ctx.lineTo(P[0].x - r, P[0].y + r); ctx.stroke();
    } else if (s.type === 'text' && P.length === 1) {
      const fs = base * 7 * (s.width || 1);
      ctx.font = `700 ${fs}px Arial, Helvetica, sans-serif`;
      ctx.lineWidth = fs / 6; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.setLineDash([]);
      ctx.strokeText(s.text || '', P[0].x, P[0].y);
      ctx.fillText(s.text || '', P[0].x, P[0].y);
    }
    ctx.restore();
  }
  if (opts.selected != null && shapes[opts.selected]) {
    const s = shapes[opts.selected];
    const r = opts.handleR || base * 2.2;
    ctx.save();
    for (const p of s.points) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = base * .8; ctx.strokeStyle = s.color || COLORS[0]; ctx.stroke();
    }
    if (s.type === 'poly') for (const m of segMidpoints(s)) { // „+“-Stellen zum Einfügen (auf der Kurve)
      ctx.beginPath(); ctx.arc(m.x, m.y, r * .7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill();
      ctx.lineWidth = base * .5; ctx.strokeStyle = '#333'; ctx.beginPath(); ctx.moveTo(m.x - r * .4, m.y); ctx.lineTo(m.x + r * .4, m.y); ctx.moveTo(m.x, m.y - r * .4); ctx.lineTo(m.x, m.y + r * .4); ctx.stroke();
    }
    ctx.restore();
  }
}
function arrowHead(ctx, a, b, lw) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), L = lw * 4.5;
  ctx.beginPath(); ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - L * Math.cos(ang - .5), b.y - L * Math.sin(ang - .5));
  ctx.lineTo(b.x - L * Math.cos(ang + .5), b.y - L * Math.sin(ang + .5));
  ctx.closePath(); ctx.fill();
}

// Bild + Formen zu einem JPEG-Blob
export async function composite(img, shapes, maxSide = 2000) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.scale(s, s);
  renderShapes(ctx, shapes || [], img.naturalWidth);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Bild konnte nicht erzeugt werden (Speicher?)');
  return blob;
}

const distPtSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
function hitShape(s, p, tol) {
  const P = s.points;
  if (s.type === 'text') return Math.hypot(p.x - P[0].x, p.y - P[0].y) < tol * 4 || (p.x > P[0].x && p.x < P[0].x + (s.text || '').length * tol * 1.6 && Math.abs(p.y - P[0].y + tol) < tol * 2);
  if (s.type === 'x') return Math.hypot(p.x - P[0].x, p.y - P[0].y) < tol * 2;
  if (s.type === 'rect' || s.type === 'ellipse') {
    const x1 = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x), y1 = Math.min(P[0].y, P[1].y), y2 = Math.max(P[0].y, P[1].y);
    const edges = [[{ x: x1, y: y1 }, { x: x2, y: y1 }], [{ x: x2, y: y1 }, { x: x2, y: y2 }], [{ x: x2, y: y2 }, { x: x1, y: y2 }], [{ x: x1, y: y2 }, { x: x1, y: y1 }]];
    return edges.some(([a, b]) => distPtSeg(p, a, b) < tol);
  }
  const Q = pathPoints(P, s.type === 'poly' && s.smooth);
  for (let i = 1; i < Q.length; i++) if (distPtSeg(p, Q[i - 1], Q[i]) < tol) return true;
  return false;
}
// Nächstes Segment (Index des Endpunkts) zu p – zum Einfügen eines Punktes
function nearestSegment(P, p) {
  let best = 1, d = Infinity;
  for (let i = 1; i < P.length; i++) { const dd = distPtSeg(p, P[i - 1], P[i]); if (dd < d) { d = dd; best = i; } }
  return best;
}

/**
 * Öffnet den Editor als Vollbild. Gibt Promise auf neue Formen (oder null bei Abbruch) zurück.
 */
export function openEditor(img, shapes0) {
  return new Promise(resolve => {
    let shapes = JSON.parse(JSON.stringify(shapes0 || []));
    const undo = [];
    let tool = 'select', color = COLORS[0], selected = null, dash = false;
    let width = 1; try { const w = parseFloat(localStorage.getItem('sp_strich')); if (WIDTHS.some(x => x.v === w)) width = w; } catch (e) { /* egal */ }
    let pending = null; // Form in Erstellung
    let drag = null;

    const root = h(`<div class="editor">
      <div class="topbar" style="color:#fff"><button class="back" data-a="cancel">Abbrechen</button><div class="title">Einzeichnen</div><button class="action" data-a="ok">Fertig</button></div>
      <div class="canvaswrap"><canvas></canvas></div>
      <div class="hintline"></div>
      <div class="tools">
        <button class="tool on" data-t="select" title="Auswählen">↖</button>
        <button class="tool" data-t="line"><svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="19" x2="19" y2="3" stroke="#fff" stroke-width="2.5"/></svg></button>
        <button class="tool" data-t="arrow"><svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="19" x2="17" y2="5" stroke="#fff" stroke-width="2.5"/><polygon points="19,3 12,5 17,10" fill="#fff"/></svg></button>
        <button class="tool" data-t="poly"><svg width="22" height="22" viewBox="0 0 22 22"><polyline points="3,19 8,10 13,14 18,4" fill="none" stroke="#fff" stroke-width="2.5"/><polygon points="19,3 13,5 17,9" fill="#fff"/></svg></button>
        <button class="tool" data-t="rect"><svg width="22" height="22" viewBox="0 0 22 22"><rect x="3" y="5" width="16" height="12" fill="none" stroke="#fff" stroke-width="2.5"/></svg></button>
        <button class="tool" data-t="ellipse"><svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="none" stroke="#fff" stroke-width="2.5"/></svg></button>
        <button class="tool" data-t="x">✕</button>
        <button class="tool" data-t="text">T</button>
        <button class="tool" data-a="dash" title="gestrichelt">┄</button>
        <button class="tool ghost" data-a="smooth" title="rund / eckig">⌒</button>
        <button class="tool ghost" data-a="head" title="Pfeilspitze">➤</button>
        <button class="tool" data-a="fit" title="Ansicht zurücksetzen">⤢</button>
        <button class="tool" data-a="help" title="Hilfe" style="background:#3a3f47">?</button>
        <button class="tool" data-a="undo">↶</button>
        <button class="tool del" data-a="del">🗑</button>
        <button class="tool ghost" data-a="polydone" style="background:#0f6b31">✓</button>
      </div>
      <div class="colorrow">${COLORS.map(c => `<button class="c ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="widthrow">${WIDTHS.map(w => `<button class="w ${w.v === width ? 'on' : ''}" data-w="${w.v}"><span style="height:${Math.round(2 + w.v * 3)}px"></span>${w.label}</button>`).join('')}</div>
      <div style="height:env(safe-area-inset-bottom)"></div>
    </div>`);
    document.body.appendChild(root);
    const wrap = $('.canvaswrap', root), cv = $('canvas', root), ctx = cv.getContext('2d'), hint = $('.hintline', root);
    const W = img.naturalWidth, H = img.naturalHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    let scale = 1;            // Canvas-Pixel je Bildpixel bei Zoom 1
    let z = 1, tx = 0, ty = 0; // Ansicht: Zoom + Verschiebung (Canvas-Pixel)
    let loupe = null;          // Lupe während des Ziehens {x,y} in Bildkoordinaten

    function fit() {
      const bw = wrap.clientWidth, bh = wrap.clientHeight;
      const s = Math.min(bw / W, bh / H);
      cv.style.width = Math.round(W * s) + 'px'; cv.style.height = Math.round(H * s) + 'px';
      cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr);
      scale = s * dpr; clampView(); draw();
    }
    function clampView() {
      z = Math.max(1, Math.min(6, z));
      const cw = W * scale * z, ch = H * scale * z;
      tx = Math.min(0, Math.max(cv.width - cw, tx)); ty = Math.min(0, Math.max(cv.height - ch, ty));
      if (z === 1) { tx = 0; ty = 0; }
      $('[data-a=fit]', root).classList.toggle('on', z > 1);
    }
    const k = () => scale * z; // Canvas-Pixel je Bildpixel aktuell
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(k(), 0, 0, k(), tx, ty);
      ctx.drawImage(img, 0, 0, W, H);
      const all = pending ? [...shapes, pending] : shapes;
      const handleR = 9 * dpr / k();
      renderShapes(ctx, all, W, { selected, handleR });
      if (loupe) drawLoupe(all, handleR);
      const cur = selected != null ? shapes[selected] : pending;
      const isPoly = cur?.type === 'poly';
      $('[data-a=smooth]', root).classList.toggle('ghost', !isPoly);
      $('[data-a=smooth]', root).classList.toggle('on', !!(isPoly && cur.smooth));
      $('[data-a=head]', root).classList.toggle('ghost', !(isPoly || cur?.type === 'arrow'));
      $('[data-a=head]', root).classList.toggle('on', !!(cur && (isPoly || cur.type === 'arrow') && !cur.noHead));
      $$('.widthrow .w', root).forEach(b => b.classList.toggle('on', parseFloat(b.dataset.w) === (cur?.width || width)));
      hint.textContent = hints[tool] + (selected != null ? (isPoly ? ' · Punkte ziehen · ⊕ auf der Linie fügt Punkt ein · 🗑 löscht' : ' · Griffpunkte ziehen · 🗑 löscht') : '');
    }
    const hints = {
      select: 'Form antippen zum Auswählen · zwei Finger: zoomen/verschieben',
      line: 'Anfang und Ende antippen (oder ziehen)',
      arrow: 'Pfeil: Anfang und Spitze antippen',
      poly: 'Fahrweg: Punkte nacheinander antippen (Kurve entsteht automatisch), dann ✓',
      rect: 'Rechteck: zwei Ecken antippen',
      ellipse: 'Kreis: zwei Ecken antippen',
      x: 'Stelle antippen',
      text: 'Stelle antippen, dann Text eingeben',
    };
    // Lupe: vergrößerter Ausschnitt um die gezogene Stelle, versetzt über dem Finger
    function drawLoupe(all, handleR) {
      const R = Math.round(Math.min(cv.width, cv.height) * 0.19), Z = 2.6;
      const px = loupe.x * k() + tx, py = loupe.y * k() + ty; // Fingerposition in Canvas-Pixeln
      let cx = px, cy = py - R - 26 * dpr; if (cy - R < 0) cy = py + R + 26 * dpr; if (cx - R < 0) cx = R; if (cx + R > cv.width) cx = cv.width - R;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      const kk = k() * Z;
      ctx.setTransform(kk, 0, 0, kk, cx - loupe.x * kk, cy - loupe.y * kk);
      ctx.drawImage(img, 0, 0, W, H);
      renderShapes(ctx, all, W, { selected, handleR: handleR / Z });
      ctx.restore();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1 * dpr; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(cx - 12 * dpr, cy); ctx.lineTo(cx + 12 * dpr, cy); ctx.moveTo(cx, cy - 12 * dpr); ctx.lineTo(cx, cy + 12 * dpr); ctx.stroke();
      ctx.restore();
    }
    const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; };
    const toImg = (e) => { const c = toCanvas(e); return { x: (c.x - tx) / k(), y: (c.y - ty) / k() }; };
    const tol = () => Math.max(4, 16 * dpr / k()); // ~16 Bildschirmpunkte, in Bildpixeln
    const push = () => undo.push(JSON.stringify(shapes));

    let downPt = null, downTime = 0, moved = false;
    const fingers = new Map(); let pinch = null, gestureLock = false;
    const midDist = () => { const [a, b] = [...fingers.values()]; return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetisch */ }
      fingers.set(e.pointerId, toCanvas(e));
      if (fingers.size === 2) {
        // Zweiter Finger: laufende Einzelaktion verwerfen, in Zoom/Verschieben wechseln
        if (drag?.kind === 'handle' || drag?.kind === 'move') { if (undo.length) shapes = JSON.parse(undo.pop()); }
        if (drag?.kind === 'create') pending = null;
        drag = null; downPt = null; loupe = null; gestureLock = true;
        const m = midDist(); pinch = { z0: z, tx0: tx, ty0: ty, ...m }; draw(); return;
      }
      if (gestureLock) return;
      const p = toImg(e); downPt = p; downTime = Date.now(); moved = false; drag = null;
      if (tool === 'select' && selected != null) {
        const s = shapes[selected];
        const hi = s.points.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < tol() * 1.6);
        if (hi >= 0) { push(); drag = { kind: 'handle', idx: hi, start: p, orig: { ...s.points[hi] } }; return; }
        if (s.type === 'poly') { // „+“ getroffen → neuer Punkt, der sich sofort ziehen lässt
          const m = segMidpoints(s).find(q => Math.hypot(q.x - p.x, q.y - p.y) < tol() * 1.6);
          if (m) { push(); s.points.splice(m.seg, 0, { x: m.x, y: m.y }); drag = { kind: 'handle', idx: m.seg, start: p, orig: { x: m.x, y: m.y } }; draw(); return; }
        }
        if (hitShape(s, p, tol())) { push(); drag = { kind: 'move', start: p, orig: s.points.map(q => ({ ...q })) }; return; }
      }
      if ((tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse') && !pending) {
        pending = { type: tool, color, width, dash, points: [p, { ...p }] }; drag = { kind: 'create' };
      }
    });
    cv.addEventListener('pointermove', e => {
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, toCanvas(e));
      if (pinch && fingers.size === 2) {
        const m = midDist();
        z = pinch.z0 * (m.d / Math.max(1, pinch.d));
        const f = Math.max(1, Math.min(6, z)) / pinch.z0;
        tx = m.mx - (pinch.mx - pinch.tx0) * f; ty = m.my - (pinch.my - pinch.ty0) * f;
        clampView(); draw(); return;
      }
      if (!downPt) return;
      const p = toImg(e);
      if (Math.hypot(p.x - downPt.x, p.y - downPt.y) > tol() / 2) moved = true;
      if (drag?.kind === 'handle') { shapes[selected].points[drag.idx] = p; loupe = p; draw(); }
      else if (drag?.kind === 'move') { const dx = p.x - drag.start.x, dy = p.y - drag.start.y; shapes[selected].points = drag.orig.map(q => ({ x: q.x + dx, y: q.y + dy })); draw(); }
      else if (drag?.kind === 'create' && pending) { pending.points[1] = p; loupe = p; draw(); }
    });
    cv.addEventListener('pointerup', async e => {
      fingers.delete(e.pointerId);
      if (fingers.size < 2) pinch = null;
      if (fingers.size === 0) gestureLock = false;
      loupe = null;
      const p = toImg(e); const wasDown = downPt; downPt = null;
      if (!wasDown) { draw(); return; }
      if (drag?.kind === 'move' && !moved && shapes[selected]?.type === 'poly') {
        // Tipp auf die Linie (ohne Ziehen) fügt an dieser Stelle einen Punkt ein
        const s = shapes[selected]; const i = nearestSegment(s.points, p); s.points.splice(i, 0, p); drag = null; draw(); return;
      }
      if (drag?.kind === 'handle' || drag?.kind === 'move') { drag = null; draw(); return; }
      if (drag?.kind === 'create' && pending) {
        if (moved) { commit(pending); pending = null; }
        else { pending.points = [wasDown]; pending._await2 = true; } // zweiter Tipp folgt
        drag = null; draw(); return;
      }
      if (pending?._await2) { pending.points = [pending.points[0], p]; delete pending._await2; commit(pending); pending = null; draw(); return; }
      if (tool === 'poly') {
        if (!pending) pending = { type: 'poly', color, width, dash, smooth: true, points: [p] };
        else pending.points.push(p);
        $('[data-a=polydone]', root).classList.remove('ghost'); draw(); return;
      }
      if (tool === 'x') { commit({ type: 'x', color, width, points: [p] }); draw(); return; }
      if (tool === 'text') {
        const t = await promptSheet('Text', '', 'z. B. Halteverbot');
        if (t) commit({ type: 'text', color, width, text: t, points: [p] });
        draw(); return;
      }
      if (tool === 'select') {
        const idx = [...shapes.keys()].reverse().find(i => hitShape(shapes[i], p, tol()));
        selected = idx == null ? null : idx; draw();
      }
    });
    cv.addEventListener('pointercancel', e => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; if (!fingers.size) gestureLock = false; downPt = null; drag = null; loupe = null; draw(); });
    function commit(s) { push(); shapes.push(s); selected = shapes.length - 1; setTool('select'); }
    function setTool(t) {
      tool = t; pending = null; $('[data-a=polydone]', root).classList.add('ghost');
      $$('.tool[data-t]', root).forEach(b => b.classList.toggle('on', b.dataset.t === t));
      if (t !== 'select') selected = null;
      draw();
    }
    root.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { setTool(b.dataset.t); return; }
      if (b.dataset.c) { color = b.dataset.c; $$('.c', root).forEach(x => x.classList.toggle('on', x.dataset.c === color)); if (selected != null) { push(); shapes[selected].color = color; } else if (pending) pending.color = color; draw(); return; }
      if (b.dataset.w) { width = parseFloat(b.dataset.w); try { localStorage.setItem('sp_strich', String(width)); } catch (e) { /* egal */ } if (selected != null) { push(); shapes[selected].width = width; } else if (pending) pending.width = width; draw(); return; }
      switch (b.dataset.a) {
        case 'fit': z = 1; tx = 0; ty = 0; clampView(); draw(); break;
        case 'help': infoSheet(HILFE.editor.titel, HILFE.editor.text); break;
        case 'cancel': close(null); break;
        case 'ok': if (pending?.type === 'poly' && pending.points.length >= 2) shapes.push(pending); close(shapes); break;
        case 'undo': if (undo.length) { shapes = JSON.parse(undo.pop()); selected = null; pending = null; draw(); } break;
        case 'del': if (selected != null) { push(); shapes.splice(selected, 1); selected = null; draw(); } else if (pending) { pending = null; draw(); } break;
        case 'dash': dash = !dash; b.classList.toggle('on', dash); if (selected != null) { push(); shapes[selected].dash = dash; draw(); } break;
        case 'smooth': { const cur = selected != null ? shapes[selected] : pending; if (cur?.type === 'poly') { if (selected != null) push(); cur.smooth = !cur.smooth; draw(); } break; }
        case 'head': { const cur = selected != null ? shapes[selected] : pending; if (cur && (cur.type === 'poly' || cur.type === 'arrow')) { if (selected != null) push(); cur.noHead = !cur.noHead; draw(); } break; }
        case 'polydone': if (pending && pending.points.length >= 2) { commit(pending); pending = null; } else pending = null; $('[data-a=polydone]', root).classList.add('ghost'); draw(); break;
      }
    });
    function close(result) { window.removeEventListener('resize', fit); root.remove(); resolve(result); }
    window.addEventListener('resize', fit);
    requestAnimationFrame(fit);
  });
}

/**
 * Zuschneide-Editor. img = gedrehtes Vollbild, crop = {x,y,w,h} (Anteile) oder null.
 * Ergebnis: neuer Zuschnitt, {voll:true} für „ganzes Bild“, oder null bei Abbruch.
 */
export function openCrop(img, crop0) {
  return new Promise(resolve => {
    const W = img.naturalWidth, H = img.naturalHeight;
    let r = crop0 ? { x: crop0.x * W, y: crop0.y * H, w: crop0.w * W, h: crop0.h * H } : { x: 0, y: 0, w: W, h: H };
    let ratio = 0; // 0 = frei
    const RATIOS = [[0, 'Frei'], [4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 9, '16:9'], [1, '1:1'], [3 / 4, 'Hoch 3:4']];
    const root = h(`<div class="editor">
      <div class="topbar" style="color:#fff"><button class="back" data-a="cancel">Abbrechen</button><div class="title">Zuschneiden</div><button class="action" data-a="ok">Fertig</button></div>
      <div class="canvaswrap"><canvas></canvas></div>
      <div class="hintline">Ecken oder Kanten ziehen · Rahmen innen verschieben · alles außerhalb fällt weg</div>
      <div class="widthrow" data-r="ratios">${RATIOS.map(([v, l]) => `<button class="w ${v === 0 ? 'on' : ''}" data-r="${v}">${l}</button>`).join('')}</div>
      <div class="tools"><button class="tool" data-a="reset" style="width:auto;padding:0 14px">Ganzes Bild</button><button class="tool" data-a="help" style="background:#3a3f47">?</button></div>
      <div style="height:env(safe-area-inset-bottom)"></div>
    </div>`);
    document.body.appendChild(root);
    const wrap = $('.canvaswrap', root), cv = $('canvas', root), ctx = cv.getContext('2d');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    let k = 1, pad = 0;
    function fit() {
      pad = 14 * dpr;
      const bw = wrap.clientWidth, bh = wrap.clientHeight;
      const s = Math.min((bw - 28) / W, (bh - 28) / H);
      cv.style.width = Math.round(W * s + 28) + 'px'; cv.style.height = Math.round(H * s + 28) + 'px';
      cv.width = Math.round((W * s + 28) * dpr); cv.height = Math.round((H * s + 28) * dpr);
      k = s * dpr; draw();
    }
    const X = (x) => pad + x * k, Y = (y) => pad + y * k;
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, pad, pad, W * k, H * k);
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      ctx.beginPath(); ctx.rect(pad, pad, W * k, H * k); ctx.rect(X(r.x), Y(r.y), r.w * k, r.h * k); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(X(r.x), Y(r.y), r.w * k, r.h * k);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1 * dpr;
      for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(X(r.x + r.w * i / 3), Y(r.y)); ctx.lineTo(X(r.x + r.w * i / 3), Y(r.y + r.h)); ctx.moveTo(X(r.x), Y(r.y + r.h * i / 3)); ctx.lineTo(X(r.x + r.w), Y(r.y + r.h * i / 3)); ctx.stroke(); }
      const L = 18 * dpr; ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * dpr; ctx.lineCap = 'square';
      for (const [cx, cy, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) { ctx.beginPath(); ctx.moveTo(X(cx) + sx * L, Y(cy)); ctx.lineTo(X(cx), Y(cy)); ctx.lineTo(X(cx), Y(cy) + sy * L); ctx.stroke(); }
    }
    const toImg = (e) => { const b = cv.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width * cv.width - pad) / k, y: ((e.clientY - b.top) / b.height * cv.height - pad) / k }; };
    const MIN = Math.max(40, Math.min(W, H) * 0.08);
    function clamp() {
      r.w = Math.max(MIN, Math.min(r.w, W)); r.h = Math.max(MIN, Math.min(r.h, H));
      r.x = Math.max(0, Math.min(r.x, W - r.w)); r.y = Math.max(0, Math.min(r.y, H - r.h));
    }
    function applyRatio() {
      if (!ratio) return;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let w = r.w, hh = w / ratio; if (hh > H) { hh = H; w = hh * ratio; } if (w > W) { w = W; hh = w / ratio; }
      if (hh > r.h && r.h * ratio <= W) { hh = r.h; w = hh * ratio; }
      r = { x: cx - w / 2, y: cy - hh / 2, w, h: hh }; clamp();
    }
    let drag = null;
    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      const p = toImg(e), t = 28 * dpr / k;
      const nearL = Math.abs(p.x - r.x) < t, nearR = Math.abs(p.x - (r.x + r.w)) < t, nearT = Math.abs(p.y - r.y) < t, nearB = Math.abs(p.y - (r.y + r.h)) < t;
      const inX = p.x > r.x - t && p.x < r.x + r.w + t, inY = p.y > r.y - t && p.y < r.y + r.h + t;
      const edges = { l: nearL && inY, r: nearR && inY, t: nearT && inX, b: nearB && inX };
      if (edges.l || edges.r || edges.t || edges.b) drag = { kind: 'edge', edges, start: p, o: { ...r } };
      else if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) drag = { kind: 'move', start: p, o: { ...r } };
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = toImg(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y, o = drag.o;
      if (drag.kind === 'move') { r = { ...o, x: o.x + dx, y: o.y + dy }; clamp(); draw(); return; }
      let { x, y, w, h: hh } = o; const E = drag.edges;
      if (E.l) { x = Math.min(o.x + dx, o.x + o.w - MIN); x = Math.max(0, x); w = o.x + o.w - x; }
      if (E.r) { w = Math.max(MIN, Math.min(o.w + dx, W - o.x)); }
      if (E.t) { y = Math.min(o.y + dy, o.y + o.h - MIN); y = Math.max(0, y); hh = o.y + o.h - y; }
      if (E.b) { hh = Math.max(MIN, Math.min(o.h + dy, H - o.y)); }
      if (ratio) { // Seitenverhältnis halten: von der gezogenen Ecke/Kante aus
        if ((E.l || E.r) && !(E.t || E.b)) { hh = w / ratio; if (y + hh > H) { hh = H - y; w = hh * ratio; if (E.l) x = o.x + o.w - w; } }
        else { w = hh * ratio; if (E.l) x = o.x + o.w - w; if (x < 0) { x = 0; w = (E.l ? o.x + o.w : W - x); hh = w / ratio; if (E.t) y = o.y + o.h - hh; } if (x + w > W) { w = W - x; hh = w / ratio; if (E.t) y = o.y + o.h - hh; } }
      }
      r = { x, y, w, h: hh }; clamp(); draw();
    });
    const up = () => { drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.r != null && b.closest('[data-r=ratios]')) { ratio = parseFloat(b.dataset.r); $$('[data-r=ratios] .w', root).forEach(x => x.classList.toggle('on', x === b)); applyRatio(); draw(); return; }
      switch (b.dataset.a) {
        case 'cancel': close(null); break;
        case 'reset': r = { x: 0, y: 0, w: W, h: H }; ratio = 0; $$('[data-r=ratios] .w', root).forEach((x, i) => x.classList.toggle('on', i === 0)); draw(); break;
        case 'help': infoSheet('Zuschneiden', 'Ecken oder Kanten des Rahmens ziehen, Rahmen innen verschieben. Alles außerhalb erscheint nicht im Protokoll – z. B. Fahrzeuge, Personen, Kennzeichen.\nDas Originalfoto bleibt gespeichert: „Ganzes Bild“ macht den Zuschnitt jederzeit rückgängig.\nEinzeichnungen bleiben an ihrer Stelle im Bild.'); break;
        case 'ok': {
          const full = r.x < 1 && r.y < 1 && r.w > W - 2 && r.h > H - 2;
          close(full ? { voll: true } : { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H }); break;
        }
      }
    });
    function close(v) { window.removeEventListener('resize', fit); root.remove(); resolve(v); }
    window.addEventListener('resize', fit);
    requestAnimationFrame(fit);
  });
}
