/**
 * simulation.js - Discrete Event Simulation & Packet Animation Engine
 * Controls Realtime vs Simulation (Step-by-Step) modes, PDU logging, and packet physics
 */

import { inspectPDU } from '../models/protocols.js';

export class SimulationEngine {
  constructor() {
    this.devices = [];
    this.cables = [];
    this.activePackets = []; // Packets currently in transit: { id, srcPort, dstPort, frame, progress, duration, startTime, color, label }
    this.eventList = [];     // Event history log for bottom drawer
    this.mode = 'REALTIME';  // 'REALTIME' | 'SIMULATION'
    this.isRunning = true;
    this.simSpeed = 1.0;
    this.stepQueue = [];     // Queued events waiting in SIMULATION mode
    this.onStateChangeCallbacks = [];
    this.onEventLoggedCallbacks = [];
    this.onInspectPDUCallbacks = [];
    this.onWarningCallbacks = [];
    this.lastFrameTime = performance.now();
    this._loopActive = false;
    this._rafId = null;
    this._intervalId = null;
    this._stopEpoch = 0;

    // Attach globally for devices to call
    globalThis.simEngine = this;
    this.loop = this.loop.bind(this);
  }

  /**
   * Start animation loop only while activePackets exist so idle CPU usage stays near 0%.
   */
  ensureLoopRunning() {
    if (this._loopActive || this.activePackets.length === 0) return;
    this._loopActive = true;
    if (typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(this.loop);
    } else {
      this._intervalId = setInterval(() => this.loop(performance.now()), 16);
    }
  }

