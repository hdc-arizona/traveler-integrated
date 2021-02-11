import copy
import os
import re
import gc
import diskcache
import numpy as np
from blist import sortedlist
from intervaltree import Interval, IntervalTree
from .sparseUtilizationList import SparseUtilizationList
from . import logToConsole

# Helper function from https://stackoverflow.com/a/4836734/1058935 for
# human-friendly location name sorting
def natural_sort(l):
    convert = lambda text: int(text) if text.isdigit() else text.lower()
    alphanum_key = lambda key: [ convert(c) for c in re.split('([0-9]+)', key) ]
    return sorted(l, key = alphanum_key)

# Tools for handling OTF2 traces
eventLineParser = re.compile(r'^((?:ENTER)|(?:LEAVE))\s+(\d+)\s+(\d+)\s+(.*)$')
attrParsers = {
    'ENTER': r'(Region): "([^"]*)"',
    'LEAVE': r'(Region): "([^"]*)"'
}
addAttrLineParser = re.compile(r'^\s+ADDITIONAL ATTRIBUTES: (.*)$')
addAttrSplitter = re.compile(r'\), \(')
addAttrParser = re.compile(r'\(?"([^"]*)" <\d+>; [^;]*; ([^\)]*)')

metricLineParser = re.compile(r'^METRIC\s+(\d+)\s+(\d+)\s+Metric:[\s\d,]+Values?: \("([^"]*)" <\d+>; [^;]*; ([^\)]*)')
memInfoMetricParser = re.compile(r'^METRIC\s+(\d+)\s+(\d+)\s+Metric:[\s\d,]+Values?: \("meminfo:([^"]*)" <\d+>; [^;]*; ([^\)]*)')

def processEvent(self, datasetId, event):
    newR = seenR = 0

    if 'Region' in event:
        # Identify the primitive (and add to its counter)
        primitiveName = event['Region'].replace('::eval', '')
        event['Primitive'] = primitiveName
        del event['Region']
        primitive, newR = self.processPrimitive(datasetId, primitiveName, 'otf2')
        seenR = 1 if newR == 0 else 0
        if self.debugSources is True:
            if 'eventCount' not in primitive:
                primitive['eventCount'] = 0
            primitive['eventCount'] += 1
        self[datasetId]['primitives'][primitiveName] = primitive
    # Add enter / leave events to per-location lists
    if event['Event'] == 'ENTER' or event['Event'] == 'LEAVE':
        if not event['Location'] in self.sortedEventsByLocation:
            # TODO: use BPlusTree instead of blist? For big enough runs, piling
            # all this up in memory could be a problem...
            self.sortedEventsByLocation[event['Location']] = sortedlist(key=lambda i: i[0])
        self.sortedEventsByLocation[event['Location']].add((event['Timestamp'], event))
    return (newR, seenR)

async def processOtf2(self, datasetId, file, log=logToConsole):
    # Run each substep, with manual calls to python's garbage collector in
    # between
    await self.processRawTrace(datasetId, file, log)
    gc.collect()
    await self.combineIntervals(datasetId, log)
    gc.collect()
    await self.buildIntervalTree(datasetId, log)
    gc.collect()
    await self.buildSparseUtilizationLists(datasetId, log)
    gc.collect()
    self.finishLoadingSourceFile(datasetId, file.name)

