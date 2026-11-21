#!/usr/bin/env python3
"""Read-only RPC compatibility probe for Nito solo-mining development.

Usage:
  NITO_RPC_USER=... NITO_RPC_PASSWORD=... python3 tests/rpc_mining_probe.py
Optional: NITO_RPC_URL=http://127.0.0.1:8825
"""
import json
import os
import sys
import urllib.request
import urllib.error
import base64

URL = os.getenv("NITO_RPC_URL", "http://127.0.0.1:8825")
USER = os.environ.get("NITO_RPC_USER")
PASSWORD = os.environ.get("NITO_RPC_PASSWORD")
if not USER or not PASSWORD:
    sys.exit("Set NITO_RPC_USER and NITO_RPC_PASSWORD; no credentials are read from files.")

def rpc(method, params=None):
    payload = json.dumps({"jsonrpc": "1.0", "id": "nito-mining-probe", "method": method, "params": params or []}).encode()
    req = urllib.request.Request(URL, payload, headers={"Content-Type": "application/json"})
    token = base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
    req.add_header("Authorization", "Basic " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"RPC HTTP {e.code}: {e.reason} (check node RPC config/network)")
    except Exception as e:
        sys.exit(f"RPC request failed: {e}")
    if body.get("error"):
        sys.exit(f"RPC {method} error: {body['error']}")
    return body.get("result")

info = rpc("getblockchaininfo")
print(f"Node: chain={info.get('chain')} blocks={info.get('blocks')} headers={info.get('headers')}")

template = rpc("getblocktemplate", [{"rules": ["segwit"]}])
required = ("previousblockhash", "height", "version", "bits", "target", "curtime", "mintime", "coinbasevalue", "transactions")
missing = [key for key in required if key not in template]
if missing:
    sys.exit("Template missing required fields: " + ", ".join(missing))
if not isinstance(template["transactions"], list):
    sys.exit("Template transactions field is not an array")
print("GBT OK:")
print(f"  height={template['height']} previous={template['previousblockhash']}")
print(f"  bits={template['bits']} target={template['target']} coinbasevalue={template['coinbasevalue']}")
print(f"  tx_count={len(template['transactions'])} rules={template.get('rules', [])}")
print("Probe passed. This does not test Stratum job conversion, share validation, or submitblock.")
