/**
 * device.js - Core Network Device Models (Host/PC, Switch, Router)
 * Implements complete L2 Switching, L3 Routing, ARP, ICMP, and Interface State
 */

import { IPUtils, EthernetFrame, ARPPacket, IPv4Packet, ICMPPacket, UDPPacket, DHCPMessage, DNSMessage, TCPSegment, HTTPMessage } from './protocols.js';

/**
 * Physical Network Interface (Port)
 */
export class NetworkInterface {
  constructor(name, device, defaultMac = null) {
    this.id = 'intf_' + Math.random().toString(36).substr(2, 9);
    this.name = name; // e.g. "FastEthernet0/1" or "GigabitEthernet0/0"
    this.device = device;
    this.mac = defaultMac || IPUtils.generateRandomMac();
    this.ip = null;
    this.subnetMask = null;
    this.adminUp = true; // administratively up / shutdown
    this.connectedCable = null;
    this.duplex = 'Auto';
    this.speed = 'Auto';

    // VLAN & Switchport attributes
    this.vlan = 1; // Access VLAN
    this.mode = 'access'; // 'access' | 'trunk'
    this.nativeVlan = 1; // Native VLAN on trunk
    this.allowedVlans = 'ALL'; // 'ALL' or Array of numbers

    // Sub-interface attributes (Router-on-a-stick)
    this.isSubInterface = false;
    this.parentInterface = null;
    this.vlanTag = null;
    this.encapsulation = null; // 'dot1Q'
  }

  get isUp() {
    if (this.isSubInterface) {
      return this.adminUp && this.parentInterface !== null && this.parentInterface.isUp;
    }
    return this.adminUp && this.connectedCable !== null && this.getPeer() !== null && this.getPeer().adminUp;
  }

  getPeer() {
    if (this.isSubInterface) {
      return this.parentInterface ? this.parentInterface.getPeer() : null;
    }
    if (!this.connectedCable) return null;
    return this.connectedCable.interfaceA === this 
      ? this.connectedCable.interfaceB 
      : this.connectedCable.interfaceA;
  }

  setIP(ip, mask) {
    if (ip && !IPUtils.isValidIp(ip)) throw new Error('Invalid IP address: ' + ip);
    if (mask && !IPUtils.isValidMask(mask)) throw new Error('Invalid Subnet Mask: ' + mask);
    this.ip = ip;
    this.subnetMask = mask;
    if (this.device && typeof this.device.onInterfaceConfigChange === 'function') {
      this.device.onInterfaceConfigChange(this);
    }
  }

  sendFrame(frame) {
    if (this.isSubInterface) {
      if (!this.isUp || !this.parentInterface) return false;
      if (this.encapsulation === 'dot1Q' && this.vlanTag !== null && this.vlanTag !== undefined) {
        frame.vlanTag = this.vlanTag;
      }
      return this.parentInterface.sendFrame(frame);
    }
    if (!this.isUp || !this.connectedCable) return false;
    if (globalThis.simEngine) {
      globalThis.simEngine.enqueueTransmission(this, this.getPeer(), frame);
      return true;
    }
    return false;
  }

  receiveFrame(frame) {
    if (this.device && typeof this.device.onFrameReceived === 'function') {
      this.device.onFrameReceived(this, frame);
    }
  }
}

/**
 * Cable (Media Connection)
 */
export class Cable {
  constructor(interfaceA, interfaceB, type = 'straight') {
    this.id = 'cable_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'straight' | 'crossover' | 'fiber'
    this.interfaceA = interfaceA;
    this.interfaceB = interfaceB;

    interfaceA.connectedCable = this;
    interfaceB.connectedCable = this;

    if (interfaceA.device && typeof interfaceA.device.onInterfaceConfigChange === 'function') {
      interfaceA.device.onInterfaceConfigChange(interfaceA);
    }
    if (interfaceB.device && typeof interfaceB.device.onInterfaceConfigChange === 'function') {
      interfaceB.device.onInterfaceConfigChange(interfaceB);
    }
  }

  disconnect() {
    if (this.interfaceA) {
      this.interfaceA.connectedCable = null;
      if (this.interfaceA.device) this.interfaceA.device.onInterfaceConfigChange(this.interfaceA);
    }
    if (this.interfaceB) {
      this.interfaceB.connectedCable = null;
      if (this.interfaceB.device) this.interfaceB.device.onInterfaceConfigChange(this.interfaceB);
    }
    this.interfaceA = null;
    this.interfaceB = null;
  }
}

/**
 * Base Device
 */
export class Device {
  constructor(id, name, type, x = 100, y = 100) {
    this.id = id || 'dev_' + Math.random().toString(36).substr(2, 9);
    this.name = name;
    this.type = type; // 'pc' | 'laptop' | 'server' | 'switch' | 'router'
    this.x = x;
    this.y = y;
    this.interfaces = [];
    this.logs = [];
    this.customData = {};
  }

  addInterface(name, mac = null) {
    const intf = new NetworkInterface(name, this, mac);
    this.interfaces.push(intf);
    return intf;
  }

  getInterface(name) {
    if (!name) return null;
    const clean = name.toLowerCase().replace(/\s+/g, '');
    
    // 1. Direct match
    const exact = this.interfaces.find(i => i.name.toLowerCase() === clean);
    if (exact) return exact;

    // 2. Flexible match (e.g. Fa0/1 vs FastEthernet0/1 or Gi0/0 vs GigabitEthernet0/0)
    const numMatch = clean.match(/(\d+[\/\d]*(\.\d+)?)/);
    if (numMatch) {
      const num = numMatch[1];
      if (clean.startsWith('fa') || clean.startsWith('fast')) {
        const found = this.interfaces.find(i => {
          const iname = i.name.toLowerCase();
          return iname === `fa${num}` || iname === `fa0/${num}` || iname === `fastethernet${num}` || iname === `fastethernet0/${num}`;
        });
        if (found) return found;
      }
      if (clean.startsWith('gi') || clean.startsWith('gig') || clean.startsWith('g')) {
        const found = this.interfaces.find(i => {
          const iname = i.name.toLowerCase();
          return iname === `gi${num}` || iname === `g${num}` || iname === `gigabitethernet${num}`;
        });
        if (found) return found;
      }
    }

    return null;
  }

  getFirstUpInterface() {
    return this.interfaces.find(i => i.isUp);
  }

  log(msg, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), msg, level };
    this.logs.unshift(entry);
    if (this.logs.length > 200) this.logs.pop();
    if (globalThis.simEngine) globalThis.simEngine.emitLog(this, entry);
  }

  onInterfaceConfigChange(intf) {
    // Override in subclasses
  }

  onFrameReceived(inPort, frame) {
    // Override in subclasses
  }
}

/**
 * Host Device (PC, Laptop, Server)
 */
