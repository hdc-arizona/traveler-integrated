#!/usr/bin/env python3
import os
import re
import argparse
import shutil
import shelve
import pickle
from datetime import datetime
from wrangling import common, otf2, phylanx

parser = argparse.ArgumentParser(description='Bundle data directly from phylanx stdout, individual tree / performance / graph files, OTF2 traces, and/or source code files')
parser.add_argument('-l', '--label', dest='label', type=str, default='Latest',
                    help='Label for the bundled dataset (default: "Latest"). Providing a label that already exists in the database will bundle with/overwrite any previous data. If globbing multiple inputs, this should be a regular expression, where the first capturing group indicates which files go together (e.g. --input data/*/phylanxLog.txt --otf2 data/*/OTF2_archive/APEX.otf2 --label data/([^/]*) would merge datasets based on their common directory name). Note that any captured "/" characters will be removed.')
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
                    help='Collect all events, not just intervals')

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
        # We're in globbing mode; we can expect many files per argument, and
        # --label should be a regular expression that matches input files to
        # their label The only (possible) exception is the code file: if only
        # one is provided, use it for all labels (otherwise, expect it to match
        # the regular expression as well)
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
                label = m[1].replace('/', '')
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
            sourceFiles = {}
            timestamp = None
            for arg, path in paths.items():
                sourceFiles[arg] = {}
                sourceFiles[arg]['filename'] = os.path.split(path)[1]
                modtime = os.path.getmtime(path)
                sourceFiles[arg]['modified'] = datetime.fromtimestamp(modtime).isoformat()
                if not timestamp:
                    timestamp = modtime
                else:
                    timestamp += modtime
            meta['sourceFiles'] = sourceFiles
            meta['timestamp'] = datetime.fromtimestamp(timestamp / len(sourceFiles)).isoformat()

            # Regardless of what data we're given, we'll want primitives and the debug setting
            db[label]['primitives'] = shelve.open(os.path.join(dbDir, 'primitives.shelf'))
            kwargs = {
                'primitives': db[label]['primitives'],
                'debug': args['debug']
            }

            # Several things (might) populate or modify coreTree
            coreTree = None

            # Handle the performance file
            if 'performance' in paths:
                nr, sr, time = phylanx.processPerfFile(paths['performance'], **kwargs)
                meta['time'] = time
                common.log('Finished parsing performance CSV')
                common.log('New primitives: %d, Observed existing primitives: %d' % (nr, sr))
                common.log('Max inclusive time seen in performance CSV (ns): %f' % time)

            # Everything except for the performance file needs primitiveLinks as well as primitives
            db[label]['primitiveLinks'] = shelve.open(os.path.join(dbDir, 'primitiveLinks.shelf'))
            kwargs['primitiveLinks'] = db[label]['primitiveLinks']

            # Handle stdout from phylanx
            if 'input' in paths:
                # The full phylanx parser handles all logging internally
                coreTree, meta['time'] = phylanx.parsePhylanxLog(paths['input'], **kwargs)

            # Handle the tree file
            if 'tree' in paths:
                with open(paths['tree'], 'r') as file:
                    coreTree, nr, sr, nl, sl = phylanx.processTree(file.read(), **kwargs)
                    common.log('Finished parsing newick tree')
                    common.log('New primitives: %d, Observed existing primitives: %d' % (nr, sr))
                    common.log('New links: %d, Observed existing links: %d' % (nl, sl))

            # Handle the dot graph file
            if 'graph' in paths:
                nr, sr, nl, sl = phylanx.processDotFile(paths['graph'], **kwargs)
                common.log('Finished parsing DOT graph')
                common.log('New primitives: %d, References to existing primitives: %d' % (nr, sr))
                common.log('New links: %d, Observed existing links: %d' % (nl, sl))

            # Handle otf2
            if 'otf2' in paths:
                db[label]['intervals'] = kwargs['intervals'] = shelve.open(os.path.join(dbDir, 'intervals.shelf'))
                meta['hasIntervals'] = True
                if args['guids']:
                    db[label]['guids'] = kwargs['guids'] = shelve.open(os.path.join(dbDir, 'guids.shelf'))
                    meta['hasGuids'] = True
                if args['events']:
                    db[label]['events'] = kwargs['events'] = shelve.open(os.path.join(dbDir, 'events.shelf'))
                    meta['hasEvents'] = True
                # Otf2 parsing handles its logging internally
                otf2Results = otf2.parseOtf2(paths['otf2'], **kwargs)

                # Store metadata computed by parsing the OTF2 trace
                meta['locationNames'] = otf2Results['locationNames']

                # Pickle the indexes
                db[label]['intervalIndexes'] = otf2Results['indexes']
                with open(os.path.join(dbDir, 'intervalIndexes.pickle'), 'wb') as intervalIndexFile:
                    pickle.dump(db[label]['intervalIndexes'], intervalIndexFile)

                # Extract the domain from the main index as metadata
                meta['intervalDomain'] = [
                    db[label]['intervalIndexes']['main'].top_node.begin,
                    db[label]['intervalIndexes']['main'].top_node.end
                ]

                # Save the extra files
                db[label]['intervals'].sync()
                if args['guids']:
                    db[label]['guids'].sync()
                if args['events']:
                    db[label]['events'].sync()

            # Handle code
            if 'code' in paths:
                with open(paths['code'], 'r') as infile, open(os.path.join(dbDir, 'code.pickle'), 'wb') as outfile:
                    pickle.dump(infile.read(), outfile)
                    meta['hasCode'] = True
                    common.log('Finished adding code file')

            # Save all the data
            db[label]['primitives'].sync()
            db[label]['primitiveLinks'].sync()
            if coreTree is not None:
                meta['hasTree'] = True
                with open(os.path.join(dbDir, 'coreTree.pickle'), 'wb') as coreTreeFile:
                    pickle.dump(coreTree, coreTreeFile)
            meta.sync()
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
