/**
 * cli.js - Cisco IOS Command Line Interface (CLI) Parser & State Machine
 * Supports multi-level Cisco IOS context: 
 * User EXEC, Privileged EXEC, Global Config, Interface Config, VLAN Config, Sub-Interface Config
 */

import { IPUtils } from '../models/protocols.js';

export class CiscoCLI {
  constructor(device) {
    this.device = device;
    this.mode = 'USER_EXEC'; // 'USER_EXEC' | 'PRIV_EXEC' | 'GLOBAL_CONFIG' | 'IF_CONFIG' | 'VLAN_CONFIG' | 'SUBIF_CONFIG'
    this.currentInterface = null;
    this.currentVlan = null;
    this.history = [];
    this.historyIndex = -1;
  }

  getPrompt() {
    const hostname = this.device.name || (this.device.type === 'router' ? 'Router' : 'Switch');
    switch (this.mode) {
      case 'USER_EXEC':
        return `${hostname}>`;
      case 'PRIV_EXEC':
        return `${hostname}#`;
      case 'GLOBAL_CONFIG':
        return `${hostname}(config)#`;
      case 'IF_CONFIG':
        return `${hostname}(config-if)#`;
      case 'VLAN_CONFIG':
        return `${hostname}(config-vlan)#`;
      case 'SUBIF_CONFIG':
        return `${hostname}(config-subif)#`;
      default:
        return `${hostname}>`;
    }
  }

  execute(rawInput) {
    const trimmed = (rawInput || '').trim();
    if (!trimmed) return '';

    // Add to command history
    this.history.push(trimmed);
    this.historyIndex = this.history.length;

    // Handle Help / Question mark
    if (trimmed === '?' || trimmed.endsWith('?')) {
      return this.handleHelp(trimmed);
    }

    const tokens = trimmed.split(/\s+/);
    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    // Global navigation commands available across levels
    if (cmd === 'exit') {
      return this.handleExit();
    }
    if (cmd === 'end') {
      this.mode = 'PRIV_EXEC';
      this.currentInterface = null;
      this.currentVlan = null;
      return '';
    }

    switch (this.mode) {
      case 'USER_EXEC':
        return this.execUserMode(cmd, args, tokens);
      case 'PRIV_EXEC':
        return this.execPrivMode(cmd, args, tokens);
      case 'GLOBAL_CONFIG':
        return this.execGlobalConfig(cmd, args, tokens);
      case 'IF_CONFIG':
        return this.execInterfaceConfig(cmd, args, tokens);
      case 'VLAN_CONFIG':
        return this.execVlanConfig(cmd, args, tokens);
      case 'SUBIF_CONFIG':
        return this.execSubInterfaceConfig(cmd, args, tokens);
      default:
        return '% Unknown execution mode error.';
    }
  }

  handleExit() {
    switch (this.mode) {
      case 'SUBIF_CONFIG':
      case 'IF_CONFIG':
        this.mode = 'GLOBAL_CONFIG';
        this.currentInterface = null;
        return '';
      case 'VLAN_CONFIG':
        this.mode = 'GLOBAL_CONFIG';
        this.currentVlan = null;
        return '';
      case 'GLOBAL_CONFIG':
        this.mode = 'PRIV_EXEC';
        return '';
      case 'PRIV_EXEC':
        this.mode = 'USER_EXEC';
        return '';
      case 'USER_EXEC':
        return '';
      default:
        return '';
    }
  }

  execUserMode(cmd, args, tokens) {
    if (cmd === 'enable' || cmd === 'en') {
      this.mode = 'PRIV_EXEC';
      return '';
    }
    if (cmd === 'ping') {
      return this.handlePing(args);
    }
    if (cmd === 'show' || cmd === 'sh') {
      return this.handleShow(args);
    }
    if (cmd === 'help') {
      return this.handleHelp('');
    }
    return `% Invalid input detected at '^' marker.\n  ${cmd}\n  ^`;
  }

