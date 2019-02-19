#!/usr/bin/env python3
import os
import re
import argparse
import shutil
import shelve
from datetime import datetime
# from bplustree import BPlusTree
from wrangling import common, otf2, phylanx

parser = argparse.ArgumentParser(description='Bundle data directly from phylanx stdout, individual tree / performance / graph files, OTF2 traces, and/or source code files')
parser.add_argument('-l', '--label', dest='label', type=str, default='Latest',
                    help='Label for the bundled dataset (default: "Latest"). Providing a label that already exists in the database will bundle with/overwrite any previous data. If globbing multiple inputs, this should be a regular expression, where the first capturing group indicates which files go together (e.g. --input data/*/phylanxLog.txt --otf2 data/*/OTF2_archive/APEX.otf2 --label data/([^/]*) would merge datasets based on their common directory name)')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory to store the bundled data (default: /tmp/traveler-integrated')
parser.add_argument('-i', '--input', dest='input', type=str, metavar='path', nargs='*', default=[],
                    help='STDOUT from phylanx run as a file or pipe (should contain the tree, graph, and performance CSV)')
parser.add_argument('-t', '--tree', dest='tree', type=str, metavar='path', nargs='*', default=[],
                    help='Input newick tree as its own file')
parser.add_argument('-p', '--performance', dest='performance', type=str, metavar='path', nargs='*', default=[],
                    help='Input performance CSV as its own file')
parser.add_argument('-g', '--graph', dest='graph', type=str, metavar='path', nargs='*', default=[],
                    help='Input DOT-formatted links as its own file')
parser.add_argument('-o', '--otf2', dest='otf2', type=str, metavar='path', nargs='*', default=[],
                    help='Input otf2 trace file (e.g. OTF2_archive/APEX.otf2)')
parser.add_argument('-c', '--code', dest='code', type=str, metavar='path', nargs='*', default=[],
                    help='Input source code file')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information')
parser.add_argument('-u', '--guids', dest='guids', action='store_true',
                    help='Collect GUIDs')
parser.add_argument('-e', '--events', dest='events', action='store_true',
                    help='Collect all events, not just ranges')

if __name__ == '__main__':
    args = vars(parser.parse_args())
    db = common.loadDatabase(args['dbDir'])

    inputs = {}
    r = re.compile(args['label'])
    if r.groups == 0:
        # We're in normal mode; one path per argument
        inputs[args['label']] = {}
        for arg in ['input', 'tree', 'performance', 'graph', 'otf2', 'code']:
            if len(args[arg]) == 1:
                inputs[args['label']][arg] = args[arg][0]
            elif len(args[arg]) > 1:
                raise Exception('To use glob patterns, please provide a regular expression with one capture group as a --label argument')
        if not inputs[args['label']]:
            raise Exception('At least one of: --input, --tree, --performance, --graph, --otf2, and/or --code is required')
    elif r.groups == 1:
        # We're in globbing mode; we can expect many files per argument, and --label should be a regular expression that matches
        # input files to their label
        # The only (possible) exception is the code file: if only one is provided, use it for all labels (otherwise, expect it to
        # match the regular expression as well)
        singleCodeFile = args['code'][0] if len(args['code']) == 1 else None
        for arg in ['input', 'tree', 'performance', 'graph', 'otf2', 'code']:
            if arg == 'code' and singleCodeFile is not None:
                continue
            for path in args[arg]:
                m = r.match(path)
                if m is None:
                    raise Exception('--label pattern could not identify a label for file: %s' % path)
                elif arg == 'code':
                    # There was one instance of the code file matching the
                    singleCodeFile = False
                label = m[1]
                inputs[label] = inputs.get(label, {})
                if arg in inputs[label]:
                    raise Exception('--label pattern found duplicate matches for --%s:\n%s\n%s' % (arg, inputs[label][arg], path))
                inputs[label][arg] = path
        if singleCodeFile is not None:
            for label in inputs:
                inputs[label]['code'] = singleCodeFile
    else:
        raise Exception('Too many capturing groups in the --label argument')


    for label, paths in inputs.items():
        if 'input' in paths and ('tree' in paths or 'performance' in paths or 'graph' in paths):
            raise Exception('Don\'t use --input with --tree, --performance, or --graph for the same --label: %s' % label)
        try:
            common.log('#################' + ''.join(['#' for x in range(len(label))]))
            common.log('Adding data for: %s' % label)

            # Set up the database
            dbDir = os.path.join(args['dbDir'], label)
            if not os.path.exists(dbDir):
                os.makedirs(dbDir)
            db[label] = db.get(label, {})

            meta = db[label]['meta'] = shelve.open(os.path.join(dbDir, 'meta.shelf'))
            meta['label'] = label

            # Grab the timestamps from each input file
            meta['timestamps'] = {}
            for arg, path in paths.items():
                meta['timestamps'][arg] = datetime.fromtimestamp(os.path.getmtime(path)).isoformat()

            # Regardless of what data we're given, we'll want regions and the debug setting
            db[label]['regions'] = shelve.open(os.path.join(dbDir, 'regions.shelf'))
            kwargs = {
                'regions': db[label]['regions'],
                'debug': args['debug']
            }

            # Handle the performance file
            if 'performance' in paths:
                nr, sr, time = phylanx.processPerfFile(paths['performance'], **kwargs)
                meta['time'] = time
                common.log('Finished parsing performance CSV')
                common.log('New regions: %d, Observed existing regions: %d' % (nr, sr))
                common.log('Total inclusive time from performance CSV (ns): %f' % time)

            # Everything except for the performance file needs regionLinks as well as regions
            db[label]['regionLinks'] = shelve.open(os.path.join(dbDir, 'regionLinks.shelf'))
            kwargs['regionLinks'] = db[label]['regionLinks']

            # Handle stdout from phylanx
            if 'input' in paths:
                # The full phylanx parser handles all logging internally
                meta['coreTree'], meta['time'] = phylanx.parsePhylanxLog(paths['input'], **kwargs)

            # Handle the tree file
            if 'tree' in paths:
                with open(paths['tree'], 'r') as file:
                    meta['coreTree'], nr, sr, nl, sl = phylanx.processTree(file.read(), **kwargs)
                    common.log('Finished parsing newick tree')
                    common.log('New regions: %d, Observed existing regions: %d' % (nr, sr))
                    common.log('New links: %d, Observed existing links: %d' % (nl, sl))

            # Handle the dot graph file
            if 'graph' in paths:
                nr, sr, nl, sl = phylanx.processDotFile(paths['graph'], **kwargs)
                common.log('Finished parsing DOT graph')
                common.log('New regions: %d, References to existing regions: %d' % (nr, sr))
                common.log('New links: %d, Observed existing links: %d' % (nl, sl))

            # Handle otf2
            if 'otf2' in paths:
                db[label]['ranges'] = kwargs['ranges'] = shelve.open(os.path.join(dbDir, 'ranges.shelf'))
                meta['ranges'] = True
                if args['guids']:
                    db[label]['guids'] = kwargs['guids'] = shelve.open(os.path.join(dbDir, 'guids.shelf'))
                    meta['guids'] = True
                if args['events']:
                    db[label]['events'] = kwargs['events'] = shelve.open(os.path.join(dbDir, 'events.shelf'))
                    meta['events'] = True
                # Otf2 parsing handles its logging internally
                otf2.parseOtf2(paths['otf2'], **kwargs)
                # Save the extra files
                db[label]['ranges'].sync()
                if args['guids']:
                    db[label]['guids'].sync()
                if args['events']:
                    db[label]['events'].sync()

            # Handle code
            if 'code' in paths:
                with open(paths['code'], 'r') as file:
                    meta['code'] = file.read()

            # Save all the data
            meta.sync()
            db[label]['regions'].sync()
            db[label]['regionLinks'].sync()
        except: #pylint: disable=W0702
            common.log('Error encountered; purging corrupted data for: %s' % label)
            if os.path.exists(dbDir):
                shutil.rmtree(dbDir)
            raise
        # Always close all shelves
        for data in db.values():
            for maybeShelf in data.values():
                if isinstance(maybeShelf, shelve.Shelf):
                    maybeShelf.close()
