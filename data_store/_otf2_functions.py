import copy
import os
import re
import gc
import diskcache
import numpy as np
from sortedcontainers import SortedList
from intervaltree import Interval, IntervalTree
from .sparseUtilizationList import SparseUtilizationList
from .dependencyTree import DependencyTreeNode
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
            self.sortedEventsByLocation[event['Location']] = SortedList()
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
    await self.connectIntervals(datasetId, log)
    gc.collect()
    await self.buildSparseUtilizationLists(datasetId, log)
    gc.collect()
    await self.buildDependencyTree(datasetId, log)
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
    badAddAttrLines = 0

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
            # Usually group(4) is just a number, but sometimes we can get input
            # like "DOUBLE <2>; 1234.0000"... we want the last number
            value = float(re.findall('[0-9.]+', metricLineMatch.group(4))[-1])

            if metricType.startswith('PAPI'):
                if currentEvent is None:
                    skippedMetricsForMissingPrior += 1
                elif currentEvent['Timestamp'] != timestamp or currentEvent['Location'] != location: #pylint: disable=unsubscriptable-object
                    skippedMetricsForMismatch += 1
                else:
                    includedMetrics += 1
                    currentEvent['metrics'][metricType] = value #pylint: disable=unsubscriptable-object
                if metricType not in self[datasetId]['info']['procMetricList']:
                    procMetricList.append(metricType)
                    self[datasetId]['info']['procMetricList'] = procMetricList
            else: # do the other meminfo status io parsing here
                if metricType not in procMetrics:
                    cMetric = dict()
                    procMetricList.append(metricType)
                    self[datasetId]['info']['procMetricList'] = procMetricList
                else:
                    cMetric = procMetrics[metricType]
                cMetric[str(timestamp)] = {'Timestamp': timestamp, 'Value':  value}
                procMetrics[metricType] = cMetric
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
                if attr is None:
                    badAddAttrLines += 1
                    await log('\nWARNING: omitting data from bad ADDITIONAL ATTRIBUTES line:\n%s' % line)
                    continue
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
    await log('Additional attribute lines skipped: %d' % badAddAttrLines)
    await log('Lines skipped because they are not yet supported: %d' % unsupportedSkippedLines)

    # Now that we've seen all the locations, store that list in our info
    self[datasetId]['info']['locationNames'] = natural_sort(self.sortedEventsByLocation.keys())

async def combineIntervals(self, datasetId, log):
    # Set up database file
    idDir = os.path.join(self.dbDir, datasetId)
    intervals = self[datasetId]['intervals'] = diskcache.Index(os.path.join(idDir, 'intervals.diskCacheIndex'))

    # Helper function for creating interval objects
    async def createNewInterval(event, lastEvent, intervalId):
        newInterval = {'enter': {}, 'leave': {}, 'intervalId': intervalId, 'parent': None, 'children': []}
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
                    await log('\nWARNING: ENTER and LEAVE have different locations')
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
                    await log('\nWARNING: omitting LEAVE event without a prior ENTER event (%s)' % event['Primitive'])
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
            lastEvent = lastEventStack[-1]
            await log('\nWARNING: omitting trailing ENTER event (%s)' % lastEvent['Primitive'])

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