  execPrivMode(cmd, args, tokens) {
    if (cmd === 'disable') {
      this.mode = 'USER_EXEC';
      return '';
    }
    if (cmd === 'configure' || cmd === 'conf') {
      if (args[0] && (args[0].toLowerCase() === 'terminal' || args[0].toLowerCase() === 't')) {
        this.mode = 'GLOBAL_CONFIG';
        return 'Enter configuration commands, one per line.  End with CNTL/Z or exit.';
      }
      return '% Incomplete command. Use: configure terminal';
    }
    if (cmd === 'show' || cmd === 'sh') {
      return this.handleShow(args);
    }
    if (cmd === 'ping') {
      return this.handlePing(args);
    }
    if (cmd === 'write' || (cmd === 'copy' && args[0] === 'run')) {
      return 'Building configuration...\n[OK]';
    }
    return `% Invalid input detected at '^' marker.\n  ${cmd}\n  ^`;
  }

  execGlobalConfig(cmd, args, tokens) {
    if (cmd === 'hostname') {
      if (!args[0]) return '% Incomplete command.';
      this.device.name = args[0];
      if (globalThis.simEngine) globalThis.simEngine.notifyStateChange();
      return '';
    }

    // Switch VLAN creation: vlan <id>
    if (cmd === 'vlan') {
      if (this.device.type !== 'switch') {
        return '% VLAN configuration only supported on Switch.';
      }
      const vId = parseInt(args[0], 10);
      if (isNaN(vId) || vId < 1 || vId > 4094) {
        return '% Invalid VLAN ID (1-4094).';
      }
      try {
        this.currentVlan = this.device.createVlan(vId);
        this.mode = 'VLAN_CONFIG';
        return '';
      } catch (e) {
        return `% Error: ${e.message}`;
      }
    }

    if (cmd === 'no' && args[0] && args[0].toLowerCase() === 'vlan') {
      if (this.device.type !== 'switch') return '% VLAN configuration only supported on Switch.';
      const vId = parseInt(args[1], 10);
      if (isNaN(vId)) return '% Incomplete command. Usage: no vlan <id>';
      try {
        this.device.removeVlan(vId);
        return '';
      } catch (e) {
        return `% Error: ${e.message}`;
      }
    }

    // Interface configuration
    if (cmd === 'interface' || cmd === 'int') {
      if (!args[0]) return '% Incomplete command. Usage: interface <name>';
      const rawTarget = args[0];
      const targetName = this.normalizeInterfaceName(rawTarget);

      // Check if sub-interface on Router: e.g. GigabitEthernet0/0.10
      if (targetName.includes('.')) {
        if (this.device.type !== 'router') {
          return '% Sub-interfaces only supported on Router.';
        }
        try {
          const subIntf = this.device.getOrCreateSubInterface(targetName);
          this.currentInterface = subIntf;
          this.mode = 'SUBIF_CONFIG';
          return '';
        } catch (e) {
          return `% Error: ${e.message}`;
        }
      }

      const intf = this.device.getInterface(rawTarget) || 
                   this.device.getInterface(targetName) || 
                   this.device.interfaces.find(i => i.name.toLowerCase().includes(rawTarget.toLowerCase()));
      if (!intf) {
        return `% Invalid interface type or number: ${rawTarget}`;
      }
      this.currentInterface = intf;
      this.mode = 'IF_CONFIG';
      return '';
    }

    if (cmd === 'ip' && args[0] && args[0].toLowerCase() === 'route') {
      return this.handleIpRoute(args.slice(1), false);
    }

    if (cmd === 'no' && args[0] && args[0].toLowerCase() === 'ip' && args[1] && args[1].toLowerCase() === 'route') {
      return this.handleIpRoute(args.slice(2), true);
    }

    if (cmd === 'do') {
      const subCmd = args[0] ? args[0].toLowerCase() : '';
      const subArgs = args.slice(1);
      if (subCmd === 'show' || subCmd === 'sh') return this.handleShow(subArgs);
      if (subCmd === 'ping') return this.handlePing(subArgs);
      return '% Unrecognized "do" command.';
    }

    return `% Invalid input detected at '^' marker.`;
  }

