#!/usr/bin/env python3
import os
import sys
import argparse
import shutil
import shelve
from hashlib import md5
from itertools import zip_longest
from datetime import datetime
# from bplustree import BPlusTree
from wrangling import common, otf2, phylanx

parser = argparse.ArgumentParser(description='Bundle data directly from phylanx stdout, individual tree / performance / graph files, OTF2 traces, and/or source code files')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Where to store the bundled data (default: /tmp/traveler-integrated')
parser.add_argument('-i', '--input', dest='input', type=argparse.FileType('r'), default=[], action='append',
                    help='STDOUT from phylanx run as a file or pipe (should contain the tree, graph, and performance CSV)')
parser.add_argument('-t', '--tree', dest='tree', type=argparse.FileType('r'), default=[], action='append',
                    help='Input newick tree as its own file')
parser.add_argument('-p', '--performance', dest='performance', type=argparse.FileType('r'), default=[], action='append',
                    help='Input performance CSV as its own file')
parser.add_argument('-g', '--graph', dest='graph', type=argparse.FileType('r'), default=[], action='append',
                    help='Input DOT-formatted links as its own file')
parser.add_argument('-o', '--otf2', dest='otf2', default=[], action='append',
                    help='Input otf2 trace file (e.g. OTF2_archive/APEX.otf2)')
parser.add_argument('-c', '--code', dest='code', type=argparse.FileType('r'), default=[], action='append',
                    help='Input source code file')
parser.add_argument('-l', '--label', dest='label', default=[], action='append',
                    help='Label for input / otf2 / code combination; defaults to modification timestamp of --input or --otf2. Providing a label that already exists in the database will overwrite any previous data')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information')
parser.add_argument('-u', '--guids', dest='guids', action='store_true',
                    help='Collect GUIDs')
parser.add_argument('-e', '--events', dest='events', action='store_true',
                    help='Collect all events, not just ranges')

if __name__ == '__main__':
    args = parser.parse_args()
    db = common.loadDatabase(args.dbDir)

    for phylanxLog, tree, performance, graph, otf2path, code, label in zip_longest(args.input, args.tree, args.performance, args.graph, args.otf2, args.code, args.label):
        try:
            if phylanxLog is not None and os.path.exists(phylanxLog.name):
                timestamp = datetime.fromtimestamp(os.path.getmtime(phylanxLog.name))
            elif tree is not None and os.path.exists(tree.name):
                timestamp = datetime.fromtimestamp(os.path.getmtime(tree.name))
            elif performance is not None and os.path.exists(performance.name):
                timestamp = datetime.fromtimestamp(os.path.getmtime(performance.name))
            elif graph is not None and os.path.exists(graph.name):
                timestamp = datetime.fromtimestamp(os.path.getmtime(graph.name))
            elif otf2 is not None and os.path.exists(otf2path):
                timestamp = datetime.fromtimestamp(os.path.getmtime(otf2path))
            else:
                raise Exception('At least one of: --input, --tree, --performance, --graph, or --otf2 is required')

            if label is None:
                label = md5(timestamp.isoformat().encode('utf-8')).hexdigest()

            common.log('#################' + ''.join(['#' for x in range(len(label))]))
            common.log('Adding data for: %s' % label)

            # Set up the database
            dbDir = os.path.join(args.dbDir, label)
            if not os.path.exists(dbDir):
                os.makedirs(dbDir)
            db[label] = db.get('label', {})

            meta = db[label]['meta'] = shelve.open(os.path.join(dbDir, 'meta.shelf'))
            meta['label'] = label
            meta['timestamp'] = timestamp.isoformat()

            # Regardless of what data we're given, we'll want regions and the debug setting
            db[label]['regions'] = shelve.open(os.path.join(dbDir, 'regions.shelf'))
            kwargs = {
                'regions': db[label]['regions'],
                'debug': args.debug
            }

            # Handle the performance file
            if performance is not None:
                nr, sr = phylanx.processPerfFile(performance, **kwargs)
                common.log('Finished parsing performance CSV')
                common.log('New regions: %d, Observed existing regions: %d' % (nr, sr))

            # Everything except for the performance file needs regionLinks as well as regions
            db[label]['regionLinks'] = shelve.open(os.path.join(dbDir, 'regionLinks.shelf'))
            kwargs['regionLinks'] = db[label]['regionLinks']

            # Handle stdout from phylanx
            if phylanxLog is not None:
                if tree is not None or performance is not None or graph is not None:
                    raise Exception('If the full phylanx output is provided, I can\'t process (don\'t need?) separate tree, performance, or graph files')
                # The full phylanx parser handles all logging internally
                meta['coreTree'], meta['time'] = phylanx.parsePhylanxLog(phylanxLog, **kwargs)

            # Handle the tree file
            if tree is not None:
                coreTree, nr, sr, nl, sl = phylanx.processTree(tree.read(), **kwargs)
                common.log('Finished parsing newick tree')
                common.log('New regions: %d, Observed existing regions: %d' % (nr, sr))
                common.log('New links: %d, Observed existing links: %d' % (nl, sl))

            # Handle the dot graph file
            if graph is not None:
                nr, sr, nl, sl = phylanx.processDotFile(graph, **kwargs)
                common.log('Finished parsing DOT graph')
                common.log('New regions: %d, References to existing regions: %d' % (nr, sr))
                common.log('New links: %d, Observed existing links: %d' % (nl, sl))

            # Handle otf2
            if otf2path is not None:
                db[label]['ranges'] = kwargs['ranges'] = shelve.open(os.path.join(dbDir, 'ranges.shelf'))
                meta['ranges'] = True
                if args.guids:
                    db[label]['guids'] = kwargs['guids'] = shelve.open(os.path.join(dbDir, 'guids.shelf'))
                    meta['guids'] = True
                if args.events:
                    db[label]['events'] = kwargs['events'] = shelve.open(os.path.join(dbDir, 'events.shelf'))
                    meta['events'] = True
                # Otf2 parsing handles its logging internally
                otf2.parseOtf2(otf2path, **kwargs)

            # Handle code
            if code is not None:
                meta['code'] = code.read()

            # Save all the data
            meta.sync()
            db[label]['regions'].sync()
            db[label]['regionLinks'].sync()
        except: #pylint: disable=W0702
            common.log('Error encountered; purging corrupted data for: %s' % label)
            if os.path.exists(dbDir):
                shutil.rmtree(dbDir)
            raise