async def processRawTrace(self, datasetId, file, log):
    # Set up database file for procMetrics
    idDir = os.path.join(self.dbDir, datasetId)
    procMetrics = self[datasetId]['procMetrics'] = diskcache.Index(os.path.join(idDir, 'procMetrics.diskCacheIndex'))
    procMetricList = self[datasetId]['info']['procMetricList'] = []

    # Temporary counters / lists for sorting
    numEvents = 0
    self.sortedEventsByLocation = {}
    await log('Parsing OTF2 events (.=2500 events)')
    newR = seenR = 0
    currentEvent = None
    includedMetrics = 0
    skippedMetricsForMissingPrior = 0
    skippedMetricsForMismatch = 0
    unsupportedSkippedLines = 0

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
                if metricTypePapi not in self[datasetId]['info']['procMetricList']:
                    procMetricList.append(metricTypePapi)
                    self[datasetId]['info']['procMetricList'] = procMetricList
            else: # do the other meminfo status io parsing here
                if metricType not in procMetrics:
                    procMetrics[metricType] = {}
                    procMetricList.append(metricType)
                    self[datasetId]['info']['procMetricList'] = procMetricList
                procMetrics[metricType][str(timestamp)] = {'Timestamp': timestamp, 'Value':  value}
        elif eventLineMatch is not None:
            # This is the beginning of a new event; process the previous one
            if currentEvent is not None:
                counts = self.processEvent(datasetId, currentEvent)
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
        elif currentEvent is not None and addAttrLineMatch is not None:
            # This line contains additional event attributes
            attrList = addAttrSplitter.split(addAttrLineMatch.group(1))
            for attrStr in attrList:
                attr = addAttrParser.match(attrStr)
                assert attr is not None
                currentEvent[attr.group(1)] = attr.group(2) #pylint: disable=unsupported-assignment-operation
        else:
            # This is a line that we aren't capturing (yet), e.g. MPI_SEND
            unsupportedSkippedLines += 1
    # The last event will never have had a chance to be processed:
    if currentEvent is not None:
        counts = self.processEvent(datasetId, currentEvent)
        newR += counts[0]
        seenR += counts[1]
    await log('')
    await log('Finished processing %i events' % numEvents)
    await log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
    await log('Metrics included: %d; skipped for no prior ENTER: %d; skipped for mismatch: %d' % (includedMetrics, skippedMetricsForMissingPrior, skippedMetricsForMismatch))
    await log('Lines skipped because they are not yet supported: %d' % unsupportedSkippedLines)

    # Now that we've seen all the locations, store that list in our info
    self[datasetId]['info']['locationNames'] = natural_sort(self.sortedEventsByLocation.keys())

async def combineIntervals(self, datasetId, log):
    # Set up database file
    idDir = os.path.join(self.dbDir, datasetId)
    intervals = self[datasetId]['intervals'] = diskcache.Index(os.path.join(idDir, 'intervals.diskCacheIndex'))

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
                    await log('')
                    await log('WARNING: ENTER and LEAVE have different locations')
                newInterval['enter'][attr] = lastEvent[attr]  # pylint: disable=unsubscriptable-object
                newInterval['leave'][attr] = event[attr]
        return newInterval

    await log('Combining enter / leave events into intervals (.=2500 intervals)')
    numIntervals = mismatchedIntervals = missingPrimitives = 0

    # Keep track of the earliest and latest timestamps we see
    intervalDomain = [float('inf'), float('-inf')]

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
                    await log('')
                    await log('WARNING: omitting LEAVE event without a prior ENTER event (%s)' % event['Primitive'])
                    continue
                lastEvent = lastEventStack.pop()
                currentInterval = await createNewInterval(event, lastEvent, intervalId)
                if len(lastEventStack) > 0:
                    lastEventStack[-1]['Timestamp'] = event['Timestamp'] + 1  # move the enter event to after 1 time unit
            if currentInterval is not None:
                # Count whether the primitive attribute is missing or differed between enter / leave
                if 'Primitive' not in currentInterval:
                    if 'Primitive' not in currentInterval['enter'] or 'Primitive' not in currentInterval['leave']:
                        missingPrimitives += 1
                        currentInterval['Primitive'] = '(primitive name missing)'
                    else:
                        mismatchedIntervals += 1
                        # Use the enter event's primitive name
                        currentInterval['Primitive'] = currentInterval['enter']['Primitive']
                intervals[intervalId] = currentInterval
                # Update intervalDomain
                intervalDomain[0] = min(intervalDomain[0], currentInterval['enter']['Timestamp'])
                intervalDomain[1] = max(intervalDomain[1], currentInterval['leave']['Timestamp'])
                # Log that we've finished the finished interval
                numIntervals += 1
                if numIntervals % 2500 == 0:
                    await log('.', end='')
                if numIntervals % 100000 == 0:
                    await log('processed %i intervals' % numIntervals)
            currentInterval = None
        # Make sure there are no trailing ENTER events
        if len(lastEventStack) > 0:
            # TODO: this seems to be triggered by recent distributed runs;
            # probably not a big deal as they're usually shudown_action events?
            await log('')
            await log('WARNING: omitting trailing ENTER event (%s)' % lastEvent['Primitive'])

    # Clean up temporary lists
    del self.sortedEventsByLocation

    # Store the full domain of the data in the datasets' info
    self[datasetId]['info']['intervalDomain'] = intervalDomain

    await log('')
    await log('Finished creating %i intervals; %i had no primitive name; %i had mismatching primitives (ENTER primitive used)' % (numIntervals, missingPrimitives, mismatchedIntervals))

