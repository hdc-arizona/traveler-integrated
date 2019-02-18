import re
import newick
from .common import log, processRegion, addRegionChild

# Tools for handling the tree
treeModeParser = re.compile(r'Tree information for function:')

def _processTree(node, regions=None, regionLinks=None, debug=False):
    # Create the hashed region object
    regionName = node.name.strip()
    newR = processRegion(regionName, regions, 'tree', debug)[1]
    seenR = 1 if newR == 0 else 0
    tree = {'name': regionName, 'children': []}
    newL = seenL = 0

    # Create the tree hierarchy
    if node.descendants:
        for child in node.descendants:
            childTree, nr, sr, nl, sl = _processTree(child, regions, regionLinks, debug)
            tree['children'].append(childTree)
            newR += nr
            seenR += sr
            l = addRegionChild(regionName, childTree['name'], regions, regionLinks, 'tree', debug)[1]
            newL += nl + l
            seenL += sl + (1 if l == 0 else 0)
    return (tree, newR, seenR, newL, seenL)
def processTree(newickText, regions=None, regionLinks=None, debug=False):
    return _processTree(newick.loads(newickText)[0], regions, regionLinks, debug=debug)

# Tools for handling the DOT graph
dotModeParser = re.compile(r'graph "[^"]*" {')
dotLineParser = re.compile(r'"([^"]*)" -- "([^"]*)";')

def _processDotLine(line, regions=None, regionLinks=None, debug=False):
    dotLine = dotLineParser.match(line)
    if dotLine is None:
        return None

    newR = processRegion(dotLine[1], regions, 'dot graph', debug)[1]
    seenR = 1 if newR == 0 else 0
    r = processRegion(dotLine[2], regions, 'dot graph', debug)[1]
    newR += r
    seenR += 1 if r == 0 else 0
    newL = addRegionChild(dotLine[1], dotLine[2], regions, regionLinks, 'dot graph', debug=debug)
    seenL = 1 if newL == 0 else 0
    return (newR, seenR, newL, seenL)
def processDotFile(file, regions=None, regionLinks=None, debug=False):
    newR = seenR = newL = seenL = 0
    assert dotModeParser.match(file.readline()) is not None
    for line in file:
        temp = _processDotLine(line, regions, regionLinks, debug)
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

def _processPerfLine(line, regions=None, debug=False):
    perfLine = perfLineParser.match(line)
    if perfLine is None:
        return None

    regionName = perfLine[1]
    region, newR = processRegion(regionName, regions, 'perf csv', debug)
    region['display_name'] = perfLine[2]
    region['count'] = int(perfLine[3])
    region['time'] = int(perfLine[4])
    region['eval_direct'] = int(perfLine[5])
    regions[regionName] = region
    return newR
def processPerfFile(file, regions=None, debug=False):
    newR = seenR = 0
    assert perfModeParser.match(file.readline()) is not None
    for line in file:
        r = _processPerfLine(line, regions, debug)
        if r is None:
            break
        newR += r
        seenR += 1 if r == 0 else 0
    return (newR, seenR)

# Tools for handling the inclusive time line
timeParser = re.compile(r'time: ([\d\.]+)')

def parsePhylanxLog(logFile, regions=None, regionLinks=None, debug=False):
    mode = None
    coreTree = None
    time = None
    newR = seenR = newL = seenL = 0
    for line in logFile:
        if mode is None:
            if treeModeParser.match(line):
                mode = 'tree'
                log('Parsing tree...')
            elif dotModeParser.match(line):
                mode = 'dot'
                log('Parsing graph...')
            elif perfModeParser.match(line):
                mode = 'perf'
                log('Parsing performance csv...')
            elif timeParser.match(line):
                time = timeParser.match(line)[1]
        elif mode == 'tree':
            coreTree, nr, sr, nl, sl = processTree(line, regions, regionLinks, debug)
            mode = None
            log('Finished parsing newick tree')
            log('New regions: %d, Observed existing regions: %d' % (nr, sr))
            log('New links: %d, Observed existing links: %d' % (nl, sl))
        elif mode == 'dot':
            counts = _processDotLine(line, regions, regionLinks, debug)
            if counts is not None:
                newR += counts[0]
                seenR += counts[1]
                newL += counts[2]
                seenL += counts[3]
            else:
                mode = None
                log('Finished parsing DOT graph')
                log('New regions: %d, References to existing regions: %d' % (newR, seenR))
                log('New links: %d, Observed existing links: %d' % (newL, seenL))
                newR = seenR = newL = seenL = 0
        elif mode == 'perf':
            r = _processPerfLine(line, regions, debug)
            if counts is not None:
                newR += r
                seenR += 1 if r == 0 else 0
            else:
                mode = None
                log('Finished parsing performance CSV')
                log('New regions: %d, Observed existing regions: %d' % (newR, seenR))
                newR = seenR = 0
        else:
            # Should never reach this point
            assert False
    return (coreTree, time)
