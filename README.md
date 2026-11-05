# Cisco Packet Tracer Web - Network Simulator (HTML, CSS, JavaScript)

A high-fidelity, web-based network simulation application inspired by **Cisco Packet Tracer**. Built entirely with standard **HTML5, CSS3, and modern vanilla JavaScript (ES6 Modules)** with zero external runtime dependencies.

---

## 🚀 Key Features

### 1. Interactive Topology Workspace (HTML5 Canvas)
- **Device Catalog**: Generic PC, Server, Cisco 2960 Switch (24 ports), and Cisco 1941 Router.
- **Drag & Drop**: Fluid device positioning and automatic cable alignment.
- **Port-to-Port Wiring**: Connect copper cables by picking specific physical interfaces (`Fa0/1`, `Gi0/0`).
- **Real-time LED Status**: Visual link indicators (Green = UP, Orange/Amber = Down/Idle, Red = Shutdown).
- **Smooth Canvas Controls**: Zoom (Mouse Wheel), Pan (Middle-Click or Shift-Drag).

### 2. Discrete Event Simulation (DES) & Packet Animation
- **Dual Simulation Modes**:
  - **Realtime Mode (⚡)**: Instant or continuous animated packet transmission.
  - **Simulation Mode (⏱)**: Discrete step-by-step packet inspection with **Play/Pause**, **Step Forward**, and **Speed Slider**.
- **Packet Envelopes**: Animated envelopes flying along cable paths with protocol tags (Yellow = ARP, Purple = ICMP Request, Cyan = ICMP Reply).
- **Simple PDU Tool**: Click the envelope tool $\rightarrow$ Click Source PC $\rightarrow$ Click Destination PC to trigger an authentic end-to-end Ping with ARP discovery.

### 3. OSI 7-Layer PDU Inspector
- Click on any active flying packet or event log row to inspect:
  - **Layer 1 (Physical)**: Interface name, cable medium, link state.
  - **Layer 2 (Data Link - Ethernet II)**: Source MAC, Destination MAC, EtherType (0x0806 ARP, 0x0800 IPv4), Preamble, FCS.
  - **Layer 3 (Network - IPv4 / ARP)**: Source IP, Destination IP, TTL, Protocol, ARP Operation (Request/Reply).
  - **Layer 4 (Transport / Control - ICMP)**: Type (Echo Request/Reply), Sequence Number, Identifier, Checksum.

### 4. Device State Machines & Protocol Stack
- **Host / PC / Laptop**:
  - **Desktop Window**:
    - **IP Configuration**: Static vs. DHCP toggle with live DHCP negotiation!
    - **Command Prompt**: `ping <ip>`, `ipconfig`, `arp -a`, `cls`, `help`.
    - **Web Browser**: Live URL bar (`http://cisco.local`), DNS name resolution, and real HTML webpage rendering!
  - **ARP Engine**: Local ARP caching, pending packet buffering, ARP Request broadcast, and ARP Reply handling.
- **Server Device (Services Hub)**:
  - **HTTP Server**: Configurable web pages (`/index.html`), responds to TCP port 80 requests with HTML payload.
  - **DHCP Server**: Configurable pool name, subnet mask, default router, and DNS server; automatic IP lease allocation.
  - **DNS Server**: Domain record management (A records mapping names like `cisco.local` to IP addresses).
- **Cisco 2960 Switch (Layer 2 & 802.1Q VLANs)**:
  - 24 FastEthernet ports (`Fa0/1` – `Fa0/24`).
  - **IEEE 802.1Q VLANs & Trunking**:
    - Access ports (untagged frames belonging to port VLAN).
    - Trunk ports (802.1Q tagged frames with native VLAN support).
    - True Layer 2 Broadcast Domain Isolation: Broadcast and unicast traffic are strictly isolated within each VLAN!
  - **CAM Table (MAC Address Table)**: Dynamic MAC learning and aging per VLAN.
  - **Forwarding Engine**: Intelligent broadcast/unknown unicast flooding and known unicast forwarding per VLAN.
