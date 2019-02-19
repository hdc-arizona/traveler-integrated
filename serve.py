#!/usr/bin/env python3
import argparse
import json
from flask import Flask
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

# TODO: add endpoints for querying ranges, guids, and maybe individual events

@app.route('/<path:path>')
def static_proxy(path):
    # send_static_file will guess the correct MIME type
    return app.send_static_file(path)

if __name__ == '__main__':
    app.run()
