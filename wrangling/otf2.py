import re
import subprocess
from blist import sortedlist #pylint: disable=import-error
from intervaltree import Interval, IntervalTree #pylint: disable=import-error
from .common import log, processPrimitive, addPrimitiveChild

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

def _processEvent(event, primitives=None, intervals=None, guids=None, events=None, debug=False):
    global numEvents

    eventId = str(numEvents)
    newR = seenR = newG = seenG = 0

    if 'Primitive' in event:
        # Identify the primitive (and add to its counter)
        primitiveName = event['Primitive'].replace('::eval', '')
        primitive, newR = processPrimitive(primitiveName, primitives, 'otf2 event', debug=debug)
        seenR = 1 if newR == 0 else 0
        if debug is True:
            if 'eventCount' not in primitive:
                primitive['eventCount'] = 0
            primitive['eventCount'] += 1

        # Add to GUID / Parent GUID relationships
        if guids is not None and 'GUID' in event and 'Parent GUID' in event:
            if 'guids' not in primitive:
                primitive['guids'] = [event['GUID']]
            elif event['GUID'] not in primitive['guids']:
                # TODO: using a list instead of a set is expensive... but
                # storing sets may or may not be supported
                primitive['guids'].append(event['GUID'])
            guid = guids.get(event['GUID'], None)
            if guid is None:
                newG += 1
                guid = {
                    'primitives': [primitiveName],
                    'parent': event['Parent GUID']
                }
            else:
                seenG += 1
                if primitiveName not in guid['primitives']:
                    guid['primitives'].append(primitiveName)
                assert guid['parent'] == event['Parent GUID']
            guids[event['GUID']] = guid

        primitives[primitiveName] = primitive

    # If we're computing intervals, add enter / leave events to per-location lists
    if intervals is not None and (event['Event'] == 'ENTER' or event['Event'] == 'LEAVE'):
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

def parseOtf2(otf2Path, primitives=None, primitiveLinks=None, intervals=None, guids=None, events=None, debug=False):
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
                counts = _processEvent(currentEvent, primitives, intervals, guids, events, debug)
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
        counts = _processEvent(currentEvent, primitives, intervals, guids, events, debug)
        newR += counts[0]
        seenR += counts[0]
        newG += counts[0]
        seenG += counts[0]
    log('')
    log('Finished processing %i events' % numEvents)
    log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
    log('New GUIDs: %d, Number of GUID references: %d' % (newG, seenG))

    # Combine the sorted enter / leave events into intervals
    if intervals is not None:
        log('Combining enter / leave events into intervals (.=2500 intervals)')
        numIntervals = 0
        for eventList in locations.values():
            lastEvent = None
            for _, event in eventList:
                assert event is not None
                if event['Event'] == 'ENTER':
                    # Start a interval (don't output anything)
                    assert lastEvent is None
                    lastEvent = event
                elif event['Event'] == 'LEAVE':
                    # Finish a interval
                    assert lastEvent is not None
                    intervalId = str(numIntervals)
                    currentInterval = {'enter': {}, 'leave': {}}
                    for attr, value in event.items():
                        if attr != 'Timestamp' and value == lastEvent[attr]: #pylint: disable=unsubscriptable-object
                            currentInterval[attr] = value
                        else:
                            currentInterval['enter'][attr] = lastEvent[attr] #pylint: disable=unsubscriptable-object
                            currentInterval['leave'][attr] = value
                    intervals[intervalId] = currentInterval

                    # Log that we've finished the finished interval
                    numIntervals += 1
                    if numIntervals % 2500 == 0:
                        log('.', end='')
                    if numIntervals % 100000 == 0:
                        log('processed %i intervals' % numIntervals)
                    lastEvent = None
            # Make sure there are no trailing ENTER events
            # TODO: fibonacci data violates this... why?
            # assert lastEvent is None
        # Finish the intervals dict
        log('')
        log('Finished processing %i intervals' % numIntervals)

    # Create any missing parent-child primitive relationships based on the GUIDs we've collected
    if guids is not None:
        log('Creating primitive links based on GUIDs (.=2500 relationships observed)')
        newL = seenL = 0
        for guid in guids.values():
            if guid['parent'] != '0':
                parentGuid = guids.get(guid['parent'], None)
                assert parentGuid is not None
                for parentPrimitive in parentGuid['primitives']:
                    for childPrimitive in guid['primitives']:
                        l = addPrimitiveChild(parentPrimitive, childPrimitive, primitives, primitiveLinks, 'guids', debug)[1]
                        newL += l
                        seenL += 1 if newL == 0 else 0

                        if newL + seenL % 2500 == 0:
                            log('.', end='')
                        if newL + seenL % 100000 == 0:
                            log('observed %i links' % (newL + seenL))
        log('')
        log('Finished scanning GUIDs')
        log('New links: %d, Observed existing links: %d' % (newL, seenL))

def indexIntervals(intervals):
    log('Assembling interval index (.=2500 intervals)')
    count = 0
    def intervalIterator():
        nonlocal count
        for intervalId, intervalObj in intervals.items():
            enter = intervalObj['enter']['Timestamp']
            leave = intervalObj['leave']['Timestamp'] + 1
            # Need to add one because IntervalTree can't handle zero-length intervals
            # (and because IntervalTree is not inclusive of upper bounds in queries)

            count += 1
            if count % 2500 == 0:
                log('.', end='')
            if count % 100000 == 0:
                log('indexed %i intervals' % count)

            yield Interval(enter, leave, intervalId)
    index = IntervalTree(interval for interval in intervalIterator())

    log('')
    log('Pre-computing binning statistics')
    index.freeze()

    log('Finished indexing intervals')

    return index
