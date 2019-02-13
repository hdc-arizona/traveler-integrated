import re
import newick
from .log import log
from . import common

# Tools for handling the tree
treeModeParser = re.compile(r'Tree information for function:')

def processTree(regions, regionLinks, node, parent=None, debug=False):
    # Create the hashed region object
    regionName = node.name.strip()
    assert regions.find_one({'_id': regionName}) is None
    common.processRegion(regions, regionName, 'tree', debug)
    tree = { 'name': regionName, 'children': [] }

    # Create the tree hierarchy
    if len(node.descendants) > 0:
        for child in node.descendants:
            childTree = processTree(regions, regionLinks, child, parent=regionName, debug=debug)
            tree['children'].append(childTree)
            common.addRegionChild(regions, regionLinks, regionName, childTree['name'], 'tree', debug=debug)
    return tree


# Tools for handling the DOT graph
dotModeParser = re.compile(r'graph "[^"]*" {')
dotLineParser = re.compile(r'"([^"]*)" -- "([^"]*)";')

# Tools for handling the performance csv
perfModeParser = re.compile(r'primitive_instance,display_name,count,time,eval_direct')
perfLineParser = re.compile(r'"([^"]*)","([^"]*)",(\d+),(\d+),(-?1)')

# Tools for handling the inclusive time line
timeParser = re.compile(r'time: ([\d\.]+)')

def parsePhylanxLog (logFile, regions, regionLinks, debug=False):
    mode = None
    count = 0
    newCount = 0
    coreTree = None
    time = None
    for line in logFile:
        if mode is None:
            if treeModeParser.match(line):
                mode = 'tree'
                log('Parsing tree...')
            elif dotModeParser.match(line):
                mode = 'dot'
                log('Parsing graph...')
                count = 0
            elif perfModeParser.match(line):
                mode = 'perf'
                log('Parsing performance csv...')
                count = 0
            elif timeParser.match(line):
                time = timeParser.match(line)[1]
        elif mode == 'tree':
            coreTree = processTree(regions, regionLinks, newick.loads(line)[0], debug=debug)
            mode = None
            log('Finished parsing %d regions from newick tree' % regions.count())
        elif mode == 'dot':
            dotLine = dotLineParser.match(line)
            if dotLine is not None:
                count += 1
                assert regions.find_one({'_id': dotLine[1]}) is not None
                assert regions.find_one({'_id': dotLine[2]}) is not None
                if debug is True:
                    common.processRegion(regions, dotLine[1], 'dot graph', debug=debug)
                    common.processRegion(regions, dotLine[2], 'dot graph', debug=debug)
                common.addRegionChild(regions, regionLinks, dotLine[1], dotLine[2], 'dot graph', debug=debug)
            else:
                mode = None
                log('Finished parsing %d relationships from the dot graph' % count)
        elif mode == 'perf':
            perfLine = perfLineParser.match(line)
            if perfLine is not None:
                regionName = perfLine[1]
                count += 1
                region = regions.find_one({'_id': regionName})
                # TODO: something violates this... (what was it, and why does it happen?)
                # assert region is not None
                if region is None:
                    newCount += 1
                    region = common.processRegion(regions, regionName, 'perf csv', debug=debug)
                elif debug is True:
                    region = common.processRegion(regions, regionName, 'perf csv', debug=debug)
                region['display_name'] = perfLine[2]
                region['count'] = int(perfLine[3])
                region['time'] = int(perfLine[4])
                region['eval_direct'] = int(perfLine[5])
                regions.replace_one({'_id': regionName}, region)
            else:
                mode = None
                log('Finished parsing stats for %d regions (added %d new regions)' % (count, newCount))
        else:
            # Should never reach this point
            assert False
    return (coreTree, time)