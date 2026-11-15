'use strict';

/**
 * The Feather lab canvas. Every animation state is driven by the workflow
 * event stream: agent statuses, scan pulses, and the lead/worker handoff
 * packets. There is no timer that invents progress the job did not report.
 */
const Lab = (() => {
  const canvas = document.getElementById('lab');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = 960;
  const H = 500;

  const AGENTS = {
    lead: { row: 0, x: 160, accent: '#b8ff38' },
    scanner: { row: 1, x: 480, accent: '#66e0ff' },
    repair: { row: 2, x: 797, accent: '#ffb347' }
  };

  let sheet = null;
  let sheetReady = false;
  let started = 0;
  let raf = 0;
  const states = {
    lead: { status: 'idle', last: 0 },
    scanner: { status: 'idle', last: 0 },
    repair: { status: 'idle', last: 0 }
  };
  const packets = [];
  const pulses = [];
  let scanGlow = 0;

  const img = new Image();
  img.src = '../../assets/sprites/agents.png';
  img.onload = () => {
    sheet = img;
    sheetReady = true;
  };
  img.onerror = () => {
    sheetReady = false;
  };

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function line(x1, y1, x2, y2, color, width = 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawWall() {
    rect(0, 0, W, 332, '#070b06');
    for (let y = 0; y < 332; y += 42) {
      for (let x = 0; x < W; x += 48) {
        const tone = (x / 48 + y / 42) % 2 === 0 ? '#0a1008' : '#0b1209';
        rect(x, y, 47, 41, tone);
      }
    }
    for (let y = 0; y <= 332; y += 42) rect(0, y, W, 1, '#111a0d');
    for (let x = 0; x <= W; x += 48) rect(x, 0, 1, 332, '#10180c');

    // Conduits, vents, and wall clutter.
    rect(12, 0, 7, 332, '#131b0f');
    for (let y = 20; y < 332; y += 36) rect(10, y, 11, 3, '#1e2a18');
    rect(941, 0, 7, 332, '#131b0f');
    for (let y = 14; y < 332; y += 44) rect(939, y, 11, 3, '#1e2a18');
    rect(68, 74, 34, 20, '#0c120a');
    for (let i = 0; i < 4; i += 1) rect(72, 78 + i * 4, 26, 1, '#1c2816');
    rect(854, 86, 34, 20, '#0c120a');
    for (let i = 0; i < 4; i += 1) rect(858, 90 + i * 4, 26, 1, '#1c2816');

    // Station back panels.
    for (const agent of Object.values(AGENTS)) {
      rect(agent.x - 118, 206, 236, 126, '#080d07');
      rect(agent.x - 118, 206, 236, 2, '#151f10');
      rect(agent.x - 118, 330, 236, 2, '#161f11');
      // Pegboard / shelf shadow.
      rect(agent.x - 108, 214, 86, 34, '#0b1108');
      for (let i = 0; i < 5; i += 1) rect(agent.x - 104 + i * 17, 219, 9, 3, '#1b2715');
      rect(agent.x + 76, 214, 34, 34, '#0b1108');
      rect(agent.x + 80, 219, 26, 2, '#1d2917');
      rect(agent.x + 80, 226, 20, 2, '#1d2917');
      rect(agent.x + 80, 233, 23, 2, '#1d2917');
    }

    // Big wall display behind Scanner.
    rect(336, 58, 288, 126, '#040704');
    rect(340, 62, 280, 118, '#071007');
    rect(340, 62, 280, 2, '#6fa32a');
    rect(340, 178, 280, 2, '#35511a');
    rect(346, 70, 268, 1, '#1d3315');
    ctx.font = '700 12px "Courier New", monospace';
    ctx.fillStyle = '#b8ff38';
    ctx.fillText('FEATHER LAB // SECTOR 02', 352, 82);
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = '#5f8238';
    ctx.fillText('READ-ONLY DIAGNOSTIC MATRIX', 352, 96);
    const t = (performance.now() - started) / 1000;
    for (let i = 0; i < 5; i += 1) {
      const y = 108 + i * 12;
      const width = 70 + ((i * 37 + Math.floor(t * 16)) % 120);
      rect(352, y, 210, 3, '#101c0c');
      rect(352, y, width, 3, i === 0 ? '#66e0ff' : i === 1 ? '#b8ff38' : '#35511a');
      rect(568, y, 24, 3, i === 2 ? '#ffb347' : '#1a2a13');
    }
    rect(352, 165, 4, 4, '#b8ff38');
    ctx.fillStyle = '#6b8d48';
    ctx.fillText('NO NETWORK LINK', 362, 170);

    // Lab title plaque.
    rect(392, 14, 176, 30, '#050805');
    rect(393, 15, 174, 28, '#0a1108');
    rect(393, 15, 174, 2, '#b8ff38');
    ctx.font = '700 13px "Courier New", monospace';
    ctx.fillStyle = '#b8ff38';
    ctx.textAlign = 'center';
    ctx.fillText('FEATHER  AI  2.0', 480, 35);
    ctx.textAlign = 'left';
  }

  function drawFloor() {
    rect(0, 332, W, 168, '#080d07');
    // Perspective floor lines.
    for (let y = 340; y < H; y += 14) {
      rect(0, y, W, 1, y % 28 === 0 ? '#182513' : '#111a0d');
    }
    for (let i = -7; i <= 7; i += 1) {
      const xTop = 480 + i * 26;
      const xBottom = 480 + i * 96;
      line(xTop, 332, xBottom, H, '#10190c', 1);
    }
    rect(0, 330, W, 3, '#2a3b1f');
    rect(0, 333, W, 1, '#0b1108');
    // Painted hazard strip at the very bottom.
    for (let x = -20; x < W + 20; x += 32) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 18, H);
      ctx.lineTo(x + 36, H - 9);
      ctx.lineTo(x + 18, H - 9);
      ctx.closePath();
      ctx.fillStyle = '#17200f';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawLamp(x) {
    rect(x - 30, 0, 60, 8, '#111a0d');
    rect(x - 26, 8, 52, 5, '#1a2614');
    rect(x - 18, 13, 36, 3, '#b8ff38');
    rect(x - 16, 16, 32, 2, '#5f8e27');
    const gradient = ctx.createLinearGradient(x, 18, x, 332);
    gradient.addColorStop(0, 'rgba(184,255,56,0.085)');
    gradient.addColorStop(1, 'rgba(184,255,56,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x - 20, 18);
    ctx.lineTo(x + 20, 18);
    ctx.lineTo(x + 130, 332);
    ctx.lineTo(x - 130, 332);
    ctx.closePath();
    ctx.fill();
  }

  function drawMonitor(x, y, w, h, accent, pattern) {
    rect(x - 3, y - 3, w + 6, h + 6, '#040604');
    rect(x, y, w, h, '#0a1309');
    rect(x + 2, y + 2, w - 4, h - 4, '#050a05');
    for (let i = 0; i < h - 10; i += 5) {
      const width = Math.max(4, (w - 14) * (0.18 + ((i * 7 + pattern) % 70) / 100));
      rect(x + 6, y + 7 + i, width, 2, i % 15 === 0 ? accent : '#1c3317');
    }
    rect(x + 6, y + h - 10, w - 12, 1, '#2d4a22');
    rect(x + w / 2 - 5, y + h + 2, 10, 10, '#0b1108');
    rect(x + w / 2 - 15, y + h + 11, 30, 3, '#1a2613');
  }

  function drawStation(agentId) {
    const agent = AGENTS[agentId];
    const cx = agent.x;
    const accent = agent.accent;
    // Monitors flank the scientist.
    drawMonitor(cx - 116, 276, 76, 58, accent, agentId === 'scanner' ? 12 : 31);
    drawMonitor(cx + 40, 276, 76, 58, accent, agentId === 'repair' ? 53 : 7);
    // Monitor glow on wall.
    const glow = ctx.createRadialGradient(cx, 304, 10, cx, 304, 150);
    glow.addColorStop(0, agentId === 'scanner' ? 'rgba(102,224,255,0.08)' : 'rgba(184,255,56,0.055)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 170, 220, 340, 170);
  }

  function drawDesk(agentId) {
    const agent = AGENTS[agentId];
    const cx = agent.x;
    const accent = agent.accent;
    // Desk shadow.
    rect(cx - 126, 368, 252, 6, '#050805');
    // Desk top.
    rect(cx - 128, 373, 256, 12, '#202d19');
    rect(cx - 128, 373, 256, 2, '#3d552b');
    rect(cx - 128, 383, 256, 2, '#0e150b');
    // Front panel.
    rect(cx - 120, 385, 240, 58, '#0d140a');
    rect(cx - 120, 385, 240, 1, '#1b2814');
    for (let i = 0; i < 3; i += 1) {
      rect(cx - 106, 397 + i * 15, 64, 7, '#111a0d');
      rect(cx - 104, 399 + i * 15, 60, 1, '#1b2814');
      rect(cx + 2, 397 + i * 15, 104, 7, '#10180c');
      rect(cx + 4, 399 + i * 15, 100, 1, '#1a2613');
    }
    // Legs.
    rect(cx - 120, 443, 12, 44, '#111a0d');
    rect(cx + 108, 443, 12, 44, '#111a0d');
    rect(cx - 126, 485, 24, 4, '#070b06');
    rect(cx + 102, 485, 24, 4, '#070b06');

    // Keyboard.
    rect(cx - 44, 358, 88, 13, '#070b06');
    rect(cx - 42, 359, 84, 10, '#151f10');
    for (let i = 0; i < 7; i += 1) rect(cx - 38 + i * 11, 361, 8, 2, '#24351b');
    for (let i = 0; i < 6; i += 1) rect(cx - 34 + i * 11, 365, 8, 2, '#1d2a16');

    // Desk objects: mug, papers, and per-agent tool.
    rect(cx + 58, 356, 12, 11, '#1b2615');
    rect(cx + 60, 357, 8, 7, accent);
    rect(cx + 65, 358, 3, 3, '#0a0f08');
    rect(cx - 84, 360, 26, 6, '#c8d2bc');
    rect(cx - 82, 361, 10, 1, '#7d8b72');
    if (agentId === 'repair') {
      rect(cx + 68, 348, 22, 7, '#3a2b15');
      rect(cx + 71, 344, 4, 7, '#ffb347');
      rect(cx + 78, 344, 3, 7, '#d99431');
    } else if (agentId === 'scanner') {
      // A small diagnostic puck with a blinking light.
      rect(cx - 24, 351, 22, 8, '#0a140f');
      rect(cx - 21, 353, 5, 3, accent);
      rect(cx - 14, 353, 5, 3, '#234b37');
    } else {
      rect(cx + 46, 348, 10, 13, '#1b2615');
      rect(cx + 48, 346, 6, 3, '#b8ff38');
    }

    // Station nameplate on desk front.
    rect(cx - 44, 424, 88, 13, '#050805');
    rect(cx - 43, 425, 86, 11, '#0b1208');
    ctx.font = '700 8px "Courier New", monospace';
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.fillText(`${agentId.toUpperCase()} // 0${AGENTS[agentId].row + 1}`, cx, 433);
    ctx.textAlign = 'left';
  }

  function frameFor(status, now) {
    if (status === 'working') return 2 + (Math.floor(now / 170) % 2);
    if (status === 'waiting') return Math.floor(now / 800) % 2;
    if (status === 'done') return 5;
    if (status === 'error') return 0;
    return Math.floor(now / 720) % 2;
  }

  function drawAgent(agentId, now) {
    const agent = AGENTS[agentId];
    const state = states[agentId];
    const frame = frameFor(state.status, now);
    const x = agent.x - 48;
    const y = 245;
    // Aura.
    if (state.status !== 'idle') {
      const color = state.status === 'waiting' ? '255,179,71' : state.status === 'error' ? '255,107,107' : agentId === 'scanner' ? '102,224,255' : '184,255,56';
      const aura = ctx.createRadialGradient(agent.x, 312, 8, agent.x, 312, 86);
      aura.addColorStop(0, `rgba(${color},${state.status === 'working' ? 0.13 : 0.08})`);
      aura.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = aura;
      ctx.fillRect(agent.x - 100, 230, 200, 165);
    }
    if (!sheetReady || !sheet) {
      // Fallback silhouette while the sheet loads.
      rect(x + 24, y + 10, 48, 70, '#eef4e6');
      rect(x + 32, y + 2, 32, 18, '#0c0806');
      rect(x + 36, y + 26, 32, 30, '#111a0d');
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, frame * 144, agent.row * 192, 144, 192, x, y, 96, 128);
  }

  function drawDeskLights(agentId) {
    const agent = AGENTS[agentId];
    const state = states[agentId];
    if (state.status === 'idle') return;
    const color = state.status === 'waiting' ? '#ffb347' : agent.accent;
    rect(agent.x - 128, 371, 256, 1, color);
  }

  function drawScanEffect(now) {
    if (states.scanner.status !== 'working') return;
    const y = 250 + ((now / 8) % 130);
    const gradient = ctx.createLinearGradient(0, y - 20, 0, y + 20);
    gradient.addColorStop(0, 'rgba(102,224,255,0)');
    gradient.addColorStop(0.5, 'rgba(102,224,255,0.17)');
    gradient.addColorStop(1, 'rgba(102,224,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(360, y - 20, 240, 40);
    rect(360, y, 240, 1, 'rgba(102,224,255,0.65)');
    scanGlow = 1;
  }

  function drawPulse(pulse, now) {
    const progress = (now - pulse.start) / pulse.duration;
    if (progress >= 1) return;
    const agent = AGENTS[pulse.agentId];
    const radius = 20 + progress * 56;
    ctx.strokeStyle = pulse.color.replace(')', `,${(1 - progress) * 0.65})`).replace('rgb(', 'rgba(');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(agent.x, 320, radius, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + progress;
      rect(agent.x + Math.cos(angle) * radius - 1, 320 + Math.sin(angle) * radius - 1, 3, 3, agent.accent);
    }
  }

  function drawPacket(packet, now) {
    const t = Math.min(1, (now - packet.start) / packet.duration);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const from = AGENTS[packet.from];
    const to = AGENTS[packet.to];
    const x0 = from.x;
    const y0 = 292;
    const x1 = to.x;
    const y1 = 292;
    const cx = (x0 + x1) / 2;
    const cy = 178;
    const x = (1 - ease) * (1 - ease) * x0 + 2 * (1 - ease) * ease * cx + ease * ease * x1;
    const y = (1 - ease) * (1 - ease) * y0 + 2 * (1 - ease) * ease * cy + ease * ease * y1;

    // Trail.
    for (let i = 1; i <= 6; i += 1) {
      const tt = Math.max(0, ease - i * 0.035);
      const tx = (1 - tt) * (1 - tt) * x0 + 2 * (1 - tt) * tt * cx + tt * tt * x1;
      const ty = (1 - tt) * (1 - tt) * y0 + 2 * (1 - tt) * tt * cy + tt * tt * y1;
      const alpha = (1 - i / 7) * 0.35;
      ctx.fillStyle = `rgba(184,255,56,${alpha})`;
      ctx.fillRect(Math.round(tx) - 2, Math.round(ty) - 2, 4, 4);
    }

    // Packet body.
    rect(x - 10, y - 8, 20, 15, '#050805');
    rect(x - 9, y - 7, 18, 13, '#b8ff38');
    rect(x - 8, y - 6, 16, 11, '#10180b');
    line(x - 8, y - 6, x, y + 1, '#b8ff38', 1);
    line(x + 8, y - 6, x, y + 1, '#b8ff38', 1);
    rect(x - 3, y - 4, 6, 2, '#66e0ff');
    // Destination spark.
    if (t > 0.85) {
      const alpha = (t - 0.85) / 0.15;
      ctx.strokeStyle = `rgba(184,255,56,${0.7 * (1 - alpha)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x1, 292, 12 + alpha * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawCeilingAndProps(now) {
    // Server rack left.
    rect(20, 224, 62, 146, '#070b06');
    rect(24, 228, 54, 138, '#0b1209');
    for (let i = 0; i < 6; i += 1) {
      rect(28, 234 + i * 21, 46, 15, '#0e170c');
      rect(32, 238 + i * 21, 6, 3, i === 1 || i === 4 ? '#b8ff38' : '#2a441f');
      rect(42, 238 + i * 21, 18, 2, '#1b2b14');
    }
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#5f7a48';
    ctx.fillText('DIAG-01', 28, 365);

    // Tool cabinet right.
    rect(880, 212, 62, 158, '#070b06');
    rect(884, 216, 54, 150, '#0d130a');
    rect(888, 222, 46, 38, '#131c0e');
    rect(892, 228, 18, 3, '#ffb347');
    rect(892, 236, 28, 2, '#3b2b15');
    rect(888, 268, 46, 74, '#111a0d');
    for (let i = 0; i < 3; i += 1) {
      rect(893, 276 + i * 20, 36, 2, '#26381c');
      rect(906, 280 + i * 20, 8, 2, '#4c672f');
    }
    ctx.fillStyle = '#6f5831';
    ctx.fillText('TOOLS', 892, 358);

    // Plant in the corner.
    rect(72, 426, 26, 30, '#11180d');
    rect(76, 420, 18, 8, '#1b2a13');
    for (let i = 0; i < 7; i += 1) {
      const h = 18 + (i % 3) * 10;
      rect(78 + i * 4, 420 - h, 3, h, i % 2 ? '#34511f' : '#4d7328');
      rect(76 + i * 4, 414 - h, 7, 4, '#5c8a2f');
    }
    ctx.fillStyle = '#5f7a48';
    ctx.fillText('O2', 78, 447);

    // Loose cables and wall vents.
    ctx.strokeStyle = '#172310';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(130, 331);
    ctx.bezierCurveTo(160, 360, 90, 390, 140, 430);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(840, 331);
    ctx.bezierCurveTo(820, 370, 880, 390, 850, 438);
    ctx.stroke();

    // Ceiling lamps.
    drawLamp(160);
    drawLamp(480);
    drawLamp(797);

    // Tiny ambient floaters in the light beams.
    for (let i = 0; i < 9; i += 1) {
      const x = 140 + ((i * 83 + now / 90) % 680);
      const y = 70 + ((i * 47 + now / 120) % 240);
      rect(x, y, 1, 1, 'rgba(184,255,56,0.22)');
    }
  }

  function render(now) {
    if (!started) started = now;
    ctx.imageSmoothingEnabled = false;
    drawWall();
    drawFloor();
    drawCeilingAndProps(now);
    for (const id of Object.keys(AGENTS)) drawStation(id);
    for (const id of Object.keys(AGENTS)) drawAgent(id, now);
    for (const id of Object.keys(AGENTS)) {
      drawDesk(id);
      drawDeskLights(id);
    }
    drawScanEffect(now);
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      drawPulse(pulses[i], now);
      if (now - pulses[i].start > pulses[i].duration) pulses.splice(i, 1);
    }
    for (let i = packets.length - 1; i >= 0; i -= 1) {
      drawPacket(packets[i], now);
      if (now - packets[i].start > packets[i].duration) {
        const packet = packets[i];
        pulses.push({
          agentId: packet.to,
          start: now,
          duration: 700,
          color: 'rgb(184,255,56)'
        });
        packets.splice(i, 1);
      }
    }
    // Subtle vignette.
    const vignette = ctx.createRadialGradient(480, 270, 180, 480, 270, 600);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    raf = requestAnimationFrame(render);
  }

  function setStatus(agentId, status) {
    if (!states[agentId]) return;
    states[agentId].status = ['idle', 'working', 'waiting', 'done', 'error'].includes(status) ? status : 'idle';
    states[agentId].last = performance.now();
  }

  function pulse(agentId, color = 'rgb(184,255,56)') {
    if (!AGENTS[agentId]) return;
    pulses.push({ agentId, start: performance.now(), duration: 620, color });
  }

  function handoff(from, to) {
    if (!AGENTS[from] || !AGENTS[to]) return;
    packets.push({ from, to, start: performance.now(), duration: 1250 });
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  return { setStatus, pulse, handoff, start };
})();

window.Lab = Lab;
