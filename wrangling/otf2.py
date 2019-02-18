import re
import subprocess
from blist import sortedlist #pylint: disable=import-error
from .common import log, processRegion, addRegionChild

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

numEvents = 0
locations = {}

def _processEvent(event, regions=None, ranges=None, guids=None, events=None, debug=False):
    global numEvents

    eventId = str(numEvents)
    newR = seenR = newG = seenG = 0

    if 'Region' in event:
        # Identify the region (and add to its counter)
        regionName = event['Region'].replace('::eval', '')
        region, newR = processRegion(regionName, regions, 'otf2 event', debug=debug)
        seenR = 1 if newR == 0 else 0
        if debug is True:
            if 'eventCount' not in region:
                region['eventCount'] = 0
            region['eventCount'] += 1

        # Add to GUID / Parent GUID relationships
        if guids is not None and 'GUID' in event and 'Parent GUID' in event:
            if 'guids' not in region:
                region['guids'] = [event['GUID']]
            elif event['GUID'] not in region['guids']:
                # TODO: using a list instead of a set is expensive... but
                # storing sets may or may not be supported
                region['guids'].append(event['GUID'])
            guid = guids.get(event['GUID'], None)
            if guid is None:
                newG += 1
                guid = {
                    'regions': [regionName],
                    'parent': event['Parent GUID']
                }
            else:
                seenG += 1
                if regionName not in guid['regions']:
                    guid['regions'].append(regionName)
                assert guid['parent'] == event['Parent GUID']
            guids[event['GUID']] = guid

        regions[regionName] = region

    # If we're computing ranges, add enter / leave events to per-location lists
    if ranges is not None and (event['Event'] == 'ENTER' or event['Event'] == 'LEAVE'):
        if not event['Location'] in locations:
            # TODO: use BPlusTree instead of blist?
            locations[event['Location']] = sortedlist(key=lambda i: i[0])
        locations[event['Location']].add((event['Timestamp'], event))

    # Add the event
    if events is not None:
        events[eventId] = event

    # Log that we've processed another event
    numEvents += 1
    if numEvents % 2500 == 0:
        log('.', end='')
    if numEvents % 100000 == 0:
        log('processed %i events' % numEvents)

    return (newR, seenR, newG, seenG)

def parseOtf2(otf2Path, regions=None, regionLinks=None, ranges=None, guids=None, events=None, debug=False):
    log('Parsing events (.=2500 events)')
    newR = seenR = newG = seenG = 0
    currentEvent = None
    otfPipe = subprocess.Popen(['otf2-print', otf2Path], stdout=subprocess.PIPE)
    for line in otfPipe.stdout:
        line = line.decode()
        eventLineMatch = eventLineParser.match(line)
        addAttrLineMatch = addAttrLineParser.match(line)
        if currentEvent is None and eventLineMatch is None:
            # This is a blank / header line
            continue

        if eventLineMatch is not None:
            # This is the beginning of a new event; process the previous one
            if currentEvent is not None:
                counts = _processEvent(currentEvent, regions, ranges, guids, events, debug)
                newR += counts[0]
                seenR += counts[0]
                newG += counts[0]
                seenG += counts[0]
            currentEvent = {}
            currentEvent['Event'] = eventLineMatch.group(1)
            currentEvent['Location'] = int(eventLineMatch.group(2))
            currentEvent['Timestamp'] = int(eventLineMatch.group(3))
            attrs = eventLineMatch.group(4)
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
    if currentEvent is not None:
        counts = _processEvent(currentEvent, regions, ranges, guids, events, debug)
        newR += counts[0]
        seenR += counts[0]
        newG += counts[0]
        seenG += counts[0]
    log('')
    log('Finished processing %i events' % numEvents)
    log('New regions: %d, References to existing regions: %d' % (newR, seenR))
    log('New GUIDs: %d, Number of GUID references: %d' % (newG, seenG))

    # Combine the sorted enter / leave events into ranges
    if ranges is not None:
        log('Combining enter / leave events into ranges (.=2500 ranges)')
        numRanges = 0
        for eventList in locations.values():
            lastEvent = None
            for _, event in eventList:
                assert event is not None
                if event['Event'] == 'ENTER':
                    # Start a range (don't output anything)
                    assert lastEvent is None
                    lastEvent = event
                elif event['Event'] == 'LEAVE':
                    # Finish a range
                    assert lastEvent is not None
                    rangeId = str(numRanges)
                    currentRange = {'enter': {}, 'leave': {}}
                    for attr, value in event.items():
                        if attr != 'Timestamp' and value == lastEvent[attr]: #pylint: disable=unsubscriptable-object
                            currentRange[attr] = value
                        else:
                            currentRange['enter'][attr] = lastEvent[attr] #pylint: disable=unsubscriptable-object
                            currentRange['leave'][attr] = value
                    ranges[rangeId] = currentRange

                    # Log that we've finished the finished range
                    numRanges += 1
                    if numRanges % 2500 == 0:
                        log('.', end='')
                    if numRanges % 100000 == 0:
                        log('processed %i ranges' % numRanges)
                    lastEvent = None
            # Make sure there are no trailing ENTER events
            # TODO: fibonacci data violates this... why?
            # assert lastEvent is None
        # Finish the ranges dict
        log('')
        log('Finished processing %i ranges' % numRanges)

    # Create any missing parent-child region relationships based on the GUIDs we've collected
    if guids is not None:
        log('Creating region links based on GUIDs (.=2500 relationships observed)')
        newL = seenL = 0
        for guid in guids.values():
            if guid['parent'] != '0':
                parentGuid = guids.get(guid['parent'], None)
                assert parentGuid is not None
                for parentRegion in parentGuid['regions']:
                    for childRegion in guid['regions']:
                        l = addRegionChild(parentRegion, childRegion, regions, regionLinks, 'guids', debug)[1]
                        newL += l
                        seenL += 1 if newL == 0 else 0

                        if newL + seenL % 2500 == 0:
                            log('.', end='')
                        if newL + seenL % 100000 == 0:
                            log('observed %i links' % (newL + seenL))
        log('')
        log('Finished scanning GUIDs')
        log('New links: %d, Observed existing links: %d' % (newL, seenL))