- **Cisco 1941 Router (Layer 3 & Router-on-a-Stick)**:
  - Multi-interface routing (`GigabitEthernet0/0`, `0/1`, `0/2`).
  - **Sub-Interfaces (Router-on-a-Stick)**:
    - Logical sub-interfaces e.g. `GigabitEthernet0/0.10` and `GigabitEthernet0/0.20`.
    - `encapsulation dot1Q <vlanId>` tag insertion and stripping.
    - Inter-VLAN routing across distinct subnets over a single physical trunk link!
  - **Routing Table**: Automatic directly connected (`C`) routes for physical interfaces and sub-interfaces, plus static (`S`) routes.
  - **Packet Forwarding**: Longest Prefix Match, TTL decrement, ICMP Time Exceeded generation, and next-hop ARP resolution.

### 5. Cisco IOS Command-Line Interface (CLI)
Double-click any Switch or Router to open the Cisco IOS Terminal:
- Modes:
  - `User EXEC` (`Router>`)
  - `Privileged EXEC` (`Router#`)
  - `Global Configuration` (`Router(config)#`)
  - `Interface Configuration` (`Router(config-if)#`)
  - `VLAN Configuration` (`Switch(config-vlan)#`)
  - `Sub-Interface Configuration` (`Router(config-subif)#`)
- Commands supported:
  - `enable`, `disable`
  - `configure terminal` (`conf t`)
  - `hostname <name>`
  - `vlan <id>` $\rightarrow$ `name <vlan_name>`
  - `interface <name>` (e.g. `interface GigabitEthernet0/0`, `int fa0/1`, `int gi0/0.10`)
  - `switchport mode access` | `switchport mode trunk`
  - `switchport access vlan <vlanId>`
  - `switchport trunk native vlan <vlanId>`
  - `encapsulation dot1Q <vlanId>`
  - `ip address <ip> <subnet_mask>`
  - `no shutdown`, `shutdown`
  - `ip route <network> <mask > <next-hop>`
  - `show ip interface brief`
  - `show ip route`
  - `show vlan brief`
  - `show interfaces trunk`
  - `show mac address-table`
  - `show running-config`
  - `ping <ip>`
  - `?` or `help`
  - Command history (`Up`/`Down` arrows) and `Tab` auto-completion!

### 6. Preloaded Scenarios & JSON Export/Import
- **Basic LAN**: 2 PCs connected to a 2960 Switch on `192.168.1.0/24`.
- **Web, DNS & DHCP Server**: Live DHCP auto-assignment, DNS lookup of `cisco.local`, and HTTP Web page rendering.
- **Router Inter-Subnet**: PC0 (`192.168.1.10`) $\rightarrow$ Switch0 $\rightarrow$ Router0 $\rightarrow$ Switch1 $\rightarrow$ PC1 (`192.168.2.10`).
- **Inter-VLAN (Router-on-a-Stick)**: PC0 (VLAN 10 Sales) and PC1 (VLAN 20 Marketing) isolated on Switch0, routed across subnets through Router0 sub-interfaces (`Gi0/0.10` and `Gi0/0.20`) with IEEE 802.1Q tags!
- **Export / Import**: Save complete network topologies to JSON files and restore them anytime.

---

## 📁 Project Structure

```
cisco/
├── index.html                 # Main UI layout, canvas, palette, and modal dialogs
├── css/
│   └── style.css              # Cisco dark theme, retro terminals, and UI components
├── js/
│   ├── main.js                # App orchestration, presets, and toolbar bindings
│   ├── models/
│   │   ├── protocols.js       # Bitwise IP math, EthernetFrame, ARPPacket, IPv4Packet, ICMPPacket
│   │   └── device.js          # NetworkInterface, Cable, HostDevice, SwitchDevice, RouterDevice
│   ├── engine/
│   │   ├── simulation.js      # Discrete Event Scheduler, animation loop, speed control
│   │   └── cli.js             # Cisco IOS CLI parser and execution state machine
│   └── ui/
│       ├── canvas.js          # High-DPI canvas renderer, vector device icons, cable snapping
│       └── modals.js          # PC Desktop, Command Prompt, Cisco IOS Terminal, PDU Inspector
└── README.md                  # Documentation and architecture guide
```

---

## 🏃 Running the Application

Because this application uses standard ES6 modules (`import`/`export`), it is recommended to run it with any local static web server.

### Option 1: Python HTTP Server (Recommended)
```bash
python3 -m http.server 8000
```
Then open your browser at:
```
http://localhost:8000
```

### Option 2: Node.js (npx serve)
```bash
npx serve .
```

### Option 3: VS Code Live Server
Right-click `index.html` and click **"Open with Live Server"**.

