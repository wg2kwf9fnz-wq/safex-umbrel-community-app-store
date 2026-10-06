#!/usr/bin/env python3
"""Builds the GitHub release text for an app from its umbrel-app.yml + docker-compose.yml (no dependencies).
Usage: release_notes.py <app-dir>   -> prints '<version>' on line 1 and the markdown body after a blank line."""
import re, sys
d = sys.argv[1].rstrip('/')
m = open(d + '/umbrel-app.yml').read()
ver = re.search(r'^version:\s*"?([^"\n]+)"?\s*$', m, re.M).group(1).strip()
name = re.search(r'^name:\s*"?([^"\n]+)"?\s*$', m, re.M).group(1).strip()
rn = re.search(r'^releaseNotes:\s*>-?\s*\n((?:[ \t]+.*\n?)+)', m, re.M)
notes = ' '.join(l.strip() for l in rn.group(1).splitlines() if l.strip()) if rn else 'See the commit history for changes.'
images = re.findall(r'^\s*image:\s*(\S+)', open(d + '/docker-compose.yml').read(), re.M)
body = ['## What is new', '', notes, '', '## How to update', '',
        'Open your Umbrel, go to **App Store > Updates** and install **%s %s** (refresh the community store first if it does not show up).' % (name, ver), '',
        '## Container images in this version', ''] + ['- `%s`' % i for i in images]
print(ver)
print()
print('\n'.join(body))
