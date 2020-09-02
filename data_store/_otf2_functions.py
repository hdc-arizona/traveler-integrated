import copy
import os
import re
import diskcache #pylint: disable=import-error
from blist import sortedlist #pylint: disable=import-error
from intervaltree import Interval, IntervalTree #pylint: disable=import-error
from .loggers import logToConsole

# Tools for handling OTF2 traces
eventLineParser = re.compile(r'^(\S+)\s+(\d+)\s+(\d+)\s+(.*)$')
attrParsers = {
    'ENTER': r'(Region): "([^"]*)"',
    'LEAVE': r'(Region): "([^"]*)"'
}
addAttrLineParser = re.compile(r'^\s+ADDITIONAL ATTRIBUTES: (.*)$')
addAttrSplitter = re.compile(r'\), \(')
addAttrParser = re.compile(r'\(?"([^"]*)" <\d+>; [^;]*; ([^\)]*)')

metricLineParser = re.compile(r'^METRIC\s+(\d+)\s+(\d+)\s+Metric:[\s\d,]+Values?: \("([^"]*)" <\d+>; [^;]*; ([^\)]*)')
memInfoMetricParser = re.compile(r'^METRIC\s+(\d+)\s+(\d+)\s+Metric:[\s\d,]+Values?: \("meminfo:([^"]*)" <\d+>; [^;]*; ([^\)]*)')

def processEvent(self, label, event):
    newR = seenR = 0

    if 'Region' in event:
        # Identify the primitive (and add to its counter)
        primitiveName = event['Region'].replace('::eval', '')
        event['Primitive'] = primitiveName
        del event['Region']
        primitive, newR = self.processPrimitive(label, primitiveName, 'otf2')
        seenR = 1 if newR == 0 else 0
        if self.debugSources is True:
            if 'eventCount' not in primitive:
                primitive['eventCount'] = 0
            primitive['eventCount'] += 1
        self.datasets[label]['primitives'][primitiveName] = primitive
    # Add enter / leave events to per-location lists
    if event['Event'] == 'ENTER' or event['Event'] == 'LEAVE':
        if not event['Location'] in self.sortedEventsByLocation:
            # TODO: use BPlusTree instead of blist? For big enough runs, piling
            # all this up in memory could be a problem...
            self.sortedEventsByLocation[event['Location']] = sortedlist(key=lambda i: i[0])
        self.sortedEventsByLocation[event['Location']].add((event['Timestamp'], event))
    return (newR, seenR)

async def processOtf2(self, label, file, log=logToConsole):
    self.addSourceFile(label, file.name, 'otf2')
    await self.processRawTrace(label, file, log)
    await self.combineIntervals(label, log)
    await self.buildIntervalTree(label, log)
    await self.connectIntervals(label, log)
    self.finishLoadingSourceFile(label, file.name)

async def processRawTrace(self, label, file, log):
    # Set up database file for procMetrics
    labelDir = os.path.join(self.dbDir, label)
    procMetrics = self.datasets[label]['procMetrics'] = diskcache.Index(os.path.join(labelDir, 'procMetrics.diskCacheIndex'))

    if 'procMetricList' not in procMetrics:
        procMetrics['procMetricList'] = []
    # Temporary counters / lists for sorting
    numEvents = 0
    self.sortedEventsByLocation = {}
    await log('Parsing OTF2 events (.=2500 events)')
    newR = seenR = 0
    currentEvent = None
    includedMetrics = 0
    skippedMetricsForMissingPrior = 0
    skippedMetricsForMismatch = 0

    async for line in file:
        eventLineMatch = eventLineParser.match(line)
        addAttrLineMatch = addAttrLineParser.match(line)
        metricLineMatch = metricLineParser.match(line)
        if currentEvent is None and eventLineMatch is None and metricLineMatch is None:
            # This is a blank / header line
            continue

        if metricLineMatch is not None:
            # This is a metric line
            location = metricLineMatch.group(1)
            timestamp = int(metricLineMatch.group(2))
            metricType = metricLineMatch.group(3)
            value = float(metricLineMatch.group(4))

            if metricType.startswith('PAPI'):
                if currentEvent is None:
                    skippedMetricsForMissingPrior += 1
                elif currentEvent['Timestamp'] != timestamp or currentEvent['Location'] != location: #pylint: disable=unsubscriptable-object
                    skippedMetricsForMismatch += 1
                else:
                    includedMetrics += 1
                    currentEvent['metrics'][metricType] = value #pylint: disable=unsubscriptable-object
                metricTypePapi = 'PAPI' + ':' + metricType
                pm = procMetrics['procMetricList']
                if metricTypePapi not in pm:
                    pm.append(metricTypePapi)
                    procMetrics['procMetricList'] = pm
            else: # do the other meminfo status io parsing here
                if metricType not in procMetrics:
                    procMetrics[metricType] = {}
                    pm = procMetrics['procMetricList']
                    pm.append(metricType)
                    procMetrics['procMetricList'] = pm
                val = procMetrics[metricType]
                val[str(timestamp)] = {'Timestamp': timestamp, 'Value':  value}
                procMetrics[metricType] = val
        elif eventLineMatch is not None:
            # This is the beginning of a new event; process the previous one
            if currentEvent is not None:
                counts = self.processEvent(label, currentEvent)
                # Log that we've processed another event
                numEvents += 1
                if numEvents % 2500 == 0:
                    await log('.', end='')
                if numEvents % 100000 == 0:
                    await log('processed %i events' % numEvents)
                # Add to primitive / guid counts
                newR += counts[0]
                seenR += counts[1]
            currentEvent = {'metrics': {}}
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
        counts = self.processEvent(label, currentEvent)
        newR += counts[0]
        seenR += counts[1]
    await log('')
    await log('Finished processing %i events' % numEvents)
    await log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
    await log('Metrics included: %d; skpped for no prior ENTER: %d; skipped for mismatch: %d' % (includedMetrics, skippedMetricsForMissingPrior, skippedMetricsForMismatch))

    # Now that we've seen all the locations, store that list in our info
    self.datasets[label]['info']['locationNames'] = sorted(self.sortedEventsByLocation.keys())

