import os
import re
import sys
import shutil
import shelve
import pickle
import errno
import newick
from blist import sortedlist #pylint: disable=import-error
from intervaltree import Interval, IntervalTree #pylint: disable=import-error

# Possible files / metadata structures that we create / open / update
shelves = ['meta', 'primitives', 'primitiveLinks', 'intervals', 'guids', 'events']
requiredShelves = ['meta', 'primitives', 'primitiveLinks']
pickles = ['intervalIndexes', 'metricIndexes', 'trees', 'physl', 'python', 'cpp']
requiredMetaLists = ['sourceFiles']
requiredPickleDicts = ['trees']

# Tools for handling the tree
treeModeParser = re.compile(r'Tree information for function:')
unflaggedTreeParser = re.compile(r'\(\(\(\(\(.*;')  # assume a line beginning with at least 5 parens is the tree

# Tools for handling the DOT graph
dotModeParser = re.compile(r'graph "[^"]*" {')
dotLineParser = re.compile(r'"([^"]*)" -- "([^"]*)";')

# Tools for handling the performance csv
perfModeParser = re.compile(r'primitive_instance,display_name,count,time,eval_direct')
perfLineParser = re.compile(r'"([^"]*)","([^"]*)",(\d+),(\d+),(-?1)')

# Tools for handling the inclusive time line
timeParser = re.compile(r'time: ([\d\.]+)')

# Tools for handling OTF2 traces
eventLineParser = re.compile(r'^(\S+)\s+(\d+)\s+(\d+)\s+(.*)$')
attrParsers = {
    'ENTER': r'(Region): "([^"]*)"',
    'LEAVE': r'(Region): "([^"]*)"'
}
addAttrLineParser = re.compile(r'^\s+ADDITIONAL ATTRIBUTES: (.*)$')
addAttrSplitter = re.compile(r'\), \(')
addAttrParser = re.compile(r'\(?"([^"]*)" <\d+>; [^;]*; ([^\)]*)')

metricLineParser = re.compile(r'^METRIC\s+(\d+)\s+(\d)+\s+Metric:[\s\d,]+Value: \("([^"]*)" <\d+>; [^;]*; ([^\)]*)')

async def logToConsole(value, end='\n'):
    sys.stderr.write('\x1b[0;32;40m' + value + end + '\x1b[0m')
    sys.stderr.flush()

