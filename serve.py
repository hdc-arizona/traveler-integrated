#!/usr/bin/env python3
import argparse
import json
from flask import Flask, abort
# from bplustree import BPlusTree
from wrangling import common

parser = argparse.ArgumentParser(description='Serve data bundled by bundle.py')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is stored (default: /tmp/traveler-integrated')

args = parser.parse_args()
db = common.loadDatabase(args.dbDir)
app = Flask(__name__)

@app.route('/')
def main():
    return app.send_static_file('index.html')

@app.route('/datasets')
def datasets():
    result = {}
    for label, data in db.items():
        result[label] = dict(data['meta'])
    return json.dumps(result)

@app.route('/tree/<string:label>')
def tree(label):
    if label not in db:
        abort(404)
    return json.dumps(db[label]['meta']['coreTree'])

@app.route('/regions/<string:label>')
def regions(label):
    if label not in db:
        abort(404)
    return json.dumps(dict(db[label]['regions']))

# TODO: add endpoints for querying ranges, guids, and maybe individual events

@app.route('/<path:path>')
def static_proxy(path):
    # send_static_file will guess the correct MIME type
    return app.send_static_file(path)

if __name__ == '__main__':
    app.run()
