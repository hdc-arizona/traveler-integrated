import re
from . import logToConsole

# Tools for handling the performance csv
perfModeParser = re.compile(r'primitive_instance,display_name,count,time,eval_direct')
perfLineParser = re.compile(r'"([^"]*)","([^"]*)",(\d+),(\d+),(-?\d)')

def processCsvLine(self, datasetId, line):
    perfLine = perfLineParser.match(line)
    if perfLine is None:
        return None

    primitiveName = perfLine[1]
    primitive, newR = self.processPrimitive(datasetId, primitiveName, 'csv')
    primitive['display_name'] = perfLine[2]
    primitive['count'] = int(perfLine[3])
    primitive['time'] = float(perfLine[4])
    primitive['eval_direct'] = float(perfLine[5])
    primitive['avg_time'] = primitive['time'] / primitive['count'] if primitive['count'] != 0 else primitive['time']
    self[datasetId]['primitives'][primitiveName] = primitive # tells the primitives diskcache that there was an update
    return (newR, primitive['time'])

async def processCsv(self, datasetId, lines, log=logToConsole):
    newR = seenR = maxTime = 0
    assert perfModeParser.match(next(lines)) is not None
    for line in lines:
        counts = self.processCsvLine(datasetId, line)
        if counts is None:
            break
        newR += counts[0]
        seenR += 1 if counts[0] == 0 else 0
        maxTime = max(maxTime, counts[1])
    await log('Finished parsing performance CSV')
    await log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
    await log('Max inclusive time seen in performance CSV (ns): %f' % maxTime)

async def processCsvFile(self, datasetId, file, log=logToConsole):
    def lineGenerator():
        for line in file:
            yield line
    self.addSourceFile(datasetId, file.name, 'csv')
    await self.processCsv(datasetId, lineGenerator(), log)
    self.finishLoadingSourceFile(datasetId, file.name)
