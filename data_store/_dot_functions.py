import re
from .loggers import logToConsole

# Tools for handling the DOT graph
dotModeParser = re.compile(r'graph "[^"]*" {')
dotLineParser = re.compile(r'"([^"]*)" -- "([^"]*)";')

def processDotLine(self, datasetId, line):
    dotLine = dotLineParser.match(line)
    if dotLine is None:
        return None

    newR = self.processPrimitive(datasetId, dotLine[1], 'dot')[1]
    seenR = 1 if newR == 0 else 0
    r = self.processPrimitive(datasetId, dotLine[2], 'dot')[1]
    newR += r
    seenR += 1 if r == 0 else 0
    newL = self.addPrimitiveChild(dotLine[1], dotLine[2], 'dot')[1]
    seenL = 1 if newL == 0 else 0
    return (newR, seenR, newL, seenL)

async def processDot(self, datasetId, lines, log=logToConsole):
    newR = seenR = newL = seenL = 0
    assert dotModeParser.match(next(lines)) is not None
    for line in lines:
        temp = self.processDotLine(datasetId, line)
        if temp is None:
            break
        newR += temp[0]
        seenR += temp[1]
        newL += temp[2]
        seenL += temp[3]
    await log('Finished parsing DOT graph')
    await log('New primitives: %d, References to existing primitives: %d' % (newR, seenR))
    await log('New links: %d, Observed existing links: %d' % (newL, seenL))

async def processDotFile(self, datasetId, file, log=logToConsole):
    def lineGenerator():
        for line in file:
            yield line
    self.addSourceFile(datasetId, file.name, 'dot')
    await self.processDot(datasetId, lineGenerator(), log)
    self.finishLoadingSourceFile(datasetId, file.name)
