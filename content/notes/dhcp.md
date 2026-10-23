+++
title = "DHCP"
description = "IP 주소를 할당받는 과정과 DHCP 메시지의 흐름 정리."
tags = ["networking"]
summary = "IP 주소를 할당받는 과정과 DHCP 메시지의 흐름 정리."
draft = false
showToc = true
weight = 7
[extra]
imported = true
source = "DHCP.md"
+++

### 1. DHCP Discover (발견)

- **목적:** 네트워크에 새로 연결된 클라이언트가 DHCP 서버를 찾아 IP 주소 할당을 요청합니다.

- **발신자 (클라이언트):**

    - **Source IP:** `0.0.0.0` (아직 IP 주소가 없으므로)

    - **Destination IP:** `255.255.255.255` (브로드캐스트 주소, 네트워크 내 모든 호스트에게 전송)

    - **Source MAC:** 클라이언트의 실제 MAC 주소

    - **Destination MAC:** `FF:FF:FF:FF:FF:FF` (브로드캐스트 MAC 주소)

- **패킷 내용 (주요 필드):**

    - **Op Code (Operation Code):** `BOOTREQUEST` (클라이언트가 서버로 요청)

    - **Hardware Type:** 이더넷 (1)

    - **Hardware Address Length:** 6 (MAC 주소 길이)

    - **Hops:** 0 (라우터를 거치지 않음)

    - **Transaction ID (xid):** 클라이언트가 생성하는 고유한 식별자. 이 트랜잭션의 모든 메시지(Discover, Offer, Request, ACK)에서 동일하게 사용되어 응답이 어떤 요청에 대한 것인지 식별합니다.

    - **Seconds (secs):** 클라이언트가 부팅을 시작한 후 경과된 시간

    - **Flags:** 브로드캐스트 플래그 (0x8000) - 응답을 브로드캐스트로 받겠다는 의미

    - **Client IP Address (ciaddr):** `0.0.0.0` (아직 IP 없음)

    - **Your IP Address (yiaddr):** `0.0.0.0`

    - **Server IP Address (siaddr):** `0.0.0.0`

    - **Gateway IP Address (giaddr):** `0.0.0.0` (릴레이 에이전트를 거치지 않는 경우)

    - **Client Hardware Address (chaddr):** 클라이언트의 MAC 주소 (예: `00:1A:2B:3C:4D:5E`)

    - **Magic Cookie:** `0x63825363` (RFC 1497에서 정의된 값)

    - **Options:**

        - `DHCP Message Type: Discover`

        - `Parameter Request List`: 클라이언트가 받고자 하는 정보 목록 (예: 서브넷 마스크, 라우터, DNS 서버 등)


### 2. DHCP Offer (제안)

- **목적:** DHCP Discover 메시지를 받은 DHCP 서버가 클라이언트에게 할당 가능한 IP 주소 및 네트워크 설정 정보를 제안합니다.

- **발신자 (DHCP 서버):**

    - **Source IP:** DHCP 서버의 IP 주소

    - **Destination IP:** `255.255.255.255` (클라이언트가 아직 IP가 없으므로 브로드캐스트로 응답) 또는 클라이언트의 `chaddr`로 유니캐스트 (클라이언트가 `ciaddr`를 가지고 있거나, 서버가 클라이언트의 MAC 주소를 알고 직접 전송할 수 있는 경우)

    - **Source MAC:** DHCP 서버의 MAC 주소

    - **Destination MAC:** `FF:FF:FF:FF:FF:FF` (브로드캐스트 MAC 주소) 또는 클라이언트의 실제 MAC 주소

- **패킷 내용 (주요 필드):**

    - **Op Code (Operation Code):** `BOOTREPLY` (서버가 클라이언트로 응답)

    - **Transaction ID (xid):** Discover 메시지와 동일한 값

    - **Your IP Address (yiaddr):** 서버가 클라이언트에게 제안하는 IP 주소 (예: `192.168.1.100`)

    - **Server IP Address (siaddr):** DHCP 서버의 IP 주소

    - **Client Hardware Address (chaddr):** 클라이언트의 MAC 주소

    - **Options:**

        - `DHCP Message Type: Offer`

        - `Subnet Mask`: 제안된 IP 주소의 서브넷 마스크

        - `Router (Gateway)`: 기본 게이트웨이 주소

        - `Domain Name Server`: DNS 서버 주소

        - `IP Address Lease Time`: 제안된 IP 주소의 임대 기간 (초 단위)

        - `DHCP Server Identifier`: 제안을 보낸 DHCP 서버의 IP 주소


### 3. DHCP Request (요청)

- **목적:** 클라이언트가 여러 DHCP 서버로부터 받은 Offer 중 하나를 선택하고, 해당 IP 주소를 사용하겠다고 서버에 최종적으로 요청합니다.

- **발신자 (클라이언트):**

    - **Source IP:** `0.0.0.0` (아직 임시 IP 주소이므로)

    - **Destination IP:** `255.255.255.255` (브로드캐스트)

    - **Source MAC:** 클라이언트의 실제 MAC 주소

    - **Destination MAC:** `FF:FF:FF:FF:FF:FF` (브로드캐스트)

