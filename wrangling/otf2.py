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

def parseOtf2(otf2Path, primitives=None, primitiveLinks=None, intervals=None, guids=None, events=None, debug=False):
    numEvents = 0
    sortedEventsByLocation = {}
    resultsToReturn = {}

    # Helper function for processing events
    def _processEvent(event):
        nonlocal numEvents

        eventId = str(numEvents)
        newR = seenR = newG = seenG = 0

        if 'Region' in event:
            # Identify the primitive (and add to its counter)
            primitiveName = event['Region'].replace('::eval', '')
            event['Primitive'] = primitiveName
            del event['Region']
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
                    # TODO: list lookups instead of set lookups aren't as optimal...
                    # but storing sets may or may not be supported
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
            if not event['Location'] in sortedEventsByLocation:
                # TODO: use BPlusTree instead of blist? For big enough runs, piling
                # all this up in memory could be a problem...
                sortedEventsByLocation[event['Location']] = sortedlist(key=lambda i: i[0])
            sortedEventsByLocation[event['Location']].add((event['Timestamp'], event))

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
                counts = _processEvent(currentEvent)
                newR += counts[0]
                seenR += counts[1]
                newG += counts[2]
                seenG += counts[3]
            currentEvent = {}
            currentEvent['Event'] = eventLineMatch.group(1)
            currentEvent['Location'] = eventLineMatch.group(2)
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
        counts = _processEvent(currentEvent)
        newR += counts[0]
        seenR += counts[1]
        newG += counts[2]
        seenG += counts[3]
    log('')
    log('Finished processing %i events' % numEvents)
    log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
    if guids is not None:
        log('New GUIDs: %d, Number of GUID references: %d' % (newG, seenG))

    # Now that we've seen all the locations, we'll want to return a list of them
    resultsToReturn['locationNames'] = sorted(sortedEventsByLocation.keys())

    # Combine the sorted enter / leave events into intervals, and then index
    # the intervals
    assert intervals is not None
    log('Combining enter / leave events into intervals (.=2500 intervals)')
    numIntervals = 0
    for location, eventList in sortedEventsByLocation.items():
        lastEvent = None
        for _, event in eventList:
            assert event is not None
            if event['Event'] == 'ENTER':
                # Start an interval (don't output anything)
                if lastEvent is not None:
                    log('WARNING: omitting ENTER event without a following LEAVE event (%s)' % lastEvent['name']) #pylint: disable=unsubscriptable-object
                # TODO: factorial data used to violate this... why?
                # assert lastEvent is None
                lastEvent = event
            elif event['Event'] == 'LEAVE':
                # Finish a interval
                if lastEvent is None:
                    log('WARNING: omitting LEAVE event without a prior ENTER event (%s)' % event['name'])
                    continue
                # TODO: factorial data used to violate this... why?
                # assert lastEvent is not None
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
        if lastEvent is not None:
            log('WARNING: omitting trailing ENTER event (%s)' % lastEvent['Primitive'])
    log('')
    log('Finished creating %i intervals' % numIntervals)

    # Now for indexing: we want per-location indexes, per-primitive indexes,
    # as well as both filters at the same time (we key by locations first)
    # TODO: these are all built in memory... I should probably find a way
    # to make a shelve-like version of IntervalTree:
    resultsToReturn['indexes'] = {
        'primitives': {},
        'locations': {},
        'both': {}
    }

    for location in resultsToReturn['locationNames']:
        resultsToReturn['indexes']['locations'][location] = IntervalTree()
        resultsToReturn['indexes']['both'][location] = {}
    for primitive in primitives.keys():
        resultsToReturn['indexes']['primitives'][primitive] = IntervalTree()
        for location in resultsToReturn['locationNames']:
            resultsToReturn['indexes']['both'][location][primitive] = IntervalTree()

    log('Assembling interval indexes (.=2500 intervals)')
    count = 0
    def intervalIterator():
        nonlocal count
        for intervalId, intervalObj in intervals.items():
            enter = intervalObj['enter']['Timestamp']
            leave = intervalObj['leave']['Timestamp'] + 1
            # Need to add one because IntervalTree can't handle zero-length intervals
            # (and because IntervalTree is not inclusive of upper bounds in queries)

            iv = Interval(enter, leave, intervalId)

            # Add the interval to the appropriate indexes (piggybacked off
            # the construction of the main index):
            location = intervalObj['Location']
            resultsToReturn['indexes']['locations'][location].add(iv)
            if 'Primitive' in intervalObj:
                resultsToReturn['indexes']['primitives'][intervalObj['Primitive']].add(iv)
                resultsToReturn['indexes']['both'][location][intervalObj['Primitive']].add(iv)
            elif 'Primitive' in intervalObj['enter']:
                resultsToReturn['indexes']['primitives'][intervalObj['enter']['Primitive']].add(iv)
                resultsToReturn['indexes']['both'][location][intervalObj['enter']['Primitive']].add(iv)

            count += 1
            if count % 2500 == 0:
                log('.', end='')
            if count % 100000 == 0:
                log('processed %i intervals' % count)

            yield iv
    # Iterate through all intervals to construct the main index:
    resultsToReturn['indexes']['main'] = IntervalTree(intervalIterator())

    log('')
    log('Finished indexing %i intervals' % count)

    # Create any missing parent-child primitive relationships based on the GUIDs we've collected
    if guids is not None:
        log('Creating primitive links based on GUIDs (.=2500 GUIDs processed)')
        newL = seenL = 0
        for nGuid, guid in enumerate(guids.values()):
            if guid['parent'] != '0':
                parentGuid = guids.get(guid['parent'], None)
                assert parentGuid is not None
                for parentPrimitive in parentGuid['primitives']:
                    for childPrimitive in guid['primitives']:
                        l = addPrimitiveChild(parentPrimitive, childPrimitive, primitives, primitiveLinks, 'guids', debug)[1]
                        newL += l
                        seenL += 1 if newL == 0 else 0
            if nGuid > 0 and nGuid % 250 == 0:
                log('.', end='')
            if nGuid > 0 and nGuid % 10000 == 0:
                log('scanned %i GUIDs' % nGuid)
        log('')
        log('Finished scanning %d GUIDs' % len(guids))
        log('New links: %d, Observed existing links: %d' % (newL, seenL))

    return resultsToReturn