export class HostDevice extends Device {
  constructor(id, name, type = 'pc', x = 100, y = 100) {
    super(id, name, type, x, y);
    this.defaultGateway = null;
    this.dnsServer = null;
    this.ipMode = 'STATIC'; // 'STATIC' | 'DHCP'
    this.arpTable = new Map(); // IP -> { mac, timestamp }
    this.pendingPackets = new Map(); // nextHopIp -> Array<{ frame, callback }>
    this.pingSession = null;
    this.dhcpPending = null;
    this.dnsPending = new Map();
    this.httpSessions = new Map();

    // Default primary port
    this.addInterface('FastEthernet0');
  }

  get primaryInterface() {
    return this.interfaces[0];
  }

  get ip() {
    return this.primaryInterface ? this.primaryInterface.ip : null;
  }

  get subnetMask() {
    return this.primaryInterface ? this.primaryInterface.subnetMask : null;
  }

  setIPConfig(ip, subnetMask, defaultGateway = null, dnsServer = null) {
    this.ipMode = 'STATIC';
    this.primaryInterface.setIP(ip, subnetMask);
    if (defaultGateway && !IPUtils.isValidIp(defaultGateway)) throw new Error('Invalid Default Gateway: ' + defaultGateway);
    if (dnsServer && !IPUtils.isValidIp(dnsServer)) throw new Error('Invalid DNS Server: ' + dnsServer);
    this.defaultGateway = defaultGateway;
    this.dnsServer = dnsServer;
    this.log(`Configured IP: ${ip}/${subnetMask}, Gateway: ${defaultGateway || 'None'}`);
  }