async def connectIntervals(self, datasetId, log=logToConsole):
    await log('Connecting intervals with the same GUID (.=2500 intervals)')

    guids = {}
    # TODO: using a simple dict piles up GUIDs and intervalIds in memory... if
    # this gets too big, a (REALLY slow) alternative to guids = {}:
    #
    # idDir = os.path.join(self.dbDir, datasetId)
    # guids = self.datasets[datasetId]['guids'] = diskcache.Index(os.path.join(idDir, 'guids.diskCacheIndex'))
    #
    # ... also, I'm not totally sure that guids[guid].append(intervalId) below
    # even works correctly with a diskcache.Index; it might need the slower
    # guids[guid] = guids[guid] + [intervalId]

    intervals = self[datasetId]['intervals']
    intervalCount = missingCount = newLinks = seenLinks = 0

    for iv in self[datasetId]['intervalIndex'].iterOverlap(endOrder=True):
        intervalId = iv.data
        intervalObj = intervals[intervalId]

        # Parent GUIDs refer to the one in the enter event, not the leave event
        guid = intervalObj.get('GUID', intervalObj['enter'].get('GUID', None))

        if guid is None:
            missingCount += 1
        else:
            if not guid in guids:
                guids[guid] = []
            guids[guid].append(intervalId)

        # Connect to most recent interval with the parent GUID
        parentGuid = intervalObj.get('Parent GUID', intervalObj['enter'].get('Parent GUID', None))

        if parentGuid is not None and parentGuid in guids:
            foundPrior = False
            for parentIntervalId in reversed(guids[parentGuid]):
                parentInterval = intervals[parentIntervalId]
                if parentInterval['enter']['Timestamp'] <= intervalObj['enter']['Timestamp']:
                    foundPrior = True
                    intervalCount += 1
                    # Store the id of the most recent interval
                    intervalObj['parent'] = parentIntervalId
                    # add our id to the parent interval
                    parentInterval['children'].append(intervalId)
                    # Because intervals is a diskcache.Index, it needs to know that something changed
                    intervals[intervalId] = intervalObj
                    intervals[parentIntervalId] = parentInterval

                    # While we're here, note the parent-child link in the primitive graph
                    # (for now, only assume links from the parent's leave interval to the
                    # child's enter when primitive names are mismatched)
                    childPrimitive = intervalObj.get('Primitive', intervalObj['enter'].get('Primitive', None))
                    parentPrimitive = parentInterval.get('Primitive', intervalObj['leave'].get('Primitive', None))
                    if childPrimitive is not None and parentPrimitive is not None:
                        l = self.addPrimitiveChild(datasetId, parentPrimitive, childPrimitive, 'otf2')[1]
                        newLinks += l
                        seenLinks += 1 if l == 0 else 0
                    break
            if not foundPrior:
                missingCount += 1
        else:
            missingCount += 1

        if (missingCount + intervalCount) % 2500 == 0:
            await log('.', end='')
        if (missingCount + intervalCount) % 100000 == 0:
            await log('processed %i intervals' % (missingCount + intervalCount))

    await log('Finished connecting intervals')
    await log('Interval links created: %i, Intervals without prior parent GUIDs: %i' % (intervalCount, missingCount))
    await log('New primitive links based on GUIDs: %d, Observed existing links: %d' % (newLinks, seenLinks))

async def buildSparseUtilizationLists(self, datasetId, log=logToConsole):
    # create allSuls obj
    allSuls = {'intervals': SparseUtilizationList(), 'metrics': dict(), 'primitives': dict(), 'intervalHistograms': dict()}
    intervalHistograms = dict()
    preMetricValue = dict()
    allLocations = set()

    def updateSULForInterval(event, cur_location):
        if 'metrics' in event:
            for k, value in event['metrics'].items():
                if k not in allSuls['metrics']:
                    allSuls['metrics'][k] = SparseUtilizationList(False)
                    preMetricValue[k] = {'Timestamp': 0, 'Value': 0}
                current_rate = (value - preMetricValue[k]['Value']) / (event['Timestamp'] - preMetricValue[k]['Timestamp'])
                allSuls['metrics'][k].setIntervalAtLocation({'index': int(event['Timestamp']), 'counter': 0, 'util': current_rate}, cur_location)
                preMetricValue[k]['Timestamp'] = event['Timestamp']
                preMetricValue[k]['Value'] = value

    def updateIntervalDuration(event):
        duration = event['leave']['Timestamp'] - event['enter']['Timestamp']
        if 'Primitive' in event:
            durationCounts = intervalHistograms[event['Primitive']] = intervalHistograms.get(event['Primitive'], dict())
            durationCounts[duration] = durationCounts.get(duration, 0) + 1
            allDurationCounts = intervalHistograms['all_primitives'] = intervalHistograms.get('all_primitives', dict())
            allDurationCounts[duration] = allDurationCounts.get(duration, 0) + 1

    # First pass through all the intervals
    count = 0
    await log('Building SparseUtilizationList indexes (.=2500 intervals)')
    for intervalObj in self[datasetId]['intervals'].values():
        loc = intervalObj['Location']
        allLocations.add(loc)
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
    observedPrimitives = set(intervalHistograms.keys())
    extraExpected = expectedPrimitives - observedPrimitives
    extraObserved = observedPrimitives - expectedPrimitives
    if len(extraExpected) > 0:
        await log('\nWARNING: Did not observe intervals for primitives: ' + ', '.join(extraExpected))
    if len(extraObserved) > 0:
        await log('\nWARNING: Observed intervals for unknown primitives: ' + ', '.join(extraObserved))

    # Second pass to finish each SparseUtilizationList
    await log('Finalizing indexes')
    flatSulList = [allSuls['intervals']] + list(allSuls['primitives'].values()) + list(allSuls['metrics'].values())
    for sul in flatSulList:
        sul.finalize(allLocations)
        await log('.', end='')
    await log('')

    # start processing interval histograms
    dummyLocation = 1
    count = 0
    intervalDurationDomainDict = dict()
    for primitive in intervalHistograms:
        allSuls['intervalHistograms'][primitive] = SparseUtilizationList(False)
        for ind, value in intervalHistograms[primitive].items():
            allSuls['intervalHistograms'][primitive].setIntervalAtLocation({'index': int(ind), 'counter': 0, 'util': value}, dummyLocation)

        allSuls['intervalHistograms'][primitive].sortAtLoc(dummyLocation)
        length = len(allSuls['intervalHistograms'][primitive].locationDict[dummyLocation])
        intervalDurationDomainDict[primitive] = [
            allSuls['intervalHistograms'][primitive].locationDict[dummyLocation][0]['index'],
            allSuls['intervalHistograms'][primitive].locationDict[dummyLocation][length-1]['index']
        ]
        count += 1
        if count % 2500 == 0:
            await log('.', end='')
        if count % 100000 == 0:
            await log('processed %i interval histograms' % count)

    await log('')
    await log('Finished processing %s interval histograms' % count)

    # Second pass to finish each SparseUtilizationList for interval histograms
    await log('Finalizing interval histograms')
    flatSulList = list(allSuls['intervalHistograms'].values())
    for sul in flatSulList:
        sul.finalize([dummyLocation], True)
        await log('.', end='')
    await log('')

    self[datasetId]['sparseUtilizationList'] = allSuls
    self[datasetId]['info']['intervalDurationDomain'] = intervalDurationDomainDict


