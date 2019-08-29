#!/usr/bin/env python3
import re
import argparse
import subprocess
import asyncio
from database import Database, logToConsole

parser = argparse.ArgumentParser(description='Bundle data directly from phylanx stdout, individual tree / performance / graph files, OTF2 traces, and/or source code files')
parser.add_argument('-l', '--label', dest='label', type=str, default='Latest',
                    help='Label for the bundled dataset (default: "Latest"). Providing a label that already exists in the database will bundle with/overwrite any previous data. If globbing multiple inputs, this should be a regular expression, where the first capturing group indicates which files go together (e.g. --input data/*/phylanxLog.txt --otf2 data/*/OTF2_archive/APEX.otf2 --label data/([^/]*) would merge datasets based on their common directory name). Note that any captured "/" characters will be removed.')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory to store the bundled data (default: /tmp/traveler-integrated)')
parser.add_argument('-i', '--input', dest='input', type=str, metavar='path', nargs='*', default=[],
                    help='STDOUT from phylanx run as a file or pipe (should contain the tree, graph, and performance CSV)')
parser.add_argument('-t', '--tree', dest='tree', type=str, metavar='path', nargs='*', default=[],
                    help='Input newick tree as its own file')
parser.add_argument('-p', '--performance', dest='performance', type=str, metavar='path', nargs='*', default=[],
                    help='Input performance CSV as its own file')
parser.add_argument('-g', '--graph', dest='graph', type=str, metavar='path', nargs='*', default=[],
                    help='Input DOT-formatted links as its own file')
parser.add_argument('-o', '--otf2', dest='otf2', type=str, metavar='path', nargs='*', default=[],
                    help='Input otf2 trace (e.g. OTF2_archive/APEX.otf2)')
parser.add_argument('-y', '--physl', dest='physl', type=str, metavar='path', nargs='*', default=[],
                    help='Input physl source code file')
parser.add_argument('-n', '--python', dest='python', type=str, metavar='path', nargs='*', default=[],
                    help='Input python source code file')
parser.add_argument('-c', '--cpp', dest='cpp', type=str, metavar='path', nargs='*', default=[],
                    help='Input C++ source code file')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information for debugging source files, etc.')
parser.add_argument('-u', '--guids', dest='guids', action='store_true',
                    help='Collect GUIDs')
parser.add_argument('-e', '--events', dest='events', action='store_true',
                    help='Collect all events, not just intervals')

class FakeFile: #pylint: disable=R0903
    def __init__(self, name):
        self.name = name
    def __iter__(self):
        otfPipe = subprocess.Popen(['otf2-print', self.name], stdout=subprocess.PIPE)
        for line in otfPipe.stdout:
            yield line.decode()

async def main():
    args = vars(parser.parse_args())
    db = Database(args['dbDir'], args['debug'])
    await db.load()

    inputs = {}
    r = re.compile(args['label'])
    if r.groups == 0:
        # We're in normal mode; one path per argument
        inputs[args['label']] = {}
        for arg in ['input', 'tree', 'performance', 'graph', 'otf2', 'physl', 'python', 'cpp']:
            if len(args[arg]) == 1:
                inputs[args['label']][arg] = args[arg][0]
            elif len(args[arg]) > 1:
                raise Exception('To use glob patterns, please provide a regular expression with one capture group as a --label argument')
        if not inputs[args['label']]:
            raise Exception('At least one of: --input, --tree, --performance, --graph, --otf2, --physl, --python, and/or --cpp is required')
    elif r.groups == 1:
        # We're in globbing mode; we can expect many files per argument, and
        # --label should be a regular expression that matches input files to
        # their label The only (possible) exception are code files: if only
        # one is provided, use it for all labels (otherwise, expect it to match
        # the regular expression as well)
        singlePhysl = args['physl'][0] if len(args['physl']) == 1 else None
        singlePython = args['python'][0] if len(args['python']) == 1 else None
        singleCpp = args['cpp'][0] if len(args['cpp']) == 1 else None
        for arg in ['input', 'tree', 'performance', 'graph', 'otf2', 'physl', 'python', 'cpp']:
            if arg == 'physl' and singlePhysl is not None:
                continue
            if arg == 'python' and singlePython is not None:
                continue
            if arg == 'cpp' and singleCpp is not None:
                continue
            for path in args[arg]:
                m = r.match(path)
                if m is None:
                    raise Exception('--label pattern could not identify a label for file: %s' % path)
                label = m[1].replace('/', '')
                inputs[label] = inputs.get(label, {})
                if arg in inputs[label]:
                    raise Exception('--label pattern found duplicate matches for --%s:\n%s\n%s' % (arg, inputs[label][arg], path))
                inputs[label][arg] = path
        for label in inputs:
            if singlePhysl is not None:
                inputs[label]['physl'] = singlePhysl
            if singlePython is not None:
                inputs[label]['python'] = singlePython
            if singleCpp is not None:
                inputs[label]['cpp'] = singleCpp
    else:
        raise Exception('Too many capturing groups in the --label argument')

    for label, paths in inputs.items():
        if 'input' in paths and ('tree' in paths or 'performance' in paths or 'graph' in paths):
            raise Exception('Don\'t use --input with --tree, --performance, or --graph for the same --label: %s' % label)
        try:
            await logToConsole('#################' + ''.join(['#' for x in range(len(label))]))
            await logToConsole('Adding data for: %s' % label)

            # Initialize the dataset
            db.createDataset(label)

            # Handle performance files
            if 'performance' in paths:
                with open(paths['performance'], 'r') as file:
                    await db.processCsvFile(label, file)

            # Handle tree files:
            if 'tree' in paths:
                with open(paths['tree'], 'r') as file:
                    await db.processNewickFile(label, file)

            # Handle graph files:
            if 'graph' in paths:
                with open(paths['graph'], 'r') as file:
                    await db.processDotFile(label, file)

            # Handle stdout from phylanx
            if 'input' in paths:
                with open(paths['input'], 'r') as file:
                    await db.processPhylanxLogFile(label, file)

            # Handle code files
            for codeType in ['physl', 'python', 'cpp']:
                if codeType in paths:
                    with open(paths[codeType], 'r') as file:
                        await db.processCodeFile(label, file, codeType)

            # Handle otf2
            if 'otf2' in paths:
                await db.processOtf2(label, FakeFile(paths['otf2']), args['guids'], args['events'])

            # Save all the data
            await db.save(label)
        except: #pylint: disable=W0702
            await logToConsole('Error encountered; purging corrupted data for: %s' % label)
            db.purgeDataset(label)
            raise
        # Always close all shelves
        await db.close()

if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
