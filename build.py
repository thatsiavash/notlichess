#!/usr/bin/env python3
"""Builds index.html from src/.

The page is src/page.html with src/app.css in its <style> and the scripts
listed in src/js/ORDER, joined exactly as they are, in its <script>. Edit the
files in src/, run `python3 build.py`, and commit both src/ and index.html
(Render serves index.html as it is; there is no build step on the server)."""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding='utf-8') as f:
        return f.read()


page = read('page.html')
css = read('app.css')
order = [line.strip() for line in read('js', 'ORDER').splitlines() if line.strip()]
js = ''.join(read('js', name) for name in order)
out = page.replace('/*@CSS*/', css, 1).replace('/*@JS*/', js, 1)

# house style: the product never uses an em dash, comments included
if '—' in out:
    sys.exit('build.py: an em dash (U+2014) crept into src/; use a comma, colon or period')

with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('index.html: %d characters, %d scripts' % (len(out), len(order)))
