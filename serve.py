#!/usr/bin/env python3
import sys
import argparse
import json
from processInputs import processInputs
from flask import Flask

parser = argparse.ArgumentParser(description='Collect stdout and/or OTF2 trace data from a phylanx run')
parser.add_argument('-i', '--input', dest='input', type=argparse.FileType('r'), nargs='?',
                    help='stdout from phylanx run as a file; alternatively, you can omit this argument and pipe the phylanx output directly into this script')
parser.add_argument('-o', '--otf2', dest='otf2',
                    help='The input otf2 trace file (e.g. test_data/OTF2_archive/APEX.otf2)')
parser.add_argument('-t', '--temp_dir', dest='tempDir', default='/tmp',
                    help='A directory for storing temporary files (default: /tmp')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Collect additional debugging information')
parser.add_argument('-g', '--guids', dest='guids', action='store_true',
                    help='Collect GUIDs')
parser.add_argument('-e', '--events', dest='events', action='store_true',
                    help='Collect all events, not just ranges')

args = parser.parse_args()
data = processInputs(args)
app = Flask(__name__)

@app.route('/')
def main():
    return app.send_static_file('index.html')

@app.route('/coreTree')
def coreTree():
    return json.dumps(data['coreTree'])

@app.route('/regions')
def regions():
    return json.dumps(data['regions'])

@app.route('/regionLinks')
def regionLinks():
    return json.dumps(data['regionLinks'])

@app.route('/locations')
def locations():
    return json.dumps(data['locations'])

# TODO: add endpoints for querying ranges, guids, and maybe individual events
@app.route('/ranges')
def ranges():
    return json.dumps(dict(data['ranges']))

@app.route('/guids')
def guids():
    return json.dumps(dict(data['guids']))

@app.route('/events')
def events():
    return json.dumps(dict(data['events']))

@app.route('/<path:path>')
def static_proxy(path):
    # send_static_file will guess the correct MIME type
    return app.send_static_file(path)

if __name__ == '__main__':
    app.run()