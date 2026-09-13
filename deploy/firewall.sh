#!/bin/sh
set -eu
# Leave Docker FORWARD/NAT rules and the Amnezia UDP listener untouched.
iptables -N WEBMTV_INPUT 2>/dev/null || true
iptables -F WEBMTV_INPUT
iptables -A WEBMTV_INPUT -i lo -j ACCEPT
iptables -A WEBMTV_INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A WEBMTV_INPUT -m conntrack --ctstate INVALID -j DROP
iptables -A WEBMTV_INPUT -p icmp -j ACCEPT
iptables -A WEBMTV_INPUT -p udp --dport 49621 -j ACCEPT
iptables -A WEBMTV_INPUT -p tcp --dport 22 -j ACCEPT
iptables -A WEBMTV_INPUT -p tcp -m multiport --dports 80,443 --syn -m hashlimit --hashlimit-above 30/second --hashlimit-burst 60 --hashlimit-mode srcip --hashlimit-name webmtv_syn -j DROP
iptables -A WEBMTV_INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -A WEBMTV_INPUT -j DROP
iptables -C INPUT -j WEBMTV_INPUT 2>/dev/null || iptables -A INPUT -j WEBMTV_INPUT
ip6tables -N WEBMTV_INPUT 2>/dev/null || true
ip6tables -F WEBMTV_INPUT
ip6tables -A WEBMTV_INPUT -i lo -j ACCEPT
ip6tables -A WEBMTV_INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A WEBMTV_INPUT -p ipv6-icmp -j ACCEPT
ip6tables -A WEBMTV_INPUT -p udp --dport 49621 -j ACCEPT
ip6tables -A WEBMTV_INPUT -p tcp -m multiport --dports 22,80,443 -j ACCEPT
ip6tables -A WEBMTV_INPUT -j DROP
ip6tables -C INPUT -j WEBMTV_INPUT 2>/dev/null || ip6tables -A INPUT -j WEBMTV_INPUT