  requestDHCP(callback) {
    this.ipMode = 'DHCP';
    const outPort = this.primaryInterface;
    if (!outPort.isUp) {
      if (callback) callback(false, 'FastEthernet0 interface is down.');
      return;
    }

    const xid = Math.floor(Math.random() * 0xFFFFFF);
    this.log(`Initiating DHCP Discover (xid: 0x${xid.toString(16).toUpperCase()})...`);

    this.dhcpPending = {
      xid,
      timer: setTimeout(() => {
        if (this.dhcpPending && this.dhcpPending.xid === xid) {
          this.log('DHCP Request timed out. Assigning APIPA (169.254.x.x)...', 'warn');
          const apipaIp = `169.254.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
          this.primaryInterface.setIP(apipaIp, '255.255.0.0');
          this.defaultGateway = null;
          this.dnsServer = null;
          if (callback) callback(false, 'DHCP failed. APIPA is being used.');
          this.dhcpPending = null;
        }
      }, 5000),
      callback
    };

    // Construct DHCP Discover
    const myMac = outPort.mac.toUpperCase();
    const dhcpDiscover = new DHCPMessage('DISCOVER', xid, '0.0.0.0', '0.0.0.0', myMac);
    const udp = new UDPPacket(68, 67, dhcpDiscover);
    const ip = new IPv4Packet('0.0.0.0', '255.255.255.255', 'UDP', udp, 128);
    const frame = new EthernetFrame(myMac, 'FF:FF:FF:FF:FF:FF', 'IPv4', ip);
    outPort.sendFrame(frame);
  }

  handleIPv4(inPort, ipPacket) {
    const isBroadcast = ipPacket.dstIp === '255.255.255.255';
    if (ipPacket.dstIp !== inPort.ip && !isBroadcast) {
      return; // Not addressed to this host
    }

    if (ipPacket.protocol === 'ICMP' && ipPacket.payload) {
      this.handleICMP(inPort, ipPacket, ipPacket.payload);
    } else if (ipPacket.protocol === 'UDP' && ipPacket.payload) {
      this.handleUDP(inPort, ipPacket, ipPacket.payload);
    } else if (ipPacket.protocol === 'TCP' && ipPacket.payload) {
      this.handleTCP(inPort, ipPacket, ipPacket.payload);
    }
  }

  handleICMP(inPort, ipPacket, icmp) {
    if (icmp.type === 'ECHO_REQUEST') {
      this.log(`Received ICMP Echo Request from ${ipPacket.srcIp}`);
      const replyIcmp = new ICMPPacket('ECHO_REPLY', icmp.identifier, icmp.sequenceNumber, icmp.data);
      const replyIp = new IPv4Packet(inPort.ip, ipPacket.srcIp, 'ICMP', replyIcmp, 128);
      this.sendIPv4Packet(inPort, replyIp);
    } else if (icmp.type === 'ECHO_REPLY') {
      this.log(`Received ICMP Echo Reply from ${ipPacket.srcIp} seq=${icmp.sequenceNumber} ttl=${ipPacket.ttl}`);
      if (this.pingSession && typeof this.pingSession.onReply === 'function') {
        this.pingSession.onReply({
          srcIp: ipPacket.srcIp,
          seq: icmp.sequenceNumber,
          bytes: icmp.data ? icmp.data.length + 8 : 32,
          ttl: ipPacket.ttl,
          time: Math.floor(Math.random() * 6) + 1
        });
      }
    } else if (icmp.type === 'TIME_EXCEEDED' || icmp.type === 'DEST_UNREACHABLE') {
      this.log(`ICMP Error from ${ipPacket.srcIp}: ${icmp.type}`);
      if (this.pingSession && typeof this.pingSession.onError === 'function') {
        this.pingSession.onError({
          srcIp: ipPacket.srcIp,
          type: icmp.type,
          seq: icmp.sequenceNumber
        });
      }
    }
  }

  handleUDP(inPort, ipPacket, udp) {
    if (udp.dstPort === 68 && udp.payload instanceof DHCPMessage) {
      // Client DHCP Response handling
      this.handleDHCPClient(inPort, ipPacket, udp.payload);
    } else if (udp.dstPort >= 1024 && udp.payload instanceof DNSMessage) {
      // Client DNS Response handling
      this.handleDNSClient(inPort, ipPacket, udp.payload);
    }
  }

  handleDHCPClient(inPort, ipPacket, dhcpMsg) {
    if (!this.dhcpPending || this.dhcpPending.xid !== dhcpMsg.xid) return;

    if (dhcpMsg.type === 'OFFER') {
      this.log(`Received DHCP Offer: ${dhcpMsg.yiaddr} from server ${ipPacket.srcIp}`);
      // Send DHCP Request
      const myMac = inPort.mac.toUpperCase();
      const dhcpReq = new DHCPMessage('REQUEST', dhcpMsg.xid, dhcpMsg.yiaddr, ipPacket.srcIp, myMac, dhcpMsg.options);
      const udp = new UDPPacket(68, 67, dhcpReq);
      const ip = new IPv4Packet('0.0.0.0', '255.255.255.255', 'UDP', udp, 128);
      const frame = new EthernetFrame(myMac, 'FF:FF:FF:FF:FF:FF', 'IPv4', ip);
      inPort.sendFrame(frame);
    } else if (dhcpMsg.type === 'ACK') {
      clearTimeout(this.dhcpPending.timer);
      this.log(`Received DHCP ACK for IP ${dhcpMsg.yiaddr}!`);

      inPort.setIP(dhcpMsg.yiaddr, dhcpMsg.options.subnetMask || '255.255.255.0');
      this.defaultGateway = dhcpMsg.options.router || null;
      this.dnsServer = dhcpMsg.options.dns || null;

      if (this.dhcpPending.callback) {
        this.dhcpPending.callback(true, {
          ip: dhcpMsg.yiaddr,
          mask: dhcpMsg.options.subnetMask,
          gateway: this.defaultGateway,
          dns: this.dnsServer
        });
      }
      this.dhcpPending = null;
    }
  }

  handleDNSClient(inPort, ipPacket, dnsMsg) {
    if (this.dnsPending.has(dnsMsg.txId)) {
      const entry = this.dnsPending.get(dnsMsg.txId);
      this.dnsPending.delete(dnsMsg.txId);
      clearTimeout(entry.timer);

      if (dnsMsg.answers && dnsMsg.answers.length > 0) {
        const resolvedIp = dnsMsg.answers[0].ip;
        this.log(`DNS Resolved: ${entry.domain} -> ${resolvedIp}`);
        entry.callback(true, resolvedIp);
      } else {
        this.log(`DNS Resolution failed: domain not found (${entry.domain})`, 'warn');
        entry.callback(false, `Cannot resolve host ${entry.domain}`);
      }
    }
  }

  handleTCP(inPort, ipPacket, tcp) {
    const sessionKey = `${ipPacket.srcIp}:${tcp.srcPort}`;
    if (this.httpSessions.has(sessionKey)) {
      const sess = this.httpSessions.get(sessionKey);

      if (tcp.flags.includes('SYN') && tcp.flags.includes('ACK')) {
        // TCP 3-Way Handshake Step 2 -> Send ACK + HTTP GET
        this.log(`TCP Handshake connected with ${ipPacket.srcIp}:80. Sending HTTP GET ${sess.path}...`);
        const httpReq = new HTTPMessage('REQUEST', 'GET', sess.path, { Host: sess.host });
        const tcpGet = new TCPSegment(sess.clientPort, 80, 'PSH, ACK', 1, tcp.seq + 1, httpReq);
        const ip = new IPv4Packet(inPort.ip, ipPacket.srcIp, 'TCP', tcpGet, 128);
        this.sendIPv4Packet(inPort, ip);
      } else if (tcp.payload instanceof HTTPMessage) {
        // HTTP Response received!
        clearTimeout(sess.timer);
        this.httpSessions.delete(sessionKey);
        this.log(`HTTP ${tcp.payload.status} ${tcp.payload.statusText} received from ${ipPacket.srcIp}`);
        if (sess.callback) {
          sess.callback(true, tcp.payload);
        }
      }
    }
  }

  resolveDNS(domain, callback) {
    if (IPUtils.isValidIp(domain)) {
      callback(true, domain);
      return;
    }

    if (!this.dnsServer) {
      this.log('DNS Lookup error: No DNS server configured on this host.', 'error');
      callback(false, 'DNS Server not configured.');
      return;
    }

    const txId = Math.floor(Math.random() * 65535);
    const dnsQuery = new DNSMessage('QUERY', txId, { name: domain.toLowerCase(), type: 'A' });
    const udp = new UDPPacket(49152 + Math.floor(Math.random() * 10000), 53, dnsQuery);
    const ip = new IPv4Packet(this.ip, this.dnsServer, 'UDP', udp, 128);

    const timer = setTimeout(() => {
      if (this.dnsPending.has(txId)) {
        this.dnsPending.delete(txId);
        this.log(`DNS Request timed out for ${domain}`, 'warn');
        callback(false, 'DNS Request timed out.');
      }
    }, 4000);

    this.dnsPending.set(txId, { domain, timer, callback });
    this.sendIPv4Packet(this.primaryInterface, ip);
  }

  fetchWebPage(rawUrl, callback) {
    let url = rawUrl.trim();
    if (url.startsWith('http://')) url = url.substring(7);
    const slashIdx = url.indexOf('/');
    const host = slashIdx >= 0 ? url.substring(0, slashIdx) : url;
    const path = slashIdx >= 0 ? url.substring(slashIdx) : '/';

    this.log(`Web Browser: Navigating to http://${host}${path}...`);

    this.resolveDNS(host, (success, result) => {
      if (!success) {
        callback(false, `<h3>Web Browser Error</h3><p>${result}</p>`);
        return;
      }

      const serverIp = result;
      const clientPort = 49152 + Math.floor(Math.random() * 10000);
      const sessionKey = `${serverIp}:80`;

      const timer = setTimeout(() => {
        if (this.httpSessions.has(sessionKey)) {
          this.httpSessions.delete(sessionKey);
          callback(false, `<h3>Connection Timeout</h3><p>Could not connect to ${host} (${serverIp}) on port 80.</p>`);
        }
      }, 5000);

      this.httpSessions.set(sessionKey, {
        host,
        path,
        serverIp,
        clientPort,
        timer,
        callback: (ok, httpResp) => {
          if (ok) {
            callback(true, httpResp.body || '<h3>200 OK</h3><p>Empty response body.</p>');
          } else {
            callback(false, `<h3>HTTP Error</h3><p>Failed to load resource.</p>`);
          }
        }
      });

      // Send TCP SYN (3-way handshake start)
      const tcpSyn = new TCPSegment(clientPort, 80, 'SYN', 0, 0);
      const ip = new IPv4Packet(this.ip, serverIp, 'TCP', tcpSyn, 128);
      this.sendIPv4Packet(this.primaryInterface, ip);
    });
  }

  onFrameReceived(inPort, frame) {
    // Drop if frame is not for us and not broadcast
    const myMac = (inPort.mac || '').toUpperCase();
    const dstMac = (frame.dstMac || '').toUpperCase();
    if (dstMac !== myMac && dstMac !== 'FF:FF:FF:FF:FF:FF') {
      return;
    }

    if (frame.etherType === 'ARP' && frame.payload) {
      this.handleArp(inPort, frame.payload);
    } else if (frame.etherType === 'IPv4' && frame.payload) {
      this.handleIPv4(inPort, frame.payload);
    }
  }

  handleArp(inPort, arp) {
    // Learn ARP sender
    if (arp.senderIp && arp.senderMac) {
      const senderMac = arp.senderMac.toUpperCase();
      this.arpTable.set(arp.senderIp, { mac: senderMac, time: Date.now() });
      this.log(`ARP Learned: ${arp.senderIp} is at ${senderMac}`);

      // Check if we had pending packets waiting for this MAC
      if (this.pendingPackets.has(arp.senderIp)) {
        const queue = this.pendingPackets.get(arp.senderIp);
        this.pendingPackets.delete(arp.senderIp);
        queue.forEach(item => {
          item.frame.dstMac = senderMac;
          const sendPort = item.outPort || inPort;
          sendPort.sendFrame(item.frame);
          this.log(`Transmitted deferred packet to ${arp.senderIp} (${senderMac})`);
        });
      }
    }

    // Process ARP Request
    if (arp.op === 'REQUEST' && arp.targetIp === inPort.ip) {
      this.log(`Received ARP Request for our IP (${inPort.ip}) from ${arp.senderIp}`);
      const myMac = (inPort.mac || '').toUpperCase();
      const targetMac = arp.senderMac.toUpperCase();
      const replyArp = new ARPPacket('REPLY', myMac, inPort.ip, targetMac, arp.senderIp);
      const replyFrame = new EthernetFrame(myMac, targetMac, 'ARP', replyArp);
      inPort.sendFrame(replyFrame);
      this.log(`Sent ARP Reply to ${arp.senderIp}: ${inPort.ip} is at ${myMac}`);
    }
  }

  sendIPv4Packet(outPort, ipPacket) {
    if (!outPort.isUp) {
      this.log('Cannot send: Interface FastEthernet0 is down', 'error');
      return false;
    }

    if (!outPort.ip || !outPort.subnetMask) {
      this.log('Cannot send: Interface IP configuration missing', 'error');
      return false;
    }

    // Determine Next-Hop IP
    let nextHopIp = null;
    const isLocal = IPUtils.isSameSubnet(outPort.ip, ipPacket.dstIp, outPort.subnetMask);
    if (isLocal) {
      nextHopIp = ipPacket.dstIp;
    } else {
      if (!this.defaultGateway) {
        this.log(`No Default Gateway configured for remote destination ${ipPacket.dstIp}`, 'error');
        if (this.pingSession && typeof this.pingSession.onError === 'function') {
          this.pingSession.onError({ type: 'NO_GATEWAY', dstIp: ipPacket.dstIp });
        }
        return false;
      }
      nextHopIp = this.defaultGateway;
    }

    const myMac = (outPort.mac || '').toUpperCase();

    // Resolve Next-Hop MAC
    if (this.arpTable.has(nextHopIp)) {
      const nextHopMac = this.arpTable.get(nextHopIp).mac.toUpperCase();
      const frame = new EthernetFrame(myMac, nextHopMac, 'IPv4', ipPacket);
      return outPort.sendFrame(frame);
    } else {
      // Need ARP Resolution: buffer packet, send ARP Request
      const dummyFrame = new EthernetFrame(myMac, '00:00:00:00:00:00', 'IPv4', ipPacket);
      if (!this.pendingPackets.has(nextHopIp)) {
        this.pendingPackets.set(nextHopIp, []);
      }
      this.pendingPackets.get(nextHopIp).push({ outPort, frame: dummyFrame });

      this.log(`ARP Cache Miss for ${nextHopIp}. Broadcasting ARP Request...`);
      const arpReq = new ARPPacket('REQUEST', myMac, outPort.ip, '00:00:00:00:00:00', nextHopIp);
      const arpFrame = new EthernetFrame(myMac, 'FF:FF:FF:FF:FF:FF', 'ARP', arpReq);
      return outPort.sendFrame(arpFrame);
    }
  }

  startPing(targetIp, count = 4, callbacks = {}) {
    if (this.pingSession && this.pingSession.active) {
      if (callbacks.onPrint) callbacks.onPrint('A ping session is already in progress.');
      return;
    }

    let seq = 1;

    this.pingSession = {
      targetIp,
      count,
      sent: 0,
      received: 0,
      lost: 0,
      active: true,
      waitingForSeq: null,
      seqTimer: null,
      callbacks,
      onReply: (data) => {
        if (!this.pingSession || !this.pingSession.active) return;
        if (this.pingSession.waitingForSeq === data.seq) {
          clearTimeout(this.pingSession.seqTimer);
          this.pingSession.waitingForSeq = null;
          this.pingSession.received++;
          if (callbacks.onPrint) {
            callbacks.onPrint(`Reply from ${data.srcIp}: bytes=${data.bytes} time=${data.time}ms TTL=${data.ttl}`);
          }
          // Schedule next ping packet
          setTimeout(sendNext, 400);
        }
      },
      onError: (err) => {
        if (!this.pingSession || !this.pingSession.active) return;
        clearTimeout(this.pingSession.seqTimer);
        this.pingSession.waitingForSeq = null;
        this.pingSession.lost++;
        if (callbacks.onPrint) {
          if (err.type === 'NO_GATEWAY') {
            callbacks.onPrint(`Destination host unreachable (No Default Gateway configured).`);
          } else if (err.type === 'TIME_EXCEEDED') {
            callbacks.onPrint(`Reply from ${err.srcIp}: TTL expired in transit.`);
          } else {
            callbacks.onPrint(`Destination host unreachable.`);
          }
        }
        setTimeout(sendNext, 400);
      }
    };

    if (callbacks.onPrint) {
      callbacks.onPrint(`\nPinging ${targetIp} with 32 bytes of data:`);
    }

    const sendNext = () => {
      if (!this.pingSession || !this.pingSession.active) return;

      if (seq > count) {
        // Summary
        const sent = count;
        const rec = this.pingSession.received;
        const lost = sent - rec;
        const lossRate = Math.round((lost / sent) * 100);
        if (callbacks.onPrint) {
          callbacks.onPrint(`\nPing statistics for ${targetIp}:`);
          callbacks.onPrint(`    Packets: Sent = ${sent}, Received = ${rec}, Lost = ${lost} (${lossRate}% loss),`);
        }
        this.pingSession.active = false;
        if (callbacks.onComplete) callbacks.onComplete({ sent, received: rec, lost, lossRate });
        return;
      }

      const currentSeq = seq;
      seq++;
      this.pingSession.waitingForSeq = currentSeq;
      this.pingSession.sent++;

      const icmp = new ICMPPacket('ECHO_REQUEST', Math.floor(Math.random() * 1000), currentSeq);
      const ip = new IPv4Packet(this.ip, targetIp, 'ICMP', icmp, 128);

      const sentSuccess = this.sendIPv4Packet(this.primaryInterface, ip);
      if (!sentSuccess && (!this.primaryInterface.isUp || !this.ip)) {
        if (callbacks.onPrint) callbacks.onPrint('Transmit error: interface down or IP unconfigured.');
        this.pingSession.lost++;
        setTimeout(sendNext, 400);
        return;
      }

      // 4-second timeout per packet (standard ping timeout)
      this.pingSession.seqTimer = setTimeout(() => {
        if (this.pingSession && this.pingSession.active && this.pingSession.waitingForSeq === currentSeq) {
          this.pingSession.waitingForSeq = null;
          this.pingSession.lost++;
          if (callbacks.onPrint) callbacks.onPrint('Request timed out.');
          setTimeout(sendNext, 400);
        }
      }, 4000);
    };

    sendNext();
  }
}

/**
 * Server Device (End Device with DHCP, DNS, and HTTP Services)
 */
export class ServerDevice extends HostDevice {
  constructor(id, name, x = 100, y = 100) {
    super(id, name, 'server', x, y);

    const defaultHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
  <div style="background: linear-gradient(135deg, #0284c7, #06b6d4); color: white; padding: 18px; border-radius: 6px; margin-bottom: 20px;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">Cisco Packet Tracer Web Server</h2>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">HTTP & DNS Test Page</p>
  </div>
  <p style="font-size: 14px; line-height: 1.6; color: #475569;">
    Congratulations! Your PC successfully resolved the domain <strong>cisco.local</strong> via <strong>DNS</strong> and retrieved this webpage using standard <strong>HTTP/1.1</strong> over TCP port 80.
  </p>
  <div style="margin: 20px 0; padding: 14px; background: #f1f5f9; border-radius: 6px; font-size: 13px; text-align: left; color: #334155;">
    <div><strong>Host Server:</strong> ${name}</div>
    <div><strong>Protocol Stack:</strong> Ethernet II &rarr; IPv4 &rarr; TCP (Port 80) &rarr; HTTP/1.1</div>
    <div><strong>Status:</strong> 200 OK</div>
  </div>
  <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">
  <div style="display: flex; justify-content: center; gap: 16px; font-size: 13px;">
    <a href="#" style="color: #0284c7; font-weight: 600; text-decoration: none;">Topology Map</a>
    <span>&bull;</span>
    <a href="#" style="color: #0284c7; font-weight: 600; text-decoration: none;">Cisco IOS Guide</a>
    <span>&bull;</span>
    <a href="#" style="color: #0284c7; font-weight: 600; text-decoration: none;">About NetSim</a>
  </div>
</div>`;

    this.services = {
      dhcp: {
        enabled: true,
        poolName: 'serverPool',
        startIp: '192.168.1.100',
        subnetMask: '255.255.255.0',
        defaultGateway: '192.168.1.1',
        dnsServer: '192.168.1.254',
        poolSize: 50,
        leases: new Map() // mac -> ip
      },
      dns: {
        enabled: true,
        records: [
          { name: 'cisco.local', type: 'A', ip: '192.168.1.254' },
          { name: 'server.local', type: 'A', ip: '192.168.1.254' }
        ]
      },
      http: {
        enabled: true,
        files: {
          '/': defaultHtml,
          '/index.html': defaultHtml
        }
      }
    };
  }

  handleUDP(inPort, ipPacket, udp) {
    if (udp.dstPort === 67 && udp.payload instanceof DHCPMessage) {
      this.handleDHCPServer(inPort, ipPacket, udp.payload);
    } else if (udp.dstPort === 53 && udp.payload instanceof DNSMessage) {
      this.handleDNSServer(inPort, ipPacket, udp);
    } else {
      super.handleUDP(inPort, ipPacket, udp);
    }
  }

  handleDHCPServer(inPort, ipPacket, dhcpMsg) {
    if (!this.services.dhcp.enabled) return;
    const cfg = this.services.dhcp;
    const clientMac = dhcpMsg.chaddr.toUpperCase();

    if (dhcpMsg.type === 'DISCOVER') {
      let assignedIp = cfg.leases.get(clientMac);
      if (!assignedIp) {
        const startInt = IPUtils.ipToInt(cfg.startIp);
        const nextInt = startInt + cfg.leases.size;
        assignedIp = IPUtils.intToIp(nextInt);
        cfg.leases.set(clientMac, assignedIp);
      }

      this.log(`DHCP Server: Offering IP ${assignedIp} to client ${clientMac}`);
      const dhcpOffer = new DHCPMessage('OFFER', dhcpMsg.xid, assignedIp, inPort.ip, clientMac, {
        subnetMask: cfg.subnetMask,
        router: cfg.defaultGateway,
        dns: cfg.dnsServer
      });
      const udp = new UDPPacket(67, 68, dhcpOffer);
      const ip = new IPv4Packet(inPort.ip, '255.255.255.255', 'UDP', udp, 128);
      const frame = new EthernetFrame(inPort.mac, 'FF:FF:FF:FF:FF:FF', 'IPv4', ip);
      inPort.sendFrame(frame);
    } else if (dhcpMsg.type === 'REQUEST') {
      const assignedIp = dhcpMsg.yiaddr || cfg.leases.get(clientMac) || cfg.startIp;
      cfg.leases.set(clientMac, assignedIp);

      this.log(`DHCP Server: Acknowledging (ACK) IP ${assignedIp} for client ${clientMac}`);
      const dhcpAck = new DHCPMessage('ACK', dhcpMsg.xid, assignedIp, inPort.ip, clientMac, {
        subnetMask: cfg.subnetMask,
        router: cfg.defaultGateway,
        dns: cfg.dnsServer
      });
      const udp = new UDPPacket(67, 68, dhcpAck);
      const ip = new IPv4Packet(inPort.ip, '255.255.255.255', 'UDP', udp, 128);
      const frame = new EthernetFrame(inPort.mac, 'FF:FF:FF:FF:FF:FF', 'IPv4', ip);
      inPort.sendFrame(frame);
    }
  }

  handleDNSServer(inPort, ipPacket, udp) {
    if (!this.services.dns.enabled) return;
    const query = udp.payload;
    const qName = (query.question && query.question.name ? query.question.name : '').toLowerCase();

    const record = this.services.dns.records.find(r => r.name.toLowerCase() === qName);
    const answers = [];
    if (record) {
      answers.push({ name: record.name, type: 'A', ip: record.ip, ttl: 3600 });
      this.log(`DNS Server: Resolved ${qName} -> ${record.ip}`);
    } else {
      this.log(`DNS Server: No record for domain ${qName}`, 'warn');
    }

    const dnsResp = new DNSMessage('RESPONSE', query.txId, query.question, answers);
    const respUdp = new UDPPacket(53, udp.srcPort, dnsResp);
    const ip = new IPv4Packet(inPort.ip, ipPacket.srcIp, 'UDP', respUdp, 128);
    this.sendIPv4Packet(inPort, ip);
  }

  handleTCP(inPort, ipPacket, tcp) {
    if (!this.services.http.enabled || tcp.dstPort !== 80) {
      super.handleTCP(inPort, ipPacket, tcp);
      return;
    }

    if (tcp.flags.includes('SYN') && !tcp.flags.includes('ACK')) {
      this.log(`HTTP Server: Received TCP SYN on port 80 from ${ipPacket.srcIp}:${tcp.srcPort}. Sending SYN, ACK...`);
      const tcpSynAck = new TCPSegment(80, tcp.srcPort, 'SYN, ACK', 100, tcp.seq + 1);
      const ip = new IPv4Packet(inPort.ip, ipPacket.srcIp, 'TCP', tcpSynAck, 128);
      this.sendIPv4Packet(inPort, ip);
    } else if (tcp.payload instanceof HTTPMessage) {
      const httpReq = tcp.payload;
      this.log(`HTTP Server: Serving HTTP ${httpReq.method} ${httpReq.uri} to ${ipPacket.srcIp}`);

      let content = this.services.http.files[httpReq.uri] || this.services.http.files['/'] || '<h1>404 Not Found</h1>';
      const httpResp = new HTTPMessage('RESPONSE', 200, 'OK', { 'Content-Type': 'text/html' }, content);
      const tcpResp = new TCPSegment(80, tcp.srcPort, 'PSH, ACK', tcp.ack, tcp.seq + 1, httpResp);
      const ip = new IPv4Packet(inPort.ip, ipPacket.srcIp, 'TCP', tcpResp, 128);
      this.sendIPv4Packet(inPort, ip);
    }
  }
}

/**
 * Switch Device (Layer 2)
 */
export class SwitchDevice extends Device {
  constructor(id, name, portCount = 24, x = 100, y = 100) {
    super(id, name, 'switch', x, y);
    this.macTable = new Map(); // `${vlanId}_${mac}` -> { portName, mac, vlan, time }
    this.agingTimeMs = 300000; // 5 minutes
    this.vlans = new Map([
      [1, { id: 1, name: 'default' }]
    ]);

    // Create FastEthernet ports
    for (let i = 1; i <= portCount; i++) {
      const intf = this.addInterface(`Fa0/${i}`);
      intf.vlan = 1;
      intf.mode = 'access';
      intf.nativeVlan = 1;
      intf.allowedVlans = 'ALL';
    }
  }

  createVlan(id, name = null) {
    const vId = parseInt(id, 10);
    if (isNaN(vId) || vId < 1 || vId > 4094) throw new Error('Invalid VLAN ID (1-4094)');
    if (!this.vlans.has(vId)) {
      const vlanObj = { id: vId, name: name || `VLAN${vId.toString().padStart(4, '0')}` };
      this.vlans.set(vId, vlanObj);
      this.log(`Created VLAN ${vId} (${vlanObj.name})`);
      return vlanObj;
    }
    const existing = this.vlans.get(vId);
    if (name) existing.name = name;
    return existing;
  }

  removeVlan(id) {
    const vId = parseInt(id, 10);
    if (vId === 1) throw new Error('Default VLAN 1 cannot be deleted');
    this.vlans.delete(vId);
    this.interfaces.forEach(p => {
      if (p.vlan === vId) p.vlan = 1;
    });
    this.log(`Deleted VLAN ${vId}`);
  }

  setPortMode(portName, mode) {
    const port = this.getInterface(portName);
    if (!port) throw new Error(`Port ${portName} not found`);
    if (mode !== 'access' && mode !== 'trunk') throw new Error(`Invalid switchport mode: ${mode}`);
    port.mode = mode;
    this.log(`Set ${port.name} mode to ${mode}`);
  }

  setPortAccessVlan(portName, vlanId) {
    const port = this.getInterface(portName);
    if (!port) throw new Error(`Port ${portName} not found`);
    const vId = parseInt(vlanId, 10);
    if (isNaN(vId) || vId < 1 || vId > 4094) throw new Error('Invalid VLAN ID');
    if (!this.vlans.has(vId)) {
      this.createVlan(vId);
    }
    port.vlan = vId;
    this.log(`Assigned ${port.name} to VLAN ${vId}`);
  }

  isVlanAllowedOnTrunk(port, vlanId) {
    if (port.allowedVlans === 'ALL') return true;
    if (Array.isArray(port.allowedVlans)) return port.allowedVlans.includes(vlanId);
    return true;
  }

  onFrameReceived(inPort, frame) {
    const srcMac = (frame.srcMac || '').toUpperCase();
    const dstMac = (frame.dstMac || '').toUpperCase();

    // 1. Determine incoming VLAN ID
    let vlanId;
    if (inPort.mode === 'access') {
      vlanId = inPort.vlan || 1;
    } else {
      // Trunk port
      if (frame.vlanTag !== null && frame.vlanTag !== undefined) {
        vlanId = frame.vlanTag;
      } else {
        vlanId = inPort.nativeVlan || 1;
      }

      if (!this.isVlanAllowedOnTrunk(inPort, vlanId)) {
        this.log(`Dropped frame on trunk ${inPort.name}: VLAN ${vlanId} is not allowed`, 'warn');
        return;
      }
    }

    // 2. MAC Learning per VLAN
    this.learnMac(srcMac, inPort.name, vlanId);

    // 3. Forwarding Decision within the same VLAN
    const macKey = `${vlanId}_${dstMac}`;
    if (frame.isBroadcast() || !this.macTable.has(macKey)) {
      // Unknown Unicast or Broadcast -> Flood within VLAN
      this.floodFrame(inPort, frame, vlanId);
    } else {
      // Known Unicast -> Forward to target port
      const entry = this.macTable.get(macKey);
      const targetPort = this.getInterface(entry.portName);

      if (targetPort && targetPort !== inPort && targetPort.isUp) {
        this.forwardFrameToPort(targetPort, frame, vlanId);
      } else if (targetPort === inPort) {
        this.log(`Filtering frame: destination MAC ${dstMac} is on the same port ${inPort.name}`);
      }
    }
  }

  learnMac(mac, portName, vlanId) {
    if (!mac) return;
    const cleanMac = mac.toUpperCase();
    if (cleanMac === 'FF:FF:FF:FF:FF:FF') return;
    const key = `${vlanId}_${cleanMac}`;
    const existing = this.macTable.get(key);
    if (!existing || existing.portName !== portName) {
      this.log(`Learned MAC ${cleanMac} on port ${portName} (VLAN ${vlanId})`);
    }
    this.macTable.set(key, { portName, mac: cleanMac, vlan: vlanId, time: Date.now() });
  }

  forwardFrameToPort(targetPort, frame, vlanId) {
    if (targetPort.mode === 'access') {
      if (targetPort.vlan === vlanId) {
        this.log(`Forwarding unicast to ${frame.dstMac} via ${targetPort.name} (Access VLAN ${vlanId})`);
        const outFrame = frame.clone();
        outFrame.vlanTag = null; // Strip 802.1Q tag on access port
        targetPort.sendFrame(outFrame);
      }
    } else if (targetPort.mode === 'trunk') {
      if (this.isVlanAllowedOnTrunk(targetPort, vlanId)) {
        this.log(`Forwarding unicast to ${frame.dstMac} via ${targetPort.name} (Trunk VLAN ${vlanId})`);
        const outFrame = frame.clone();
        outFrame.vlanTag = (vlanId === targetPort.nativeVlan) ? null : vlanId;
        targetPort.sendFrame(outFrame);
      }
    }
  }

  floodFrame(inPort, frame, vlanId) {
    this.log(`Flooding ${frame.isBroadcast() ? 'broadcast' : 'unknown unicast'} frame from ${inPort.name} (VLAN ${vlanId})`);
    this.interfaces.forEach(port => {
      if (port !== inPort && port.isUp) {
        if (port.mode === 'access') {
          if (port.vlan === vlanId) {
            const outFrame = frame.clone();
            outFrame.vlanTag = null;
            port.sendFrame(outFrame);
          }
        } else if (port.mode === 'trunk') {
          if (this.isVlanAllowedOnTrunk(port, vlanId)) {
            const outFrame = frame.clone();
            outFrame.vlanTag = (vlanId === port.nativeVlan) ? null : vlanId;
            port.sendFrame(outFrame);
          }
        }
      }
    });
  }

  clearMacTable() {
    this.macTable.clear();
    this.log('MAC address table cleared.');
  }
}

/**
 * Router Device (Layer 3)
 */
export class RouterDevice extends Device {
  constructor(id, name, x = 100, y = 100) {
    super(id, name, 'router', x, y);
    this.routingTable = []; // Array of { network, mask, nextHop, exitInterface, type: 'C'|'S' }
    this.arpTable = new Map(); // IP -> { mac, time }
    this.pendingPackets = new Map(); // nextHopIp -> Array<{ inPort, exitPort, packet, nextHopIp }>
    this.subInterfaces = []; // Array of sub-interfaces e.g. GigabitEthernet0/0.10

    // Default 3 GigabitEthernet ports
    this.addInterface('GigabitEthernet0/0');
    this.addInterface('GigabitEthernet0/1');
    this.addInterface('GigabitEthernet0/2');
  }

  getInterface(name) {
    if (!name) return null;
    const clean = name.toLowerCase().replace(/\s+/g, '');

    // Check physical interfaces first
    const intf = super.getInterface(name);
    if (intf) return intf;

    // Check sub-interfaces (exact)
    const exactSub = this.subInterfaces.find(s => s.name.toLowerCase() === clean);
    if (exactSub) return exactSub;

    // Flexible sub-interface match (e.g. Gi0/0.10 vs GigabitEthernet0/0.10)
    const numMatch = clean.match(/(\d+[\/\d]*\.\d+)/);
    if (numMatch) {
      const num = numMatch[1];
      if (clean.startsWith('gi') || clean.startsWith('gig') || clean.startsWith('g')) {
        const foundSub = this.subInterfaces.find(s => {
          const iname = s.name.toLowerCase();
          return iname === `gi${num}` || iname === `g${num}` || iname === `gigabitethernet${num}`;
        });
        if (foundSub) return foundSub;
      }
    }

    return null;
  }

  getOrCreateSubInterface(fullName) {
    const existing = this.getInterface(fullName);
    if (existing) return existing;

    const dotIdx = fullName.lastIndexOf('.');
    if (dotIdx === -1) throw new Error(`Invalid sub-interface name: ${fullName}`);
    const parentName = fullName.substring(0, dotIdx);
    const parent = this.getInterface(parentName);
    if (!parent) throw new Error(`Parent interface ${parentName} does not exist`);

    const sub = new NetworkInterface(fullName, this, parent.mac);
    sub.isSubInterface = true;
    sub.parentInterface = parent;
    sub.adminUp = true;
    this.subInterfaces.push(sub);
    this.log(`Created sub-interface ${fullName} on parent ${parent.name}`);
    return sub;
  }

  onInterfaceConfigChange(intf) {
    this.updateConnectedRoutes();
  }

  updateConnectedRoutes() {
    // Rebuild directly connected ('C') routes based on UP interfaces & sub-interfaces
    this.routingTable = this.routingTable.filter(r => r.type !== 'C');
    const allPorts = [...this.interfaces, ...this.subInterfaces];
    allPorts.forEach(intf => {
      if (intf.isUp && intf.ip && intf.subnetMask) {
        const netAddr = IPUtils.getNetworkAddress(intf.ip, intf.subnetMask);
        this.routingTable.push({
          network: netAddr,
          mask: intf.subnetMask,
          nextHop: '0.0.0.0',
          exitInterface: intf.name,
          type: 'C' // Connected
        });
      }
    });
  }

  addStaticRoute(network, mask, nextHopOrInterface) {
    if (!IPUtils.isValidIp(network)) throw new Error('Invalid network address');
    if (!IPUtils.isValidMask(mask)) throw new Error('Invalid subnet mask');

    let nextHop = '0.0.0.0';
    let exitInterface = null;

    if (IPUtils.isValidIp(nextHopOrInterface)) {
      nextHop = nextHopOrInterface;
    } else {
      const intf = this.getInterface(nextHopOrInterface);
      if (!intf) throw new Error('Invalid exit interface: ' + nextHopOrInterface);
      exitInterface = intf.name;
    }

    // Remove existing matching static route if any
    this.routingTable = this.routingTable.filter(r => !(r.type === 'S' && r.network === network && r.mask === mask));
    this.routingTable.push({
      network,
      mask,
      nextHop,
      exitInterface,
      type: 'S' // Static
    });
    this.log(`Added static route: ${network}/${mask} via ${nextHopOrInterface}`);
  }

  removeStaticRoute(network, mask) {
    this.routingTable = this.routingTable.filter(r => !(r.type === 'S' && r.network === network && r.mask === mask));
    this.log(`Removed static route: ${network}/${mask}`);
  }

  onFrameReceived(inPort, frame) {
    // Drop frame if dstMac is not this interface's MAC and not broadcast
    const myMac = (inPort.mac || '').toUpperCase();
    const dstMac = (frame.dstMac || '').toUpperCase();
    if (dstMac !== myMac && dstMac !== 'FF:FF:FF:FF:FF:FF') {
      return;
    }

    // Determine target logical port (physical interface or 802.1Q sub-interface)
    let logicalPort = inPort;
    if (frame.vlanTag !== null && frame.vlanTag !== undefined) {
      const sub = this.subInterfaces.find(s => 
        s.parentInterface === inPort && 
        s.vlanTag === frame.vlanTag && 
        s.encapsulation === 'dot1Q'
      );
      if (!sub) {
        this.log(`Dropped frame on ${inPort.name}: Tagged for VLAN ${frame.vlanTag} but no matching dot1Q sub-interface found`, 'warn');
        return;
      }
      logicalPort = sub;
    }

    if (frame.etherType === 'ARP' && frame.payload) {
      this.handleArp(logicalPort, frame.payload);
    } else if (frame.etherType === 'IPv4' && frame.payload) {
      this.handleIPv4(logicalPort, frame.payload);
    }
  }

  handleArp(logicalPort, arp) {
    // Learn ARP sender
    if (arp.senderIp && arp.senderMac) {
      const senderMac = arp.senderMac.toUpperCase();
      this.arpTable.set(arp.senderIp, { mac: senderMac, time: Date.now() });
      this.log(`ARP Learned: ${arp.senderIp} is at ${senderMac}`);

      // Check pending routed packets waiting for this ARP
      if (this.pendingPackets.has(arp.senderIp)) {
        const queue = this.pendingPackets.get(arp.senderIp);
        this.pendingPackets.delete(arp.senderIp);
        queue.forEach(item => {
          this.encapsulateAndForward(item.exitPort, senderMac, item.packet);
        });
      }
    }

    // Process ARP Request targeting this logical port
    if (arp.op === 'REQUEST' && arp.targetIp === logicalPort.ip) {
      this.log(`ARP Request targeting ${logicalPort.name} (${logicalPort.ip}) from ${arp.senderIp}`);
      const myMac = (logicalPort.mac || '').toUpperCase();
      const targetMac = arp.senderMac.toUpperCase();
      const replyArp = new ARPPacket('REPLY', myMac, logicalPort.ip, targetMac, arp.senderIp);
      const replyFrame = new EthernetFrame(myMac, targetMac, 'ARP', replyArp);
      if (logicalPort.isSubInterface && logicalPort.vlanTag) {
        replyFrame.vlanTag = logicalPort.vlanTag;
      }
      logicalPort.sendFrame(replyFrame);
    }
  }

  handleIPv4(logicalPort, ipPacket) {
    // Check if packet is destined for any local interface or sub-interface of this router
    const allInterfaces = [...this.interfaces, ...this.subInterfaces];
    const localIntf = allInterfaces.find(i => i.ip === ipPacket.dstIp);
    if (localIntf) {
      this.handleLocalTraffic(logicalPort, localIntf, ipPacket);
      return;
    }

    // L3 Routing Forwarding Engine
    this.routePacket(logicalPort, ipPacket);
  }

  handleLocalTraffic(inPort, destIntf, ipPacket) {
    if (ipPacket.protocol === 'ICMP' && ipPacket.payload) {
      const icmp = ipPacket.payload;
      if (icmp.type === 'ECHO_REQUEST') {
        this.log(`Responding to ICMP Echo Request from ${ipPacket.srcIp}`);
        const replyIcmp = new ICMPPacket('ECHO_REPLY', icmp.identifier, icmp.sequenceNumber, icmp.data);
        const replyIp = new IPv4Packet(destIntf.ip, ipPacket.srcIp, 'ICMP', replyIcmp, 255);
        this.routePacket(destIntf, replyIp);
      }
    }
  }

  routePacket(inPort, ipPacket) {
    // Decrement TTL
    ipPacket.ttl -= 1;
    if (ipPacket.ttl <= 0) {
      this.log(`TTL expired for packet from ${ipPacket.srcIp} to ${ipPacket.dstIp}`, 'warn');
      // Send ICMP Time Exceeded back to source
      const timeExceeded = new ICMPPacket('TIME_EXCEEDED', 0, 0);
      const errIp = new IPv4Packet(inPort.ip || '0.0.0.0', ipPacket.srcIp, 'ICMP', timeExceeded, 255);
      this.routePacket(inPort, errIp);
      return;
    }

    // Longest Prefix Match in Routing Table
    const route = this.lookupRoute(ipPacket.dstIp);
    if (!route) {
      this.log(`No route to destination ${ipPacket.dstIp}. Destination unreachable.`, 'warn');
      const unreach = new ICMPPacket('DEST_UNREACHABLE', 0, 0);
      const errIp = new IPv4Packet(inPort.ip || '0.0.0.0', ipPacket.srcIp, 'ICMP', unreach, 255);
      this.routePacket(inPort, errIp);
      return;
    }

    // Determine exit interface and next hop
    let exitPort = null;
    let nextHopIp = null;

    if (route.type === 'C') {
      exitPort = this.getInterface(route.exitInterface);
      nextHopIp = ipPacket.dstIp; // directly connected destination
    } else {
      if (route.exitInterface) {
        exitPort = this.getInterface(route.exitInterface);
      }
      if (route.nextHop && route.nextHop !== '0.0.0.0') {
        nextHopIp = route.nextHop;
        if (!exitPort) {
          // Recursively resolve exit interface for nextHop
          const nextHopRoute = this.lookupRoute(nextHopIp);
          if (nextHopRoute) exitPort = this.getInterface(nextHopRoute.exitInterface);
        }
      } else {
        nextHopIp = ipPacket.dstIp;
      }
    }

    if (!exitPort || !exitPort.isUp) {
      this.log(`Exit interface ${exitPort ? exitPort.name : 'Unknown'} is down.`, 'warn');
      return;
    }

    // Check ARP Table for Next Hop MAC
    if (this.arpTable.has(nextHopIp)) {
      const nextHopMac = this.arpTable.get(nextHopIp).mac;
      this.encapsulateAndForward(exitPort, nextHopMac, ipPacket);
    } else {
      // Buffer packet and broadcast ARP Request
      if (!this.pendingPackets.has(nextHopIp)) {
        this.pendingPackets.set(nextHopIp, []);
      }
      this.pendingPackets.get(nextHopIp).push({ exitPort, packet: ipPacket, nextHopIp });

      this.log(`Router ARP Cache Miss for next hop ${nextHopIp}. Broadcasting ARP Request on ${exitPort.name}...`);
      const arpReq = new ARPPacket('REQUEST', exitPort.mac, exitPort.ip, '00:00:00:00:00:00', nextHopIp);
      const arpFrame = new EthernetFrame(exitPort.mac, 'FF:FF:FF:FF:FF:FF', 'ARP', arpReq);
      if (exitPort.isSubInterface && exitPort.vlanTag) {
        arpFrame.vlanTag = exitPort.vlanTag;
      }
      exitPort.sendFrame(arpFrame);
    }
  }

  encapsulateAndForward(exitPort, nextHopMac, ipPacket) {
    this.log(`Routing packet for ${ipPacket.dstIp} out ${exitPort.name} to MAC ${nextHopMac}`);
    const frame = new EthernetFrame(exitPort.mac, nextHopMac, 'IPv4', ipPacket);
    if (exitPort.isSubInterface && exitPort.vlanTag) {
      frame.vlanTag = exitPort.vlanTag;
    }
    exitPort.sendFrame(frame);
  }

  lookupRoute(dstIp) {
    let bestMatch = null;
    let maxPrefixLength = -1;

    for (const route of this.routingTable) {
      if (IPUtils.isSameSubnet(dstIp, route.network, route.mask)) {
        const prefixLength = IPUtils.maskToCidr(route.mask);
        if (prefixLength > maxPrefixLength) {
          maxPrefixLength = prefixLength;
          bestMatch = route;
        }
      }
    }

    return bestMatch;
  }
}
