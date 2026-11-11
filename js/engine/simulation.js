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
    this.lastFrameTime = performance.now();

    // Attach globally for devices to call
    globalThis.simEngine = this;

    // Start render/animation loop
    this.loop = this.loop.bind(this);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(this.loop);
    } else {
      setInterval(() => this.loop(performance.now()), 16);
    }
  }

  addDevice(device) {
    this.devices.push(device);
    this.notifyStateChange();
    return device;
  }

  removeDevice(device) {
    // Disconnect all cables attached to this device
    const cablesToRemove = this.cables.filter(
      c => (c.interfaceA && c.interfaceA.device === device) || 
           (c.interfaceB && c.interfaceB.device === device)
    );
    cablesToRemove.forEach(c => this.removeCable(c));

    this.devices = this.devices.filter(d => d !== device);
    this.notifyStateChange();
  }

  addCable(cable) {
    this.cables.push(cable);
    this.notifyStateChange();
    return cable;
  }

  removeCable(cable) {
    cable.disconnect();
    this.cables = this.cables.filter(c => c !== cable);
    this.notifyStateChange();
  }

  clearAll() {
    this.cables.forEach(c => c.disconnect());
    this.cables = [];
    this.devices = [];
    this.activePackets = [];
    this.eventList = [];
    this.stepQueue = [];
    this.notifyStateChange();
  }

  enqueueTransmission(srcPort, dstPort, frame) {
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

    if (this.mode === 'REALTIME') {
      this.activePackets.push(packetItem);
    } else {
      // Simulation mode
      if (this.isRunning) {
        this.activePackets.push(packetItem);
      } else {
        this.stepQueue.push(packetItem);
      }
    }
  }

  stepForward() {
    if (this.stepQueue.length > 0) {
      const nextPacket = this.stepQueue.shift();
      nextPacket.startTime = performance.now();
      nextPacket.progress = 0;
      this.activePackets.push(nextPacket);
      this.notifyStateChange();
    }
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'REALTIME') {
      this.isRunning = true;
      // Flush any queued packets into active
      while (this.stepQueue.length > 0) {
        const p = this.stepQueue.shift();
        p.startTime = performance.now();
        this.activePackets.push(p);
      }
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
    const dt = currentTime - this.lastFrameTime;
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
      for (let i = completed.length - 1; i >= 0; i--) {
        const index = completed[i];
        const pkt = this.activePackets.splice(index, 1)[0];

        // Deliver frame to receiving interface
        if (pkt.dstPort && pkt.dstPort.device) {
          try {
            pkt.dstPort.receiveFrame(pkt.frame);
          } catch (err) {
            console.error('Error during packet delivery:', err);
          }
        }
      }
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(this.loop);
    }
  }
}