  execVlanConfig(cmd, args, tokens) {
    if (!this.currentVlan) {
      this.mode = 'GLOBAL_CONFIG';
      return '% No active VLAN.';
    }

    if (cmd === 'name') {
      if (!args[0]) return '% Incomplete command. Usage: name <vlan-name>';
      this.currentVlan.name = args.join(' ');
      return '';
    }

    if (cmd === 'do') {
      const subCmd = args[0] ? args[0].toLowerCase() : '';
      const subArgs = args.slice(1);
      if (subCmd === 'show' || subCmd === 'sh') return this.handleShow(subArgs);
      if (subCmd === 'ping') return this.handlePing(subArgs);
      return '% Unrecognized "do" command.';
    }

    return `% Invalid input detected at '^' marker.`;
  }

  execSubInterfaceConfig(cmd, args, tokens) {
    if (!this.currentInterface || !this.currentInterface.isSubInterface) {
      this.mode = 'GLOBAL_CONFIG';
      return '% No active sub-interface.';
    }

    // encapsulation dot1Q <vlanId>
    if (cmd === 'encapsulation' || cmd === 'encap') {
      const type = (args[0] || '').toLowerCase();
      if (type !== 'dot1q') {
        return '% Only 802.1Q encapsulation is supported. Usage: encapsulation dot1Q <vlan_id>';
      }
      const vlanId = parseInt(args[1], 10);
      if (isNaN(vlanId) || vlanId < 1 || vlanId > 4094) {
        return '% Invalid VLAN ID (1-4094).';
      }
      this.currentInterface.encapsulation = 'dot1Q';
      this.currentInterface.vlanTag = vlanId;
      return '';
    }

    // ip address <ip> <mask >
    if (cmd === 'ip' && args[0] && args[0].toLowerCase() === 'address') {
      const ip = args[1];
      const mask = args[2];
      if (!ip || !mask) return '% Incomplete command. Usage: ip address <ip> <subnet_mask>';
      if (!IPUtils.isValidIp(ip)) return '% Invalid IP address.';
      if (!IPUtils.isValidMask(mask)) return '% Invalid Subnet Mask.';

      try {
        this.currentInterface.setIP(ip, mask);
        return '';
      } catch (e) {
        return `% Error: ${e.message}`;
      }
    }

    if (cmd === 'no') {
      const sub = args[0] ? args[0].toLowerCase() : '';
      if (sub === 'shutdown' || sub === 'shut') {
        this.currentInterface.adminUp = true;
        if (this.device.onInterfaceConfigChange) this.device.onInterfaceConfigChange(this.currentInterface);
        return `\n%LINK-5-CHANGED: Interface ${this.currentInterface.name}, changed state to up`;
      }
      if (sub === 'ip' && args[1] && args[1].toLowerCase() === 'address') {
        this.currentInterface.ip = null;
        this.currentInterface.subnetMask = null;
        if (this.device.onInterfaceConfigChange) this.device.onInterfaceConfigChange(this.currentInterface);
        return '';
      }
    }

    if (cmd === 'shutdown' || cmd === 'shut') {
      this.currentInterface.adminUp = false;
      if (this.device.onInterfaceConfigChange) this.device.onInterfaceConfigChange(this.currentInterface);
      return `\n%LINK-5-CHANGED: Interface ${this.currentInterface.name}, changed state to administratively down`;
    }

    if (cmd === 'do') {
      const subCmd = args[0] ? args[0].toLowerCase() : '';
      const subArgs = args.slice(1);
      if (subCmd === 'show' || subCmd === 'sh') return this.handleShow(subArgs);
      if (subCmd === 'ping') return this.handlePing(subArgs);
      return '% Unrecognized command.';
    }

    return `% Invalid input detected at '^' marker.`;
  }

