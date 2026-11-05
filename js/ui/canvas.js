/**
 * canvas.js - Interactive HTML5 Canvas Workspace Renderer
 * Handles grid rendering, device vector art, cable snapping, packet animations, and user interaction
 */

export class NetworkCanvas {
  constructor(canvasElement, simEngine) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.engine = simEngine;

    // Viewport transforms (Pan & Zoom)
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;

    // Interaction states
    this.tool = 'SELECT'; // 'SELECT' | 'CABLE' | 'PDU' | 'DELETE'
    this.selectedDevice = null;
    this.selectedCable = null;
    this.draggedDevice = null;
    this.dragOffset = { x: 0, y: 0 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Cable drawing state
    this.cableSourceDevice = null;
    this.cableSourcePort = null;
    this.cableMousePos = { x: 0, y: 0 };

    // Simple PDU state
    this.pduSourceDevice = null;

    // Callbacks
    this.onDeviceDoubleClick = null;
    this.onRequestPortSelection = null;
    this.onStatusMessage = null;

    this.initCanvasSize();
    this.ensureRoundRectPolyfill();
    this.bindEvents();
    this.startRenderLoop();
  }

  ensureRoundRectPolyfill() {
    if (!CanvasRenderingContext2D.prototype.roundRect) {
      CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
        if (typeof r === 'undefined') r = 0;
        if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
        this.beginPath();
        this.moveTo(x + r.tl, y);
        this.lineTo(x + w - r.tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
        this.lineTo(x + w, y + h - r.br);
        this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
        this.lineTo(x + r.bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
        this.lineTo(x, y + r.tl);
        this.quadraticCurveTo(x, y, x + r.tl, y);
        this.closePath();
        return this;
      };
    }
  }

  initCanvasSize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
  }