async def buildDependencyTree(self, datasetId, log=logToConsole):
    def is_include_primitive_name(primitive: str):
        # return True
        # if '$' in primitive:
        #     return True
        # return False
        if 'APEX MAIN' in primitive:
            return False
        return True
    await log('Building dependency tree')
    primitive_set = dict()
    dId = 0
    while str(dId) in self[datasetId]['intervals']:
        intervalObj = self[datasetId]['intervals'][str(dId)]
        if intervalObj['parent'] is None:
            if is_include_primitive_name(intervalObj['Primitive']):
                if intervalObj['Primitive'] not in primitive_set:
                    primitive_set[intervalObj['Primitive']] = list()
                primitive_set[intervalObj['Primitive']].append(str(dId))
        dId = dId + 1

    def getChildren(cId):
        currentNode = DependencyTreeNode()
        intObj = self[datasetId]['intervals'][cId]
        currentNode.setName(intObj['Primitive'])
        for childId in intObj['children']:
            if is_include_primitive_name(self[datasetId]['intervals'][childId]['Primitive']):
                currentNode.addChildren(getChildren(childId))
        currentNode.addIntervalToAggregatedList(intObj)
        return currentNode

    def mergeTwoTrees(tree1, tree2):
        if tree1.name != tree2.name:
            return
        for eachTree2Child in tree2.children:
            tree1.addChildren(eachTree2Child)  # call add children instead of list.append to merge safely
        tree1.intervalList.extend(tree2.intervalList)
        tree1.aggregatedBlockList.extend(tree2.aggregatedBlockList)

    count = 0
    pre_c = None
    for prim in primitive_set:
        for each_interval_id in primitive_set[prim]:
            thisNode = DependencyTreeNode()
            newChild = getChildren(each_interval_id)
            thisNode.addChildren(newChild)
            thisNode.aggregatedBlockList.extend(newChild.aggregatedBlockList)
            thisNode.intervalList.extend(newChild.intervalList)
            current_c = thisNode
            if pre_c is None:
                pre_c = current_c
            else:
                mergeTwoTrees(pre_c, current_c)
            count += 1
            if count % 2500 == 0:
                await log('.', end='')
            if count % 100000 == 0:
                await log('processed %i primitives' % count)
    await log('')

    results = pre_c
    if results:
        results.finalizeTreeNode()
    self[datasetId]['dependencyTree'] = results
