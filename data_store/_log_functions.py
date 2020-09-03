import re
from .loggers import logToConsole

from ._newick_functions import treeModeParser, unflaggedTreeParser
from ._dot_functions import dotModeParser
from ._csv_functions import perfModeParser

# Tools for handling a combined log file
timeParser = re.compile(r'time: ([\d\.]+)')

async def processPhylanxLog(self, datasetId, lines, log=logToConsole):
    mode = None
    newR = seenR = newL = seenL = maxTime = 0
    for line in lines:
        if mode is None:
            if treeModeParser.match(line):
                mode = 'tree'
                await log('Parsing tree...')
            elif unflaggedTreeParser.match(line):
                await log('Parsing unflagged line that looks like a newick tree...')
                await self.processNewickTree(datasetId, line)
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
            await self.processNewickTree(datasetId, line, log)
            mode = None
        elif mode == 'dot':
            counts = self.processDotLine(datasetId, line)
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
            counts = self.processCsvLine(datasetId, line)
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

async def processPhylanxLogFile(self, datasetId, file, log=logToConsole):
    def lineGenerator():
        for line in file:
            yield line
    self.addSourceFile(datasetId, file.name, 'log')
    await self.processPhylanxLog(datasetId, lineGenerator(), log)
    self.finishLoadingSourceFile(datasetId, file.name)