  setTool(tool) {
    this.tool = tool;
    this.cableSourceDevice = null;
    this.cableSourcePort = null;
    this.pduSourceDevice = null;
    this.canvas.style.cursor = 
      tool === 'CABLE' ? 'crosshair' :
      tool === 'PDU' ? 'cell' :
      tool === 'DELETE' ? 'not-allowed' : 'default';

    if (this.onStatusMessage) {
      if (tool === 'CABLE') this.onStatusMessage('Cable Tool: Click source device to start wiring');
      else if (tool === 'PDU') this.onStatusMessage('Simple PDU Tool: Click source PC/device, then click destination');
      else if (tool === 'DELETE') this.onStatusMessage('Delete Tool: Click on a device or cable to remove it');
      else this.onStatusMessage('Select Tool: Drag devices or double-click to configure');
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedDevice) {
          this.engine.removeDevice(this.selectedDevice);
          this.selectedDevice = null;
        } else if (this.selectedCable) {
          this.engine.removeCable(this.selectedCable);
          this.selectedCable = null;
        }
      } else if (e.key === 'Escape') {
        this.setTool('SELECT');
      }
    });
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.panX) / this.scale;
    const y = (clientY - rect.top - this.panY) / this.scale;
    return { x, y };
  }

  getDeviceAt(x, y) {
    const radius = 35;
    for (let i = this.engine.devices.length - 1; i >= 0; i--) {
      const dev = this.engine.devices[i];
      const dist = Math.hypot(dev.x - x, dev.y - y);
      if (dist <= radius) return dev;
    }
    return null;
  }

  getCableAt(x, y) {
    const threshold = 8;
    for (const cable of this.engine.cables) {
      const devA = cable.interfaceA.device;
      const devB = cable.interfaceB.device;
      if (!devA || !devB) continue;

      // Distance from point (x, y) to line segment (devA, devB)
      const d = this.distToSegment({ x, y }, { x: devA.x, y: devA.y }, { x: devB.x, y: devB.y });
      if (d <= threshold) return cable;
    }
    return null;
  }

  distToSegment(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  handleMouseDown(e) {
    const pos = this.screenToWorld(e.clientX, e.clientY);

    // Pan with Middle Mouse or Space+Click
    if (e.button === 1 || e.shiftKey) {
      this.isPanning = true;
      this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      return;
    }

    if (e.button !== 0) return; // Left click only

    const clickedDevice = this.getDeviceAt(pos.x, pos.y);
    const clickedCable = clickedDevice ? null : this.getCableAt(pos.x, pos.y);

    // Check if clicked an active flying packet envelope
    const clickedPacket = this.getPacketAt(pos.x, pos.y);
    if (clickedPacket) {
      if (this.engine.inspectPDU) this.engine.inspectPDU(clickedPacket);
      return;
    }

    if (this.tool === 'DELETE') {
      if (clickedDevice) this.engine.removeDevice(clickedDevice);
      else if (clickedCable) this.engine.removeCable(clickedCable);
      return;
    }

    if (this.tool === 'CABLE') {
      if (clickedDevice) {
        if (!this.cableSourceDevice) {
          // Step 1: select source device
          this.cableSourceDevice = clickedDevice;
          if (this.onRequestPortSelection) {
            this.onRequestPortSelection(clickedDevice, (selectedPort) => {
              if (selectedPort) {
                this.cableSourcePort = selectedPort;
                if (this.onStatusMessage) this.onStatusMessage(`Cable: Connecting from ${clickedDevice.name} (${selectedPort.name}). Now click destination device.`);
              } else {
                this.cableSourceDevice = null;
              }
            });
          }
        } else if (clickedDevice !== this.cableSourceDevice) {
          // Step 2: select destination device
          const destDevice = clickedDevice;
          if (this.onRequestPortSelection) {
            this.onRequestPortSelection(destDevice, (selectedDestPort) => {
              if (selectedDestPort && this.cableSourcePort) {
                // Create cable connection!
                import('../models/device.js').then(({ Cable }) => {
                  new Cable(this.cableSourcePort, selectedDestPort, 'straight');
                  if (this.onStatusMessage) this.onStatusMessage(`Connected ${this.cableSourceDevice.name} [${this.cableSourcePort.name}] <---> ${destDevice.name} [${selectedDestPort.name}]`);
                  this.setTool('SELECT');
                });
              } else {
                this.cableSourceDevice = null;
                this.cableSourcePort = null;
              }
            });
          }
        }
      }
      return;
    }

    if (this.tool === 'PDU') {
      if (clickedDevice && clickedDevice.type === 'pc') {
        if (!this.pduSourceDevice) {
          this.pduSourceDevice = clickedDevice;
          if (this.onStatusMessage) this.onStatusMessage(`PDU Source: ${clickedDevice.name}. Now click destination PC/host.`);
        } else if (clickedDevice !== this.pduSourceDevice) {
          const targetDevice = clickedDevice;
          if (targetDevice.ip) {
            if (this.onStatusMessage) this.onStatusMessage(`Firing ICMP Ping from ${this.pduSourceDevice.name} to ${targetDevice.name} (${targetDevice.ip})...`);
            this.pduSourceDevice.startPing(targetDevice.ip, 4, {
              onPrint: (msg) => console.log(`[Ping] ${msg}`)
            });
          } else {
            alert(`Destination device ${targetDevice.name} does not have an IP address configured yet!`);
          }
          this.setTool('SELECT');
        }
      }
      return;
    }

    // SELECT TOOL
    if (clickedDevice) {
      this.selectedDevice = clickedDevice;
      this.selectedCable = null;
      this.draggedDevice = clickedDevice;
      this.dragOffset = { x: pos.x - clickedDevice.x, y: pos.y - clickedDevice.y };
    } else if (clickedCable) {
      this.selectedCable = clickedCable;
      this.selectedDevice = null;
    } else {
      this.selectedDevice = null;
      this.selectedCable = null;
    }
  }

  handleMouseMove(e) {
    if (this.isPanning) {
      this.panX = e.clientX - this.panStart.x;
      this.panY = e.clientY - this.panStart.y;
      return;
    }

    const pos = this.screenToWorld(e.clientX, e.clientY);
    this.cableMousePos = pos;

    if (this.draggedDevice) {
      this.draggedDevice.x = Math.round(pos.x - this.dragOffset.x);
      this.draggedDevice.y = Math.round(pos.y - this.dragOffset.y);
    }
  }

  handleMouseUp(e) {
    this.isPanning = false;
    this.draggedDevice = null;
  }

  handleDoubleClick(e) {
    const pos = this.screenToWorld(e.clientX, e.clientY);
    const clickedDevice = this.getDeviceAt(pos.x, pos.y);
    if (clickedDevice && this.onDeviceDoubleClick) {
      this.onDeviceDoubleClick(clickedDevice);
    }
  }

  handleWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(2.5, Math.max(0.4, this.scale * zoomFactor));

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
    this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
    this.scale = newScale;
  }

  getPacketAt(x, y) {
    for (const pkt of this.engine.activePackets) {
      const pPos = this.getPacketCoordinates(pkt);
      if (Math.hypot(pPos.x - x, pPos.y - y) <= 18) {
        return pkt;
      }
    }
    return null;
  }

  getPacketCoordinates(pkt) {
    const devA = pkt.srcPort.device;
    const devB = pkt.dstPort.device;
    if (!devA || !devB) return { x: 0, y: 0 };
    const t = pkt.progress;
    return {
      x: devA.x + (devB.x - devA.x) * t,
      y: devA.y + (devB.y - devA.y) * t
    };
  }

  startRenderLoop() {
    const render = () => {
      this.draw();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  draw() {
    const ctx = this.ctx;
    const width = this.cssWidth;
    const height = this.cssHeight;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Apply Pan & Zoom
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // 1. Draw Grid Pattern
    this.drawGrid(ctx);

    // 2. Draw Cables
    this.drawCables(ctx);

    // 3. Draw Rubberband Cable during wiring
    if (this.tool === 'CABLE' && this.cableSourceDevice) {
      this.drawCablePreview(ctx);
    }

    // 4. Draw Devices
    this.drawDevices(ctx);

    // 5. Draw Flying Packet Envelopes
    this.drawPackets(ctx);

    ctx.restore();
  }

  drawGrid(ctx) {
    const gridSize = 30;
    const left = -this.panX / this.scale - 100;
    const top = -this.panY / this.scale - 100;
    const right = left + this.cssWidth / this.scale + 200;
    const bottom = top + this.cssHeight / this.scale + 200;

    const startX = Math.floor(left / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;

    ctx.beginPath();
    ctx.strokeStyle = '#222938';
    ctx.lineWidth = 0.8;

    for (let x = startX; x <= right; x += gridSize) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = startY; y <= bottom; y += gridSize) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();

    // Subtle grid dots at intersections
    ctx.fillStyle = '#2d3748';
    for (let x = startX; x <= right; x += gridSize * 2) {
      for (let y = startY; y <= bottom; y += gridSize * 2) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  drawCables(ctx) {
    for (const cable of this.engine.cables) {
      const devA = cable.interfaceA.device;
      const devB = cable.interfaceB.device;
      if (!devA || !devB) continue;

      const isSelected = this.selectedCable === cable;

      // Draw Cable Line
      ctx.beginPath();
      ctx.moveTo(devA.x, devA.y);
      ctx.lineTo(devB.x, devB.y);
      ctx.strokeStyle = isSelected ? '#38bdf8' : '#64748b';
      ctx.lineWidth = isSelected ? 3.5 : 2.0;
      ctx.stroke();

      // Draw Port Indicator LEDs & Labels near endpoints
      this.drawPortEndpoint(ctx, devA, devB, cable.interfaceA, 0.22);
      this.drawPortEndpoint(ctx, devB, devA, cable.interfaceB, 0.22);
    }
  }

  drawPortEndpoint(ctx, devFrom, devTo, intf, ratio) {
    const angle = Math.atan2(devTo.y - devFrom.y, devTo.x - devFrom.x);
    const dist = 38;
    const px = devFrom.x + Math.cos(angle) * dist;
    const py = devFrom.y + Math.sin(angle) * dist;

    // LED status light (Green if isUp, Orange/Amber if adminUp but not connected, Red if down)
    const ledColor = intf.isUp ? '#22c55e' : (intf.adminUp ? '#f59e0b' : '#ef4444');
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = ledColor;
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Port Label (e.g. Fa0/1)
    const labelX = px + Math.cos(angle + Math.PI / 2) * 12;
    const labelY = py + Math.sin(angle + Math.PI / 2) * 12;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(intf.name.replace('FastEthernet', 'Fa').replace('GigabitEthernet', 'Gi'), labelX, labelY);
  }

  drawCablePreview(ctx) {
    ctx.beginPath();
    ctx.moveTo(this.cableSourceDevice.x, this.cableSourceDevice.y);
    ctx.lineTo(this.cableMousePos.x, this.cableMousePos.y);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawDevices(ctx) {
    for (const dev of this.engine.devices) {
      const isSelected = this.selectedDevice === dev;

      // Selection Halo
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(dev.x, dev.y, 42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw Icon based on type
      if (dev.type === 'switch') {
        this.drawSwitchIcon(ctx, dev.x, dev.y);
      } else if (dev.type === 'router') {
        this.drawRouterIcon(ctx, dev.x, dev.y);
      } else if (dev.type === 'server') {
        this.drawServerIcon(ctx, dev.x, dev.y);
      } else {
        this.drawPCIcon(ctx, dev.x, dev.y);
      }

      // Draw Device Name Label
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(dev.name, dev.x, dev.y + 32);

      // Draw IP subtitle if configured
      let ipText = '';
      if (dev.ip) {
        ipText = dev.ip;
      } else if (dev.interfaces && dev.interfaces.some(i => i.ip)) {
        const assigned = dev.interfaces.filter(i => i.ip);
        ipText = assigned.map(i => `${i.name.replace('GigabitEthernet', 'Gi')}: ${i.ip}`).join(', ');
      }

      if (ipText) {
        ctx.font = '10px Consolas, monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(ipText, dev.x, dev.y + 46);
      }
    }
  }

  drawPCIcon(ctx, x, y) {
    // Monitor
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 22, y - 22, 44, 30, 4);
    ctx.fill();
    ctx.stroke();

    // Screen display inner
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 18, y - 18, 36, 22);

    // Screen mini lines
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x - 14, y - 12, 12, 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - 14, y - 7, 20, 2);

    // Stand & Base
    ctx.fillStyle = '#475569';
    ctx.fillRect(x - 4, y + 8, 8, 8);
    ctx.beginPath();
    ctx.roundRect(x - 14, y + 16, 28, 4, 2);
    ctx.fill();
  }

  drawSwitchIcon(ctx, x, y) {
    // Switch chassis (flat rectangular box)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 34, y - 14, 68, 28, 4);
    ctx.fill();
    ctx.stroke();

    // 4 bi-directional arrows (Cisco Switch Standard Symbol)
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;

    // Horizontal arrow right
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 4);
    ctx.lineTo(x + 20, y - 4);
    ctx.stroke();
    // Arrowhead right
    ctx.beginPath();
    ctx.moveTo(x + 16, y - 7);
    ctx.lineTo(x + 21, y - 4);
    ctx.lineTo(x + 16, y - 1);
    ctx.stroke();

    // Horizontal arrow left
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 4);
    ctx.lineTo(x - 20, y + 4);
    ctx.stroke();
    // Arrowhead left
    ctx.beginPath();
    ctx.moveTo(x - 16, y + 1);
    ctx.lineTo(x - 21, y + 4);
    ctx.lineTo(x - 16, y + 7);
    ctx.stroke();

    // Mini port status LEDs
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(x - 26, y - 8, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRouterIcon(ctx, x, y) {
    // Cisco Router round puck
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4 Inward/Outward crossing arrows (Cisco Router Standard Symbol)
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;

    // North-South line
    ctx.beginPath();
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y + 18);
    ctx.stroke();
    // East-West line
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x + 18, y);
    ctx.stroke();

    // Arrow tips pointing inward/outward
    ctx.fillStyle = '#c084fc';
    // Top arrow
    ctx.beginPath();
    ctx.moveTo(x, y - 18); ctx.lineTo(x - 4, y - 12); ctx.lineTo(x + 4, y - 12); ctx.fill();
    // Bottom arrow
    ctx.beginPath();
    ctx.moveTo(x, y + 18); ctx.lineTo(x - 4, y + 12); ctx.lineTo(x + 4, y + 12); ctx.fill();
    // Left arrow
    ctx.beginPath();
    ctx.moveTo(x - 18, y); ctx.lineTo(x - 12, y - 4); ctx.lineTo(x - 12, y + 4); ctx.fill();
    // Right arrow
    ctx.beginPath();
    ctx.moveTo(x + 18, y); ctx.lineTo(x + 12, y - 4); ctx.lineTo(x + 12, y + 4); ctx.fill();
  }

  drawServerIcon(ctx, x, y) {
    // Server tower
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 24, 36, 48, 4);
    ctx.fill();
    ctx.stroke();

    // Drive bays
    ctx.fillStyle = '#334155';
    ctx.fillRect(x - 14, y - 18, 28, 6);
    ctx.fillRect(x - 14, y - 8, 28, 6);
    ctx.fillRect(x - 14, y + 2, 28, 6);

    // Blinking lights
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x + 8, y + 14, 4, 4);
  }

  drawPackets(ctx) {
    for (const pkt of this.engine.activePackets) {
      const pos = this.getPacketCoordinates(pkt);

      // Packet Envelope Shadow & Glow
      ctx.save();
      ctx.shadowColor = pkt.color;
      ctx.shadowBlur = 10;

      // Envelope body (Cisco Packet Tracer style envelope)
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(pos.x - 14, pos.y - 10, 28, 20, 3);
      ctx.fill();
      ctx.stroke();

      // Envelope fold flap
      ctx.beginPath();
      ctx.moveTo(pos.x - 14, pos.y - 10);
      ctx.lineTo(pos.x, pos.y + 2);
      ctx.lineTo(pos.x + 14, pos.y - 10);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Protocol Tag Badge above envelope
      ctx.font = 'bold 9px sans-serif';
      const labelWidth = ctx.measureText(pkt.label).width + 8;
      ctx.fillStyle = pkt.color;
      ctx.beginPath();
      ctx.roundRect(pos.x - labelWidth / 2, pos.y - 24, labelWidth, 13, 3);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pkt.label, pos.x, pos.y - 18);
    }
  }
}
