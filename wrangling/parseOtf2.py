import re
from blist import sortedlist #pylint: disable=import-error
from .log import log
from . import common

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

def processEvent(regions, event, ranges=None, guids=None, events=None, debug=False):
    global numEvents
    if event is None:
        return
    
    eventId = str(numEvents)

    if 'Region' in event:
        # Identify the region (and add to its counter)
        regionName = event['Region'].replace('::eval', '')
        region = common.processRegion(regions, regionName, 'otf2 event', debug=debug)
        if debug is True:
            if 'eventCount' not in region:
                region['eventCount'] = 0
            region['eventCount'] += 1

        # Add to GUID / Parent GUID relationships
        if guids is not None and 'GUID' in event and 'Parent GUID' in event:
            if 'guids' not in region:
                region['guids'] = [event['GUID']]
            elif event['GUID'] not in region['guids']:
                region['guids'].append(event['GUID'])
            guid = guids.get(event['GUID'], None)
            if guid is None:
                guid = {
                    'regions': [regionName],
                    'parent': event['Parent GUID']
                }
            else:
                if regionName not in guid['regions']:
                    guid['regions'].append(regionName)
                assert guid['parent'] == event['Parent GUID']
            guids[event['GUID']] = guid
        
        regions[regionName] = region

    # If we're computing ranges, add enter / leave events to per-location lists
    if ranges is not None and (event['Event'] == 'ENTER' or event['Event'] == 'LEAVE'):
        if not event['Location'] in locations:
            locations[event['Location']] = sortedlist(key=lambda i: i[0])
        locations[event['Location']].add((event['Timestamp'], eventId))
    
    # Add the event
    if events is not None:
        events[eventId] = event

    # Log that we've processed another event
    numEvents += 1
    if numEvents % 2500 == 0:
        log('.', end=''),
    if numEvents % 100000 == 0:
        log('processed %i events' % numEvents)

def parseOtf2 (otfPipe, regions, regionLinks, ranges=None, guids=None, events=None, debug=False):
    log('Parsing events (.=2500 events)')
    currentEvent = None
    for line in otfPipe.stdout:
        line = line.decode()
        eventLineMatch = eventLineParser.match(line)
        addAttrLineMatch = addAttrLineParser.match(line)
        if currentEvent is None and eventLineMatch is None:
            # This is a blank / header line
            continue

        if eventLineMatch is not None:
            # This is the beginning of a new event; process the previous one
            processEvent(regions, currentEvent, ranges, guids, events, debug)
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
    processEvent(regions, currentEvent, ranges, guids, events, debug)
    log('')
    log('finished processing %i events' % numEvents)

    # Combine the sorted enter / leave events into ranges
    if ranges is not None:
        log('Combining enter / leave events into ranges (.=2500 ranges)')
        numRanges = 0
        for eventList in locations.values():
            lastEvent = None
            for _, eventId in eventList:
                event = events.get(eventId, None)
                assert event is not None
                if event['Event'] == 'ENTER':
                    # Start a range (don't output anything)
                    assert lastEvent is None
                    lastEvent = event
                elif event['Event'] == 'LEAVE':
                    # Finish a range
                    assert lastEvent is not None
                    rangeId = str(numRanges)
                    currentRange = { 'enter': {}, 'leave': {} }
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
                        log('.', end=''),
                    if numRanges % 100000 == 0:
                        log('processed %i ranges' % numRanges)
                    lastEvent = None
            # Make sure there are no trailing ENTER events
            # TODO: fibonacci data violates this... why?
            # assert lastEvent is None
        # Finish the ranges dict
        log('')
        log('finished processing %i ranges' % numRanges)

    # Create any missing parent-child region relationships based on the GUIDs we've collected
    if guids is not None:
        log('Creating region relationships based on GUIDs (.=2500 relationships observed)')
        count = 0
        initialLinkCount = len(regionLinks)
        for guid in guids.values():
            if guid['parent'] != '0':
                parentGuid = guids.get(guid['parent'], None)
                assert parentGuid is not None
                for parentRegion in parentGuid['regions']:
                    for childRegion in guid['regions']:
                        count += 1
                        common.addRegionChild(regions, regionLinks, parentRegion, childRegion, 'guids', debug=debug)

                        if count % 2500 == 0:
                            log('.', end=''),
                        if count % 100000 == 0:
                            log('observed %i relationships' % count)
        log('')
        log('%d relationships observed based on GUIDs; %d are new' % (count, len(regionLinks) - initialLinkCount))