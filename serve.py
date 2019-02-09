#!/usr/bin/env python3
import sys
import argparse
from processInputs import processInputs
from flask import Flask

parser = argparse.ArgumentParser(description='Collect stdout and/or OTF2 trace data from a phylanx run')
parser.add_argument('-i', '--input', dest='input', default=sys.stdin, type=argparse.FileType('r'), nargs='?',
                    help='stdout from phylanx run as a file; alternatively, you can omit this argument and pipe the phylanx output directly into this script')
parser.add_argument('-o', '--otf2', dest='otf2',
                    help='The input otf2 trace file (e.g. test_data/OTF2_archive/APEX.otf2)')
parser.add_argument('-t', '--temp_dir', dest='tempDir', default='/tmp',
                    help='A directory for storing temporary files (default: /tmp')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Collect additional debugging information')

args = parser.parse_args()
data = processInputs(args)
app = Flask(__name__)

@app.route('/')
def main():
    return app.send_static_file('index.html')

@app.route('/<path:path>')
def static_proxy(path):
    # send_static_file will guess the correct MIME type
    return app.send_static_file(path)

if __name__ == '__main__':
    app.run()