  stopLoop() {
    this._loopActive = false;
    if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Force stop all active transmissions, queued simulation events, and ongoing device sessions.
   */
  stopAll() {
    this._stopEpoch += 1;
    this.stopLoop();
    this.activePackets = [];
    this.stepQueue = [];
    if (this.mode === 'SIMULATION') {
      this.isRunning = false;
    }
    this.devices.forEach(dev => {
      if (typeof dev.cancelActiveSessions === 'function') {
        dev.cancelActiveSessions();
      } else if (dev.pendingPackets && typeof dev.pendingPackets.clear === 'function') {
        dev.pendingPackets.clear();
      }
    });
    this.notifyStateChange();
  }

  addDevice(device) {
    this.devices.push(device);
    this.recomputeSpanningTree(false);
    this.notifyStateChange();
    return device;
  }

  removeDevice(device) {
    if (typeof device.cancelActiveSessions === 'function') {
      device.cancelActiveSessions();
    }
    // Disconnect all cables attached to this device
    const cablesToRemove = this.cables.filter(
      c => (c.interfaceA && c.interfaceA.device === device) || 
           (c.interfaceB && c.interfaceB.device === device)
    );
    cablesToRemove.forEach(c => this.removeCable(c));

    this.devices = this.devices.filter(d => d !== device);
    this.recomputeSpanningTree(true);
    this.notifyStateChange();
  }

  addCable(cable) {
    this.cables.push(cable);
    this.recomputeSpanningTree(true);
    this.notifyStateChange();
    return cable;
  }

  removeCable(cable) {
    cable.disconnect();
    this.cables = this.cables.filter(c => c !== cable);
    this.recomputeSpanningTree(true);
    this.notifyStateChange();
  }

  clearAll() {
    this._stopEpoch += 1;
    this.stopLoop();
    this.devices.forEach(dev => {
      if (typeof dev.cancelActiveSessions === 'function') {
        dev.cancelActiveSessions();
      }
    });
    this.cables.forEach(c => c.disconnect());
    this.cables = [];
    this.devices = [];
    this.activePackets = [];
    this.eventList = [];
    this.stepQueue = [];
    this.notifyStateChange();
  }

  /**
   * Compute IEEE 802.1D Spanning Tree across Switch-to-Switch links to break L2 loops in Ring/Mesh topologies.
   */
  recomputeSpanningTree(clearMacsIfChanged = true) {
    const switches = this.devices.filter(d => d.type === 'switch');
    if (switches.length === 0) return;

    const prevStates = new Map();
    switches.forEach(sw => {
      sw.interfaces.forEach(p => {
        prevStates.set(p, `${p.stpState}:${p.stpRole}`);
        p.stpState = 'FWD';
        p.stpRole = 'DES';
      });
      sw.stpRootId = null;
    });

    const getBridgeKey = (sw) => ({
      priority: sw.stpPriority ?? 32768,
      mac: (sw.interfaces[0]?.mac || 'FF:FF:FF:FF:FF:FF').toUpperCase(),
      id: sw.id || sw.name || ''
    });

    const compareBridge = (a, b) => {
      const ka = getBridgeKey(a);
      const kb = getBridgeKey(b);
      if (ka.priority !== kb.priority) return ka.priority - kb.priority;
      if (ka.mac !== kb.mac) return ka.mac < kb.mac ? -1 : 1;
      if (ka.id !== kb.id) return ka.id < kb.id ? -1 : 1;
      return 0;
    };

    const getPortNum = (port) => {
      const m = (port?.name || '').match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : 9999;
    };

    const swCables = this.cables.filter(c =>
      c.interfaceA && c.interfaceB &&
      c.interfaceA.device?.type === 'switch' &&
      c.interfaceB.device?.type === 'switch' &&
      c.interfaceA.isUp && c.interfaceB.isUp
    );

    const adj = new Map(switches.map(sw => [sw, []]));
    swCables.forEach(cable => {
      const a = cable.interfaceA;
      const b = cable.interfaceB;
      if (adj.has(a.device)) adj.get(a.device).push({ localPort: a, neighbor: b.device, remotePort: b, cable });
      if (a.device !== b.device && adj.has(b.device)) adj.get(b.device).push({ localPort: b, neighbor: a.device, remotePort: a, cable });
    });

    const visitedComp = new Set();
    const treeCables = new Set();
    const distMap = new Map();

    switches.forEach(startSw => {
      if (visitedComp.has(startSw)) return;
      const comp = [];
      const q = [startSw];
      visitedComp.add(startSw);
      while (q.length > 0) {
        const cur = q.shift();
        comp.push(cur);
        for (const edge of adj.get(cur) || []) {
          if (!visitedComp.has(edge.neighbor)) {
            visitedComp.add(edge.neighbor);
            q.push(edge.neighbor);
          }
        }
      }

      let rootSw = comp[0];
      for (let i = 1; i < comp.length; i++) {
        if (compareBridge(comp[i], rootSw) < 0) rootSw = comp[i];
      }

      const bfsQueue = [rootSw];
      distMap.set(rootSw, 0);
      rootSw.stpRootId = rootSw.id;
      const bestParentEdge = new Map();

      while (bfsQueue.length > 0) {
        const cur = bfsQueue.shift();
        const curDist = distMap.get(cur);
        const edges = [...(adj.get(cur) || [])].sort((e1, e2) => {
          const bCmp = compareBridge(e1.neighbor, e2.neighbor);
          if (bCmp !== 0) return bCmp;
          return getPortNum(e1.localPort) - getPortNum(e2.localPort);
        });

        for (const edge of edges) {
          if (edge.neighbor === cur) continue;
          const candDist = curDist + 1;
          if (!distMap.has(edge.neighbor)) {
            distMap.set(edge.neighbor, candDist);
            edge.neighbor.stpRootId = rootSw.id;
            bestParentEdge.set(edge.neighbor, {
              localPort: edge.remotePort,
              remotePort: edge.localPort,
              neighbor: cur,
              cable: edge.cable
            });
            bfsQueue.push(edge.neighbor);
          } else if (distMap.get(edge.neighbor) === candDist) {
            const prev = bestParentEdge.get(edge.neighbor);
            if (prev) {
              let better = compareBridge(cur, prev.neighbor);
              if (better === 0) better = getPortNum(edge.localPort) - getPortNum(prev.remotePort);
              if (better === 0) better = getPortNum(edge.remotePort) - getPortNum(prev.localPort);
              if (better < 0) {
                bestParentEdge.set(edge.neighbor, {
                  localPort: edge.remotePort,
                  remotePort: edge.localPort,
                  neighbor: cur,
                  cable: edge.cable
                });
              }
            }
          }
        }
      }

      bestParentEdge.forEach((pEdge) => {
        pEdge.localPort.stpRole = 'ROOT';
        pEdge.localPort.stpState = 'FWD';
        pEdge.remotePort.stpRole = 'DES';
        pEdge.remotePort.stpState = 'FWD';
        treeCables.add(pEdge.cable);
      });
    });

    swCables.forEach(cable => {
      if (treeCables.has(cable)) return;
      const pA = cable.interfaceA;
      const pB = cable.interfaceB;
      const swA = pA.device;
      const swB = pB.device;

      if (swA === swB) {
        if (getPortNum(pA) <= getPortNum(pB)) {
          pA.stpRole = 'DES'; pA.stpState = 'FWD';
          pB.stpRole = 'ALT'; pB.stpState = 'BLK';
        } else {
          pB.stpRole = 'DES'; pB.stpState = 'FWD';
          pA.stpRole = 'ALT'; pA.stpState = 'BLK';
        }
        return;
      }

      const dA = distMap.has(swA) ? distMap.get(swA) : Infinity;
      const dB = distMap.has(swB) ? distMap.get(swB) : Infinity;
      let aIsDesignated = true;
      if (dA !== dB) {
        aIsDesignated = dA < dB;
      } else {
        const bCmp = compareBridge(swA, swB);
        if (bCmp !== 0) aIsDesignated = bCmp < 0;
        else aIsDesignated = getPortNum(pA) <= getPortNum(pB);
      }

      if (aIsDesignated) {
        pA.stpRole = 'DES'; pA.stpState = 'FWD';
        pB.stpRole = 'ALT'; pB.stpState = 'BLK';
      } else {
        pB.stpRole = 'DES'; pB.stpState = 'FWD';
        pA.stpRole = 'ALT'; pA.stpState = 'BLK';
      }
    });

    if (clearMacsIfChanged) {
      let changed = false;
      switches.forEach(sw => {
        sw.interfaces.forEach(p => {
          if (prevStates.get(p) !== `${p.stpState}:${p.stpRole}`) changed = true;
        });
      });
      if (changed) {
        switches.forEach(sw => sw.macTable.clear());
      }
    }
  }

  enqueueTransmission(srcPort, dstPort, frame) {
    // Defense-in-depth loop/storm guard: drop frames exceeding hop limit or burst capacity
    const MAX_FRAME_HOPS = 64;
    const MAX_PENDING_PACKETS = 250;
    const nextHop = (frame._hopCount || 0) + 1;
    if (nextHop > MAX_FRAME_HOPS) {
      srcPort?.device?.log?.(`Loop guard: Dropped frame after ${MAX_FRAME_HOPS} hops.`, 'warn');
      this.notifyWarning(`Loop guard dropped frame after ${MAX_FRAME_HOPS} hops.`);
      return;
    }
    if (this.activePackets.length + this.stepQueue.length >= MAX_PENDING_PACKETS) {
      srcPort?.device?.log?.('Broadcast storm guard: Packet queue cap reached.', 'warn');
      this.notifyWarning('Traffic cap reached (broadcast storm protection). Use Stop ⏹ to reset.');
      return;
    }
    frame._hopCount = nextHop;

    const isArp = frame.etherType === 'ARP';
    const isIpv4 = frame.etherType === 'IPv4' && frame.payload;
    let label = frame.etherType;
    let color = '#38bdf8'; // Blue default

    if (isArp && frame.payload) {
      label = `ARP (${frame.payload.op})`;
      color = frame.payload.op === 'REQUEST' ? '#eab308' : '#22c55e'; // Yellow for request, Green for reply
    } else if (isIpv4) {
      const ip = frame.payload;
      if (ip.protocol === 'ICMP' && ip.payload) {
        label = ip.payload.type === 'ECHO_REQUEST' ? 'ICMP Req' : 'ICMP Rep';
        color = ip.payload.type === 'ECHO_REQUEST' ? '#a855f7' : '#06b6d4'; // Purple for req, Cyan for rep
      } else if (ip.protocol === 'UDP' && ip.payload) {
        const udp = ip.payload;
        if (udp.payload && udp.payload.type && ['DISCOVER', 'OFFER', 'REQUEST', 'ACK'].includes(udp.payload.type)) {
          label = `DHCP ${udp.payload.type}`;
          color = '#f97316'; // Orange for DHCP
        } else if (udp.payload && (udp.srcPort === 53 || udp.dstPort === 53)) {
          label = `DNS ${udp.payload.type || ''}`;
          color = '#3b82f6'; // Royal Blue for DNS
        } else {
          label = `UDP ${udp.dstPort}`;
          color = '#0284c7';
        }
      } else if (ip.protocol === 'TCP' && ip.payload) {
        const tcp = ip.payload;
        if (tcp.payload && tcp.payload.version) {
          label = tcp.payload.type === 'REQUEST' ? 'HTTP Req' : 'HTTP Rep';
          color = '#14b8a6'; // Teal for HTTP
        } else if (tcp.payload && tcp.payload.documentName) {
          label = tcp.payload.type === 'SUBMIT' ? 'Print Job' : 'Print ACK';
          color = '#ec4899'; // Pink for Network Print
        } else {
          label = `TCP [${tcp.flags}]`;
          color = '#6366f1'; // Indigo for TCP
        }
      }
    }

    if (frame.vlanTag !== null && frame.vlanTag !== undefined) {
      label += ` [V${frame.vlanTag}]`;
    }

    const packetItem = {
      id: 'pkt_' + Math.random().toString(36).substr(2, 9),
      srcPort,
      dstPort,
      frame,
      progress: 0,
      duration: Math.max(150, 350 / this.simSpeed),
      startTime: performance.now(),
      color,
      label,
      pduInfo: inspectPDU(frame, { portName: srcPort.name, direction: 'out' })
    };

    // Log the transmission event
    const eventRecord = {
      id: packetItem.id,
      timestamp: (this.eventList.length + 1).toString().padStart(3, '0'),
      timeStr: new Date().toLocaleTimeString(),
      lastDevice: srcPort.device.name,
      atDevice: dstPort.device.name,
      type: label,
      color,
      packetItem,
      details: packetItem.pduInfo.summary
    };
    this.eventList.unshift(eventRecord);
    if (this.eventList.length > 300) this.eventList.pop();
    this.notifyEventLogged(eventRecord);

    if (this.mode === 'REALTIME' || this.isRunning) {
      this.activePackets.push(packetItem);
      this.ensureLoopRunning();
      this.notifyStateChange();
    } else {
      // Simulation mode (paused): queue packet for Play or Step Forward
      this.stepQueue.push(packetItem);
      this.notifyStateChange();
    }
  }

  /**
   * Move all queued simulation packets into active transit animation.
   */
  flushStepQueue() {
    const now = performance.now();
    while (this.stepQueue.length > 0) {
      const p = this.stepQueue.shift();
      p.startTime = now;
      p.progress = 0;
      this.activePackets.push(p);
    }
    this.ensureLoopRunning();
  }

  /**
   * Toggle continuous Play vs Paused state in Simulation Mode.
   */
  setRunning(running) {
    this.isRunning = Boolean(running);
    if (this.isRunning) {
      this.flushStepQueue();
    }
    this.notifyStateChange();
  }

  stepForward() {
    if (this.stepQueue.length === 0) return null;
    const nextPacket = this.stepQueue.shift();
    nextPacket.startTime = performance.now();
    nextPacket.progress = 0;
    this.activePackets.push(nextPacket);
    this.ensureLoopRunning();
    this.notifyStateChange();
    return nextPacket;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'REALTIME') {
      this.isRunning = true;
      this.flushStepQueue();
    } else {
      this.isRunning = false; // Pause initially in simulation mode
    }
    this.notifyStateChange();
  }