async def combineIntervals(self, label, log):
    # Set up database file
    labelDir = os.path.join(self.dbDir, label)
    intervals = self.datasets[label]['intervals'] = diskcache.Index(os.path.join(labelDir, 'intervals.diskCacheIndex'))

    # Helper function for creating interval objects
    async def createNewInterval(event, lastEvent, intervalId):
        newInterval = {'enter': {}, 'leave': {}, 'intervalId': intervalId}
        # Copy all of the attributes from the OTF2 events into the interval object. If the values
        # differ (or it's the timestamp), put them in nested enter / leave objects. Otherwise, put
        # them directly in the interval object
        for attr in set(event.keys()).union(lastEvent.keys()):
            if attr not in event:
                newInterval['enter'][attr] = lastEvent[attr]  # pylint: disable=unsubscriptable-object
            elif attr not in lastEvent:  # pylint: disable=E1135
                newInterval['leave'][attr] = event[attr]
            elif attr != 'Timestamp' and attr != 'metrics' and event[attr] == lastEvent[attr]:  # pylint: disable=unsubscriptable-object
                newInterval[attr] = event[attr]
            else:
                if attr == 'Location':
                    await log('WARNING: ENTER and LEAVE have different locations')
                newInterval['enter'][attr] = lastEvent[attr]  # pylint: disable=unsubscriptable-object
                newInterval['leave'][attr] = event[attr]
        return newInterval

    await log('Combining enter / leave events into intervals (.=2500 intervals)')
    numIntervals = mismatchedIntervals = 0

    # Keep track of the earliest and latest timestamps we see
    intervalDomain = [float('inf'), float('-inf')]

    # Create a temporary list of interval IDs sorted by leave timestamp (for
    # the later connectIntervals step)
    self.endOrderIntervalIdList = sortedlist(key=lambda i: i[0])

    # Combine the sorted enter / leave events into intervals
    for eventList in self.sortedEventsByLocation.values():
        lastEventStack = []
        currentInterval = None
        for _, event in eventList:
            assert event is not None
            intervalId = str(numIntervals)
            if event['Event'] == 'ENTER':
                # check if there is an enter event in the stack, push a dummy leave event
                if len(lastEventStack) > 0:
                    dummyEvent = copy.deepcopy(lastEventStack[-1])
                    dummyEvent['Event'] = 'LEAVE'
                    dummyEvent['Timestamp'] = event['Timestamp'] - 1  # add a new dummy leave event in 1 time unit ago
                    if 'metrics' in event:
                        dummyEvent['metrics'] = copy.deepcopy(event['metrics'])
                    currentInterval = await createNewInterval(dummyEvent, lastEventStack[-1], intervalId)
                lastEventStack.append(event)
            elif event['Event'] == 'LEAVE':
                # Finish a interval
                if len(lastEventStack) == 0:
                    # TODO: factorial data used to trigger this... why?
                    await log('WARNING: omitting LEAVE event without a prior ENTER event (%s)' % event['Primitive'])
                    continue
                lastEvent = lastEventStack.pop()
                currentInterval = await createNewInterval(event, lastEvent, intervalId)
                if len(lastEventStack) > 0:
                    lastEventStack[-1]['Timestamp'] = event['Timestamp'] + 1  # move the enter event to after 1 time unit
            if currentInterval is not None:
                # Count whether the primitive attribute differed between enter / leave
                if 'Primitive' not in currentInterval:
                    mismatchedIntervals += 1
                intervals[intervalId] = currentInterval
                # Update intervalDomain
                intervalDomain[0] = min(intervalDomain[0], currentInterval['enter']['Timestamp'])
                intervalDomain[1] = max(intervalDomain[1], currentInterval['leave']['Timestamp'])
                # Insert the id into the endOrderIntervalIdList
                self.endOrderIntervalIdList.add((currentInterval['leave']['Timestamp'], intervalId))
                # Log that we've finished the finished interval
                numIntervals += 1
                if numIntervals % 2500 == 0:
                    await log('.', end='')
                if numIntervals % 100000 == 0:
                    await log('processed %i intervals' % numIntervals)
            currentInterval = None
        # Make sure there are no trailing ENTER events
        if len(lastEventStack) > 0:
            # TODO: fibonacci data triggers this... why?
            await log('WARNING: omitting trailing ENTER event (%s)' % lastEvent['Primitive'])

    # Clean up temporary lists
    del self.sortedEventsByLocation

    # Store the full domain of the data in the datasets' info
    self.datasets[label]['info']['intervalDomain'] = intervalDomain

    await log('')
    await log('Finished creating %i intervals; %i refer to mismatching primitives' % (numIntervals, mismatchedIntervals))

