#!/usr/bin/env python3
import sys
import os
import subprocess
import re
import shelve
from blist import sortedlist
import newick

def log(value, end='\n'):
    sys.stderr.write(value + end)
    sys.stderr.flush()

def processInputs(args):
    # Structures that we'll return
    coreTree = None
    regions = {}
    regionLinks = []
    guids = shelve.open(os.path.join(args.tempDir, 'guidShelf.db'), flag='n')
    ranges = shelve.open(os.path.join(args.tempDir, 'rangeShelf.db'), flag='n')
    rangeEnterIndex = sortedlist(key=lambda i: i[0])
    rangeLeaveIndex = sortedlist(key=lambda i: i[0])
    events = shelve.open(os.path.join(args.tempDir, 'eventShelf.db'), flag='n')
    eventIndex = sortedlist(key=lambda i: i[0])

    # Tools for handling region names
    def addRegionChild(parent, child):
        assert parent in regions and child in regions
        regions[child]['parents'].add(parent)
        regions[parent]['children'].add(child)

    def processRegion(regionName, source, parent=None):
        if regionName in regions:
            if args.debug is True:
                regions[regionName]['sources'].add(source)
            return
        regions[regionName] = { 'parents': set(), 'children': set() }
        if args.debug is True:
            regions[regionName]['sources'] = set([source])
        if parent is not None:
            addRegionChild(parent, regionName)
        regionChunks = regionName.split('$')
        regions[regionName]['name'] = regionChunks[0]
        if len(regionChunks) >= 3:
            regions[regionName]['line'] = regionChunks[-2]
            regions[regionName]['char'] = regionChunks[-1]

    # Tools for handling the tree
    treeModeParser = re.compile(r'Tree information for function:')

    def processTree(node, parent=None):
        # Create the hashed region object
        regionName = node.name.strip()
        assert regionName not in regions
        processRegion(regionName, 'tree', parent)
        tree = { 'name': regionName, 'children': [] }

        # Create the tree hierarchy
        if len(node.descendants) > 0:
            for child in node.descendants:
                tree['children'].append(processTree(child, parent=regionName))
        return tree


    # Tools for handling the DOT graph
    dotModeParser = re.compile(r'graph "[^"]*" {')
    dotLineParser = re.compile(r'"([^"]*)" -- "([^"]*)";')

    # Tools for handling the performance csv
    perfModeParser = re.compile(r'primitive_instance,display_name,count,time,eval_direct')
    perfLineParser = re.compile(r'"([^"]*)","([^"]*)",(\d+),(\d+),(-?1)')

    # Parse stdout first (waits for it to finish before attempting to parse the OTF2 trace)
    mode = None
    for line in args.input:
        if mode is None:
            if treeModeParser.match(line):
                mode = 'tree'
            elif dotModeParser.match(line):
                mode = 'dot'
            elif perfModeParser.match(line):
                mode = 'perf'
        elif mode == 'tree':
            coreTree = processTree(newick.loads(line)[0])
            mode = None
        elif mode == 'dot':
            dotLine = dotLineParser.match(line)
            if dotLine is not None:
                assert dotLine[1] in regions
                processRegion(dotLine[1], 'dot graph', parent=None)
                assert dotLine[2] in regions
                processRegion(dotLine[2], 'dot graph', parent=None)
                addRegionChild(dotLine[1], dotLine[2])
            else:
                mode = None
        elif mode == 'perf':
            perfLine = perfLineParser.match(line)
            if perfLine is not None:
                regionName = perfLine[1]
                # TODO: assert regionName in regions
                processRegion(regionName, 'perf csv', parent=None)
                regions[regionName]['display_name'] = perfLine[2]
                regions[regionName]['count'] = int(perfLine[3])
                regions[regionName]['time'] = int(perfLine[4])
                regions[regionName]['eval_direct'] = int(perfLine[5])
            else:
                mode = None
        else:
            # Should never reach this point
            assert False

    # Parse the OTF2 trace, output non-ENTER/LEAVE events directly as we encounter them so they don't stick around in memory
    otfPrint = subprocess.Popen(['otf2-print', args.otf2], stdout=subprocess.PIPE)

    eventLineParser = re.compile(r'^(\S+)\s+(\d+)\s+(\d+)\s+(.*)$')
    attrParsers = {
        'ENTER': r'(Region): "([^"]*)"',
        'LEAVE': r'(Region): "([^"]*)"',
        'METRIC': r'Value: \("([^"]*)" <\d+>; [^;]*; ([^\)]*)',
        'MPI_SEND': r'([^:]*): ([^,]*)',
        'MPI_RECV': r'([^:]*): ([^,]*)'
    }
    addAttrLineParser = re.compile(r'^\s+ADDITIONAL ATTRIBUTES: (.*)$')
    addAttrSplitter = re.compile(r'\), \(')
    addAttrParser = re.compile(r'\(?"([^"]*)" <\d+>; [^;]*; ([^\)]*)')

    currentEvent = None
    numEvents = 0
    locations = {}

    def processEvent():
        nonlocal numEvents, currentEvent
        if currentEvent is None:
            return
        
        eventId = str(numEvents)

        if 'Region' in currentEvent:
            # Identify the region (and add to its counter)
            regionName = currentEvent['Region'].replace('::eval', '')
            processRegion(regionName, 'otf2 event', parent=None)
            if args.debug is True:
                if 'eventCount' not in regions[regionName]:
                    regions[regionName]['eventCount'] = 0
                regions[regionName]['eventCount'] += 1

            # Add to GUID / Parent GUID relationships
            if 'GUID' in currentEvent and 'Parent GUID' in currentEvent:
                if 'guids' not in regions[regionName]:
                    regions[regionName]['guids'] = set()
                regions[regionName]['guids'].add(currentEvent['GUID'])
                if currentEvent['GUID'] in guids:
                    guids[currentEvent['GUID']]['regions'].add(regionName)
                    assert guids[currentEvent['GUID']]['parent'] == currentEvent['Parent GUID']
                else:
                    guids[currentEvent['GUID']] = { 'regions': set([regionName]), 'parent': currentEvent['Parent GUID'] }

        # Add enter / leave events to per-location lists
        if currentEvent['Event'] == 'ENTER' or currentEvent['Event'] == 'LEAVE':
            if not currentEvent['Location'] in locations:
                locations[currentEvent['Location']] = sortedlist(key=lambda i: i[0])
            locations[currentEvent['Location']].add((currentEvent['Timestamp'], eventId))
        
        # Add the event
        events[eventId] = currentEvent
        eventIndex.add((currentEvent['Timestamp'], eventId))

        # Log that we've processed another event
        numEvents += 1
        if numEvents % 10000 == 0:
            log('.', end=''),
        if numEvents % 100000 == 0:
            log('processed %i events' % numEvents)

    for line in otfPrint.stdout:
        line = line.decode()
        eventLineMatch = eventLineParser.match(line)
        addAttrLineMatch = addAttrLineParser.match(line)
        if currentEvent is None and eventLineMatch is None:
            # This is a blank / header line
            continue

        if eventLineMatch is not None:
            # This is the beginning of a new event; process the previous one
            processEvent()
            currentEvent = {}
            currentEvent['Event'] = eventLineMatch.group(1)
            currentEvent['Location'] = int(eventLineMatch.group(2))
            currentEvent['Timestamp'] = int(eventLineMatch.group(3))
            attrs = eventLineMatch.group(4)
            assert currentEvent['Event'] in attrParsers
            for attrMatch in re.finditer(attrParsers[currentEvent['Event']], attrs):
                currentEvent[attrMatch.group(1)] = attrMatch.group(2)
        else:
            # This line contains additional event attributes
            assert currentEvent is not None and addAttrLineMatch is not None
            attrList = addAttrSplitter.split(addAttrLineMatch.group(1))
            for attrStr in attrList:
                attr = addAttrParser.match(attrStr)
                assert attr is not None
                currentEvent[attr.group(1)] = attr.group(2) #pylint: disable=unsupported-assignment-operation
    # The last event will never have had a chance to be processed:
    processEvent()
    log('finished processing %i events' % numEvents)

    # Combine the sorted enter / leave events into ranges
    numRanges = 0
    for eventList in locations.values():
        lastEvent = None
        for _, eventIndex in eventList:
            event = events[eventIndex]
            if event['Event'] == 'ENTER':
                # Start a range (don't output anything)
                assert lastEvent is None
                lastEvent = event
            elif event['Event'] == 'LEAVE':
                # Finish a range
                assert lastEvent is not None
                rangeId = str(numRanges)
                currentRange = {}
                for attr, value in event.items():
                    # For now, we assume Event, Timestamp, and Region are the only things
                    # that can change between an ENTER / LEAVE pair
                    if attr != 'Event' and attr != 'Timestamp' and attr != 'Region':
                        assert event[attr] == lastEvent[attr] #pylint: disable=unsubscriptable-object
                        currentRange[attr] = value
                currentRange['enter'] = {
                    'Timestamp': lastEvent['Timestamp'], #pylint: disable=unsubscriptable-object
                    'Region': lastEvent['Region'] #pylint: disable=unsubscriptable-object
                }
                currentRange['leave'] = {
                    'Timestamp': event['Timestamp'],
                    'Region': event['Region']
                }
                ranges[rangeId] = currentRange
                rangeEnterIndex.add((currentRange['enter']['Timestamp'], rangeId))
                rangeLeaveIndex.add((currentRange['leave']['Timestamp'], rangeId))

                # Log that we've finished the finished range
                numRanges += 1
                if numRanges % 10000 == 0:
                    log('.', end=''),
                if numRanges % 100000 == 0:
                    log('processed %i ranges' % numRanges)
                lastEvent = None
        # Make sure there are no trailing ENTER events
        assert lastEvent is None
    # Finish the ranges dict
    log('finished processing %i ranges' % numRanges)

    # Create any missing parent-child region relationships based on the GUIDs we've collected,
    # and make the guid objects JSON-serializable
    for _, details in guids.items():
        if details['parent'] != '0':
            assert details['parent'] in guids
            # TODO: ask what's up with multiple regions per GUID?
            for parentRegion in guids[details['parent']]['regions']:
                for childRegion in details['regions']:
                    addRegionChild(parentRegion, childRegion)
        details['regions'] = list(details['regions'])

    # Populate the region links list
    for parent, value in regions.items():
        for child in value['children']:
            regionLinks.append({ 'source': parent, 'target': child })

    # Clean up the regions so that they're JSON-serializable
    for regionName, region in regions.items():
        region['parents'] = list(region['parents'])
        if len(region['parents']) == 0:
            del region['parents']
        region['children'] = list(region['children'])
        if len(region['children']) == 0:
            del region['children']
        if args.debug:
            region['sources'] = list(region['sources'])
        if 'guids' in region:
            region['guids'] = list(region['guids'])

    # Return the computed structures
    return {
        'coreTree': coreTree,
        'regions': regions,
        'regionLinks': regionLinks,
        'guids': guids,
        'ranges': ranges,
        'rangeEnterIndex': rangeEnterIndex,
        'rangeLeaveIndex': rangeLeaveIndex,
        'events': events,
        'eventIndex': eventIndex
    }