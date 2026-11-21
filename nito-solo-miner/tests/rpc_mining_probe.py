#!/usr/bin/env python3
"""Read-only Nito mining + wallet RPC capability probe.

Usage:
  NITO_RPC_USER=... NITO_RPC_PASSWORD=... python3 tests/rpc_mining_probe.py
Optional: NITO_RPC_URL=http://127.0.0.1:8825
It does not create wallets, submit blocks, or mutate node state.
"""
import base64
import json
import os
import sys
import urllib.request
import urllib.error

URL = os.getenv("NITO_RPC_URL", "http://127.0.0.1:8825")
USER = os.environ.get("NITO_RPC_USER")
PASSWORD = os.environ.get("NITO_RPC_PASSWORD")
if not USER or not PASSWORD:
    sys.exit("Set NITO_RPC_USER and NITO_RPC_PASSWORD.")

def rpc(method, params=None):
    payload = json.dumps({"jsonrpc": "1.0", "id": "nito-probe", "method": method, "params": params or []}).encode()
    req = urllib.request.Request(URL, payload, headers={"Content-Type": "application/json"})
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"RPC HTTP {e.code}: {e.reason}")
    except Exception as e:
        sys.exit(f"RPC connection failed: {e}")
    if body.get("error"):
        return None, body["error"]
    return body.get("result"), None

def require(method, params=None):
    result, error = rpc(method, params)
    if error:
        sys.exit(f"RPC {method} failed: {error}")
    return result

info = require("getblockchaininfo")
print(f"Node OK: chain={info.get('chain')} height={info.get('blocks')}")

template = require("getblocktemplate", [{"rules": ["segwit"]}])
required = ("previousblockhash", "height", "version", "bits", "target", "curtime", "mintime", "coinbasevalue", "transactions")
missing = [k for k in required if k not in template]
if missing:
    sys.exit("GBT missing fields: " + ", ".join(missing))
if not isinstance(template["transactions"], list):
    sys.exit("GBT transactions is not a list")
for i, tx in enumerate(template["transactions"]):
    if not isinstance(tx.get("data"), str) or not isinstance(tx.get("txid"), str):
        sys.exit(f"GBT transaction #{i} lacks complete data or txid")
    if not isinstance(tx.get("depends", []), list):
        sys.exit(f"GBT transaction #{i} depends is not a list")
print(f"GBT OK: height={template['height']} txs={len(template['transactions'])} bits={template['bits']}")

# 'help <command>' is read-only and allows capability detection without
# loading/creating a wallet. A node-only build should fail this section.
wallet_commands = ("createwallet", "loadwallet", "backupwallet", "restorewallet", "getnewaddress")
for command in wallet_commands:
    help_text, error = rpc("help", [command])
    if error or not isinstance(help_text, str) or not help_text.strip():
        sys.exit(f"Wallet RPC unavailable ({command}); likely a NO_WALLET build: {error}")
print("Wallet RPC help OK: " + ", ".join(wallet_commands))
print("Probe passed. This does NOT validate Stratum, share verification, or block submission.")
