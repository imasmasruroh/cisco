/**
 * main.js - Application Entry Point & Controller
 * Ties together UI Palette, Canvas, Simulation Engine, Preloaded Scenarios, and Event Drawer
 */

import { SimulationEngine } from './engine/simulation.js';
import { NetworkCanvas } from './ui/canvas.js';
import { ModalManager } from './ui/modals.js';
import { HostDevice, ServerDevice, PrinterDevice, SwitchDevice, RouterDevice, Cable } from './models/device.js';

class App {
  constructor() {
    this.engine = new SimulationEngine();
    this.canvasElement = document.getElementById('networkCanvas');
    this.canvas = new NetworkCanvas(this.canvasElement, this.engine);
    this.modals = new ModalManager(this.engine, this.canvas);

    this.bindToolbar();
    this.bindPalette();
    this.bindEventDrawer();
    this.bindSimulationControls();

    // Load initial scenario (Basic LAN with 2 PCs and 1 Switch)
    this.loadScenarioBasicLan();
  }

  bindToolbar() {
    // Mode toggles
    const btnRealtime = document.getElementById('btnModeRealtime');
    const btnSimulation = document.getElementById('btnModeSimulation');
    const simControls = document.getElementById('simulationControlsGroup');

    btnRealtime.addEventListener('click', () => {
      btnRealtime.classList.add('active');
      btnSimulation.classList.remove('active');
      simControls.classList.add('hidden');
      this.engine.setMode('REALTIME');
    });

    btnSimulation.addEventListener('click', () => {
      btnSimulation.classList.add('active');
      btnRealtime.classList.remove('active');
      simControls.classList.remove('hidden');
      this.engine.setMode('SIMULATION');
    });

    // Tools
    const toolSelect = document.getElementById('toolSelect');
    const toolCable = document.getElementById('toolCable');
    const toolPdu = document.getElementById('toolPdu');
    const toolDelete = document.getElementById('toolDelete');

    const setActiveToolBtn = (activeBtn) => {
      [toolSelect, toolCable, toolPdu, toolDelete].forEach(b => b.classList.remove('active'));
      if (activeBtn) activeBtn.classList.add('active');
    };

    this.canvas.onToolChange = (tool) => {
      if (tool === 'SELECT') setActiveToolBtn(toolSelect);
      else if (tool === 'CABLE') setActiveToolBtn(toolCable);
      else if (tool === 'PDU') setActiveToolBtn(toolPdu);
      else if (tool === 'DELETE') setActiveToolBtn(toolDelete);
    };

    toolSelect.addEventListener('click', () => {
      this.canvas.setTool('SELECT');
    });

    toolCable.addEventListener('click', () => {
      this.canvas.setTool('CABLE');
    });

    toolPdu.addEventListener('click', () => {
      this.canvas.setTool('PDU');
    });

    toolDelete.addEventListener('click', () => {
      this.canvas.setTool('DELETE');
    });

    // Preset Scenarios dropdown
    const scenarioSelect = document.getElementById('scenarioSelect');
    scenarioSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'basic-lan') this.loadScenarioBasicLan();
      else if (val === 'server-dhcp-web') this.loadScenarioServerDhcpWeb();
      else if (val === 'router-subnet') this.loadScenarioRouterSubnet();
      else if (val === 'inter-vlan') this.loadScenarioInterVlan();
      else if (val === 'empty') this.loadScenarioEmpty();
    });

    // Export / Import
    document.getElementById('btnExportJson').addEventListener('click', () => this.exportTopologyJSON());
    document.getElementById('btnImportJson').addEventListener('click', () => document.getElementById('fileImportInput').click());
    document.getElementById('fileImportInput').addEventListener('change', (e) => this.importTopologyJSON(e));
  }

  bindPalette() {
    // Adding devices from drawer
    document.querySelectorAll('.palette-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        const rect = this.canvasElement.getBoundingClientRect();
        // Place near center with small random jitter
        const x = Math.round(rect.width / 2 - 50 + (Math.random() * 80 - 40));
        const y = Math.round(rect.height / 2 - 50 + (Math.random() * 80 - 40));
        this.createDevice(type, x, y);
      });
    });
  }

  createDevice(type, x, y) {
    let dev = null;
    const count = this.engine.devices.filter(d => d.type === type).length;

    if (type === 'pc') {
      dev = new HostDevice(null, `PC${count}`, 'pc', x, y);
      dev.setIPConfig(`192.168.1.${10 + count}`, '255.255.255.0');
    } else if (type === 'printer') {
      dev = new PrinterDevice(null, `Printer${count}`, x, y);
      dev.setIPConfig(`192.168.1.${50 + count}`, '255.255.255.0');
    } else if (type === 'server') {
      dev = new ServerDevice(null, `Server${count}`, x, y);
      dev.setIPConfig(`192.168.1.254`, '255.255.255.0', '192.168.1.1');
    } else if (type === 'switch') {
      dev = new SwitchDevice(null, `Switch${count}`, 24, x, y);
    } else if (type === 'router') {
      dev = new RouterDevice(null, `Router${count}`, x, y);
    }

    if (dev) {
      this.engine.addDevice(dev);
      this.canvas.draw();
    }
    return dev;
  }

  bindSimulationControls() {
    const btnPlayPause = document.getElementById('btnSimPlayPause');
    const btnStepForward = document.getElementById('btnSimStep');
    const speedSlider = document.getElementById('simSpeedSlider');

    btnPlayPause.addEventListener('click', () => {
      this.engine.isRunning = !this.engine.isRunning;
      btnPlayPause.innerHTML = this.engine.isRunning ? '⏸ Pause' : '▶ Play';
    });

    btnStepForward.addEventListener('click', () => {
      this.engine.stepForward();
    });

    speedSlider.addEventListener('input', (e) => {
      this.engine.setSpeed(parseFloat(e.target.value));
    });

    // Status bar hook
    const statusMsg = document.getElementById('statusBarMessage');
    this.canvas.onStatusMessage = (msg) => {
      statusMsg.textContent = msg;
    };
  }

  bindEventDrawer() {
    const tableBody = document.getElementById('eventTableBody');
    const toggleDrawerBtn = document.getElementById('toggleDrawerBtn');
    const drawerContent = document.getElementById('simulationDrawer');

    toggleDrawerBtn.addEventListener('click', () => {
      drawerContent.classList.toggle('collapsed');
      toggleDrawerBtn.textContent = drawerContent.classList.contains('collapsed') ? '▲ Simulation Panel' : '▼ Simulation Panel';
    });

    this.engine.onEventLoggedCallbacks.push((ev) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="event-tag" style="background: ${ev.color}22; color: ${ev.color}; border: 1px solid ${ev.color}88;">${ev.type}</span></td>
        <td>${ev.timeStr}</td>
        <td><strong>${ev.lastDevice}</strong></td>
        <td><strong>${ev.atDevice}</strong></td>
        <td class="event-details">${ev.details}</td>
      `;

      tr.addEventListener('click', () => {
        this.engine.inspectPDU(ev.packetItem);
      });

      tableBody.insertBefore(tr, tableBody.firstChild);

      // Keep table capped
      if (tableBody.children.length > 100) {
        tableBody.removeChild(tableBody.lastChild);
      }
    });

    document.getElementById('btnClearEventList').addEventListener('click', () => {
      tableBody.innerHTML = '';
      this.engine.eventList = [];
    });
  }

  loadScenarioBasicLan() {
    this.engine.clearAll();
    document.getElementById('eventTableBody').innerHTML = '';

    const pc0 = new HostDevice('dev_pc0', 'PC0', 'pc', 200, 280);
    pc0.setIPConfig('192.168.1.10', '255.255.255.0');

    const pc1 = new HostDevice('dev_pc1', 'PC1', 'pc', 600, 280);
    pc1.setIPConfig('192.168.1.20', '255.255.255.0');

    const sw0 = new SwitchDevice('dev_sw0', 'Switch0', 24, 400, 160);

    this.engine.addDevice(pc0);
    this.engine.addDevice(pc1);
    this.engine.addDevice(sw0);

    // Connect cables
    const c1 = new Cable(pc0.getInterface('FastEthernet0'), sw0.getInterface('Fa0/1'));
    const c2 = new Cable(pc1.getInterface('FastEthernet0'), sw0.getInterface('Fa0/2'));

    this.engine.addCable(c1);
    this.engine.addCable(c2);

    this.canvas.draw();
    if (this.canvas.onStatusMessage) {
      this.canvas.onStatusMessage('Scenario loaded: Basic LAN (PC0 <-> Switch0 <-> PC1). Double click PC0 -> Command Prompt -> type "ping 192.168.1.20"');
    }
  }

  loadScenarioRouterSubnet() {
    this.engine.clearAll();
    document.getElementById('eventTableBody').innerHTML = '';

    // Subnet 1 (192.168.1.0/24)
    const pc0 = new HostDevice('dev_pc0', 'PC0', 'pc', 160, 320);
    pc0.setIPConfig('192.168.1.10', '255.255.255.0', '192.168.1.1');

    const sw0 = new SwitchDevice('dev_sw0', 'Switch0', 24, 280, 200);

    // Router
    const router0 = new RouterDevice('dev_r0', 'Router0', 480, 150);
    const gi0 = router0.getInterface('GigabitEthernet0/0');
    const gi1 = router0.getInterface('GigabitEthernet0/1');
    gi0.setIP('192.168.1.1', '255.255.255.0');
    gi1.setIP('192.168.2.1', '255.255.255.0');

    // Subnet 2 (192.168.2.0/24)
    const sw1 = new SwitchDevice('dev_sw1', 'Switch1', 24, 680, 200);

    const pc1 = new HostDevice('dev_pc1', 'PC1', 'pc', 800, 320);
    pc1.setIPConfig('192.168.2.10', '255.255.255.0', '192.168.2.1');

    this.engine.addDevice(pc0);
    this.engine.addDevice(sw0);
    this.engine.addDevice(router0);
    this.engine.addDevice(sw1);
    this.engine.addDevice(pc1);

    // Cables
    this.engine.addCable(new Cable(pc0.getInterface('FastEthernet0'), sw0.getInterface('Fa0/1')));
    this.engine.addCable(new Cable(sw0.getInterface('Fa0/2'), gi0));
    this.engine.addCable(new Cable(gi1, sw1.getInterface('Fa0/1')));
    this.engine.addCable(new Cable(sw1.getInterface('Fa0/2'), pc1.getInterface('FastEthernet0')));

    this.canvas.draw();
    if (this.canvas.onStatusMessage) {
      this.canvas.onStatusMessage('Scenario loaded: Inter-Subnet Routing (PC0 [192.168.1.10] <-> Router0 <-> PC1 [192.168.2.10]). Ping across subnets!');
    }
  }

  loadScenarioServerDhcpWeb() {
    this.engine.clearAll();
    document.getElementById('eventTableBody').innerHTML = '';

    // PC0: DHCP client
    const pc0 = new HostDevice('dev_pc0', 'PC0', 'pc', 180, 290);
    pc0.ipMode = 'DHCP';

    // PC1: Static Host
    const pc1 = new HostDevice('dev_pc1', 'PC1', 'pc', 180, 130);
    pc1.setIPConfig('192.168.1.10', '255.255.255.0', '192.168.1.1', '192.168.1.254');

    // Switch
    const sw0 = new SwitchDevice('dev_sw0', 'Switch0', 24, 400, 210);

    // Server with Web, DHCP, and DNS
    const srv0 = new ServerDevice('dev_srv0', 'Server-PT', 640, 210);
    srv0.setIPConfig('192.168.1.254', '255.255.255.0', '192.168.1.1');

    this.engine.addDevice(pc0);
    this.engine.addDevice(pc1);
    this.engine.addDevice(sw0);
    this.engine.addDevice(srv0);

    this.engine.addCable(new Cable(pc0.getInterface('FastEthernet0'), sw0.getInterface('Fa0/1')));
    this.engine.addCable(new Cable(pc1.getInterface('FastEthernet0'), sw0.getInterface('Fa0/2')));
    this.engine.addCable(new Cable(srv0.getInterface('FastEthernet0'), sw0.getInterface('Fa0/3')));

    this.canvas.draw();
    if (this.canvas.onStatusMessage) {
      this.canvas.onStatusMessage('Scenario: Web, DNS & DHCP Server loaded. Open PC0 -> IP Configuration -> Click DHCP! Then open Web Browser -> Go to cisco.local');
    }
  }

  loadScenarioInterVlan() {
    this.engine.clearAll();
    document.getElementById('eventTableBody').innerHTML = '';

    // PC0 in VLAN 10 (Sales)
    const pc0 = new HostDevice('dev_pc0', 'PC0', 'pc', 180, 320);
    pc0.setIPConfig('192.168.10.10', '255.255.255.0', '192.168.10.1');

    // PC1 in VLAN 20 (Marketing)
    const pc1 = new HostDevice('dev_pc1', 'PC1', 'pc', 620, 320);
    pc1.setIPConfig('192.168.20.10', '255.255.255.0', '192.168.20.1');

    // Switch0 with VLAN 10 & 20, Trunk on Fa0/24
    const sw0 = new SwitchDevice('dev_sw0', 'Switch0', 24, 400, 220);
    sw0.createVlan(10, 'SALES');
    sw0.createVlan(20, 'MARKETING');
    sw0.setPortAccessVlan('Fa0/1', 10);
    sw0.setPortAccessVlan('Fa0/2', 20);
    sw0.setPortMode('Fa0/24', 'trunk');

    // Router0 with Router-on-a-Stick sub-interfaces on GigabitEthernet0/0
    const router0 = new RouterDevice('dev_r0', 'Router0', 400, 70);
    
    // Sub-interface Gi0/0.10 for VLAN 10
    const sub10 = router0.getOrCreateSubInterface('GigabitEthernet0/0.10');
    sub10.encapsulation = 'dot1Q';
    sub10.vlanTag = 10;
    sub10.setIP('192.168.10.1', '255.255.255.0');

    // Sub-interface Gi0/0.20 for VLAN 20
    const sub20 = router0.getOrCreateSubInterface('GigabitEthernet0/0.20');
    sub20.encapsulation = 'dot1Q';
    sub20.vlanTag = 20;
    sub20.setIP('192.168.20.1', '255.255.255.0');

    this.engine.addDevice(pc0);
    this.engine.addDevice(pc1);
    this.engine.addDevice(sw0);
    this.engine.addDevice(router0);

    // Cable connections
    this.engine.addCable(new Cable(pc0.getInterface('FastEthernet0'), sw0.getInterface('Fa0/1')));
    this.engine.addCable(new Cable(pc1.getInterface('FastEthernet0'), sw0.getInterface('Fa0/2')));
    this.engine.addCable(new Cable(sw0.getInterface('Fa0/24'), router0.getInterface('GigabitEthernet0/0')));

    this.canvas.draw();
    if (this.canvas.onStatusMessage) {
      this.canvas.onStatusMessage('Scenario: Inter-VLAN Routing (Router-on-a-Stick) loaded! PC0 is on VLAN 10 (Sales), PC1 is on VLAN 20 (Marketing). Double-click PC0 -> ping 192.168.20.10');
    }
  }

  loadScenarioEmpty() {
    this.engine.clearAll();
    document.getElementById('eventTableBody').innerHTML = '';
    this.canvas.draw();
    if (this.canvas.onStatusMessage) {
      this.canvas.onStatusMessage('Blank canvas. Click devices from the palette below to build your network.');
    }
  }

  exportTopologyJSON() {
    const data = {
      devices: this.engine.devices.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        x: d.x,
        y: d.y,
        ip: d.ip,
        subnetMask: d.subnetMask,
        defaultGateway: d.defaultGateway,
        dnsServer: d.dnsServer || null,
        ipMode: d.ipMode || 'STATIC',
        vlans: d.vlans ? Array.from(d.vlans.values()) : undefined,
        subInterfaces: d.subInterfaces ? d.subInterfaces.map(s => ({
          name: s.name,
          mac: s.mac,
          ip: s.ip,
          subnetMask: s.subnetMask,
          adminUp: s.adminUp,
          vlanTag: s.vlanTag,
          encapsulation: s.encapsulation
        })) : undefined,
        staticRoutes: d.routingTable ? d.routingTable.filter(r => r.type === 'S') : undefined,
        interfaces: d.interfaces.map(i => ({
          name: i.name,
          mac: i.mac,
          ip: i.ip,
          subnetMask: i.subnetMask,
          adminUp: i.adminUp,
          mode: i.mode,
          vlan: i.vlan,
          nativeVlan: i.nativeVlan
        }))
      })),
      cables: this.engine.cables.map(c => ({
        devA: c.interfaceA.device.id,
        portA: c.interfaceA.name,
        devB: c.interfaceB.device.id,
        portB: c.interfaceB.name,
        type: c.type
      }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cisco-topology-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importTopologyJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.engine.clearAll();

        const devMap = new Map();

        // Recreate devices
        data.devices.forEach(d => {
          let dev = null;
          if (d.type === 'pc' || d.type === 'laptop') {
            dev = new HostDevice(d.id, d.name, d.type, d.x, d.y);
            if (d.ip) dev.setIPConfig(d.ip, d.subnetMask, d.defaultGateway, d.dnsServer);
            if (d.ipMode) dev.ipMode = d.ipMode;
          } else if (d.type === 'printer') {
            dev = new PrinterDevice(d.id, d.name, d.x, d.y);
            if (d.ip) dev.setIPConfig(d.ip, d.subnetMask, d.defaultGateway, d.dnsServer);
            if (d.ipMode) dev.ipMode = d.ipMode;
          } else if (d.type === 'server') {
            dev = new ServerDevice(d.id, d.name, d.x, d.y);
            if (d.ip) dev.setIPConfig(d.ip, d.subnetMask, d.defaultGateway, d.dnsServer);
          } else if (d.type === 'switch') {
            dev = new SwitchDevice(d.id, d.name, 24, d.x, d.y);
            if (d.vlans) {
              d.vlans.forEach(v => dev.createVlan(v.id, v.name));
            }
          } else if (d.type === 'router') {
            dev = new RouterDevice(d.id, d.name, d.x, d.y);
            if (d.subInterfaces) {
              d.subInterfaces.forEach(s => {
                const sub = dev.getOrCreateSubInterface(s.name);
                sub.encapsulation = s.encapsulation;
                sub.vlanTag = s.vlanTag;
                sub.adminUp = s.adminUp !== undefined ? s.adminUp : true;
                if (s.ip) sub.setIP(s.ip, s.subnetMask);
              });
            }
            if (d.staticRoutes) {
              d.staticRoutes.forEach(r => dev.addStaticRoute(r.network, r.mask, r.nextHop && r.nextHop !== '0.0.0.0' ? r.nextHop : r.exitInterface));
            }
          }

          if (dev) {
            // Restore interface configs
            if (d.interfaces) {
              d.interfaces.forEach(iData => {
                const intf = dev.getInterface(iData.name);
                if (intf) {
                  intf.mac = iData.mac || intf.mac;
                  if (iData.ip) intf.setIP(iData.ip, iData.subnetMask);
                  intf.adminUp = iData.adminUp !== undefined ? iData.adminUp : true;
                  if (iData.mode) intf.mode = iData.mode;
                  if (iData.vlan) intf.vlan = iData.vlan;
                  if (iData.nativeVlan) intf.nativeVlan = iData.nativeVlan;
                }
              });
            }
            this.engine.addDevice(dev);
            devMap.set(d.id, dev);
          }
        });

        // Reconnect cables
        if (data.cables) {
          data.cables.forEach(c => {
            const devA = devMap.get(c.devA);
            const devB = devMap.get(c.devB);
            if (devA && devB) {
              const portA = devA.getInterface(c.portA);
              const portB = devB.getInterface(c.portB);
              if (portA && portB) {
                this.engine.addCable(new Cable(portA, portB, c.type || 'straight'));
              }
            }
          });
        }

        this.canvas.draw();
        if (this.canvas.onStatusMessage) {
          this.canvas.onStatusMessage('Topology loaded successfully from file.');
        }
      } catch (err) {
        alert('Failed to parse topology JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }
}

// Start application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new App();
});

