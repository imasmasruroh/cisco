/**
 * modals.js - UI Windows & Dialogs
 * Manages Device Config (PC Desktop, Command Prompt, Cisco IOS CLI), PDU Inspector, and Port Selector
 */

import { CiscoCLI } from '../engine/cli.js';
import { IPUtils } from '../models/protocols.js';

export class ModalManager {
  constructor(simEngine, canvas) {
    this.engine = simEngine;
    this.canvas = canvas;

    // Cache dialog elements
    this.deviceModal = document.getElementById('deviceModal');
    this.pduModal = document.getElementById('pduModal');
    this.portModal = document.getElementById('portModal');

    // Active device being configured
    this.currentDevice = null;
    this.activeCLIs = new Map(); // deviceId -> CiscoCLI instance

    this.bindEvents();
  }

  bindEvents() {
    // Connect to canvas double click
    this.canvas.onDeviceDoubleClick = (device) => {
      this.openDeviceModal(device);
    };

    // Connect to canvas port selection request
    this.canvas.onRequestPortSelection = (device, callback) => {
      this.openPortSelector(device, callback);
    };

    // Connect to PDU inspector trigger
    this.engine.onInspectPDUCallbacks.push((packetItem) => {
      this.openPDUInspector(packetItem);
    });

    // Close button handlers
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('dialog');
        if (modal) modal.close();
      });
    });
  }

  openDeviceModal(device) {
    this.currentDevice = device;
    const titleEl = document.getElementById('deviceModalTitle');
    titleEl.textContent = `${device.name} (${device.type.toUpperCase()})`;

    const tabsContainer = document.getElementById('deviceModalTabs');
    const bodyContainer = document.getElementById('deviceModalBody');

    // Build tabs based on device type
    if (device.type === 'server') {
      tabsContainer.innerHTML = `
        <button class="tab-btn active" data-tab="desktop">Desktop</button>
        <button class="tab-btn" data-tab="services">Services</button>
        <button class="tab-btn" data-tab="config">Config</button>
      `;
      this.renderHostDesktop(bodyContainer, device);
    } else if (device.type === 'pc' || device.type === 'laptop') {
      tabsContainer.innerHTML = `
        <button class="tab-btn active" data-tab="desktop">Desktop</button>
        <button class="tab-btn" data-tab="config">Config</button>
      `;
      this.renderHostDesktop(bodyContainer, device);
    } else if (device.type === 'printer') {
      tabsContainer.innerHTML = `
        <button class="tab-btn active" data-tab="desktop">Desktop</button>
        <button class="tab-btn" data-tab="config">Config</button>
      `;
      this.renderPrinterDesktop(bodyContainer, device);
    } else {
      // Switch or Router
      tabsContainer.innerHTML = `
        <button class="tab-btn active" data-tab="cli">CLI</button>
        <button class="tab-btn" data-tab="config">Config</button>
      `;
      this.renderCiscoCLI(bodyContainer, device);
    }

    // Tab switching listener
    tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        if (tab === 'desktop') {
          if (device.type === 'printer') this.renderPrinterDesktop(bodyContainer, device);
          else this.renderHostDesktop(bodyContainer, device);
        }
        else if (tab === 'services') this.renderServerServices(bodyContainer, device);
        else if (tab === 'cli') this.renderCiscoCLI(bodyContainer, device);
        else if (tab === 'config') this.renderDeviceConfig(bodyContainer, device);
      });
    });

    this.deviceModal.showModal();
  }

  renderHostDesktop(container, device) {
    container.innerHTML = `
      <div class="desktop-workspace">
        <div class="desktop-icons">
          <div class="desktop-app-icon" id="appIpConfig">
            <div class="icon-box ip-icon">🌐</div>
            <span>IP Configuration</span>
          </div>
          <div class="desktop-app-icon" id="appCommandPrompt">
            <div class="icon-box cmd-icon">>_</div>
            <span>Command Prompt</span>
          </div>
          <div class="desktop-app-icon" id="appWebBrowser">
            <div class="icon-box browser-icon">🌍</div>
            <span>Web Browser</span>
          </div>
          <div class="desktop-app-icon" id="appNetworkPrint">
            <div class="icon-box print-icon">🖨️</div>
            <span>Network Print</span>
          </div>
        </div>
        <div class="desktop-app-view" id="desktopAppView"></div>
      </div>
    `;

    const appView = document.getElementById('desktopAppView');
    const ipIcon = document.getElementById('appIpConfig');
    const cmdIcon = document.getElementById('appCommandPrompt');
    const browserIcon = document.getElementById('appWebBrowser');
    const printIcon = document.getElementById('appNetworkPrint');

    ipIcon.addEventListener('click', () => this.showHostIpConfigApp(appView, device));
    cmdIcon.addEventListener('click', () => this.showHostCmdApp(appView, device));
    browserIcon.addEventListener('click', () => this.showWebBrowserApp(appView, device));
    printIcon.addEventListener('click', () => this.showNetworkPrintApp(appView, device));

    // Default to IP Config app
    this.showHostIpConfigApp(appView, device);
  }

  renderPrinterDesktop(container, printer) {
    container.innerHTML = `
      <div class="desktop-workspace">
        <div class="desktop-icons">
          <div class="desktop-app-icon" id="appIpConfig">
            <div class="icon-box ip-icon">🌐</div>
            <span>IP Configuration</span>
          </div>
          <div class="desktop-app-icon" id="appPrintQueue">
            <div class="icon-box print-icon">🖨️</div>
            <span>Print Queue</span>
          </div>
        </div>
        <div class="desktop-app-view" id="desktopAppView"></div>
      </div>
    `;

    const appView = document.getElementById('desktopAppView');
    document.getElementById('appIpConfig').addEventListener('click', () => this.showHostIpConfigApp(appView, printer));
    document.getElementById('appPrintQueue').addEventListener('click', () => this.showPrinterQueueApp(appView, printer));

    this.showHostIpConfigApp(appView, printer);
  }

  showHostIpConfigApp(container, device) {
    const intf = device.primaryInterface;
    const isDhcp = device.ipMode === 'DHCP';

    container.innerHTML = `
      <div class="app-window">
        <div class="app-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>IP Configuration</span>
          <button id="btnCloseIpConfig" title="Close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1;">&times;</button>
        </div>
        <div class="app-content ip-form">
          <div class="form-group">
            <label>IP Configuration Mode:</label>
            <div style="display: flex; gap: 18px; margin: 4px 0 8px 0; font-size: 13px;">
              <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                <input type="radio" name="ipConfigMode" value="STATIC" ${!isDhcp ? 'checked' : ''}> Static
              </label>
              <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                <input type="radio" name="ipConfigMode" value="DHCP" ${isDhcp ? 'checked' : ''}> DHCP
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>Interface:</label>
            <span class="static-val">${intf ? intf.name : 'FastEthernet0'}</span>
          </div>
          <div class="form-group">
            <label>Physical (MAC) Address:</label>
            <span class="static-val">${intf ? intf.mac : 'N/A'}</span>
          </div>
          <div class="form-group">
            <label>IP Address:</label>
            <input type="text" id="cfgIpAddress" value="${intf && intf.ip ? intf.ip : ''}" placeholder="e.g. 192.168.1.10" ${isDhcp ? 'disabled' : ''}>
          </div>
          <div class="form-group">
            <label>Subnet Mask:</label>
            <input type="text" id="cfgSubnetMask" value="${intf && intf.subnetMask ? intf.subnetMask : '255.255.255.0'}" placeholder="e.g. 255.255.255.0" ${isDhcp ? 'disabled' : ''}>
          </div>
          <div class="form-group">
            <label>Default Gateway:</label>
            <input type="text" id="cfgDefaultGateway" value="${device.defaultGateway || ''}" placeholder="e.g. 192.168.1.1" ${isDhcp ? 'disabled' : ''}>
          </div>
          <div class="form-group">
            <label>DNS Server:</label>
            <input type="text" id="cfgDnsServer" value="${device.dnsServer || ''}" placeholder="e.g. 8.8.8.8" ${isDhcp ? 'disabled' : ''}>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="btnSaveIpConfig">Save & Apply</button>
            <span id="ipConfigStatus" class="form-status"></span>
          </div>
        </div>
      </div>
    `;

    const ipInput = document.getElementById('cfgIpAddress');
    const maskInput = document.getElementById('cfgSubnetMask');
    const gwInput = document.getElementById('cfgDefaultGateway');
    const dnsInput = document.getElementById('cfgDnsServer');
    const saveBtn = document.getElementById('btnSaveIpConfig');
    const status = document.getElementById('ipConfigStatus');
    const closeBtn = document.getElementById('btnCloseIpConfig');

    closeBtn.addEventListener('click', () => {
      this.deviceModal.close();
    });

    // Handle Static vs DHCP Radio Toggle
    container.querySelectorAll('input[name="ipConfigMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'DHCP') {
          ipInput.disabled = true;
          maskInput.disabled = true;
          gwInput.disabled = true;
          dnsInput.disabled = true;
          saveBtn.disabled = true;

          status.style.color = '#38bdf8';
          status.textContent = 'Requesting IP from DHCP server...';

          device.requestDHCP((success, res) => {
            saveBtn.disabled = false;
            if (success) {
              status.style.color = '#22c55e';
              status.textContent = 'DHCP request successful!';
              ipInput.value = res.ip;
              maskInput.value = res.mask;
              gwInput.value = res.gateway || '';
              dnsInput.value = res.dns || '';
            } else {
              status.style.color = '#f59e0b';
              status.textContent = typeof res === 'string' ? res : 'DHCP failed. APIPA is being used.';
              ipInput.value = intf.ip || '';
              maskInput.value = intf.subnetMask || '';
              gwInput.value = '';
              dnsInput.value = '';
            }
            if (this.canvas) this.canvas.draw();
          });
        } else {
          device.ipMode = 'STATIC';
          ipInput.disabled = false;
          maskInput.disabled = false;
          gwInput.disabled = false;
          dnsInput.disabled = false;
          saveBtn.disabled = false;
          status.textContent = '';
        }
      });
    });

    saveBtn.addEventListener('click', () => {
      const mode = container.querySelector('input[name="ipConfigMode"]:checked').value;

      if (mode === 'DHCP') {
        status.style.color = '#22c55e';
        status.textContent = 'Configuration saved and applied!';
        if (this.canvas) this.canvas.draw();
        setTimeout(() => {
          this.deviceModal.close();
        }, 300);
        return;
      }

      const ip = ipInput.value.trim();
      const mask = maskInput.value.trim();
      const gw = gwInput.value.trim();
      const dns = dnsInput.value.trim();

      try {
        device.setIPConfig(ip || null, ip ? mask : null, gw || null, dns || null);
        status.style.color = '#22c55e';
        status.textContent = 'Configuration saved and applied!';
        if (this.canvas) this.canvas.draw();
        setTimeout(() => {
          this.deviceModal.close();
        }, 300);
      } catch (err) {
        status.style.color = '#ef4444';
        status.textContent = err.message;
      }
    });
  }

  showWebBrowserApp(container, device) {
    container.innerHTML = `
      <div class="app-window browser-window" style="display: flex; flex-direction: column; height: 100%;">
        <div class="app-header browser-nav-header" style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #1e293b; border-bottom: 1px solid #334155;">
          <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">URL:</span>
          <div style="flex: 1; display: flex; align-items: center; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 0 8px;">
            <span style="color: #64748b; font-size: 11px; font-family: monospace;">http://</span>
            <input type="text" id="browserUrlInput" value="cisco.local" style="flex: 1; background: transparent; border: none; color: #fff; font-size: 12px; padding: 6px 4px; outline: none;">
          </div>
          <button class="btn btn-sm btn-primary" id="btnBrowserGo">Go</button>
          <button id="btnCloseBrowser" title="Close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px; margin-left: 4px;">&times;</button>
        </div>
        <div class="browser-viewport" id="browserViewport" style="flex: 1; padding: 16px; overflow-y: auto; background: #0b1120;">
          <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
            <div style="font-size: 32px; margin-bottom: 10px;">🌍</div>
            <h3 style="color: #38bdf8; margin-bottom: 6px; font-size: 15px;">Cisco Packet Tracer Web Browser</h3>
            <p style="font-size: 12px; max-width: 380px; margin: 0 auto; line-height: 1.5;">
              Type a domain name (e.g. <code>cisco.local</code>) or web server IP above and click <strong>Go</strong> to test DNS resolution and HTTP/1.1 retrieval.
            </p>
          </div>
        </div>
      </div>
    `;

    const urlInput = document.getElementById('browserUrlInput');
    const goBtn = document.getElementById('btnBrowserGo');
    const viewport = document.getElementById('browserViewport');

    const navigate = () => {
      const target = urlInput.value.trim();
      if (!target) return;

      viewport.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #94a3b8;">
          <div style="font-size: 24px; margin-bottom: 10px; animation: spin 1s infinite linear;">🔄</div>
          <div style="font-size: 13px; font-weight: 600; color: #38bdf8;">Resolving ${target} via DNS &amp; connecting to port 80...</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Watch packet envelopes fly on the network canvas!</div>
        </div>
      `;

      device.fetchWebPage(target, (success, content) => {
        if (success) {
          viewport.innerHTML = content;
        } else {
          viewport.innerHTML = `
            <div style="padding: 24px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: #ef4444;">
              <h4 style="margin-bottom: 6px;">Web Browser Connection Error</h4>
              <div style="color: #cbd5e1; font-size: 12px;">${content}</div>
            </div>
          `;
        }
      });
    };

    goBtn.addEventListener('click', navigate);
    document.getElementById('btnCloseBrowser').addEventListener('click', () => this.deviceModal.close());
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate();
    });
  }

  showNetworkPrintApp(container, device) {
    container.innerHTML = `
      <div class="app-window">
        <div class="app-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>Network Print Client (Port 9100)</span>
          <button id="btnCloseNetPrint" title="Close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1;">&times;</button>
        </div>
        <div class="app-content ip-form">
          <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">
            Kirim dokumen ke Network Printer melalui jaringan menggunakan protokol TCP/IP (JetDirect Port 9100).
          </p>
          <div class="form-group">
            <label>Printer IP Address / Hostname:</label>
            <input type="text" id="netPrintIp" placeholder="e.g. 192.168.1.50" value="192.168.1.50">
          </div>
          <div class="form-group">
            <label>Document Name:</label>
            <input type="text" id="netPrintDoc" value="Tugas_Topologi.pdf">
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="btnSendPrintJob">Send Print Job</button>
            <span id="netPrintStatus" class="form-status"></span>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnCloseNetPrint').addEventListener('click', () => this.deviceModal.close());
    const btnSend = document.getElementById('btnSendPrintJob');
    const statusEl = document.getElementById('netPrintStatus');

    btnSend.addEventListener('click', () => {
      const targetIp = document.getElementById('netPrintIp').value.trim();
      const docName = document.getElementById('netPrintDoc').value.trim() || 'Document.pdf';
      if (!targetIp) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = 'Enter Printer IP address.';
        return;
      }

      btnSend.disabled = true;
      statusEl.style.color = '#38bdf8';
      statusEl.textContent = `Sending "${docName}" to ${targetIp}...`;

      device.sendPrintJob(targetIp, docName, (ok, res) => {
        btnSend.disabled = false;
        if (ok) {
          statusEl.style.color = '#22c55e';
          statusEl.textContent = `Printed "${res.documentName}" successfully!`;
        } else {
          statusEl.style.color = '#ef4444';
          statusEl.textContent = typeof res === 'string' ? res : 'Print job failed.';
        }
      });
    });
  }

  showPrinterQueueApp(container, printer) {
    const renderRows = () => {
      if (!printer.printQueue || printer.printQueue.length === 0) {
        return `<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 18px;">No print jobs in history. Send a print job from a PC using "Network Print" or "print &lt;ip&gt;" in CMD.</td></tr>`;
      }
      return printer.printQueue.map(job => `
        <tr>
          <td><strong>${job.id}</strong></td>
          <td>${job.documentName}</td>
          <td>${job.clientIp}</td>
          <td>${job.time}</td>
          <td><span class="badge badge-success">${job.status}</span></td>
        </tr>
      `).join('');
    };

    container.innerHTML = `
      <div class="app-window">
        <div class="app-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>Printer Status &amp; Print Queue - ${printer.name}</span>
          <button id="btnClosePrinterQueue" title="Close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1;">&times;</button>
        </div>
        <div class="app-content">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;">
            <div style="background: var(--bg-card); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
              <div style="font-size: 11px; color: #94a3b8;">Printer Status</div>
              <div style="font-size: 13px; font-weight: 600; color: #22c55e; margin-top: 4px;">● ${printer.printerStatus}</div>
            </div>
            <div style="background: var(--bg-card); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
              <div style="font-size: 11px; color: #94a3b8;">Printer IP</div>
              <div style="font-size: 13px; font-weight: 600; color: #38bdf8; margin-top: 4px;">${printer.ip || 'Unassigned'}</div>
            </div>
            <div style="background: var(--bg-card); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
              <div style="font-size: 11px; color: #94a3b8;">Total Pages Printed</div>
              <div id="printerPagesCount" style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-top: 4px;">${printer.pagesPrinted} pages</div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="color: #38bdf8; font-size: 13px;">Print Job Spooler / History</h4>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-sm btn-secondary" id="btnPrinterLocalTest">Local Test Page</button>
              <button class="btn btn-sm btn-outline" id="btnClearPrintQueue">Clear History</button>
            </div>
          </div>
          <table class="data-table" style="width: 100%;">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Document</th>
                <th>Client IP</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="printerQueueTbody">
              ${renderRows()}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btnClosePrinterQueue').addEventListener('click', () => this.deviceModal.close());
    document.getElementById('btnPrinterLocalTest').addEventListener('click', () => {
      printer.pagesPrinted += 1;
      printer.printQueue.unshift({
        id: 'JOB-' + (printer.printQueue.length + 1).toString().padStart(3, '0'),
        clientIp: '127.0.0.1 (Local)',
        documentName: 'Printer_Test_Page.pdf',
        pages: 1,
        time: new Date().toLocaleTimeString(),
        status: 'Printed'
      });
      document.getElementById('printerPagesCount').textContent = `${printer.pagesPrinted} pages`;
      document.getElementById('printerQueueTbody').innerHTML = renderRows();
    });
    document.getElementById('btnClearPrintQueue').addEventListener('click', () => {
      printer.printQueue = [];
      document.getElementById('printerQueueTbody').innerHTML = renderRows();
    });
  }

  renderServerServices(container, server) {
    container.innerHTML = `
      <div class="services-workspace" style="display: flex; gap: 16px; min-height: 380px;">
        <div class="services-sidebar" style="width: 130px; display: flex; flex-direction: column; gap: 6px;">
          <button class="tab-btn active service-tab-btn" data-svc="http" style="text-align: left; padding: 8px 12px;">🌐 HTTP</button>
          <button class="tab-btn service-tab-btn" data-svc="dhcp" style="text-align: left; padding: 8px 12px;">📡 DHCP</button>
          <button class="tab-btn service-tab-btn" data-svc="dns" style="text-align: left; padding: 8px 12px;">🔍 DNS</button>
        </div>
        <div class="services-detail-view" id="serviceDetailView" style="flex: 1; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; overflow-y: auto;">
        </div>
      </div>
    `;

    const detailView = document.getElementById('serviceDetailView');
    const tabBtns = container.querySelectorAll('.service-tab-btn');

    const switchService = (svcName) => {
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.svc === svcName));
      if (svcName === 'http') this.renderHttpService(detailView, server);
      else if (svcName === 'dhcp') this.renderDhcpService(detailView, server);
      else if (svcName === 'dns') this.renderDnsService(detailView, server);
    };

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchService(btn.dataset.svc));
    });

    switchService('http');
  }

  renderHttpService(container, server) {
    const http = server.services.http;
    container.innerHTML = `
      <div class="service-config-pane">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color);">
          <h4 style="color: #38bdf8; font-size: 14px;">HTTP Web Server</h4>
          <div style="display: flex; gap: 14px; font-size: 13px;">
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="httpServiceState" value="on" ${http.enabled ? 'checked' : ''}> On
            </label>
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="httpServiceState" value="off" ${!http.enabled ? 'checked' : ''}> Off
            </label>
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label>File: <strong>/index.html</strong></label>
          <textarea id="httpFileContent" rows="11" style="width: 100%; background: #070a10; color: #4ade80; font-family: monospace; font-size: 11px; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; resize: vertical;">${http.files['/index.html'] || ''}</textarea>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button class="btn btn-primary" id="btnSaveHttp">Save Web Page</button>
          <span id="httpSaveStatus" style="font-size: 12px; font-weight: 600;"></span>
        </div>
      </div>
    `;

    container.querySelectorAll('input[name="httpServiceState"]').forEach(r => {
      r.addEventListener('change', (e) => {
        http.enabled = e.target.value === 'on';
      });
    });

    document.getElementById('btnSaveHttp').addEventListener('click', () => {
      const content = document.getElementById('httpFileContent').value;
      http.files['/'] = content;
      http.files['/index.html'] = content;
      const status = document.getElementById('httpSaveStatus');
      status.style.color = '#22c55e';
      status.textContent = 'Saved successfully!';
    });
  }

  renderDhcpService(container, server) {
    const dhcp = server.services.dhcp;
    container.innerHTML = `
      <div class="service-config-pane">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color);">
          <h4 style="color: #38bdf8; font-size: 14px;">DHCP Server Service</h4>
          <div style="display: flex; gap: 14px; font-size: 13px;">
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="dhcpServiceState" value="on" ${dhcp.enabled ? 'checked' : ''}> On
            </label>
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="dhcpServiceState" value="off" ${!dhcp.enabled ? 'checked' : ''}> Off
            </label>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div class="form-group">
            <label>Pool Name:</label>
            <input type="text" id="dhcpPoolName" value="${dhcp.poolName || 'serverPool'}">
          </div>
          <div class="form-group">
            <label>Default Gateway:</label>
            <input type="text" id="dhcpGateway" value="${dhcp.defaultGateway || ''}" placeholder="192.168.1.1">
          </div>
          <div class="form-group">
            <label>DNS Server:</label>
            <input type="text" id="dhcpDns" value="${dhcp.dnsServer || ''}" placeholder="192.168.1.254">
          </div>
          <div class="form-group">
            <label>Start IP Address:</label>
            <input type="text" id="dhcpStartIp" value="${dhcp.startIp || '192.168.1.100'}">
          </div>
          <div class="form-group">
            <label>Subnet Mask:</label>
            <input type="text" id="dhcpSubnetMask" value="${dhcp.subnetMask || '255.255.255.0'}">
          </div>
          <div class="form-group">
            <label>Active Leases Count:</label>
            <span class="static-val" style="margin-top: 8px;">${dhcp.leases.size} clients</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button class="btn btn-primary" id="btnSaveDhcp">Save DHCP Settings</button>
          <span id="dhcpSaveStatus" style="font-size: 12px; font-weight: 600;"></span>
        </div>
      </div>
    `;

    container.querySelectorAll('input[name="dhcpServiceState"]').forEach(r => {
      r.addEventListener('change', (e) => {
        dhcp.enabled = e.target.value === 'on';
      });
    });

    document.getElementById('btnSaveDhcp').addEventListener('click', () => {
      dhcp.poolName = document.getElementById('dhcpPoolName').value.trim();
      dhcp.defaultGateway = document.getElementById('dhcpGateway').value.trim();
      dhcp.dnsServer = document.getElementById('dhcpDns').value.trim();
      dhcp.startIp = document.getElementById('dhcpStartIp').value.trim();
      dhcp.subnetMask = document.getElementById('dhcpSubnetMask').value.trim();
      const status = document.getElementById('dhcpSaveStatus');
      status.style.color = '#22c55e';
      status.textContent = 'DHCP settings saved!';
    });
  }

  renderDnsService(container, server) {
    const dns = server.services.dns;

    const renderTableRows = () => {
      return dns.records.map((r, idx) => `
        <tr>
          <td><strong>${r.name}</strong></td>
          <td>${r.type}</td>
          <td>${r.ip}</td>
          <td>
            <button class="btn btn-xs btn-outline btn-del-record" data-idx="${idx}" style="color: #ef4444;">Delete</button>
          </td>
        </tr>
      `).join('');
    };

    container.innerHTML = `
      <div class="service-config-pane">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color);">
          <h4 style="color: #38bdf8; font-size: 14px;">DNS Server Service</h4>
          <div style="display: flex; gap: 14px; font-size: 13px;">
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="dnsServiceState" value="on" ${dns.enabled ? 'checked' : ''}> On
            </label>
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="dnsServiceState" value="off" ${!dns.enabled ? 'checked' : ''}> Off
            </label>
          </div>
        </div>
        <div style="background: var(--bg-card); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
          <h5 style="margin-bottom: 8px; font-size: 12px; color: #94a3b8;">Add Resource Record</h5>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="dnsRecordName" placeholder="Name (e.g. cisco.local)" style="flex: 2; padding: 6px 8px; background: #0f172a; border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px;">
            <select id="dnsRecordType" style="flex: 1; padding: 6px; background: #0f172a; border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px;">
              <option value="A">A Record</option>
            </select>
            <input type="text" id="dnsRecordIp" placeholder="IP Address" style="flex: 2; padding: 6px 8px; background: #0f172a; border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px;">
            <button class="btn btn-sm btn-primary" id="btnAddDnsRecord">Add</button>
          </div>
        </div>
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>IP Address</th>
              <th width="70">Action</th>
            </tr>
          </thead>
          <tbody id="dnsRecordsTbody">
            ${renderTableRows()}
          </tbody>
        </table>
      </div>
    `;

    container.querySelectorAll('input[name="dnsServiceState"]').forEach(r => {
      r.addEventListener('change', (e) => {
        dns.enabled = e.target.value === 'on';
      });
    });

    const tbody = document.getElementById('dnsRecordsTbody');

    const bindDeleteHandlers = () => {
      container.querySelectorAll('.btn-del-record').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.idx, 10);
          dns.records.splice(idx, 1);
          tbody.innerHTML = renderTableRows();
          bindDeleteHandlers();
        });
      });
    };

    bindDeleteHandlers();

    document.getElementById('btnAddDnsRecord').addEventListener('click', () => {
      const name = document.getElementById('dnsRecordName').value.trim();
      const type = document.getElementById('dnsRecordType').value;
      const ip = document.getElementById('dnsRecordIp').value.trim();

      if (name && ip && IPUtils.isValidIp(ip)) {
        dns.records.push({ name: name.toLowerCase(), type, ip });
        tbody.innerHTML = renderTableRows();
        bindDeleteHandlers();
        document.getElementById('dnsRecordName').value = '';
        document.getElementById('dnsRecordIp').value = '';
      } else {
        alert('Please enter a valid domain name and IP address.');
      }
    });
  }

  showHostCmdApp(container, device) {
    container.innerHTML = `
      <div class="app-window cmd-window">
        <div class="app-header cmd-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>Command Prompt - ${device.name}</span>
          <button id="btnCloseCmd" title="Close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1;">&times;</button>
        </div>
        <div class="terminal-body" id="cmdTerminalOutput">
          <div class="cmd-line">Cisco Packet Tracer Web CLI [Version 1.0.0]</div>
          <div class="cmd-line">(c) Web NetSim. Type "help", "ping", "ipconfig", or "arp -a".</div>
          <div class="cmd-line">&nbsp;</div>
        </div>
        <div class="terminal-input-row">
          <span class="cmd-prompt">C:\\&gt;</span>
          <input type="text" class="cmd-input" id="cmdInput" autofocus>
        </div>
      </div>
    `;

    const out = document.getElementById('cmdTerminalOutput');
    const input = document.getElementById('cmdInput');

    const printLine = (text) => {
      const div = document.createElement('div');
      div.className = 'cmd-line';
      div.textContent = text;
      out.appendChild(div);
      out.scrollTop = out.scrollHeight;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        printLine(`C:\\> ${val}`);
        input.value = '';

        if (!val) return;

        const parts = val.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const arg = parts[1];

        if (cmd === 'cls') {
          out.innerHTML = '';
        } else if (cmd === 'ipconfig') {
          printLine('\nWindows IP Configuration\n');
          printLine(`FastEthernet0 adapter:`);
          printLine(`   Connection-specific DNS Suffix  . : `);
          printLine(`   Physical Address. . . . . . . . . : ${device.primaryInterface.mac}`);
          printLine(`   Link-local IPv6 Address . . . . . : fe80::1`);
          printLine(`   IPv4 Address. . . . . . . . . . . : ${device.ip || '0.0.0.0'}`);
          printLine(`   Subnet Mask . . . . . . . . . . . : ${device.subnetMask || '0.0.0.0'}`);
          printLine(`   Default Gateway . . . . . . . . . : ${device.defaultGateway || '0.0.0.0'}\n`);
        } else if (cmd === 'arp' && (arg === '-a' || arg === '/a')) {
          printLine('\nInterface: ' + (device.ip || '0.0.0.0'));
          printLine('  Internet Address      Physical Address      Type');
          if (device.arpTable && device.arpTable.size > 0) {
            device.arpTable.forEach((v, k) => {
              printLine(`  ${k.padEnd(20, ' ')}  ${v.mac.padEnd(20, ' ')}  dynamic`);
            });
          } else {
            printLine('  No ARP Entries Found.');
          }
          printLine('');
        } else if (cmd === 'ping') {
          if (!arg) {
            printLine('Usage: ping [-n count] target_name');
            return;
          }
          if (!IPUtils.isValidIp(arg)) {
            printLine(`Ping request could not find host ${arg}. Please check the name and try again.`);
            return;
          }

          if (this.engine.mode === 'SIMULATION' && !this.engine.isRunning) {
            printLine('Notice: Simulation mode is currently PAUSED.');
            printLine('Click "Play ▶" or "Step ⏭" on the top toolbar to advance packets.\n');
          }

          input.disabled = true;
          device.startPing(arg, 4, {
            onPrint: (msg) => printLine(msg),
            onComplete: () => {
              input.disabled = false;
              input.focus();
            }
          });
        } else if (cmd === 'print' || cmd === 'lpr') {
          if (!arg) {
            printLine('Usage: print <printer-ip> [document-name]');
            return;
          }
          const docName = parts.slice(2).join(' ') || 'TestDocument.pdf';
          printLine(`Sending "${docName}" to network printer ${arg} (TCP:9100)...`);
          input.disabled = true;
          device.sendPrintJob(arg, docName, (ok, res) => {
            input.disabled = false;
            if (ok) {
              printLine(`Success: "${res.documentName}" printed! Status: ${res.status}\n`);
            } else {
              printLine(`Error: ${res}\n`);
            }
            input.focus();
          });
        } else if (cmd === 'help') {
          printLine('\nAvailable Commands:');
          printLine('  ipconfig            Display IP address, subnet mask, and gateway');
          printLine('  ping <ip>           Send ICMP Echo requests to destination host');
          printLine('  print <ip> [doc]    Send print job to network printer (port 9100)');
          printLine('  arp -a              Display current ARP cache entries');
          printLine('  cls                 Clear command prompt screen\n');
        } else {
          printLine(`'${cmd}' is not recognized as an internal or external command.`);
        }
      }
    });

    document.getElementById('btnCloseCmd').addEventListener('click', () => {
      this.deviceModal.close();
    });

    input.focus();
  }

  renderCiscoCLI(container, device) {
    if (!this.activeCLIs.has(device.id)) {
      this.activeCLIs.set(device.id, new CiscoCLI(device));
    }
    const cli = this.activeCLIs.get(device.id);

    container.innerHTML = `
      <div class="cisco-terminal">
        <div class="terminal-banner">Cisco IOS Software (${device.type === 'router' ? 'C1900-UNIVERSALK9-M' : 'C2960-LANBASEK9-M'})</div>
        <div class="terminal-body" id="ciscoTerminalOutput">
          <div class="cli-line">Press RETURN to get started!</div>
        </div>
        <div class="terminal-input-row cisco-row">
          <span class="cisco-prompt" id="ciscoPrompt">${cli.getPrompt()}</span>
          <input type="text" class="cisco-input" id="ciscoInput" autofocus>
        </div>
      </div>
    `;

    const out = document.getElementById('ciscoTerminalOutput');
    const promptEl = document.getElementById('ciscoPrompt');
    const input = document.getElementById('ciscoInput');

    const printOutput = (text) => {
      if (!text) return;
      const lines = text.split('\n');
      lines.forEach(l => {
        const div = document.createElement('div');
        div.className = 'cli-line';
        div.textContent = l;
        out.appendChild(div);
      });
      out.scrollTop = out.scrollHeight;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value;
        const currentPrompt = promptEl.textContent;
        printOutput(`${currentPrompt} ${val}`);
        input.value = '';

        const result = cli.execute(val);
        if (result) printOutput(result);

        promptEl.textContent = cli.getPrompt();
        if (this.canvas) this.canvas.draw();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        input.value = cli.autocomplete(input.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (cli.history.length > 0 && cli.historyIndex > 0) {
          cli.historyIndex--;
          input.value = cli.history[cli.historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (cli.historyIndex < cli.history.length - 1) {
          cli.historyIndex++;
          input.value = cli.history[cli.historyIndex];
        } else {
          cli.historyIndex = cli.history.length;
          input.value = '';
        }
      }
    });

    input.focus();
  }

  renderDeviceConfig(container, device) {
    const isSwitch = device.type === 'switch';
    const allPorts = [...device.interfaces, ...(device.subInterfaces || [])];

    const tableHeaders = isSwitch 
      ? `<th>Port</th><th>Mode</th><th>VLAN</th><th>Status</th>`
      : `<th>Port</th><th>MAC</th><th>IP Address</th><th>Subnet Mask</th><th>Status</th>`;

    let portRows = '';
    allPorts.forEach(intf => {
      if (isSwitch) {
        portRows += `
          <tr>
            <td><strong>${intf.name}</strong></td>
            <td>
              <select class="port-mode-select" data-port="${intf.name}" style="background: #0f172a; color: #fff; border: 1px solid var(--border-color); border-radius: 4px; padding: 3px 6px; font-size: 11px;">
                <option value="access" ${intf.mode === 'access' ? 'selected' : ''}>Access</option>
                <option value="trunk" ${intf.mode === 'trunk' ? 'selected' : ''}>Trunk</option>
              </select>
            </td>
            <td>
              <input type="number" class="port-vlan-input" data-port="${intf.name}" value="${intf.vlan || 1}" min="1" max="4094" style="width: 60px; background: #0f172a; color: #fff; border: 1px solid var(--border-color); border-radius: 4px; padding: 3px 6px; font-size: 11px;" ${intf.mode === 'trunk' ? 'disabled' : ''}>
            </td>
            <td>
              <span class="badge ${intf.isUp ? 'badge-success' : 'badge-danger'}">
                ${intf.isUp ? 'UP' : (intf.adminUp ? 'DISCONNECTED' : 'SHUTDOWN')}
              </span>
            </td>
          </tr>
        `;
      } else {
        portRows += `
          <tr>
            <td><strong>${intf.name}</strong></td>
            <td>${intf.mac}</td>
            <td>${intf.ip || 'Unassigned'}</td>
            <td>${intf.subnetMask || 'N/A'}</td>
            <td>
              <span class="badge ${intf.isUp ? 'badge-success' : 'badge-danger'}">
                ${intf.isUp ? 'UP' : (intf.adminUp ? 'DISCONNECTED' : 'SHUTDOWN')}
              </span>
            </td>
          </tr>
        `;
      }
    });

    container.innerHTML = `
      <div class="config-view">
        <div class="form-group" style="display: flex; gap: 10px; align-items: flex-end;">
          <div style="flex: 1;">
            <label>Display / Hostname:</label>
            <input type="text" id="devHostname" value="${device.name}">
          </div>
          <button class="btn btn-secondary" id="btnUpdateHostname">Update Name</button>
        </div>
        ${isSwitch ? `
          <div style="margin: 12px 0; padding: 10px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 6px; font-size: 12px; color: #94a3b8;">
            💡 <strong>Switch Tip:</strong> Configure port VLANs &amp; Trunking here or use the <strong>CLI</strong> tab (<code>switchport mode trunk</code>, <code>switchport access vlan &lt;id&gt;</code>).
          </div>
        ` : ''}
        <h4 style="margin: 16px 0 8px 0; color: #38bdf8;">Interface Status List</h4>
        <table class="data-table">
          <thead>
            <tr>
              ${tableHeaders}
            </tr>
          </thead>
          <tbody>
            ${portRows}
          </tbody>
        </table>
      </div>
    `;

    if (isSwitch) {
      container.querySelectorAll('.port-mode-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const pName = e.target.dataset.port;
          const port = device.getInterface(pName);
          if (port) {
            device.setPortMode(pName, e.target.value);
            const vlanInput = container.querySelector(`.port-vlan-input[data-port="${pName}"]`);
            if (vlanInput) vlanInput.disabled = (e.target.value === 'trunk');
          }
        });
      });

      container.querySelectorAll('.port-vlan-input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const pName = e.target.dataset.port;
          const vId = parseInt(e.target.value, 10);
          if (!isNaN(vId)) {
            device.setPortAccessVlan(pName, vId);
          }
        });
      });
    }

    document.getElementById('btnUpdateHostname').addEventListener('click', () => {
      const newName = document.getElementById('devHostname').value.trim();
      if (newName) {
        device.name = newName;
        document.getElementById('deviceModalTitle').textContent = `${newName} (${device.type.toUpperCase()})`;
        if (this.canvas) this.canvas.draw();
        setTimeout(() => {
          this.deviceModal.close();
        }, 300);
      }
    });
  }

  openPortSelector(device, callback) {
    const listEl = document.getElementById('portList');
    listEl.innerHTML = '';

    device.interfaces.forEach(intf => {
      const btn = document.createElement('button');
      btn.className = `port-selector-btn ${intf.connectedCable ? 'port-busy' : 'port-available'}`;
      btn.innerHTML = `
        <span class="port-name">${intf.name}</span>
        <span class="port-status">${intf.connectedCable ? 'In Use' : 'Available'}</span>
      `;

      if (!intf.connectedCable) {
        btn.addEventListener('click', () => {
          this.portModal.close();
          callback(intf);
        });
      } else {
        btn.disabled = true;
      }

      listEl.appendChild(btn);
    });

    this.portModal.showModal();
  }

  openPDUInspector(packetItem) {
    const info = packetItem.pduInfo;
    const pduModalTitle = document.getElementById('pduModalTitle');
    pduModalTitle.textContent = `PDU Information at ${packetItem.dstPort.device.name} (${packetItem.label})`;

    const inLayersList = document.getElementById('pduInLayers');
    const detailsBox = document.getElementById('pduLayerDetails');

    inLayersList.innerHTML = '';
    detailsBox.innerHTML = '';

    info.inLayers.forEach((layerItem, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = `pdu-layer-item ${idx === 0 ? 'active' : ''}`;
      itemEl.innerHTML = `
        <div class="layer-badge">Layer ${layerItem.layer}</div>
        <div class="layer-title">${layerItem.name}</div>
        <div class="layer-short">${layerItem.short}</div>
      `;

      itemEl.addEventListener('click', () => {
        inLayersList.querySelectorAll('.pdu-layer-item').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        this.renderPduLayerDetails(detailsBox, layerItem);
      });

      inLayersList.appendChild(itemEl);
    });

    // Render first layer details by default
    if (info.inLayers.length > 0) {
      this.renderPduLayerDetails(detailsBox, info.inLayers[0]);
    }

    this.pduModal.showModal();
  }

  renderPduLayerDetails(container, layerItem) {
    container.innerHTML = `
      <div class="layer-detail-header">
        <h4>Layer ${layerItem.layer}: ${layerItem.name}</h4>
      </div>
      <ul class="layer-detail-list">
        ${layerItem.details.map(d => `<li>${d}</li>`).join('')}
      </ul>
    `;
  }
}