async def buildIntervalTree(self, datasetId, log):
    await log('Building IntervalTree index of intervals (.=2500 intervals)')
    count = 0
    async def intervalIterator():
        nonlocal count
        for intervalId, intervalObj in self[datasetId]['intervals'].items():
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
    # (TODO: temporarily disabling the garbage collector helps speed this up,
    # but that's a hacky fix...)
    gc.disable()
    self[datasetId]['intervalIndex'] = IntervalTree([iTreeInterval async for iTreeInterval in intervalIterator()])
    gc.enable()
    gc.collect()
    await log('')
    await log('Finished indexing %i intervals' % count)

async def buildSparseUtilizationLists(self, datasetId, log=logToConsole):
    # create allSuls obj
    allSuls = {'intervals': SparseUtilizationList(), 'metrics': dict(), 'primitives': dict()}
    preMetricValue = dict()
    intervalDuration = dict()

    def updateSULForInterval(event, cur_location):
        if 'metrics' in event:
            for k, value in event['metrics'].items():
                if k not in allSuls['metrics']:
                    allSuls['metrics'][k] = SparseUtilizationList()
                    preMetricValue[k] = {'Timestamp': 0, 'Value': 0}
                current_rate = (value - preMetricValue[k]['Value']) / (event['Timestamp'] - preMetricValue[k]['Timestamp'])
                allSuls['metrics'][k].setIntervalAtLocation({'index': int(event['Timestamp']), 'counter': 0, 'util': current_rate}, cur_location)
                preMetricValue[k]['Timestamp'] = event['Timestamp']
                preMetricValue[k]['Value'] = value

    def updateIntervalDuration(event):
        duration = event['leave']['Timestamp'] - event['enter']['Timestamp']
        if 'Primitive' in event:
            durationCounts = intervalDuration[event['Primitive']] = intervalDuration.get(event['Primitive'], dict())
            durationCounts[duration] = durationCounts.get(duration, 0) + 1

    # First pass through all the intervals
    count = 0
    await log('Building SparseUtilizationList indexes (.=2500 intervals)')
    for intervalObj in self[datasetId]['intervals'].values():
        loc = intervalObj['Location']
        primitive_name = intervalObj['Primitive']

        # Update the full SparseUtilizationList
        allSuls['intervals'].setIntervalAtLocation({'index': int(intervalObj['enter']['Timestamp']), 'counter': 1, 'util': 0, 'primitive': primitive_name}, loc)
        allSuls['intervals'].setIntervalAtLocation({'index': int(intervalObj['leave']['Timestamp']), 'counter': -1, 'util': 0, 'primitive': primitive_name}, loc)

        # Create a SparseUtilizationList for the primitive if we haven't yet
        if primitive_name not in allSuls['primitives']:
            allSuls['primitives'][primitive_name] = SparseUtilizationList()
        # ... and update it
        allSuls['primitives'][primitive_name].setIntervalAtLocation({'index': int(intervalObj['enter']['Timestamp']), 'counter': 1, 'util': 0, 'primitive': primitive_name}, loc)
        allSuls['primitives'][primitive_name].setIntervalAtLocation({'index': int(intervalObj['leave']['Timestamp']), 'counter': -1, 'util': 0, 'primitive': primitive_name}, loc)

        # Create / update SparseUtilizationLists for any metrics
        updateSULForInterval(intervalObj['enter'], loc)
        updateSULForInterval(intervalObj['leave'], loc)

        # Update the duration histogram
        updateIntervalDuration(intervalObj)

        count += 1
        if count % 2500 == 0:
            await log('.', end='')
        if count % 100000 == 0:
            await log('processed %i intervals' % count)

    await log('')
    await log('Finished indexing %s intervals' % count)

    # Do a quick report on any discrepancies between the primitives we saw, and
    # the primitives that we expected to see
    expectedPrimitives = set(self[datasetId]['primitives'].keys())
    observedPrimitives = set(intervalDuration.keys())
    extraExpected = expectedPrimitives - observedPrimitives
    extraObserved = observedPrimitives - expectedPrimitives
    if len(extraExpected) > 0:
        await log('WARNING: Did not observe intervals for primitives: ' + ', '.join(extraExpected))
    if len(extraObserved) > 0:
        await log('WARNING: Observed intervals for unknown primitives: ' + ', '.join(extraObserved))

    # Second pass to finish each SparseUtilizationList
    await log('Finalizing indexes')
    flatSulList = [allSuls['intervals']] + list(allSuls['primitives'].values()) + list(allSuls['metrics'].values())
    for sul in flatSulList:
        sul.finalize()
        await log('.', end='')
    await log('')

    self[datasetId]['sparseUtilizationList'] = allSuls
    self[datasetId]['info']['intervalDuration'] = intervalDuration
