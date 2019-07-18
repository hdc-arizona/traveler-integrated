import re
import newick
from .common import log, processPrimitive, addPrimitiveChild

# Tools for handling the tree
treeModeParser = re.compile(r'Tree information for function:')
unflaggedTreeParser = re.compile(r'\(\(\(\(\(.*;')  # assume a line beginning with at least 5 parens is the tree

def _processTree(node, primitives=None, primitiveLinks=None, debug=False):
    # Create the hashed primitive object
    if node.name is None:
        primitiveName = ''
    else:
        primitiveName = node.name.strip()
    newR = processPrimitive(primitiveName, primitives, 'tree', debug)[1]
    seenR = 1 if newR == 0 else 0
    tree = {'name': primitiveName, 'children': []}
    newL = seenL = 0

    # Create the tree hierarchy
    if node.descendants:
        for child in node.descendants:
            childTree, nr, sr, nl, sl = _processTree(child, primitives, primitiveLinks, debug)
            tree['children'].append(childTree)
            newR += nr
            seenR += sr
            l = addPrimitiveChild(primitiveName, childTree['name'], primitives, primitiveLinks, 'tree', debug)[1]
            newL += nl + l
            seenL += sl + (1 if l == 0 else 0)
    return (tree, newR, seenR, newL, seenL)
def processTree(newickText, primitives=None, primitiveLinks=None, debug=False):
    return _processTree(newick.loads(newickText)[0], primitives, primitiveLinks, debug=debug)

# Tools for handling the DOT graph
dotModeParser = re.compile(r'graph "[^"]*" {')
dotLineParser = re.compile(r'"([^"]*)" -- "([^"]*)";')

def _processDotLine(line, primitives=None, primitiveLinks=None, debug=False):
    dotLine = dotLineParser.match(line)
    if dotLine is None:
        return None

    newR = processPrimitive(dotLine[1], primitives, 'dot graph', debug)[1]
    seenR = 1 if newR == 0 else 0
    r = processPrimitive(dotLine[2], primitives, 'dot graph', debug)[1]
    newR += r
    seenR += 1 if r == 0 else 0
    newL = addPrimitiveChild(dotLine[1], dotLine[2], primitives, primitiveLinks, 'dot graph', debug=debug)
    seenL = 1 if newL == 0 else 0
    return (newR, seenR, newL, seenL)
def processDotFile(path, primitives=None, primitiveLinks=None, debug=False):
    newR = seenR = newL = seenL = 0
    with open(path, 'r') as file:
        assert dotModeParser.match(file.readline()) is not None
        for line in file:
            temp = _processDotLine(line, primitives, primitiveLinks, debug)
            if temp is None:
                break
            newR += temp[0]
            seenR += temp[1]
            newL += temp[2]
            seenL += temp[3]
    return (newR, seenR, newL, seenL)

# Tools for handling the performance csv
perfModeParser = re.compile(r'primitive_instance,display_name,count,time,eval_direct')
perfLineParser = re.compile(r'"([^"]*)","([^"]*)",(\d+),(\d+),(-?1)')

def _processPerfLine(line, primitives=None, debug=False):
    perfLine = perfLineParser.match(line)
    if perfLine is None:
        return None

    primitiveName = perfLine[1]
    primitive, newR = processPrimitive(primitiveName, primitives, 'perf csv', debug)
    primitive['display_name'] = perfLine[2]
    primitive['count'] = int(perfLine[3])
    primitive['time'] = float(perfLine[4])
    primitive['eval_direct'] = float(perfLine[5])
    primitive['avg_time'] = primitive['time'] / primitive['count'] if primitive['count'] != 0 else primitive['time']
    primitives[primitiveName] = primitive
    return (newR, primitive['time'])
def processPerfFile(path, primitives=None, debug=False):
    newR = seenR = maxTime = 0
    with open(path, 'r') as file:
        assert perfModeParser.match(file.readline()) is not None
        for line in file:
            counts = _processPerfLine(line, primitives, debug)
            if counts is None:
                break
            newR += counts[0]
            seenR += 1 if counts[0] == 0 else 0
            maxTime = max(maxTime, counts[1])
    return (newR, seenR, maxTime)

# Tools for handling the inclusive time line
timeParser = re.compile(r'time: ([\d\.]+)')

def parsePhylanxLog(path, primitives=None, primitiveLinks=None, debug=False):
    mode = None
    coreTree = None
    time = None
    newR = seenR = newL = seenL = maxTime = 0
    with open(path, 'r') as logFile:
        for line in logFile:
            if mode is None:
                if treeModeParser.match(line):
                    mode = 'tree'
                    log('Parsing tree...')
                elif unflaggedTreeParser.match(line):
                    log('Parsing unflagged line that looks like a newick tree...')
                    coreTree, nr, sr, nl, sl = processTree(line, primitives, primitiveLinks, debug)
                    log('Finished parsing newick tree')
                    log('New primitives: %d, Observed existing primitives: %d' % (nr, sr))
                    log('New links: %d, Observed existing links: %d' % (nl, sl))
                elif dotModeParser.match(line):
                    mode = 'dot'
                    log('Parsing graph...')
                elif perfModeParser.match(line):
                    mode = 'perf'
                    log('Parsing performance csv...')
                elif timeParser.match(line):
                    time = 1000000000 * float(timeParser.match(line)[1])
                    log('Total inclusive time from phylanx log (converted to ns): %f' % time)
            elif mode == 'tree':
                coreTree, nr, sr, nl, sl = processTree(line, primitives, primitiveLinks, debug)
                mode = None
                log('Finished parsing newick tree')
                log('New primitives: %d, Observed existing primitives: %d' % (nr, sr))
                log('New links: %d, Observed existing links: %d' % (nl, sl))
            elif mode == 'dot':
                counts = _processDotLine(line, primitives, primitiveLinks, debug)
                if counts is not None:
                    newR += counts[0]
                    seenR += counts[1]
                    newL += counts[2]
                    seenL += counts[3]
                else:
                    mode = None
                    log('Finished parsing DOT graph')
                    log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
                    log('New links: %d, Observed existing links: %d' % (newL, seenL))
                    newR = seenR = newL = seenL = 0
            elif mode == 'perf':
                counts = _processPerfLine(line, primitives, debug)
                if counts is not None:
                    newR += counts[0]
                    seenR += 1 if counts[0] == 0 else 0
                    maxTime = max(maxTime, counts[1])
                else:
                    mode = None
                    log('Finished parsing performance CSV')
                    log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
                    log('Max inclusive time seen in performance CSV (ns): %f' % maxTime)
                    newR = seenR = 0
            else:
                # Should never reach this point
                assert False
    return (coreTree, time)