async def buildIntervalTree(self, label, log):
    await log('Building IntervalTree index of intervals (.=2500 intervals)')
    count = 0
    async def intervalIterator():
        nonlocal count
        for intervalId, intervalObj in self.datasets[label]['intervals'].items():
            enter = intervalObj['enter']['Timestamp']
            leave = intervalObj['leave']['Timestamp'] + 1
            # Need to add one because IntervalTree can't handle zero-length intervals
            # (and because IntervalTree is not inclusive of upper bounds in queries)

            iTreeInterval = Interval(enter, leave, intervalId)

            count += 1
            if count % 2500 == 0:
                await log('.', end='')
            if count % 100000 == 0:
                await log('processed %i intervals' % count)

            yield iTreeInterval
    # Iterate through all intervals to construct the main index:
    self.datasets[label]['intervalIndex'] = IntervalTree([iTreeInterval async for iTreeInterval in intervalIterator()])
    await log('')
    await log('Finished indexing %i intervals' % count)

async def connectIntervals(self, label, log):
    await log('Connecting intervals with the same GUID (.=2500 intervals)')

    # Set up db file
    labelDir = os.path.join(self.dbDir, label)
    guids = self.datasets[label]['guids'] = diskcache.Index(os.path.join(labelDir, 'guids.diskCacheIndex'))

    intervalCount = missingCount = newLinks = seenLinks = 0
    for _, intervalId in self.endOrderIntervalIdList:
        intervalObj = self.datasets[label]['intervals'][intervalId]

        # Parent GUIDs refer to the one in the enter event, not the leave event
        guid = intervalObj.get('GUID', intervalObj['enter'].get('GUID', None))

        if guid is None:
            missingCount += 1
        else:
            if not guid in guids:
                guids[guid] = []
            guids[guid] = guids[guid] + [intervalId]

        # Connect to most recent interval with the parent GUID
        parentGuid = intervalObj.get('Parent GUID', intervalObj['enter'].get('Parent GUID', None))

        if parentGuid is not None and parentGuid in guids:
            foundPrior = False
            for parentIntervalId in reversed(guids[parentGuid]):
                parentInterval = self.datasets[label]['intervals'][parentIntervalId]
                if parentInterval['enter']['Timestamp'] <= intervalObj['enter']['Timestamp']:
                    foundPrior = True
                    intervalCount += 1
                    # Store metadata about the most recent interval
                    intervalObj['lastParentInterval'] = {
                        'id': parentIntervalId,
                        'location': parentInterval['Location'],
                        'endTimestamp': parentInterval['leave']['Timestamp']
                    }
                    # Because intervals is a diskcache, it needs a copy to know that something changed
                    self.datasets[label]['intervals'][intervalId] = intervalObj.copy()

                    # While we're here, note the parent-child link in the primitive graph
                    # (for now, only assume links from the parent's leave interval to the
                    # child's enter when primitive names are mismatched)
                    child = intervalObj.get('Primitive', intervalObj['enter'].get('Primitive', None))
                    parent = parentInterval.get('Primitive', intervalObj['leave'].get('Primitive', None))
                    if child is not None and parent is not None:
                        newLinkCount = self.addPrimitiveChild(label, parent, child, 'otf2')[1]
                        newLinks += newLinkCount
                        seenLinks += 1 if newLinkCount == 0 else 0
                    break
            if not foundPrior:
                missingCount += 1
        else:
            missingCount += 1

        if (missingCount + intervalCount) % 2500 == 0:
            await log('.', end='')
        if (missingCount + intervalCount) % 100000 == 0:
            await log('processed %i intervals' % (missingCount + intervalCount))

    # Clean up temporary list
    del self.endOrderIntervalIdList

    await log('Finished connecting intervals')
    await log('Interval links created: %i, Intervals without prior parent GUIDs: %i' % (intervalCount, missingCount))
    await log('New primitive links based on GUIDs: %d, Observed existing links: %d' % (newLinks, seenLinks))
