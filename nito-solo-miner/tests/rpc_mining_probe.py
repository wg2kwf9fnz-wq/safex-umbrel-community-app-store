#!/usr/bin/env python3
"""Read-only RPC compatibility probe for Nito solo-mining development.

Usage:
  NITO_RPC_USER=... NITO_RPC_PASSWORD=... python3 tests/rpc_mining_probe.py
Optional: NITO_RPC_URL=http://127.0.0.1:8825
Optional: NITO_RPC_COOKIE_FILE=/path/to/.cookie (preferred when node uses cookie auth)
Optional: NITO_GBT_FIXTURE_PATH=./nito-v4-GBT-fixture.json (writes raw template with mode 0600)
"""
import json
import os
import sys
import urllib.request
import urllib.error
import base64
import pathlib

URL = os.getenv("NITO_RPC_URL", "http://127.0.0.1:8825")
COOKIE_FILE = os.getenv('NITO_RPC_COOKIE_FILE')
if COOKIE_FILE:
    cookie = pathlib.Path(COOKIE_FILE).read_text().strip()
    if ':' not in cookie:
        sys.exit('Invalid RPC cookie file format')
    USER, PASSWORD = cookie.split(':', 1)
else:
    USER = os.environ.get('NITO_RPC_USER')
    PASSWORD = os.environ.get('NITO_RPC_PASSWORD')
    if not USER or not PASSWORD:
        sys.exit('Set NITO_RPC_COOKIE_FILE or both NITO_RPC_USER and NITO_RPC_PASSWORD')

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

def compact_target(bits):
    compact = int(bits, 16)
    exponent = compact >> 24
    mantissa = compact & 0x007fffff
    if compact & 0x00800000 or mantissa == 0:
        raise ValueError('negative/zero compact target')
    target = mantissa >> (8 * (3 - exponent)) if exponent <= 3 else mantissa << (8 * (exponent - 3))
    if target <= 0 or target >= 1 << 256:
        raise ValueError('compact target overflow')
    return f'{target:064x}'

try:
    decoded_target = compact_target(template['bits'])
except Exception as e:
    sys.exit(f'Invalid compact bits: {e}')
if decoded_target != template['target'].lower():
    sys.exit(f"GBT target mismatch: bits decode to {decoded_target}, RPC target is {template['target']}")
print('  compact bits and full target agree')
for index, tx in enumerate(template['transactions']):
    if not all(key in tx for key in ('data', 'txid', 'hash', 'depends')):
        sys.exit(f'GBT transaction {index} is missing required raw metadata')
    if not isinstance(tx['data'], str) or not tx['data'] or len(tx['data']) % 2:
        sys.exit(f'GBT transaction {index} raw data is malformed hex')
    try:
        bytes.fromhex(tx['data'])
    except ValueError:
        sys.exit(f'GBT transaction {index} raw data is malformed hex')
print('  transaction envelope fields and raw hex are present')
if template.get('default_witness_commitment'):
    print(f"  default_witness_commitment={template['default_witness_commitment']}")
if template.get('coinbaseaux'):
    print(f"  coinbaseaux={template['coinbaseaux']}")
print(f"  tx_count={len(template['transactions'])} rules={template.get('rules', [])}")

fixture_path = os.getenv('NITO_GBT_FIXTURE_PATH')
if fixture_path:
    path = pathlib.Path(fixture_path)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, 'w') as fixture:
        json.dump(template, fixture, indent=2)
    os.chmod(path, 0o600)
    print(f"Saved raw GBT fixture to {path} (0600; contains raw transaction data)")
print("Probe passed. This does not test Stratum job conversion, share validation, or submitblock.")
