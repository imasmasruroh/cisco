/**
 * protocols.js - Network Protocol Definitions & Packet Data Units (PDUs)
 * Supports: Ethernet II, ARP, IPv4, ICMP, UDP, DHCP, DNS, TCP, HTTP
 */

// Bitwise IP & Subnetting Helper Utilities
export const IPUtils = {
  ipToInt(ip) {
    if (!ip) return 0;
    const parts = ip.trim().split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return 0;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  },

  intToIp(intVal) {
    return [
      (intVal >>> 24) & 255,
      (intVal >>> 16) & 255,
      (intVal >>> 8) & 255,
      intVal & 255
    ].join('.');
  },

  isValidIp(ip) {
    if (typeof ip !== 'string') return false;
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
      const n = Number(p);
      return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
    });
  },

  isValidMask(mask) {
    if (!this.isValidIp(mask)) return false;
    const intVal = this.ipToInt(mask);
    const inverted = ~intVal >>> 0;
    return ((inverted + 1) & inverted) === 0;
  },

  isSameSubnet(ip1, ip2, mask) {
    const int1 = this.ipToInt(ip1);
    const int2 = this.ipToInt(ip2);
    const intMask = this.ipToInt(mask);
    return (int1 & intMask) === (int2 & intMask);
  },

  getNetworkAddress(ip, mask) {
    const intIp = this.ipToInt(ip);
    const intMask = this.ipToInt(mask);
    return this.intToIp((intIp & intMask) >>> 0);
  },

  getBroadcastAddress(ip, mask) {
    const intIp = this.ipToInt(ip);
    const intMask = this.ipToInt(mask);
    const broadcastInt = (intIp | (~intMask >>> 0)) >>> 0;
    return this.intToIp(broadcastInt);
  },

  maskToCidr(mask) {
    const intMask = this.ipToInt(mask);
    let count = 0;
    for (let i = 31; i >= 0; i--) {
      if ((intMask & (1 << i)) !== 0) count++;
      else break;
    }
    return count;
  },

  cidrToMask(cidr) {
    if (cidr < 0) cidr = 0;
    if (cidr > 32) cidr = 32;
    if (cidr === 0) return '0.0.0.0';
    const mask = (0xffffffff << (32 - cidr)) >>> 0;
    return this.intToIp(mask);
  },

  generateRandomMac() {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return `00:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
  }
};

/**
 * Layer 2: Ethernet II Frame
 */
export class EthernetFrame {
  constructor(srcMac, dstMac, etherType, payload, vlanTag = null) {
    this.id = 'frame_' + Math.random().toString(36).substr(2, 9);
    this.srcMac = (srcMac || '').toUpperCase();
    this.dstMac = (dstMac || '').toUpperCase();
    this.etherType = etherType; // 'ARP' | 'IPv4'
    this.payload = payload;
    this.vlanTag = vlanTag !== null && vlanTag !== undefined ? parseInt(vlanTag, 10) : null;
    this.preamble = '10101011';
    this.fcs = '0x' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase();
    this._hopCount = 0;
  }

  isBroadcast() {
    return this.dstMac === 'FF:FF:FF:FF:FF:FF';
  }

  clone() {
    const copy = new EthernetFrame(
      this.srcMac,
      this.dstMac,
      this.etherType,
      this.payload && typeof this.payload.clone === 'function' ? this.payload.clone() : this.payload,
      this.vlanTag
    );
    copy._hopCount = this._hopCount || 0;
    return copy;
  }
}

/**
 * Layer 3/2: ARP Packet (Address Resolution Protocol)
 */
export class ARPPacket {
  constructor(op, senderMac, senderIp, targetMac, targetIp) {
    this.id = 'arp_' + Math.random().toString(36).substr(2, 9);
    this.hwType = 'Ethernet (1)';
    this.protoType = 'IPv4 (0x0800)';
    this.hwSize = 6;
    this.protoSize = 4;
    this.op = op; // 'REQUEST' | 'REPLY'
    this.senderMac = (senderMac || '').toUpperCase();
    this.senderIp = senderIp;
    this.targetMac = (targetMac || '00:00:00:00:00:00').toUpperCase();
    this.targetIp = targetIp;
  }

  clone() {
    return new ARPPacket(this.op, this.senderMac, this.senderIp, this.targetMac, this.targetIp);
  }
}

/**
 * Layer 3: IPv4 Packet
 */
export class IPv4Packet {
  constructor(srcIp, dstIp, protocol, payload, ttl = 64) {
    this.id = 'ip_' + Math.random().toString(36).substr(2, 9);
    this.version = 4;
    this.ihl = 5;
    this.tos = 0;
    this.totalLength = 20 + (payload && payload.length ? payload.length : 32);
    this.identification = Math.floor(Math.random() * 65535);
    this.flags = '0x02 (Don\'t Fragment)';
    this.fragmentOffset = 0;
    this.ttl = ttl;
    this.protocol = protocol; // 'ICMP' | 'UDP' | 'TCP'
    this.checksum = '0x' + Math.floor(Math.random() * 65535).toString(16).toUpperCase();
    this.srcIp = srcIp;
    this.dstIp = dstIp;
    this.payload = payload;
  }

  clone() {
    const copy = new IPv4Packet(
      this.srcIp,
      this.dstIp,
      this.protocol,
      this.payload && typeof this.payload.clone === 'function' ? this.payload.clone() : this.payload,
      this.ttl
    );
    copy.identification = this.identification;
    return copy;
  }
}

/**
 * Layer 4/3: ICMP Packet
 */
export class ICMPPacket {
  constructor(type, id = 1, seq = 1, data = 'abcdefghijklmnopqrstuvwabcdefghi') {
    this.id = 'icmp_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'ECHO_REQUEST' | 'ECHO_REPLY' | 'DEST_UNREACHABLE' | 'TIME_EXCEEDED'
    this.code = 0;
    this.checksum = '0x' + Math.floor(Math.random() * 65535).toString(16).toUpperCase();
    this.identifier = id;
    this.sequenceNumber = seq;
    this.data = data;
    this.length = data.length + 8;
  }

  clone() {
    return new ICMPPacket(this.type, this.identifier, this.sequenceNumber, this.data);
  }
}

/**
 * Layer 4: UDP Packet
 */
export class UDPPacket {
  constructor(srcPort, dstPort, payload) {
    this.id = 'udp_' + Math.random().toString(36).substr(2, 9);
    this.srcPort = srcPort; // e.g. 68 (DHCP Client), 53 (DNS)
    this.dstPort = dstPort; // e.g. 67 (DHCP Server), 53 (DNS)
    this.length = 8 + (payload && payload.length ? payload.length : 64);
    this.checksum = '0x' + Math.floor(Math.random() * 65535).toString(16).toUpperCase();
    this.payload = payload;
  }

  clone() {
    return new UDPPacket(
      this.srcPort,
      this.dstPort,
      this.payload && typeof this.payload.clone === 'function' ? this.payload.clone() : this.payload
    );
  }
}

/**
 * Layer 7: DHCP Message (Dynamic Host Configuration Protocol)
 */
export class DHCPMessage {
  constructor(type, xid, yiaddr = '0.0.0.0', siaddr = '0.0.0.0', chaddr = '', options = {}) {
    this.id = 'dhcp_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'DISCOVER' | 'OFFER' | 'REQUEST' | 'ACK'
    this.xid = xid || Math.floor(Math.random() * 0xFFFFFF);
    this.ciaddr = '0.0.0.0'; // Client IP
    this.yiaddr = yiaddr;     // 'Your' (client) IP
    this.siaddr = siaddr;     // Next server IP
    this.giaddr = '0.0.0.0'; // Relay agent IP
    this.chaddr = (chaddr || '').toUpperCase(); // Client hardware MAC
    this.options = {
      subnetMask: options.subnetMask || '255.255.255.0',
      router: options.router || null,
      dns: options.dns || null,
      leaseTime: options.leaseTime || 86400,
      ...options
    };
  }

  clone() {
    return new DHCPMessage(this.type, this.xid, this.yiaddr, this.siaddr, this.chaddr, { ...this.options });
  }
}

/**
 * Layer 7: DNS Message (Domain Name System)
 */
export class DNSMessage {
  constructor(type, id, question, answers = []) {
    this.id = 'dns_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'QUERY' | 'RESPONSE'
    this.txId = id || Math.floor(Math.random() * 65535);
    this.question = question; // { name: 'cisco.local', type: 'A' }
    this.answers = answers;   // [{ name: 'cisco.local', type: 'A', ip: '192.168.1.100', ttl: 3600 }]
  }

  clone() {
    return new DNSMessage(this.type, this.txId, this.question, [...this.answers]);
  }
}

/**
 * Layer 4: TCP Segment
 */
export class TCPSegment {
  constructor(srcPort, dstPort, flags, seq = 1, ack = 0, payload = null) {
    this.id = 'tcp_' + Math.random().toString(36).substr(2, 9);
    this.srcPort = srcPort; // e.g. 80 (HTTP)
    this.dstPort = dstPort;
    this.flags = flags;     // 'SYN' | 'SYN, ACK' | 'ACK' | 'PSH, ACK' | 'FIN, ACK'
    this.seq = seq;
    this.ack = ack;
    this.window = 65535;
    this.payload = payload;
  }

  clone() {
    return new TCPSegment(
      this.srcPort,
      this.dstPort,
      this.flags,
      this.seq,
      this.ack,
      this.payload && typeof this.payload.clone === 'function' ? this.payload.clone() : this.payload
    );
  }
}

/**
 * Layer 7: HTTP Message
 */
export class HTTPMessage {
  constructor(type, methodOrStatus, uriOrText, headers = {}, body = '') {
    this.id = 'http_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'REQUEST' | 'RESPONSE'
    if (type === 'REQUEST') {
      this.method = methodOrStatus || 'GET';
      this.uri = uriOrText || '/';
      this.version = 'HTTP/1.1';
    } else {
      this.status = typeof methodOrStatus === 'number' ? methodOrStatus : 200;
      this.statusText = uriOrText || 'OK';
      this.version = 'HTTP/1.1';
    }
    this.headers = headers;
    this.body = body;
  }

  clone() {
    return new HTTPMessage(
      this.type,
      this.type === 'REQUEST' ? this.method : this.status,
      this.type === 'REQUEST' ? this.uri : this.statusText,
      { ...this.headers },
      this.body
    );
  }
}

/**
 * Layer 7: Network Print Job (RAW / JetDirect Port 9100)
 */
export class PrintJobMessage {
  constructor(type, documentName = 'TestPage.pdf', pages = 1, status = 'PRINTING') {
    this.id = 'print_' + Math.random().toString(36).substr(2, 9);
    this.type = type; // 'SUBMIT' | 'ACK'
    this.documentName = documentName;
    this.pages = pages;
    this.status = status;
  }

  clone() {
    return new PrintJobMessage(this.type, this.documentName, this.pages, this.status);
  }
}

/**
 * PDU Inspector Details Generator (Cisco Packet Tracer OSI Model View)
 */
export function inspectPDU(frame, context = {}) {
  const result = {
    summary: '',
    layers: [],
    inLayers: [],
    outLayers: [],
    rawData: {}
  };

  if (!frame) return result;

  // Layer 1 - Physical
  const l1 = {
    layer: 1,
    name: 'Physical',
    short: 'Port ' + (context.portName || 'Ethernet'),
    details: [
      `Physical Port: ${context.portName || 'FastEthernet0/1'}`,
      `Medium: Copper Ethernet (100BASE-TX)`,
      `Status: Link Active, Full Duplex`,
      context.direction === 'in' 
        ? `FastEthernet receives the frame from wire.`
        : `FastEthernet transmits the frame out onto wire.`
    ]
  };

  // Layer 2 - Data Link
  const l2Details = [
    `Ethernet II Header`,
    `Source MAC: ${frame.srcMac}`,
    `Destination MAC: ${frame.dstMac} ${frame.isBroadcast() ? '(Broadcast)' : ''}`,
    `EtherType: ${frame.etherType === 'IPv4' ? '0x0800 (IPv4)' : '0x0806 (ARP)'}`
  ];
  if (frame.vlanTag !== null && frame.vlanTag !== undefined) {
    l2Details.push(`802.1Q Tag: VLAN ${frame.vlanTag} (TPID: 0x8100, Priority: 0)`);
  }
  l2Details.push(`FCS: ${frame.fcs}`);

  const l2 = {
    layer: 2,
    name: frame.vlanTag ? `Data Link (802.1Q Tagged - VLAN ${frame.vlanTag})` : 'Data Link (Ethernet II)',
    short: `${frame.srcMac} -> ${frame.dstMac}${frame.vlanTag ? ` [VLAN ${frame.vlanTag}]` : ''}`,
    details: l2Details
  };

  result.layers.push(l1, l2);

  if (frame.etherType === 'ARP' && frame.payload) {
    const arp = frame.payload;
    const l3 = {
      layer: 3,
      name: 'Network (ARP)',
      short: `ARP ${arp.op}: ${arp.senderIp} -> ${arp.targetIp}`,
      details: [
        `ARP Operation: ${arp.op === 'REQUEST' ? '1 (ARP Request: Who has ' + arp.targetIp + '? Tell ' + arp.senderIp + ')' : '2 (ARP Reply: ' + arp.senderIp + ' is at ' + arp.senderMac + ')'}`,
        `Hardware Type: ${arp.hwType}`,
        `Protocol Type: ${arp.protoType}`,
        `Sender MAC: ${arp.senderMac}`,
        `Sender IP: ${arp.senderIp}`,
        `Target MAC: ${arp.targetMac}`,
        `Target IP: ${arp.targetIp}`
      ]
    };
    result.layers.push(l3);
    result.summary = `ARP ${arp.op}: ${arp.senderIp} -> ${arp.targetIp}`;
  } else if (frame.etherType === 'IPv4' && frame.payload) {
    const ip = frame.payload;
    const l3 = {
      layer: 3,
      name: 'Network (IPv4)',
      short: `${ip.srcIp} -> ${ip.dstIp}`,
      details: [
        `IPv4 Header (IHL: 5, Total Length: ${ip.totalLength})`,
        `Source IP: ${ip.srcIp}`,
        `Destination IP: ${ip.dstIp}`,
        `Protocol: ${ip.protocol}`,
        `TTL (Time To Live): ${ip.ttl}`,
        `Identification: ${ip.identification}`,
        `Flags: ${ip.flags}`
      ]
    };
    result.layers.push(l3);

    if (ip.protocol === 'ICMP' && ip.payload) {
      const icmp = ip.payload;
      const typeStr = icmp.type === 'ECHO_REQUEST' ? 'Echo Request (Type 8)' :
                      icmp.type === 'ECHO_REPLY' ? 'Echo Reply (Type 0)' :
                      icmp.type === 'TIME_EXCEEDED' ? 'TTL Expired (Type 11)' :
                      'Destination Unreachable (Type 3)';
      const l4 = {
        layer: 4,
        name: 'Transport / Control (ICMP)',
        short: `${icmp.type}`,
        details: [
          `ICMP Header`,
          `Type & Code: ${typeStr}, Code 0`,
          `Identifier: ${icmp.identifier}`,
          `Sequence Number: ${icmp.sequenceNumber}`,
          `Checksum: ${icmp.checksum}`,
          `Payload Size: ${icmp.data ? icmp.data.length : 32} bytes`
        ]
      };
      result.layers.push(l4);
      result.summary = `ICMP ${icmp.type}: ${ip.srcIp} -> ${ip.dstIp}`;
    } else if (ip.protocol === 'UDP' && ip.payload) {
      const udp = ip.payload;
      const l4 = {
        layer: 4,
        name: 'Transport (UDP)',
        short: `UDP Port ${udp.srcPort} -> ${udp.dstPort}`,
        details: [
          `UDP Header`,
          `Source Port: ${udp.srcPort}`,
          `Destination Port: ${udp.dstPort}`,
          `Length: ${udp.length} bytes`,
          `Checksum: ${udp.checksum}`
        ]
      };
      result.layers.push(l4);

      if (udp.payload instanceof DHCPMessage) {
        const dhcp = udp.payload;
        const l7 = {
          layer: 7,
          name: 'Application (DHCP)',
          short: `DHCP ${dhcp.type}`,
          details: [
            `DHCP Message Type: ${dhcp.type}`,
            `Transaction ID (xid): 0x${dhcp.xid.toString(16).toUpperCase()}`,
            `Client IP (ciaddr): ${dhcp.ciaddr}`,
            `Your IP (yiaddr): ${dhcp.yiaddr}`,
            `Server IP (siaddr): ${dhcp.siaddr}`,
            `Client MAC (chaddr): ${dhcp.chaddr}`,
            `Option Subnet Mask: ${dhcp.options.subnetMask || 'N/A'}`,
            `Option Router (Gateway): ${dhcp.options.router || 'N/A'}`,
            `Option Domain Name Server: ${dhcp.options.dns || 'N/A'}`
          ]
        };
        result.layers.push(l7);
        result.summary = `DHCP ${dhcp.type}: yiaddr=${dhcp.yiaddr}`;
      } else if (udp.payload instanceof DNSMessage) {
        const dns = udp.payload;
        const l7 = {
          layer: 7,
          name: 'Application (DNS)',
          short: `DNS ${dns.type}`,
          details: [
            `DNS Message Type: ${dns.type}`,
            `Transaction ID: 0x${dns.txId.toString(16).toUpperCase()}`,
            dns.question ? `Question: ${dns.question.name} (Type ${dns.question.type})` : 'Question: None',
            ...(dns.answers && dns.answers.length > 0 
                ? dns.answers.map(a => `Answer: ${a.name} -> ${a.ip} (TTL: ${a.ttl}s)`) 
                : ['Answers: 0'])
          ]
        };
        result.layers.push(l7);
        result.summary = `DNS ${dns.type}: ${dns.question ? dns.question.name : ''}`;
      } else {
        result.summary = `UDP ${udp.srcPort} -> ${udp.dstPort}`;
      }
    } else if (ip.protocol === 'TCP' && ip.payload) {
      const tcp = ip.payload;
      const l4 = {
        layer: 4,
        name: 'Transport (TCP)',
        short: `TCP Port ${tcp.srcPort} -> ${tcp.dstPort} [${tcp.flags}]`,
        details: [
          `TCP Header`,
          `Source Port: ${tcp.srcPort}`,
          `Destination Port: ${tcp.dstPort}`,
          `Flags: [${tcp.flags}]`,
          `Sequence Number: ${tcp.seq}`,
          `Acknowledgment Number: ${tcp.ack}`,
          `Window Size: ${tcp.window}`
        ]
      };
      result.layers.push(l4);

      if (tcp.payload instanceof HTTPMessage) {
        const http = tcp.payload;
        const l7 = {
          layer: 7,
          name: 'Application (HTTP)',
          short: http.type === 'REQUEST' ? `${http.method} ${http.uri}` : `HTTP/1.1 ${http.status} ${http.statusText}`,
          details: [
            http.type === 'REQUEST'
              ? `HTTP Request: ${http.method} ${http.uri} ${http.version}`
              : `HTTP Response: ${http.version} ${http.status} ${http.statusText}`,
            `Headers: ${JSON.stringify(http.headers)}`,
            `Body Preview: ${http.body ? http.body.substring(0, 100) + '...' : '(Empty)'}`
          ]
        };
        result.layers.push(l7);
        result.summary = http.type === 'REQUEST' ? `HTTP ${http.method} ${http.uri}` : `HTTP ${http.status} ${http.statusText}`;
      } else if (tcp.payload instanceof PrintJobMessage) {
        const pj = tcp.payload;
        const l7 = {
          layer: 7,
          name: 'Application (Network Print / JetDirect 9100)',
          short: pj.type === 'SUBMIT' ? `Print: ${pj.documentName}` : `Print Status: ${pj.status}`,
          details: [
            `Print Protocol: RAW / HP JetDirect (TCP Port 9100)`,
            `Message Type: ${pj.type}`,
            `Document Name: ${pj.documentName}`,
            `Pages: ${pj.pages}`,
            `Status: ${pj.status}`
          ]
        };
        result.layers.push(l7);
        result.summary = pj.type === 'SUBMIT' ? `Print Job: ${pj.documentName}` : `Print ACK: ${pj.status}`;
      } else {
        result.summary = `TCP [${tcp.flags}]: ${tcp.srcPort} -> ${tcp.dstPort}`;
      }
    }
  }

  result.inLayers = [...result.layers];
  result.outLayers = [...result.layers];
  return result;
}
