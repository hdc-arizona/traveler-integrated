#!/usr/bin/env python3
import os
import argparse
import json
import subprocess
from itertools import zip_longest
from datetime import datetime
from pymongo import MongoClient
from flask import Flask
from wrangling import log, parsePhylanxLog, parseOtf2

parser = argparse.ArgumentParser(description='Collect stdout and/or OTF2 trace data from a phylanx run')
parser.add_argument('-i', '--input', dest='input', type=argparse.FileType('r'), default=[], action='append',
                    help='stdout from phylanx run as a file or pipe')
parser.add_argument('-o', '--otf2', dest='otf2', default=[], action='append',
                    help='Input otf2 trace file (e.g. test_data/OTF2_archive/APEX.otf2)')
parser.add_argument('-c', '--code', dest='code', type=argparse.FileType('r'), default=[], action='append',
                    help='Input source code file')
parser.add_argument('-l', '--label', dest='label', default=[], action='append',
                    help='Label for input / otf2 / code combination; defaults to modification timestamp of --input or --otf2. Providing a label that already exists in the database will overwrite any previous data')
parser.add_argument('-m', '--mongo', dest='mongo', default='mongodb://localhost:27017',
                    help='The mongo database to use (default: mongodb://localhost:27017)')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Collect additional debugging information')
parser.add_argument('-g', '--guids', dest='guids', action='store_true',
                    help='Collect GUIDs')
parser.add_argument('-e', '--events', dest='events', action='store_true',
                    help='Collect all events, not just ranges')

args = parser.parse_args()
client = MongoClient(args.mongo)
db = client.get_database('traveler')
app = Flask(__name__)

@app.route('/')
def main():
    return app.send_static_file('index.html')

@app.route('/labels')
def labels():
    return json.dumps(db.list_collection_names())

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
        meta = db.meta.find_one({'_id': label}) or {'_id': label}
        meta['timestamp'] = timestamp

        # Clean out any data that may already exist (todo: maybe smarter ways to save data?)
        for key, collectionId in meta.items():
            if key == '_id' or key == 'coreTree' or key == 'timestamp' or key == 'time':
                # skip keys that don't refer to collections
                continue
            db[collectionId].drop()
        
        # Regardless of what data we're given, we'll want regions, regionLinks, and the debug setting
        meta['regions'] = label + '_regions'
        meta['regionLinks'] = label + '_regionLinks'
        kwargs = {
            'regions': db[meta['regions']],
            'regionLinks': db[meta['regionLinks']],
            'debug': args.debug
        }
        db.meta.replace_one({'_id': label}, meta, upsert=True)

        # Handle stdout from phylanx
        if phylanxLog is not None:
            meta['coreTree'], meta['time'] = parsePhylanxLog(phylanxLog, **kwargs)
            db.meta.replace_one({'_id': label}, meta, upsert=True)

        # Handle otf2
        if otf2 is not None:
            meta['ranges'] = label + '_ranges'
            kwargs['ranges'] = db[meta['ranges']]
            if args.guids:
                meta['guids'] = label + '_guids'
                kwargs['guids'] = db[meta['guids']]
            if args.events:
                meta['events'] = label + '_events'
                kwargs['events'] = db[meta['events']]
            otfPipe = subprocess.Popen(['otf2-print', otf2], stdout=subprocess.PIPE)
            parseOtf2(otfPipe, **kwargs)
        
        # Handle code
        if code is not None:
            meta['code'] = code.read()        
        
        db.meta.replace_one({'_id': label}, meta, upsert=True)

    app.run()