- **패킷 내용 (주요 필드):**

    - **Op Code (Operation Code):** `BOOTREQUEST`

    - **Transaction ID (xid):** Discover, Offer 메시지와 동일한 값

    - **Client Hardware Address (chaddr):** 클라이언트의 MAC 주소

    - **Options:**

        - `DHCP Message Type: Request`

        - `Requested IP Address`: 클라이언트가 요청하는 IP 주소 (Offer에서 받은 `yiaddr` 값)

        - `Server Identifier`: 클라이언트가 선택한 DHCP 서버의 IP 주소 (이 필드를 통해 다른 DHCP 서버들은 자신이 제안했던 IP 주소가 선택되지 않았음을 알게 됩니다.)


### 4. DHCP ACK (승인)

- **목적:** 클라이언트의 Request를 받은 DHCP 서버가 IP 주소 할당을 최종적으로 승인하고, 모든 네트워크 설정 정보를 클라이언트에게 전달합니다.

- **발신자 (DHCP 서버):**

    - **Source IP:** DHCP 서버의 IP 주소

    - **Destination IP:** `255.255.255.255` (브로드캐스트) 또는 클라이언트의 할당된 IP 주소로 유니캐스트

    - **Source MAC:** DHCP 서버의 MAC 주소

    - **Destination MAC:** `FF:FF:FF:FF:FF:FF` (브로드캐스트) 또는 클라이언트의 실제 MAC 주소

- **패킷 내용 (주요 필드):**

    - **Op Code (Operation Code):** `BOOTREPLY`

    - **Transaction ID (xid):** 이전 메시지들과 동일한 값

    - **Your IP Address (yiaddr):** 클라이언트에게 최종적으로 할당된 IP 주소

    - **Server IP Address (siaddr):** DHCP 서버의 IP 주소

    - **Client Hardware Address (chaddr):** 클라이언트의 MAC 주소

    - **Options:**

        - `DHCP Message Type: ACK`

        - `Subnet Mask`: 할당된 서브넷 마스크

        - `Router (Gateway)`: 기본 게이트웨이 주소

        - `Domain Name Server`: DNS 서버 주소

        - `IP Address Lease Time`: 최종 임대 기간

        - `DHCP Server Identifier`: 승인한 DHCP 서버의 IP 주소



### 주요 DHCP 취약점 및 공격 유형

1. **Rogue DHCP Server (악성 DHCP 서버) 공격:**

    - **취약점:** DHCP 클라이언트가 IP 주소를 요청할 때, 가장 먼저 응답하는 DHCP 서버의 제안을 받아들이는 경향이 있습니다. 프로토콜 자체에 서버의 정당성을 검증하는 기능이 없습니다.

    - **공격 방식:** 공격자가 네트워크에 악성 DHCP 서버를 설치하고, 합법적인 DHCP 서버보다 빠르게 클라이언트의 DHCP Discover 요청에 응답합니다. 악성 서버는 클라이언트에게 잘못된 IP 주소, 서브넷 마스크, 게이트웨이, DNS 서버 주소 등을 할당합니다.

    - **영향:**

        - **서비스 거부(DoS):** 클라이언트가 잘못된 네트워크 설정을 받아 인터넷 접속이 불가능해집니다.

        - **중간자 공격(Man-in-the-Middle, MITM):** 공격자가 자신의 IP 주소를 게이트웨이로 할당하여 클라이언트의 모든 트래픽을 가로채고 감청하거나 조작할 수 있습니다.

        - **피싱:** 악성 DNS 서버 주소를 할당하여 클라이언트가 가짜 웹사이트로 접속하도록 유도할 수 있습니다.

2. **DHCP Starvation (고갈) 공격:**

    - **취약점:** DHCP 서버는 요청하는 클라이언트에게 IP 주소를 할당할 때, 클라이언트의 MAC 주소를 기반으로 합니다. 공격자는 쉽게 MAC 주소를 위조(Spoofing)할 수 있습니다.

    - **공격 방식:** 공격자가 위조된 MAC 주소를 사용하여 수많은 DHCP Discover 요청 패킷을 DHCP 서버로 보냅니다. DHCP 서버는 이 가짜 요청들에 대해 계속해서 IP 주소를 할당하게 되고, 결국 할당 가능한 모든 IP 주소가 소진됩니다.

    - **영향:**

        - **서비스 거부(DoS):** 합법적인 클라이언트가 IP 주소를 할당받지 못해 네트워크에 접속할 수 없게 됩니다. 이는 특히 새로운 기기가 네트워크에 연결되거나 기존 기기의 IP 임대 기간이 만료될 때 문제가 됩니다.

        - **Rogue DHCP Server 공격과 연계:** IP 주소가 고갈된 상황에서 공격자가 악성 DHCP 서버를 설치하면, 합법적인 클라이언트는 어쩔 수 없이 악성 서버로부터 IP 주소를 받아 네트워크 설정을 조작당할 가능성이 높아집니다.

3. **DHCP Spoofing (스푸핑) / Replay (재전송) 공격:**

    - **취약점:** DHCP 메시지가 평문(plaintext)으로 전송되며, 메시지 무결성을 보장하는 메커니즘이 없습니다.

    - **공격 방식:** 공격자가 네트워크를 스니핑하여 합법적인 DHCP 메시지를 캡처하고, 이를 수정하거나 재전송하여 클라이언트나 서버를 속입니다. 예를 들어, 클라이언트의 DHCP Request 메시지를 가로채거나, 과거의 DHCP Offer 메시지를 재전송하여 혼란을 야기할 수 있습니다.

    - **영향:** IP 주소 및 네트워크 설정 정보의 변조, 네트워크 혼란, 비정상적인 트래픽 발생 등.