  execInterfaceConfig(cmd, args, tokens) {
    if (!this.currentInterface) {
      this.mode = 'GLOBAL_CONFIG';
      return '% No active interface.';
    }

    // Switchport commands on Switch
    if (cmd === 'switchport' || cmd === 'sw') {
      if (this.device.type !== 'switch') {
        return '% Switchport commands only supported on Switch.';
      }
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'mode') {
        const modeVal = (args[1] || '').toLowerCase();
        if (modeVal === 'access' || modeVal === 'trunk') {
          this.device.setPortMode(this.currentInterface.name, modeVal);
          return '';
        }
        return '% Incomplete command. Usage: switchport mode [access | trunk]';
      }
      if (sub === 'access') {
        if (args[1] && args[1].toLowerCase() === 'vlan') {
          const vlanId = parseInt(args[2], 10);
          if (isNaN(vlanId)) return '% Incomplete command. Usage: switchport access vlan <id>';
          try {
            this.device.setPortAccessVlan(this.currentInterface.name, vlanId);
            return '';
          } catch (e) {
            return `% Error: ${e.message}`;
          }
        }
      }
      if (sub === 'trunk') {
        const sub2 = (args[1] || '').toLowerCase();
        if (sub2 === 'native' && args[2] && args[2].toLowerCase() === 'vlan') {
          const vlanId = parseInt(args[3], 10);
          if (isNaN(vlanId)) return '% Incomplete command. Usage: switchport trunk native vlan <id>';
          this.currentInterface.nativeVlan = vlanId;
          return '';
        }
        if (sub2 === 'allowed' && args[2] && args[2].toLowerCase() === 'vlan') {
          this.currentInterface.allowedVlans = 'ALL';
          return '';
        }
      }
      return '% Unrecognized switchport command.';
    }

    // IP address on Router or L3 port
    if (cmd === 'ip' && args[0] && args[0].toLowerCase() === 'address') {
      const ip = args[1];
      const mask = args[2];
      if (!ip || !mask) return '% Incomplete command. Usage: ip address <ip> <subnet_mask>';
      if (!IPUtils.isValidIp(ip)) return '% Invalid IP address.';
      if (!IPUtils.isValidMask(mask)) return '% Invalid Subnet Mask.';

      try {
        this.currentInterface.setIP(ip, mask);
        return '';
      } catch (e) {
        return `% Error: ${e.message}`;
      }
    }

    if (cmd === 'no') {
      const sub = args[0] ? args[0].toLowerCase() : '';
      if (sub === 'shutdown' || sub === 'shut') {
        this.currentInterface.adminUp = true;
        if (this.device.onInterfaceConfigChange) this.device.onInterfaceConfigChange(this.currentInterface);
        return `\n%LINK-5-CHANGED: Interface ${this.currentInterface.name}, changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${this.currentInterface.name}, changed state to up`;
      }
      if (sub === 'ip' && args[1] && args[1].toLowerCase() === 'address') {
        this.currentInterface.ip = null;
        this.currentInterface.subnetMask = null;
        if (this.device.onInterfaceConfigChange) this.device.onInterfaceConfigChange(this.currentInterface);
        return '';
      }
    }

    if (cmd === 'shutdown' || cmd === 'shut') {
      this.currentInterface.adminUp = false;
      if (this.device.onInterfaceConfigChange) this.device.onInterfaceConfigChange(this.currentInterface);
      return `\n%LINK-5-CHANGED: Interface ${this.currentInterface.name}, changed state to administratively down\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${this.currentInterface.name}, changed state to down`;
    }

    if (cmd === 'do') {
      const subCmd = args[0] ? args[0].toLowerCase() : '';
      const subArgs = args.slice(1);
      if (subCmd === 'show' || subCmd === 'sh') return this.handleShow(subArgs);
      if (subCmd === 'ping') return this.handlePing(subArgs);
      return '% Unrecognized command.';
    }