  setSpeed(speedMultiplier) {
    this.simSpeed = Math.max(0.2, Math.min(5.0, speedMultiplier));
    this.activePackets.forEach(p => {
      p.duration = Math.max(150, 350 / this.simSpeed);
    });
  }

  emitLog(device, entry) {
    // Hook for device logs
  }

  notifyWarning(message) {
    this.onWarningCallbacks.forEach(cb => cb(message));
  }

  notifyStateChange() {
    this.onStateChangeCallbacks.forEach(cb => cb(this));
  }

  notifyEventLogged(eventRecord) {
    this.onEventLoggedCallbacks.forEach(cb => cb(eventRecord));
  }

  inspectPDU(packetItem) {
    this.onInspectPDUCallbacks.forEach(cb => cb(packetItem));
  }

  loop(currentTime) {
    this.lastFrameTime = currentTime;

    if (this.activePackets.length > 0) {
      const completed = [];

      for (let i = 0; i < this.activePackets.length; i++) {
        const p = this.activePackets[i];
        const elapsed = currentTime - p.startTime;
        p.progress = Math.min(1.0, elapsed / p.duration);

        if (p.progress >= 1.0) {
          completed.push(i);
        }
      }

      // Process completed arrivals in reverse order to splice safely
      const epochAtStart = this._stopEpoch;
      for (let i = completed.length - 1; i >= 0; i--) {
        if (this._stopEpoch !== epochAtStart) break;
        const index = completed[i];
        const pkt = this.activePackets.splice(index, 1)[0];

        // Deliver frame to receiving interface
        if (pkt && pkt.dstPort && pkt.dstPort.device) {
          try {
            pkt.dstPort.receiveFrame(pkt.frame);
          } catch (err) {
            console.error('Error during packet delivery:', err);
          }
        }
      }

      if (completed.length > 0 && this._stopEpoch === epochAtStart) {
        this.notifyStateChange();
      }
    }

    if (this._loopActive && this.activePackets.length > 0) {
      if (typeof requestAnimationFrame === 'function') {
        this._rafId = requestAnimationFrame(this.loop);
      }
    } else {
      this.stopLoop();
    }
  }
}
