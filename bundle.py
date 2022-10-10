#!/usr/bin/env python3
import re
import argparse
import subprocess
import asyncio
from data_store import DataStore, logToConsole

parser = argparse.ArgumentParser( \
    description=('Bundle data directly from phylanx stdout, individual tree / '
                 'performance / graph files, OTF2 traces, and/or source code files'))
parser.add_argument('-l', '--label', dest='label', type=str, default='Untitled dataset',
    help=('Label for the bundled dataset (default: "Untitled dataset"). Providing a '
          'label that already exists in the database will bundle with/overwrite '
          'any previous data. If globbing multiple inputs, this should be a '
          'regular expression, where the first capturing group indicates which '
          'files go together. For example: \n'
          '--input data/*/phylanxLog.txt \n'
          '--otf2 data/*/OTF2_archive/APEX.otf2 \n'
          '--label data/([^/]*) \n'
          'would merge datasets based on their common directory name, and use '
          'that directory name as the label.'))
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory to store the bundled data (default: /tmp/traveler-integrated)')
parser.add_argument('-i', '--input', dest='input', type=str, metavar='path', nargs='*', default=[],
                    help=('STDOUT from phylanx run as a file or pipe (should contain the '
                          'tree, graph, and performance CSV)'))
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
parser.add_argument('-a', '--tags', dest='tags', type=str,
                    help=('Tags to be attached to the dataset (when bundling multiple '
                          'datasets, the same tags are attached to all datasets bundled '
                          'at the same time). Separate tags with commas.'))
parser.add_argument('-z', '--colors', dest='colors', type=str, default='Red', 
                    help=('Colors to be attached to the dataset (when bundling multiple '
                          'datasets, the same color are attached to all datasets bundled '
                          'at the same time). Separate tags with commas.'))
parser.add_argument('-f', '--folder', dest='folder', type=str,
                    help=('Folder or path name that will be prefixed to the label of all '
                          'data bundled by this command; usually this is a good idea when '
                          'bundling lots of files to reduce clutter in the interface'))

class FakeFile: #pylint: disable=R0903
    def __init__(self, name):
        self.name = name
    async def __aiter__(self):
        # otfPipe = subprocess.Popen(['otf2-print', self.name], stdout=subprocess.PIPE)
        otfPipe = subprocess.Popen(['otf2-print', self.name], stdout=subprocess.PIPE)
        for bytesChunk in otfPipe.stdout:
            yield bytesChunk.decode()
            otfPipe.stdout.flush()

async def main():
    args = vars(parser.parse_args())
    if 'folder' in args and args['folder'] is not None:
        args['folder'] = args['folder'].strip('/ ')
    db = DataStore(args['dbDir'], args['debug'])
    await db.load()

    inputs = {}
    labelRegex = re.compile(args['label'])
    if labelRegex.groups == 0:
        # We're in normal mode; one path per argument
        inputs[args['label']] = {}
        for arg in ['input', 'tree', 'performance', 'graph', 'otf2', 'physl', 'python', 'cpp']:
            if len(args[arg]) == 1:
                inputs[args['label']][arg] = args[arg][0]
            elif len(args[arg]) > 1:
                raise Exception('To use glob patterns, please provide a regular expression with one capture group as a --label argument')
        if not inputs[args['label']]:
            raise Exception('At least one of: --input, --tree, --performance, --graph, --otf2, --physl, --python, and/or --cpp is required')
    elif labelRegex.groups == 1:
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
                pathMatch = labelRegex.match(path)
                if pathMatch is None:
                    raise Exception('--label pattern could not identify a label for file: %s' % path)
                label = pathMatch[1].replace('/', '')
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
            # Initialize the dataset
            datasetId = db.createDataset()['info']['datasetId']

            # Prefix the label with the folder if one was specified
            if 'folder' in args and args['folder'] is not None:
                label = args['folder'] + '/' + label

            await logToConsole('#################' + ''.join(['#' for x in range(len(label))]))
            await logToConsole('Adding data for: %s (%s)' % (datasetId, label))

            # Assign its name
            db.rename(datasetId, label)
            db.colorName(datasetId, args['colors'])

            # Assign any tags
            if args['tags'] is not None:
                tags = {t : True for t in args['tags'].split(',')}
                db.addTags(datasetId, tags)

            # Handle performance files
            if 'performance' in paths:
                with open(paths['performance'], 'r') as file:
                    await db.processCsvFile(datasetId, file)

            # Handle tree files:
            if 'tree' in paths:
                with open(paths['tree'], 'r') as file:
                    await db.processNewickFile(datasetId, file)

            # Handle graph files:
            if 'graph' in paths:
                with open(paths['graph'], 'r') as file:
                    await db.processDotFile(datasetId, file)

            # Handle stdout from phylanx
            if 'input' in paths:
                with open(paths['input'], 'r') as file:
                    await db.processPhylanxLogFile(datasetId, file)

            # Handle code files
            for codeType in ['physl', 'python', 'cpp']:
                if codeType in paths:
                    with open(paths[codeType], 'r') as file:
                        await db.processCodeFile(datasetId, file, codeType)

            # Handle otf2
            if 'otf2' in paths:
                db.addSourceFile(datasetId, paths['otf2'], 'otf2')
                await db.processOtf2(datasetId, FakeFile(paths['otf2']))


            # Save all the data
            await db.save(datasetId)
        except: #pylint: disable=W0702
            await logToConsole('Error encountered; purging corrupted data for: %s' % datasetId)
            del db[datasetId]
            raise

if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