# pylint: disable=R0904
class Database:
    def __init__(self, dbDir='/tmp/traveler-integrated', debugSources=False):
        self.dbDir = dbDir
        self.debugSources = debugSources
        self.sortedEventsByLocation = None
        if not os.path.exists(self.dbDir):
            os.makedirs(self.dbDir)

        self.datasets = {}

    async def load(self, log=logToConsole):
        # Load any files that exist (or create missing required files)
        for label in os.listdir(self.dbDir):
            self.datasets[label] = {}
            labelDir = os.path.join(self.dbDir, label)
            for stype in shelves:
                spath = os.path.join(labelDir, stype + '.shelf')
                if os.path.exists(spath):
                    await log('Loading %s %s...' % (label, stype))
                    self.datasets[label][stype] = shelve.open(spath)
                elif os.path.exists(spath + '.db'): # shelves auto-add .db to their filenames on some platforms (but not all); see https://stackoverflow.com/questions/8704728/using-python-shelve-cross-platform
                    await log('Loading %s %s...' % (label, stype))
                    self.datasets[label][stype] = shelve.open(spath)
                elif stype in requiredShelves:
                    raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), spath)
            for stype in pickles:
                spath = os.path.join(labelDir, stype + '.pickle')
                if os.path.exists(spath):
                    await log('Loading %s %s...' % (label, stype))
                    if stype == 'intervalIndexes':
                        await log('(may take a while if %s is large)' % label)
                    self.datasets[label][stype] = pickle.load(open(spath, 'rb'))
            for listType in requiredMetaLists:
                self.datasets[label]['meta'][listType] = self.datasets[label]['meta'].get(listType, [])

    def datasetList(self):
        return list(self.datasets.keys())

    def __getitem__(self, label):
        return self.datasets[label]

    def __contains__(self, label):
        return label in self.datasets

    def createDataset(self, label):
        labelDir = os.path.join(self.dbDir, label)
        if label in self.datasets or os.path.exists(labelDir):
            self.purgeDataset(label)
        self.datasets[label] = {}
        os.makedirs(labelDir)
        for stype in requiredShelves:
            spath = os.path.join(labelDir, stype + '.shelf')
            self.datasets[label][stype] = shelve.open(spath)
        for stype in requiredPickleDicts:
            self.datasets[label][stype] = {}
        for listType in requiredMetaLists:
            self.datasets[label]['meta'][listType] = self.datasets[label]['meta'].get(listType, [])

    def purgeDataset(self, label):
        del self.datasets[label]
        labelDir = os.path.join(self.dbDir, label)
        if os.path.exists(labelDir):
            shutil.rmtree(labelDir)

    def addSourceFile(self, label, fileName, fileType):
        # Have to do this separately because meta is a shelf
        sourceFiles = self.datasets[label]['meta']['sourceFiles']
        sourceFiles.append({'fileName': fileName, 'fileType': fileType})
        self.datasets[label]['meta']['sourceFiles'] = sourceFiles

    def addTree(self, label, tree, sourceType):
        self.datasets[label]['trees'][sourceType] = tree

    async def save(self, label, log=logToConsole):
        labelDir = os.path.join(self.dbDir, label)
        for stype in self.datasets[label].keys():
            if stype in shelves:
                await log('Saving %s shelf: %s' % (label, stype))
                self.datasets[label][stype].close()
                # .sync() doesn't actually push all the data to disk (because we're not
                # using writeback?), so we close + reopen the shelf
                self.datasets[label][stype] = shelve.open(os.path.join(labelDir, stype + '.shelf'))
            elif stype in pickles:
                await log('Saving %s pickle: %s' % (label, stype))
                with open(os.path.join(labelDir, stype + '.pickle'), 'wb') as pickleFile:
                    pickle.dump(self.datasets[label][stype], pickleFile)

    async def close(self, log=logToConsole):
        for label, dataset in self.datasets.items():
            for stype in dataset.keys():
                if stype in shelves:
                    await log('Closing %s shelf: %s' % (label, stype))
                    dataset[stype].close()

    def processPrimitive(self, label, primitiveName, source=None):
        primitives = self.datasets[label]['primitives']
        primitive = primitives.get(primitiveName, {'parents': [], 'children': []})
        updatedSources = False
        if self.debugSources:
            primitive['sources'] = primitive.get('sources', [])
            if source is not None and source not in primitive['sources']:
                primitive['sources'].append(source)
                updatedSources = True
        if primitiveName in primitives:
            # Already existed
            if updatedSources:
                primitives[primitiveName] = primitive # tells the primitives shelf that there was an update
            return (primitive, 0)
        primitiveChunks = primitiveName.split('$')
        primitive['name'] = primitiveChunks[0]
        if len(primitiveChunks) >= 3:
            primitive['line'] = primitiveChunks[-2]
            primitive['char'] = primitiveChunks[-1]
        primitives[primitiveName] = primitive
        return (primitive, 1)

    def addPrimitiveChild(self, label, parent, child, source=None):
        primitives = self.datasets[label]['primitives']
        assert parent in primitives and child in primitives
        parentPrimitive = primitives[parent]
        childPrimitive = primitives[child]
        primitiveLinks = self.datasets[label]['primitiveLinks']
        if child not in parentPrimitive['children']:
            parentPrimitive['children'].append(child)
            primitives[parent] = parentPrimitive # tells the primitives shelf that there was an update
        if parent not in childPrimitive['parents']:
            childPrimitive['parents'].append(parent)
            primitives[child] = childPrimitive # tells the primitives shelf that there was an update

        linkId = parent + '_' + child
        link = primitiveLinks.get(linkId, {'parent': parent, 'child': child})
        updatedSources = False
        if self.debugSources:
            link['sources'] = link.get('sources', [])
            if source is not None and source not in link['sources']:
                link['sources'].append(source)
                updatedSources = True
        if linkId in primitiveLinks:
            # Already existed
            if updatedSources:
                primitiveLinks[linkId] = link # tells the primitiveLinks shelf that there was an update
            return (link, 0)
        primitiveLinks[linkId] = link
        return (link, 1)

    def processNewickNode(self, label, node):
        # Create the hashed primitive object
        if node.name is None:
            primitiveName = ''
        else:
            primitiveName = node.name.strip()
        newR = self.processPrimitive(label, primitiveName, 'newick')[1]
        seenR = 1 if newR == 0 else 0
        tree = {'name': primitiveName, 'children': []}
        newL = seenL = 0

        # Create the tree hierarchy
        if node.descendants:
            for child in node.descendants:
                childTree, nr, sr, nl, sl = self.processNewickNode(label, child)
                tree['children'].append(childTree)
                newR += nr
                seenR += sr
                l = self.addPrimitiveChild(label, primitiveName, childTree['name'], 'newick')[1]
                newL += nl + l
                seenL += sl + (1 if l == 0 else 0)
        return (tree, newR, seenR, newL, seenL)
    async def processNewickTree(self, label, newickText, log=logToConsole):
        tree, newR, seenR, newL, seenL = self.processNewickNode(label, newick.loads(newickText)[0])
        self.addTree(label, tree, 'newick')
        await log('Finished parsing newick tree')
        await log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
        await log('New links: %d, Observed existing links: %d' % (newL, seenL))
        return (newR, seenR, newL, seenL)
    async def processNewickFile(self, label, file, log=logToConsole):
        self.addSourceFile(label, file.name, 'newick')
        await self.processNewickTree(label, file.read(), log)

    def processDotLine(self, label, line):
        dotLine = dotLineParser.match(line)
        if dotLine is None:
            return None

        newR = self.processPrimitive(label, dotLine[1], 'dot')[1]
        seenR = 1 if newR == 0 else 0
        r = self.processPrimitive(label, dotLine[2], 'dot')[1]
        newR += r
        seenR += 1 if r == 0 else 0
        newL = self.addPrimitiveChild(dotLine[1], dotLine[2], 'dot')[1]
        seenL = 1 if newL == 0 else 0
        return (newR, seenR, newL, seenL)
    async def processDot(self, label, lines, log=logToConsole):
        newR = seenR = newL = seenL = 0
        assert dotModeParser.match(next(lines)) is not None
        for line in lines:
            temp = self.processDotLine(label, line)
            if temp is None:
                break
            newR += temp[0]
            seenR += temp[1]
            newL += temp[2]
            seenL += temp[3]
        await log('Finished parsing DOT graph')
        await log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
        await log('New links: %d, Observed existing links: %d' % (newL, seenL))
    async def processDotFile(self, label, file, log=logToConsole):
        def lineGenerator():
            for line in file:
                yield line
        self.addSourceFile(label, file.name, 'dot')
        await self.processDot(label, lineGenerator(), log)

    def processCsvLine(self, label, line):
        perfLine = perfLineParser.match(line)
        if perfLine is None:
            return None

        primitiveName = perfLine[1]
        primitive, newR = self.processPrimitive(label, primitiveName, 'csv')
        primitive['display_name'] = perfLine[2]
        primitive['count'] = int(perfLine[3])
        primitive['time'] = float(perfLine[4])
        primitive['eval_direct'] = float(perfLine[5])
        primitive['avg_time'] = primitive['time'] / primitive['count'] if primitive['count'] != 0 else primitive['time']
        self.datasets[label]['primitives'][primitiveName] = primitive # tells the primitives shelf that there was an update
        return (newR, primitive['time'])
    async def processCsv(self, label, lines, log=logToConsole):
        newR = seenR = maxTime = 0
        assert perfModeParser.match(next(lines)) is not None
        for line in lines:
            counts = self.processCsvLine(label, line)
            if counts is None:
                break
            newR += counts[0]
            seenR += 1 if counts[0] == 0 else 0
            maxTime = max(maxTime, counts[1])
        await log('Finished parsing performance CSV')
        await log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
        await log('Max inclusive time seen in performance CSV (ns): %f' % maxTime)
    async def processCsvFile(self, label, file, log=logToConsole):
        def lineGenerator():
            for line in file:
                yield line
        self.addSourceFile(label, file.name, 'csv')
        await self.processCsv(label, lineGenerator(), log)

    async def processPhylanxLog(self, label, lines, log=logToConsole):
        mode = None
        newR = seenR = newL = seenL = maxTime = 0
        for line in lines:
            if mode is None:
                if treeModeParser.match(line):
                    mode = 'tree'
                    await log('Parsing tree...')
                elif unflaggedTreeParser.match(line):
                    await log('Parsing unflagged line that looks like a newick tree...')
                    await self.processNewickTree(label, line)
                elif dotModeParser.match(line):
                    mode = 'dot'
                    await log('Parsing graph...')
                elif perfModeParser.match(line):
                    mode = 'perf'
                    await log('Parsing performance csv...')
                elif timeParser.match(line):
                    time = 1000000000 * float(timeParser.match(line)[1])
                    await log('Total inclusive time from phylanx log (converted to ns): %f' % time)
            elif mode == 'tree':
                await self.processNewickTree(label, line, log)
                mode = None
            elif mode == 'dot':
                counts = self.processDotLine(label, line)
                if counts is not None:
                    newR += counts[0]
                    seenR += counts[1]
                    newL += counts[2]
                    seenL += counts[3]
                else:
                    mode = None
                    await log('Finished parsing DOT graph')
                    await log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
                    await log('New links: %d, Observed existing links: %d' % (newL, seenL))
                    newR = seenR = newL = seenL = 0
            elif mode == 'perf':
                counts = self.processCsvLine(label, line)
                if counts is not None:
                    newR += counts[0]
                    seenR += 1 if counts[0] == 0 else 0
                    maxTime = max(maxTime, counts[1])
                else:
                    mode = None
                    await log('Finished parsing performance CSV')
                    await log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
                    await log('Max inclusive time seen in performance CSV (ns): %f' % maxTime)
                    newR = seenR = 0
            else:
                # Should never reach this point
                assert False
    async def processPhylanxLogFile(self, label, file, log=logToConsole):
        def lineGenerator():
            for line in file:
                yield line
        self.addSourceFile(label, file.name, 'log')
        await self.processPhylanxLog(label, lineGenerator(), log)

    def processCode(self, label, name, codeLines, codeType):
        assert codeType in ['physl', 'python', 'cpp']
        self.addSourceFile(label, name, codeType)
        self.datasets[label][codeType] = '\n'.join(codeLines)
    async def processCodeFile(self, label, file, codeType, log=logToConsole):
        self.processCode(label, file.name, file.read().splitlines(), codeType)
        await log('Finished parsing %s code' % codeType)

    def processEvent(self, label, event, eventId):
        newR = seenR = newG = seenG = 0

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

            # Add to GUID / Parent GUID relationships
            if self.datasets[label]['meta']['hasGuids'] and 'GUID' in event and 'Parent GUID' in event:
                if 'guids' not in primitive:
                    primitive['guids'] = [event['GUID']]
                elif event['GUID'] not in primitive['guids']:
                    # TODO: list lookups instead of set lookups aren't as optimal...
                    # but storing sets may or may not be supported
                    primitive['guids'].append(event['GUID'])
                guid = self.datasets[label]['guids'].get(event['GUID'], None)
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
                self.datasets[label]['guids'][event['GUID']] = guid

            self.datasets[label]['primitives'][primitiveName] = primitive
        # Add enter / leave events to per-location lists
        if event['Event'] == 'ENTER' or event['Event'] == 'LEAVE':
            if not event['Location'] in self.sortedEventsByLocation:
                # TODO: use BPlusTree instead of blist? For big enough runs, piling
                # all this up in memory could be a problem...
                self.sortedEventsByLocation[event['Location']] = sortedlist(key=lambda i: i[0])
            self.sortedEventsByLocation[event['Location']].add((event['Timestamp'], event))
        # Add the event
        if self.datasets[label]['meta']['hasEvents']:
            self.datasets[label]['events'][eventId] = event
        return (newR, seenR, newG, seenG)

    async def processOtf2(self, label, file, parseGuids=False, storeEvents=False, log=logToConsole):
        self.addSourceFile(label, file.name, 'otf2')

        # Set up database files
        labelDir = os.path.join(self.dbDir, label)
        primitives = self.datasets[label]['primitives']
        intervals = self.datasets[label]['intervals'] = shelve.open(os.path.join(labelDir, 'intervals.shelf'))
        intervalIndexes = self.datasets[label]['intervalIndexes'] = {
            'primitives': {},
            'locations': {},
            'both': {}
        }
        metricIndexes = self.datasets[label]['metricIndexes'] = {}
        self.datasets[label]['meta']['hasGuids'] = parseGuids
        if parseGuids:
            guids = self.datasets[label]['guids'] = shelve.open(os.path.join(labelDir, 'guids.shelf'))
        self.datasets[label]['meta']['hasEvents'] = storeEvents
        if storeEvents:
            self.datasets[label]['events'] = shelve.open(os.path.join(labelDir, 'events.shelf'))

        # Temporary counters / lists for sorting
        numEvents = 0
        self.sortedEventsByLocation = {}
        await log('Parsing events (.=2500 events)')
        newR = seenR = newG = seenG = 0
        currentEvent = None
        for line in file:
            eventLineMatch = eventLineParser.match(line)
            addAttrLineMatch = addAttrLineParser.match(line)
            metricLineMatch = metricLineParser.match(line)
            if currentEvent is None and eventLineMatch is None and metricLineMatch is None:
                # This is a blank / header line
                continue

            if metricLineMatch is not None:
                # This is a metric line
                location = metricLineMatch.group(1)
                timestamp = metricLineMatch.group(2)
                metricType = metricLineMatch.group(3)
                value = metricLineMatch.group(4)
                if location not in metricIndexes:
                    metricIndexes[location] = {}
                if metricType not in metricIndexes[location]:
                    metricIndexes[location][metricType] = IntervalTree()
                # TODO: actually add value + timestamp to mtericIndexes[location][metricType]; I don't remember exactly how it dealt with point events instead of intervals
            elif eventLineMatch is not None:
                # This is the beginning of a new event; process the previous one
                if currentEvent is not None:
                    counts = self.processEvent(label, currentEvent, str(numEvents))
                    # Log that we've processed another event
                    numEvents += 1
                    if numEvents % 2500 == 0:
                        await log('.', end='')
                    if numEvents % 100000 == 0:
                        await log('processed %i events' % numEvents)
                    # Add to primitive / guid counts
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
            counts = self.processEvent(label, currentEvent, str(numEvents))
            newR += counts[0]
            seenR += counts[1]
            newG += counts[2]
            seenG += counts[3]
        await log('')
        await log('Finished processing %i events' % numEvents)
        await log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
        if parseGuids:
            await log('New GUIDs: %d, Number of GUID references: %d' % (newG, seenG))

        # Now that we've seen all the locations, store that list in our metadata
        locationNames = self.datasets[label]['meta']['locationNames'] = sorted(self.sortedEventsByLocation.keys())

        # Combine the sorted enter / leave events into intervals, and then index
        # the intervals
        await log('Combining enter / leave events into intervals (.=2500 intervals)')
        numIntervals = 0
        for location, eventList in self.sortedEventsByLocation.items():
            lastEvent = None
            for _, event in eventList:
                assert event is not None
                if event['Event'] == 'ENTER':
                    # Start an interval (don't output anything)
                    if lastEvent is not None:
                        # TODO: factorial data used to trigger this... why?
                        await log('WARNING: omitting ENTER event without a following LEAVE event (%s)' % lastEvent['name']) #pylint: disable=unsubscriptable-object
                    lastEvent = event
                elif event['Event'] == 'LEAVE':
                    # Finish a interval
                    if lastEvent is None:
                        # TODO: factorial data used to trigger this... why?
                        await log('WARNING: omitting LEAVE event without a prior ENTER event (%s)' % event['name'])
                        continue
                    intervalId = str(numIntervals)
                    currentInterval = {'enter': {}, 'leave': {}, 'intervalId': intervalId }
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
                        await log('.', end='')
                    if numIntervals % 100000 == 0:
                        await log('processed %i intervals' % numIntervals)
                    lastEvent = None
            # Make sure there are no trailing ENTER events
            if lastEvent is not None:
                # TODO: fibonacci data triggers this... why?
                await log('WARNING: omitting trailing ENTER event (%s)' % lastEvent['Primitive'])
        await log('')
        await log('Finished creating %i intervals' % numIntervals)

        # Now for indexing: we want per-location indexes, per-primitive indexes,
        # as well as both filters at the same time (we key by locations first)
        # TODO: these are all built in memory... should probably find a way to
        # make a shelve-like version of IntervalTree:
        for location in locationNames:
            intervalIndexes['locations'][location] = IntervalTree()
            intervalIndexes['both'][location] = {}
        for primitive in primitives.keys():
            intervalIndexes['primitives'][primitive] = IntervalTree()
            for location in locationNames:
                intervalIndexes['both'][location][primitive] = IntervalTree()

        await log('Assembling interval indexes (.=2500 intervals)')
        count = 0
        async def intervalIterator():
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
                intervalIndexes['locations'][location].add(iv)
                if 'Primitive' in intervalObj:
                    intervalIndexes['primitives'][intervalObj['Primitive']].add(iv)
                    intervalIndexes['both'][location][intervalObj['Primitive']].add(iv)
                elif 'Primitive' in intervalObj['enter']:
                    intervalIndexes['primitives'][intervalObj['enter']['Primitive']].add(iv)
                    intervalIndexes['both'][location][intervalObj['enter']['Primitive']].add(iv)

                count += 1
                if count % 2500 == 0:
                    await log('.', end='')
                if count % 100000 == 0:
                    await log('processed %i intervals' % count)

                yield iv
        # Iterate through all intervals to construct the main index:
        intervalIndexes['main'] = IntervalTree([iv async for iv in intervalIterator()])

        # Store the domain of the data from the computed index as metadata
        self.datasets[label]['meta']['intervalDomain'] = [
            intervalIndexes['main'].top_node.begin,
            intervalIndexes['main'].top_node.end
        ]
        await log('')
        await log('Finished indexing %i intervals' % count)

        await log('Connecting intervals with the same GUID (.=2500 intervals)')
        guidCount = 0
        count = 0
        missingCount = 0
        lastGuidIntervals = {}
        for iv in intervalIndexes['main'].iterOverlap(endOrder=True):
            intervalId = iv.data
            intervalObj = intervals[intervalId]
            if 'GUID' not in intervalObj:
                missingCount += 1
            elif intervalObj['GUID'] in lastGuidIntervals:
                lastId = lastGuidIntervals[intervalObj['GUID']]
                previousIv = intervals[lastId]
                intervalObj['lastGuidIntervalId'] = lastId
                intervalObj['lastGuidLocation'] = previousIv['Location']
                intervalObj['lastGuidEndTimestamp'] = previousIv['leave']['Timestamp']
                # Because intervals is a shelf, it needs a copy to know that something changed
                intervals[intervalId] = intervalObj.copy()
                count += 1
                lastGuidIntervals[intervalObj['GUID']] = intervalId
            else:
                lastGuidIntervals[intervalObj['GUID']] = intervalId
                count += 1
                guidCount += 1
        await log('Finished connecting %i intervals' % count)
        await log('GUIDs used: %i, Intervals without GUIDs: %i' % (guidCount, missingCount))

        # Create any missing parent-child primitive relationships based on the GUIDs we've collected
        if parseGuids:
            await log('Creating primitive links based on GUIDs (.=2500 GUIDs processed)')
            newL = seenL = 0
            for nGuid, guid in enumerate(guids.values()):
                if guid['parent'] != '0':
                    parentGuid = guids.get(guid['parent'], None)
                    assert parentGuid is not None
                    for parentPrimitive in parentGuid['primitives']:
                        for childPrimitive in guid['primitives']:
                            l = self.addPrimitiveChild(label, parentPrimitive, childPrimitive, 'otf2')[1]
                            newL += l
                            seenL += 1 if newL == 0 else 0
                if nGuid > 0 and nGuid % 250 == 0:
                    await log('.', end='')
                if nGuid > 0 and nGuid % 10000 == 0:
                    await log('scanned %i GUIDs' % nGuid)
            await log('')
            await log('Finished scanning %d GUIDs' % len(guids))
            await log('New links: %d, Observed existing links: %d' % (newL, seenL))
