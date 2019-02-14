#!/usr/bin/env python3
import os
import argparse
import json
import subprocess
import shutil
import shelve
from itertools import zip_longest
from datetime import datetime
from flask import Flask
# from bplustree import BPlusTree
from wrangling import log, parsePhylanxLog, parseOtf2, getExistingData

parser = argparse.ArgumentParser(description='Collect stdout and/or OTF2 trace data from a phylanx run')
parser.add_argument('-i', '--input', dest='input', type=argparse.FileType('r'), default=[], action='append',
                    help='stdout from phylanx run as a file or pipe')
parser.add_argument('-o', '--otf2', dest='otf2', default=[], action='append',
                    help='Input otf2 trace file (e.g. test_data/OTF2_archive/APEX.otf2)')
parser.add_argument('-c', '--code', dest='code', type=argparse.FileType('r'), default=[], action='append',
                    help='Input source code file')
parser.add_argument('-l', '--label', dest='label', default=[], action='append',
                    help='Label for input / otf2 / code combination; defaults to modification timestamp of --input or --otf2. Providing a label that already exists in the database will overwrite any previous data')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Where to store data (default: /tmp/traveler-integrated')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Collect additional debugging information')
parser.add_argument('-g', '--guids', dest='guids', action='store_true',
                    help='Collect GUIDs')
parser.add_argument('-e', '--events', dest='events', action='store_true',
                    help='Collect all events, not just ranges')

args = parser.parse_args()
db = getExistingData(args.dbDir)
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
    for phylanxLog, otf2, code, label in zip_longest(args.input, args.otf2, args.code, args.label):
        if phylanxLog is not None and os.path.exists(phylanxLog.name):
            timestamp = datetime.fromtimestamp(os.path.getmtime(phylanxLog.name)).isoformat()
        elif otf2 is not None and os.path.exists(otf2.name):
            timestamp = datetime.fromtimestamp(os.path.getmtime(otf2.name)).isoformat()
        else:
            raise Exception('At least --input or --otf2 is required')

        # Set up the collection
        if label is None:
            # Try to get modification dates from the input or otf2 trace files
            label = timestamp
        
        log('################')
        log('Adding data for: %s' % label)

        # Clean out any data that may already exist
        dbDir = os.path.join(args.dbDir, label)
        if os.path.exists(dbDir):
            del db[label]
            shutil.rmtree(dbDir)
        db[label] = {}
        os.makedirs(dbDir)

        meta = db[label]['meta'] = shelve.open(os.path.join(dbDir, 'meta.shelf'))
        meta['label'] = label
        meta['timestamp'] = timestamp
        
        # Regardless of what data we're given, we'll want regions, regionLinks, and the debug setting
        db[label]['regions'] = shelve.open(os.path.join(dbDir, 'regions.shelf'))
        db[label]['regionLinks'] = shelve.open(os.path.join(dbDir, 'regionLinks.shelf'))
        kwargs = {
            'regions': db[label]['regions'],
            'regionLinks': db[label]['regionLinks'],
            'debug': args.debug
        }

        # Handle stdout from phylanx
        if phylanxLog is not None:
            meta['coreTree'], meta['time'] = parsePhylanxLog(phylanxLog, **kwargs)

        # Handle otf2
        if otf2 is not None:
            db[label]['ranges'] = kwargs['ranges'] = shelve.open(os.path.join(dbDir, 'ranges.shelf'))
            if args.guids:
                db[label]['guids'] = kwargs['guids'] = shelve.open(os.path.join(dbDir, 'guids.shelf'))
            if args.events:
                db[label]['events'] = kwargs['events'] = shelve.open(os.path.join(dbDir, 'events.shelf'))
            otfPipe = subprocess.Popen(['otf2-print', otf2], stdout=subprocess.PIPE)
            parseOtf2(otfPipe, **kwargs)
        
        # Handle code
        if code is not None:
            meta['code'] = code.read()
        
        # Save all the data
        meta.sync()
        db[label]['regions'].sync()
        db[label]['regionLinks'].sync()

    app.run()