    return `% Invalid input detected at '^' marker.`;
  }

  handleIpRoute(args, isNo) {
    if (this.device.type !== 'router') {
      return '% IP routing configuration only supported on Router.';
    }
    if (args.length < 3) {
      return '% Incomplete command. Usage: ip route <network> <mask > <next-hop|exit-interface>';
    }
    const [network, mask, nextHop] = args;
    if (isNo) {
      this.device.removeStaticRoute(network, mask);
      return '';
    } else {
      try {
        this.device.addStaticRoute(network, mask, nextHop);
        return '';
      } catch (e) {
        return `% Error: ${e.message}`;
      }
    }
  }

  handleShow(args) {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'ip') {
      const sub2 = (args[1] || '').toLowerCase();
      if (sub2 === 'interface' || sub2 === 'int') {
        return this.showIpInterfaceBrief();
      }
      if (sub2 === 'route' || sub2 === 'ro') {
        return this.showIpRoute();
      }
      if (sub2 === 'arp') {
        return this.showArp();
      }
    }

    if (sub === 'vlan' || sub === 'vl') {
      return this.showVlanBrief();
    }

    if (sub === 'interfaces' || sub === 'interface' || sub === 'int') {
      const sub2 = (args[1] || '').toLowerCase();
      if (sub2 === 'trunk' || sub2 === 'tr') {
        return this.showInterfacesTrunk();
      }
    }

    if (sub === 'mac' || sub === 'mac-address-table') {
      return this.showMacAddressTable();
    }

    if (sub === 'spanning-tree' || sub === 'span' || sub === 'stp') {
      return this.showSpanningTree();
    }

    if (sub === 'arp') {
      return this.showArp();
    }

    if (sub === 'running-config' || sub === 'run') {
      return this.showRunningConfig();
    }

    return '% Incomplete or unrecognized show command.';
  }

  showIpInterfaceBrief() {
    let out = 'Interface              IP-Address      OK? Method Status                Protocol\n';
    const allPorts = [...this.device.interfaces, ...(this.device.subInterfaces || [])];
    allPorts.forEach(intf => {
      const name = intf.name.padEnd(22, ' ');
      const ip = (intf.ip || 'unassigned').padEnd(16, ' ');
      const ok = 'YES ';
      const method = 'manual  ';
      const status = intf.adminUp 
        ? (intf.isUp ? 'up                    ' : 'down                  ') 
        : 'administratively down ';
      const proto = intf.isUp ? 'up' : 'down';
      out += `${name}${ip}${ok}${method}${status}${proto}\n`;
    });
    return out;
  }

  showVlanBrief() {
    if (this.device.type !== 'switch') {
      return '% VLAN table only available on Switch.';
    }
    let out = 'VLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n';
    this.device.vlans.forEach(v => {
      const idStr = v.id.toString().padEnd(4, ' ');
      const nameStr = v.name.padEnd(32, ' ');
      const statusStr = 'active   ';
      const ports = this.device.interfaces
        .filter(p => p.mode === 'access' && p.vlan === v.id)
        .map(p => p.name)
        .join(', ');
      out += `${idStr} ${nameStr} ${statusStr} ${ports}\n`;
    });
    return out;
  }

  showInterfacesTrunk() {
    if (this.device.type !== 'switch') {
      return '% Trunk table only available on Switch.';
    }
    let out = 'Port        Mode         Encapsulation  Status        Native vlan\n';
    const trunks = this.device.interfaces.filter(p => p.mode === 'trunk');
    if (trunks.length === 0) {
      return out + '% No trunk ports configured.\n';
    }
    trunks.forEach(p => {
      const name = p.name.padEnd(11, ' ');
      const mode = 'on         ';
      const encap = '802.1q         ';
      const status = p.isUp ? 'trunking      ' : 'not-trunking  ';
      const native = String(p.nativeVlan || 1);
      out += `${name} ${mode} ${encap} ${status} ${native}\n`;
    });
    out += '\nPort        Vlans allowed on trunk\n';
    trunks.forEach(p => {
      out += `${p.name.padEnd(11, ' ')} 1-4094\n`;
    });
    return out;
  }

  showIpRoute() {
    if (this.device.type !== 'router') {
      return '% IP routing table only available on Router.';
    }
    let out = 'Codes: L - local, C - connected, S - static, R - RIP, O - OSPF\n\nGateway of last resort is not set\n\n';
    if (!this.device.routingTable || this.device.routingTable.length === 0) {
      return out + '% No routes in routing table.';
    }

    this.device.routingTable.forEach(r => {
      const cidr = IPUtils.maskToCidr(r.mask);
      if (r.type === 'C') {
        out += `C    ${r.network}/${cidr} is directly connected, ${r.exitInterface}\n`;
      } else if (r.type === 'S') {
        const via = r.nextHop && r.nextHop !== '0.0.0.0' ? `via ${r.nextHop}` : `is directly connected, ${r.exitInterface}`;
        out += `S    ${r.network}/${cidr} [1/0] ${via}\n`;
      }
    });
    return out;
  }

  showMacAddressTable() {
    if (this.device.type !== 'switch') {
      return '% MAC Address Table only supported on Switch.';
    }
    let out = '          Mac Address Table\n-------------------------------------------\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n';
    if (!this.device.macTable || this.device.macTable.size === 0) {
      return out + 'Total Mac Addresses for this criterion: 0';
    }

    let count = 0;
    this.device.macTable.forEach((val) => {
      count++;
      const vlanStr = (val.vlan ? val.vlan.toString() : '1').padEnd(7, ' ');
      const macStr = (val.mac || '').padEnd(18, ' ');
      const type = 'DYNAMIC     ';
      const port = val.portName;
      out += `${vlanStr}${macStr}${type}${port}\n`;
    });
    out += `Total Mac Addresses for this criterion: ${count}`;
    return out;
  }

  showSpanningTree() {
    if (this.device.type !== 'switch') {
      return '% Spanning-tree information only available on Switch.';
    }
    const isRoot = this.device.stpRootId === this.device.id || !this.device.stpRootId;
    const bridgeMac = this.device.interfaces[0]?.mac || '00:00:00:00:00:00';
    let out = `Spanning tree enabled protocol ieee (802.1D)\n`;
    out += `  Bridge ID  Priority  ${this.device.stpPriority || 32768}  Address ${bridgeMac}\n`;
    if (isRoot) out += `             This bridge is the root\n`;
    out += `\nInterface        Role Sts Cost      Type\n---------------- ---- --- --------- --------\n`;
    const activePorts = this.device.interfaces.filter(p => p.isUp);
    if (activePorts.length === 0) {
      return out + '% No active switchports.\n';
    }
    activePorts.forEach(p => {
      const role = p.stpRole === 'ROOT' ? 'Root' : (p.stpRole === 'ALT' ? 'Altn' : 'Desg');
      const sts = p.stpState === 'BLK' ? 'BLK' : 'FWD';
      out += `${p.name.padEnd(16, ' ')} ${role.padEnd(4, ' ')} ${sts.padEnd(3, ' ')} 19        P2p\n`;
    });
    return out;
  }

  showArp() {
    let out = 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n';
    if (this.device.arpTable) {
      this.device.arpTable.forEach((val, ip) => {
        out += `Internet  ${ip.padEnd(17, ' ')} -          ${val.mac}  ARPA   FastEthernet0/0\n`;
      });
    }
    return out;
  }

  showRunningConfig() {
    let out = `!\nversion 15.1\nservice timestamps log datetime msec\nno service password-encryption\n!\nhostname ${this.device.name}\n!\n`;
    
    // Switch VLANs
    if (this.device.type === 'switch' && this.device.vlans) {
      this.device.vlans.forEach(v => {
        if (v.id !== 1) {
          out += `vlan ${v.id}\n name ${v.name}\n!\n`;
        }
      });
    }

    // Physical Interfaces
    this.device.interfaces.forEach(intf => {
      out += `interface ${intf.name}\n`;
      if (this.device.type === 'switch') {
        out += ` switchport mode ${intf.mode}\n`;
        if (intf.mode === 'access') {
          out += ` switchport access vlan ${intf.vlan}\n`;
        } else if (intf.mode === 'trunk') {
          out += ` switchport trunk native vlan ${intf.nativeVlan}\n`;
        }
      } else {
        if (intf.ip && intf.subnetMask) {
          out += ` ip address ${intf.ip} ${intf.subnetMask}\n`;
        } else {
          out += ` no ip address\n`;
        }
      }
      out += intf.adminUp ? ` no shutdown\n!\n` : ` shutdown\n!\n`;
    });

    // Router Sub-interfaces
    if (this.device.type === 'router' && this.device.subInterfaces) {
      this.device.subInterfaces.forEach(sub => {
        out += `interface ${sub.name}\n`;
        if (sub.encapsulation === 'dot1Q') {
          out += ` encapsulation dot1Q ${sub.vlanTag}\n`;
        }
        if (sub.ip && sub.subnetMask) {
          out += ` ip address ${sub.ip} ${sub.subnetMask}\n`;
        }
        out += sub.adminUp ? ` no shutdown\n!\n` : ` shutdown\n!\n`;
      });
    }

    if (this.device.routingTable) {
      this.device.routingTable.filter(r => r.type === 'S').forEach(r => {
        out += `ip route ${r.network} ${r.mask} ${r.nextHop || r.exitInterface}\n`;
      });
    }
    out += 'end\n';
    return out;
  }

  handlePing(args) {
    if (!args[0]) return '% Incomplete command. Usage: ping <target-ip>';
    const target = args[0];
    if (!IPUtils.isValidIp(target)) return '% Invalid destination IP address.';

    const sourceIntf = this.device.interfaces.find(i => i.isUp && i.ip);
    if (!sourceIntf) {
      return '% No active IP interface available to ping from.';
    }

    return `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:\n!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms`;
  }

  normalizeInterfaceName(str) {
    const s = str.toLowerCase();
    const match = str.match(/\d+[\/\d]*(\.\d+)?/);
    const numPart = match ? match[0] : '';
    if (s.startsWith('fa') || s.startsWith('fast')) {
      return numPart ? `FastEthernet${numPart}` : str;
    }
    if (s.startsWith('gi') || s.startsWith('gig') || s.startsWith('g')) {
      return numPart ? `GigabitEthernet${numPart}` : str;
    }
    return str;
  }

  handleHelp(input) {
    switch (this.mode) {
      case 'USER_EXEC':
        return 'Exec commands:\n  enable      Turn on privileged commands\n  ping        Send echo messages\n  show        Show running system information\n  exit        Exit from the EXEC';
      case 'PRIV_EXEC':
        return 'Privileged commands:\n  configure   Enter configuration mode\n  disable     Turn off privileged commands\n  ping        Send echo messages\n  show        Show running system information\n  write       Save configuration\n  exit        Exit from the EXEC';
      case 'GLOBAL_CONFIG':
        return 'Configure commands:\n  hostname    Set system\'s network name\n  interface   Select an interface or sub-interface to configure\n  vlan        Configure VLAN parameters (Switch)\n  ip route    Establish static routes\n  do          To run an EXEC command in configuration mode\n  exit        Exit from configure mode\n  end         Exit to privileged EXEC mode';
      case 'IF_CONFIG':
        return 'Interface configuration commands:\n  ip address  Set IP address\n  switchport  Set switching characteristics of the Layer 2 port\n  shutdown    Shutdown the selected interface\n  no          Negate a command or set its defaults\n  exit        Exit from interface configuration mode';
      case 'VLAN_CONFIG':
        return 'VLAN configuration commands:\n  name        Ascii name of the VLAN\n  exit        Apply changes and exit to global configuration';
      case 'SUBIF_CONFIG':
        return 'Sub-interface configuration commands:\n  encapsulation  Set encapsulation type (e.g. dot1Q <vlan>)\n  ip address     Set IP address and subnet mask\n  no shutdown    Enable interface\n  exit           Exit from sub-interface configuration mode';
      default:
        return 'Help is not available for this mode.';
    }
  }

  autocomplete(currentInput) {
    const trimmed = currentInput.trim();
    const suggestions = {
      USER_EXEC: ['enable', 'ping', 'show ip interface brief', 'show arp', 'exit', 'help'],
      PRIV_EXEC: ['configure terminal', 'disable', 'ping', 'show ip interface brief', 'show ip route', 'show mac address-table', 'show vlan brief', 'show interfaces trunk', 'show running-config', 'write memory', 'exit'],
      GLOBAL_CONFIG: ['hostname', 'interface', 'vlan', 'ip route', 'do show', 'exit', 'end'],
      IF_CONFIG: ['ip address', 'switchport mode access', 'switchport mode trunk', 'switchport access vlan', 'no shutdown', 'shutdown', 'no ip address', 'exit', 'end'],
      VLAN_CONFIG: ['name', 'exit', 'end'],
      SUBIF_CONFIG: ['encapsulation dot1Q', 'ip address', 'no shutdown', 'shutdown', 'exit', 'end']
    };

    const list = suggestions[this.mode] || [];
    const match = list.find(cmd => cmd.startsWith(trimmed.toLowerCase()));
    return match || currentInput;
  }
}
